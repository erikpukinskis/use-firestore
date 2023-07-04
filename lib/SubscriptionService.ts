import type { DocumentData, DocumentReference, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { serializeQuery } from "./serializeQuery"

type CachedDocument = DocumentData & { id: string; __path: string }

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

/**
 * The SubscriptionService keeps track of:
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
export class SubscriptionService {
  debug: boolean

  // For documents...
  ownerByDocPath: Record<string, string> = {}
  unsubscribeFunctionsByDocPath: Record<string, () => void> = {}
  docListenersByPath: Record<string, Array<(doc: CachedDocument) => void>> = {}
  lastDocByPath: Record<string, CachedDocument> = {}
  assignDocOwnerFunctionsByPath: Record<string, Array<() => void>> = {}

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
    query: Query<DocumentData>,
    onDocs: (docs: CachedDocument[]) => void
  ) {
    const queryKey = serializeQuery(query)

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
      let previousPaths: Set<string> | undefined

      const unsubscribeFromQuery = onSnapshot(query, (querySnapshot) => {
        const newPaths = new Set<string>()

        const docs: CachedDocument[] = []

        querySnapshot.forEach((docSnapshot) => {
          const path = docSnapshot.ref.path
          const doc = {
            id: docSnapshot.id,
            __path: path,
            ...docSnapshot.data(),
          }

          newPaths.add(path)
          docs.push(doc)
          this.lastDocByPath[path] = doc

          if (!this.ownerByDocPath[path]) {
            this.ownerByDocPath[path] = hookId
          }
        })

        this.lastQueryResultByKey[queryKey] = docs

        if (previousPaths) {
          // If any document hooks are listening for changes to ids which have
          // been removed from this query, we have to loop through them and
          // check if they need new owners:
          const removedPaths = [...previousPaths].filter(
            (path) => !newPaths.has(path)
          )

          for (const path of removedPaths) {
            // If we're not the owner, we're done
            if (this.ownerByDocPath[path] !== hookId) continue

            const assignNextOwner =
              this.assignDocOwnerFunctionsByPath[path]?.[0]

            // If no one else is listening to this path, we're done
            if (!assignNextOwner) continue

            // Otherwise give away ownership of this doc and let the next hook have it
            delete this.ownerByDocPath[path]
            assignNextOwner()
          }

          previousPaths = newPaths
        }

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

      // Look for individual docs that we might be watching with useDoc hooks
      // and assign ownership to them (so they subscribe to the individual doc)
      // if needed.
      for (const doc of this.lastQueryResultByKey[queryKey]) {
        const docOwner = this.ownerByDocPath[doc.__path]

        if (docOwner !== hookId) continue

        // Give up ownership
        delete this.ownerByDocPath[doc.__path]

        const assignNextDocOwner =
          this.assignDocOwnerFunctionsByPath[doc.__path]?.shift()

        if (!assignNextDocOwner) {
          this.log("no possible owners for", doc.__path)
          continue
        }

        assignNextDocOwner()
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
        throw new Error(
          `Take-ownership-function for hook ${hookId} was already gone before unlisten() was called`
        )
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

  registerDocHook(
    hookId: string,
    ref: DocumentReference<DocumentData>,
    onDoc: (doc: CachedDocument) => void
  ) {
    const path = ref.path

    // First we make sure these arrays are present for this path
    let listeners = this.docListenersByPath[path]

    if (!listeners) {
      listeners = []
      this.docListenersByPath[path] = listeners
    }

    let assignDocOwnerFunctions = this.assignDocOwnerFunctionsByPath[path]

    if (!assignDocOwnerFunctions) {
      assignDocOwnerFunctions = []
      this.assignDocOwnerFunctionsByPath[path] = assignDocOwnerFunctions
    }

    listeners.push(onDoc)

    /**
     * Stop passing document updates to the hook
     */
    const removeListener = () => {
      const index = listeners.findIndex((func) => func === onDoc)

      if (index < 0) {
        throw new Error(
          `Document listener for hook ${hookId} was already gone before unlisten() was called`
        )
      }

      listeners.splice(index, 1)
    }

    /**
     * Subscribe to updates from this document and provide them to any and all
     * listeners to this path.
     */
    const subscribe = () => {
      this.log("doc hook", hookId, "subscribing to", path)
      if (this.ownerByDocPath[path]) {
        throw new Error(
          `Path ${path} is already owned by ${this.ownerByDocPath[path]}`
        )
      }

      const unsubscribeFromSnapshot = onSnapshot(ref, (snapshot) => {
        if (!snapshot.exists()) {
          throw new Error(
            `Received a snapshot suggesting document ${ref.path} does not exist`
          )
        }

        const newDoc = {
          id: ref.id,
          ...snapshot.data(),
        } as CachedDocument

        this.lastDocByPath[path] = newDoc

        for (const listener of listeners) {
          listener(newDoc)
        }
      })

      this.unsubscribeFunctionsByDocPath[path] = unsubscribeFromSnapshot

      this.ownerByDocPath[path] = hookId
    }

    /**
     * Give up ownership of the path, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unsubscribe = () => {
      this.log(
        "unsubscribing hook",
        hookId,
        "owner is",
        this.ownerByDocPath[path]
      )
      // If we're not the owner of the current subscription, there's nothing to unsubscribe
      if (this.ownerByDocPath[path] !== hookId) {
        return
      }

      const assignNextOwner = assignDocOwnerFunctions?.shift()

      // Give up ownership
      delete this.ownerByDocPath[path]

      this.log(path, "has another owner?", assignNextOwner ? "yes" : "no")
      // If there's someone else waiting to be the new owner, let 'em have the subscription
      if (assignNextOwner) {
        assignNextOwner()
        return
      }

      // Else shut it down
      const unsubscribeFromSnapshots = this.unsubscribeFunctionsByDocPath[path]

      if (!unsubscribeFromSnapshots) {
        throw new Error(
          `No unsubscribe function found for path ${path} even though ${hookId} is the owner?`
        )
      }

      unsubscribeFromSnapshots()
      this.log("unsubscribed from", path)
    }

    /**
     * Listen for updates to the document from a pre-existing subscription, and
     * be ready to take over if needed.
     */
    const listen = () => {
      this.log("listening", hookId)
      // There's already a document subscription, owned by someone else. Just
      // register ourselves as a potential next owner:
      assignDocOwnerFunctions.push(takeOwnership)

      this.log(assignDocOwnerFunctions.length, "owners waiting on", path) ///

      const lastDoc = this.lastDocByPath[path]

      if (lastDoc) onDoc(lastDoc)
    }

    const takeOwnership = () => {
      this.log(hookId, "is taking ownership of", path)
      if (this.unsubscribeFunctionsByDocPath[path]) {
        this.ownerByDocPath[path] = hookId
      } else {
        subscribe()
      }
      this.log(
        hookId,
        "now owns",
        path,
        "remaining owners are",
        assignDocOwnerFunctions
      )
    }

    /**
     * If we're just a quiet little listener (not an owner) we can just quietly
     * unregister ourselves when the hook is done
     */
    const ignoreOwnershipRequests = () => {
      const index = assignDocOwnerFunctions.findIndex(
        (func) => func === takeOwnership
      )

      if (index < 0) {
        throw new Error(
          `zup Doc ownership function for hook ${hookId} was already gone before unlisten() was called ${assignDocOwnerFunctions.length}`
        )
      }

      assignDocOwnerFunctions.splice(index, 1)

      this.log(assignDocOwnerFunctions.length, "owners waiting")
    }

    /**
     * Either unlistens or unsubscribes depending on whether this hook is the
     * current subscription owner.
     */
    const unregister = () => {
      const weAreTheOwner = this.ownerByDocPath[path] === hookId
      this.log(
        "unregistering",
        hookId,
        `(${weAreTheOwner ? "owner" : "not the owner"})`
      )
      // First remove ourselves as a listener so we immediately stop sending snapshots to the callback
      removeListener()

      if (weAreTheOwner) {
        // We wait a little bit before unsubscribing, just in case we're
        // navigating or something and we're about to get a new wave of hooks
        // that might want to take over ownership.
        setTimeout(unsubscribe, UNSUBSCRIBE_DELAY)
      } else {
        ignoreOwnershipRequests()
      }
    }

    let cachedDoc: CachedDocument | undefined

    if (this.ownerByDocPath[path]) {
      cachedDoc = this.lastDocByPath[path]
      listen()
    } else {
      subscribe()
    }

    return { unregister, cachedDoc }
  }
}
