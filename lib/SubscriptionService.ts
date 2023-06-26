import type { DocumentData, DocumentReference, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { serializeQuery } from "./serializeQuery"

export type DocumentWithId = DocumentData & { id: string }

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
  // For documents...
  ownerByDocPath: Record<string, string> = {}
  unsubscribeFunctionsByDocPath: Record<string, () => void> = {}
  docListenersByPath: Record<string, Array<(doc: DocumentWithId) => void>> = {}
  lastDocByPath: Record<string, DocumentWithId> = {}
  assignDocOwnerFunctionsByPath: Record<string, Array<() => void>> = {}

  // For queries...
  ownerByQueryKey: Record<string, string> = {}
  unsubscribeFunctionsByQueryKey: Record<string, () => void> = {}
  queryListenersByKey: Record<string, Array<(docs: DocumentWithId[]) => void>> =
    {}
  lastQueryResultByKey: Record<string, Array<DocumentWithId>> = {}
  assignQueryOwnerFunctionsByKey: Record<string, Array<() => void>> = {}

  registerQueryHook(
    hookId: string,
    query: Query<DocumentData>,
    onDocs: (docs: DocumentWithId[]) => void
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

      const unsubscribeFromQuery = onSnapshot(query, (snapshot) => {
        const newPaths = new Set<string>()

        const docs: DocumentWithId[] = []

        snapshot.forEach((doc) => {
          const path = doc.ref.path

          newPaths.add(path)
          docs.push({ id: doc.id, ...doc.data() })

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
    }

    /**
     * Give up ownership of the query, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unsubscribe = () => {
      // Some other hook is the owner of this query key, there's nothing for us
      // to unsubscribe
      if (this.ownerByQueryKey[queryKey] !== hookId) {
        return
      }

      const assignNextOwner =
        this.assignQueryOwnerFunctionsByKey[queryKey]?.shift()

      // Give up ownership
      delete this.ownerByQueryKey[queryKey]

      // If there's another hook waiting to be the new owner, let 'em have the
      // subscription
      if (assignNextOwner) {
        assignNextOwner()
        return
      }

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
        setTimeout(unsubscribe, 1000)
      } else {
        ignoreOwnershipRequests()
      }
    }

    // If there's already an owner for this query, we just listen to their
    // results. Otherwise we create a new subscription.
    if (this.ownerByQueryKey[queryKey]) {
      listen()
    } else {
      subscribe()
    }

    return unregister
  }

  registerDocumentHook(
    hookId: string,
    ref: DocumentReference<DocumentData>,
    onDoc: (doc: DocumentWithId) => void
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
      if (this.ownerByDocPath[path]) {
        throw new Error(
          `Path ${path} is already owned by ${this.ownerByDocPath[path]}`
        )
      }

      const unsubscribeFromSnapshot = onSnapshot(ref, (snapshot) => {
        const newDoc = {
          id: ref.id,
          ...snapshot.data(),
        } as DocumentWithId

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
      // If we're not the owner of the current subscription, there's nothing to unsubscribe
      if (this.ownerByDocPath[path] !== hookId) {
        return
      }

      const assignNextOwner = this.assignDocOwnerFunctionsByPath[path]?.shift()

      // Give up ownership
      delete this.ownerByDocPath[path]

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
    }

    /**
     * Listen for updates to the document from a pre-existing subscription, and
     * be ready to take over if needed.
     */
    const listen = () => {
      // There's already a document subscription, owned by someone else. Just
      // register ourselves as a potential next owner:
      assignDocOwnerFunctions.push(takeOwnership)

      const lastDoc = this.lastDocByPath[path]

      if (lastDoc) onDoc(lastDoc)
    }

    const takeOwnership = () => {
      this.ownerByDocPath[path] = hookId
      ignoreOwnershipRequests()
    }

    /**
     * If we're just a quiet little listener (not an owner) we can just quietly
     * unregister ourselves when the hook is done
     */
    const ignoreOwnershipRequests = () => {
      const index = assignDocOwnerFunctions.findIndex((func) => func === onDoc)

      if (index < 0) {
        throw new Error(
          `Take-ownership-function for hook ${hookId} was already gone before unlisten() was called`
        )
      }

      assignDocOwnerFunctions.splice(index, 1)
    }

    /**
     * Either unlistens or unsubscribes depending on whether this hook is the
     * current subscription owner.
     */
    const unregister = () => {
      // First remove ourselves as a listener so we immediately stop sending snapshots to the callback
      removeListener()

      if (this.ownerByDocPath[path] === hookId) {
        // We wait a little bit before unsubscribing, just in case we're
        // navigating or something and we're about to get a new wave of hooks
        // that might want to take over ownership.
        setTimeout(unsubscribe, 1000)
      } else {
        ignoreOwnershipRequests()
      }
    }

    if (this.ownerByDocPath[path]) {
      listen()
    } else {
      subscribe()
    }

    return unregister
  }
}
