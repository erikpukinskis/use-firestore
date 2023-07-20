import type { DocumentData, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { serializeQuery } from "./serializeQuery"

type CachedDocument = DocumentData & { id: string; __path: string }

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

/**
 * The QueryService keeps track of:
 *
 * 1) Which hooks are currently listening for changes to queries or individual
 *    documents
 *
 * 2) Which subscriptions are providing updates for which documents
 *
 * 3) Which other subscriptions are available to provide updates for those
 *    documents should the existing one unsubscribe
 *
 * The service manages handoffs between those subscriptions, and fires up new
 * subscriptions as needed, to keep all of the hooks fed with up-to-date data.
 */
export class QueryService {
  debug: boolean

  // For queries...
  ownerByQueryKey: Record<string, string> = {}
  unsubscribeFunctionsByQueryKey: Record<string, () => void> = {}
  queryListenersByKey: Record<string, Array<(docs: CachedDocument[]) => void>> =
    {}
  lastQueryResultByKey: Record<string, Array<CachedDocument>> = {}
  assignQueryOwnerFunctionsByKey: Record<string, Array<() => void>> = {}

  constructor(debug: boolean) {
    this.debug = debug
  }

  log(...args: Parameters<typeof console.log>) {
    if (!this.debug) return
    console.log(`${red("use-firestore")} |`, ...args)
  }

  registerQueryHook(
    hookId: string,
    q: Query<DocumentData>,
    onDocs: (docs: CachedDocument[]) => void
  ) {
    this.log("registering", hookId)

    const queryKey = serializeQuery(q)

    // First we make sure these arrays are present for this path
    let queryListeners = this.queryListenersByKey[queryKey]

    if (!queryListeners) {
      queryListeners = []
      this.queryListenersByKey[queryKey] = queryListeners
    }

    let assignQueryOwnerFunctions =
      this.assignQueryOwnerFunctionsByKey[queryKey]

    if (!assignQueryOwnerFunctions) {
      assignQueryOwnerFunctions = []
      this.assignQueryOwnerFunctionsByKey[queryKey] = assignQueryOwnerFunctions
    }

    queryListeners.push(onDocs)

    /**
     * Stop passing document updates to the hook
     */
    const removeListener = () => {
      const index = queryListeners.findIndex((func) => func === onDocs)

      if (index < 0) {
        throw new Error(
          `Document listener for hook ${hookId} was already gone before unlisten() was called`
        )
      }

      queryListeners.splice(index, 1)
    }

    /**
     * If no one else is subscribed to this query yet, we'll do it
     */
    const subscribe = () => {
      this.log("subscribing to query", queryKey)

      const unsubscribeFromQuery = onSnapshot(q, (querySnapshot) => {
        const docs: CachedDocument[] = []

        this.log(queryKey, "snapshot with", querySnapshot.size, "docs")

        querySnapshot.forEach((docSnapshot) => {
          const path = docSnapshot.ref.path
          const doc = {
            id: docSnapshot.id,
            __path: path,
            ...docSnapshot.data(),
          }

          docs.push(doc)
        })

        this.lastQueryResultByKey[queryKey] = docs

        for (const listener of this.queryListenersByKey[queryKey]) {
          listener(docs)
        }
      })

      this.unsubscribeFunctionsByQueryKey[queryKey] = unsubscribeFromQuery
      this.ownerByQueryKey[queryKey] = hookId
    }

    /**
     * Give up ownership of the query, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unsubscribe = () => {
      this.log(hookId, "is unsubscribing from", queryKey)
      // Some other hook is the owner of this query key, there's nothing for us
      // to unsubscribe
      if (this.ownerByQueryKey[queryKey] !== hookId) {
        return
      }

      const assignNextQueryOwner =
        this.assignQueryOwnerFunctionsByKey[queryKey]?.shift()

      // Give up ownership
      delete this.ownerByQueryKey[queryKey]

      // If there's another hook waiting to be the new owner, let 'em have the
      // subscription
      if (assignNextQueryOwner) {
        assignNextQueryOwner()
      } else {
        // Else shut it down
        const unsubscribeFromSnapshots =
          this.unsubscribeFunctionsByQueryKey[queryKey]

        delete this.unsubscribeFunctionsByQueryKey[queryKey]

        if (!unsubscribeFromSnapshots) {
          const description = queryKey.slice(0, 50)
          throw new Error(
            `No unsubscribe function found for query ${description} even though ${hookId} is the owner?`
          )
        }

        unsubscribeFromSnapshots()
      }
    }

    /**
     * Listen for updates to the document from a pre-existing subscription, and
     * be ready to take over if needed.
     */
    const listen = () => {
      // There's already a query subscription, owned by a different hook, so we
      // don't need to set a new one up. Just register ourselves as a potential
      // next owner.
      assignQueryOwnerFunctions.push(takeOwnership)

      const lastDocs = this.lastQueryResultByKey[queryKey]

      // Since the subscription may not fire again for a while, we fire the
      // callback with the most recent results.
      if (lastDocs) onDocs(lastDocs)
    }

    /**
     * Taking ownership from an existing hook that already set up the
     * subscription is just a matter of setting our hook id as the owner
     */
    const takeOwnership = () => {
      this.ownerByQueryKey[queryKey] = hookId
      ignoreOwnershipRequests()
    }

    /**
     * If we're just a quiet little listener (not an owner) we can just quietly
     * unregister ourselves when the hook is done
     */
    const ignoreOwnershipRequests = () => {
      const index = assignQueryOwnerFunctions.findIndex(
        (func) => func === takeOwnership
      )

      if (index < 0) {
        return
      }

      assignQueryOwnerFunctions.splice(index, 1)

      this.log(
        "now there are",
        assignQueryOwnerFunctions.length,
        "available owners"
      )
    }

    /**
     * Either unlistens or unsubscribes depending on whether this hook is the
     * current subscription owner.
     */
    const unregister = () => {
      removeListener()

      // If we're the query owner, we will need to unsubscribe so we don't leave
      // lots of connections open.
      if (this.ownerByQueryKey[queryKey] === hookId) {
        // We wait a little bit before unsubscribing, just in case we're
        // navigating or something and we're about to get a new wave of hooks
        // that might want to take over ownership.
        setTimeout(unsubscribe, UNSUBSCRIBE_DELAY)
      } else {
        this.log(
          hookId,
          "is unregistering and it is not the owner,",
          this.ownerByQueryKey[queryKey],
          "is"
        )
        ignoreOwnershipRequests()
      }
    }

    let cachedResults: CachedDocument[] | undefined

    // If there's already an owner for this query, we just listen to their
    // results. Otherwise we create a new subscription.
    if (this.ownerByQueryKey[queryKey]) {
      cachedResults = this.lastQueryResultByKey[queryKey]
      listen()
    } else {
      subscribe()
    }

    return { unregister, cachedResults }
  }
}
