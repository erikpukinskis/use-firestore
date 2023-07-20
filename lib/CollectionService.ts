import { documentId, onSnapshot, query, where } from "firebase/firestore"
import type { CollectionReference, DocumentData } from "firebase/firestore"
import intersect from "./intersect"
import { serializeQuery } from "./serializeQuery"

type CachedDocument = DocumentData & { id: string }

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

type CollectionSubscription = {
  hookId: string
  collection: CollectionReference
  onDocs(docs: CachedDocument[]): void
}

/**
 * The CollectionService keeps track of:
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
export class CollectionService {
  debug: boolean

  unsubscribeFunctionsByCollectionPath: Record<string, () => void> = {}
  subscriptionsByCollectionPath: Record<string, CollectionSubscription[]> = {}
  docsCacheByCollectionPath: Record<string, Record<string, CachedDocument>> = {}
  docIdsByHookId: Record<string, string[]> = {}

  constructor(debug: boolean) {
    this.debug = debug
  }

  log(...args: Parameters<typeof console.log>) {
    if (!this.debug) return
    console.log(`${red("use-firestore")} |`, ...args)
  }

  registerDocsHook(
    hookId: string,
    collection: CollectionReference,
    ids: string[],
    onDocs: (docs: CachedDocument[]) => void
  ) {
    // First we make sure some data structures are present for this collection
    let collectionSubscriptions =
      this.subscriptionsByCollectionPath[collection.path]

    if (!collectionSubscriptions) {
      collectionSubscriptions = []
      this.subscriptionsByCollectionPath[collection.path] =
        collectionSubscriptions
    }

    let docsCache = this.docsCacheByCollectionPath[collection.path]

    if (!docsCache) {
      docsCache = {}
      this.docsCacheByCollectionPath[collection.path] = docsCache
    }

    // Then we create a new subscription
    const subscription: CollectionSubscription = {
      hookId,
      onDocs,
      collection,
    }

    collectionSubscriptions.push(subscription)

    this.docIdsByHookId[hookId] = ids

    /**
     * Subscribe to updates from this document and provide them to any and all
     * listeners to this path.
     */
    const subscribe = () => {
      this.log("doc hook", hookId, "subscribing to", collection.path)

      const allIds = new Set<string>()

      for (const subscription of collectionSubscriptions) {
        for (const id of this.docIdsByHookId[subscription.hookId]) {
          allIds.add(id)
        }
      }

      const q = query(collection, where(documentId(), "in", [...allIds]))

      const unsubscribeFromSnapshots = onSnapshot(q, (querySnapshot) => {
        const dirtyIds: string[] = []

        for (const change of querySnapshot.docChanges()) {
          switch (change.type) {
            case "added": // We get "added" changes in the very first snapshot
            case "modified": {
              const doc: CachedDocument = {
                id: change.doc.id,
                ...change.doc.data(),
              }

              docsCache[change.doc.id] = doc

              dirtyIds.push(change.doc.id)
              break
            }
            case "removed": {
              // Means a doc got deleted. Probably need to send an undefined
              // if any docs are deleted
              delete docsCache[change.doc.id]
              break
            }
          }
        }

        for (const subscription of collectionSubscriptions) {
          const dirtyIdsForHook = intersect([
            dirtyIds,
            this.docIdsByHookId[subscription.hookId],
          ])

          if (dirtyIdsForHook.length === 0) {
            continue
          }

          const docs = this.docIdsByHookId[subscription.hookId].map(
            (id) => docsCache[id]
          )

          subscription.onDocs(docs)
        }
      })

      this.unsubscribeFunctionsByCollectionPath[collection.path] =
        unsubscribeFromSnapshots
    }

    /**
     * Give up ownership of the path, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unregister = () => {
      this.log("unsubscribing hook", hookId)

      const index = collectionSubscriptions.findIndex(
        ({ hookId }) => hookId === hookId
      )

      if (index < 0) {
        throw new Error(
          `Document listener for hook ${hookId} was already gone before unlisten() was called`
        )
      }

      collectionSubscriptions.splice(index, 1)
      delete this.docIdsByHookId[hookId]

      // If there's still another hook listening to this collection, we're done
      if (collectionSubscriptions.length > 0) {
        this.log(
          "collection",
          collection.path,
          "still has",
          collectionSubscriptions.length,
          "subscriptions"
        )
        return
      }

      // Else shut it down
      const unsubscribeFromSnapshots =
        this.unsubscribeFunctionsByCollectionPath[collection.path]

      if (!unsubscribeFromSnapshots) {
        throw new Error(
          `No unsubscribe function found for collection ${collection.path} even though ${hookId} was subscribed?`
        )
      }

      delete this.unsubscribeFunctionsByCollectionPath[collection.path]

      unsubscribeFromSnapshots()

      this.log("unsubscribed from", collection.path)
    }

    if (!this.unsubscribeFunctionsByCollectionPath[collection.path]) {
      subscribe()
    }

    const docs = this.docIdsByHookId[subscription.hookId].map(
      (id) => docsCache[id]
    )

    const hookIsFullyCached = !docs.some((doc) => doc === undefined)

    return { unregister, cachedDocs: hookIsFullyCached ? docs : undefined }
  }

  updateHookIds(hookId: string, ids: string[]) {
    this.docIdsByHookId[hookId] = ids
  }
}
