import type {
  CollectionReference,
  DocumentData,
  QuerySnapshot,
} from "firebase/firestore"
import { ChunkedSnapshotListener } from "./ChunkedSnapshotListener"
import { intersect } from "./helpers"

type CachedDocument = DocumentData & { id: string }

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

type CollectionSubscription = {
  hookId: string
  collection: CollectionReference
  onDocs: (docs: CachedDocument[]) => void
  onError: (error: Error) => void
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

  snapshotListenersByCollectionPath: Record<
    string,
    ChunkedSnapshotListener
  > = {}

  subscriptionsByCollectionPath: Record<
    string,
    CollectionSubscription[]
  > = {}
  docsCacheByCollectionPath: Record<
    string,
    Record<string, CachedDocument>
  > = {}
  docIdsByHookId: Record<string, string[]> = {}
  subscribedIdsByPath: Record<string, string[]> = {}
  collectionReferencesByPath: Record<
    string,
    CollectionReference
  > = {}

  constructor(debug: boolean) {
    this.debug = debug
  }

  log(...args: Parameters<typeof console.log>) {
    if (!this.debug) return
    console.log(`${red("use-firestore")} 🔥`, ...args)
  }

  registerDocsHook(
    hookId: string,
    collection: CollectionReference,
    ids: string[],
    onDocs: (docs: CachedDocument[]) => void,
    onError: (error: Error) => void
  ) {
    this.collectionReferencesByPath[collection.path] = collection

    const existingListener =
      this.snapshotListenersByCollectionPath[collection.path]

    // First we make sure some data structures are present for this collection
    let collectionSubscriptions =
      this.subscriptionsByCollectionPath[collection.path]

    if (!collectionSubscriptions) {
      collectionSubscriptions = []
      this.subscriptionsByCollectionPath[collection.path] =
        collectionSubscriptions
    }

    let docsCache =
      this.docsCacheByCollectionPath[collection.path]

    if (!docsCache) {
      docsCache = {}
      this.docsCacheByCollectionPath[collection.path] = docsCache
    }

    // Then we create a new subscription
    const subscription: CollectionSubscription = {
      hookId,
      onDocs,
      onError,
      collection,
    }

    collectionSubscriptions.push(subscription)

    this.log(
      "Registering",
      hookId,
      existingListener
        ? `⇒ has owner (${collectionSubscriptions.length} listeners)`
        : "⇒ subscribing..."
    )

    if (!ids) {
      throw new Error(
        "registerDocsHook must receive an array of ids"
      )
    }

    this.docIdsByHookId[hookId] = ids

    /**
     * Give up ownership of the path, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unregister = () => {
      this.log("Unregistering hook", hookId)

      const index = collectionSubscriptions.findIndex(
        (subscription) => subscription.hookId === hookId
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
          "Collection",
          collection.path,
          "still has",
          collectionSubscriptions.length,
          "subscriptions"
        )
        return
      }

      // Else shut it down
      const listener =
        this.snapshotListenersByCollectionPath[collection.path]

      if (!listener) {
        throw new Error(
          `No unsubscribe function found for collection ${collection.path} even though ${hookId} was subscribed?`
        )
      }

      delete this.snapshotListenersByCollectionPath[
        collection.path
      ]

      listener.shutDown()

      this.log("Unsubscribed from", collection.path)
    }

    // End of sub-routines, final steps of .register method:

    if (existingListener) {
      existingListener.addIds(ids)
    } else {
      const listener = new ChunkedSnapshotListener(
        this.debug,
        collection,
        ids,
        (snapshot) => {
          this.handleSnapshot(collection.path, snapshot)
        }
      )

      this.snapshotListenersByCollectionPath[collection.path] =
        listener

      this.log(
        "Waiting to see if other hooks will register",
        collection.path,
        "ids..."
      )

      setTimeout(() => {
        this.log("Done waiting for", collection.path, "ids.")
        listener.start()
      }, 1)
    }

    const idsMissing: string[] = []

    const docs = ids.map((id) => {
      if (!docsCache[id]) idsMissing.push(id)
      return docsCache[id]
    })

    const hookIsFullyCached = idsMissing.length === 0

    return {
      unregister,
      cachedDocs: hookIsFullyCached ? docs : undefined,
    }
  }

  handleSnapshot(
    collectionPath: string,
    querySnapshot: QuerySnapshot
  ) {
    const dirtyIds: string[] = []

    const docsCache =
      this.docsCacheByCollectionPath[collectionPath]

    this.log(
      "Snapshot on",
      collectionPath,
      "with",
      querySnapshot.size,
      "docs"
    )

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

    const collectionSubscriptions =
      this.subscriptionsByCollectionPath[collectionPath]

    const listener =
      this.snapshotListenersByCollectionPath[collectionPath]

    for (const subscription of collectionSubscriptions) {
      const dirtyIdsForHook = intersect([
        dirtyIds,
        this.docIdsByHookId[subscription.hookId],
      ])

      const missingIds = this.docIdsByHookId[
        subscription.hookId
      ].filter((id) => !docsCache[id])

      if (dirtyIdsForHook.length === 0) {
        this.log(
          "Hook",
          subscription.hookId,
          "does not need to be notified it is waiting for",
          this.docIdsByHookId[subscription.hookId],
          listener.isLoaded
            ? "...listener is fully loaded"
            : "...listener still waiting on chunks"
        )

        if (missingIds.length > 0 && listener.isLoaded) {
          this.log(
            "No document in collection",
            collectionPath,
            "with id(s)",
            missingIds
          )

          subscription.onError(
            new Error(
              `No document in collection ${collectionPath} with id(s) ${missingIds.join(
                ","
              )}`
            )
          )

          return
        }

        continue
      }

      this.log(
        "Collecting documents for",
        subscription.hookId,
        "ids",
        this.docIdsByHookId[subscription.hookId],
        "...",
        missingIds,
        "are missing"
      )

      if (missingIds.length > 0) {
        this.log(
          "Hook",
          subscription.hookId,
          "is still waiting on ids",
          missingIds
        )
        subscription.onDocs(undefined)
      } else {
        this.log(
          "Notifying",
          subscription.hookId,
          "of new docs, it wants",
          this.docIdsByHookId[subscription.hookId]
        )
        const docs = this.docIdsByHookId[
          subscription.hookId
        ].map((id) => docsCache[id])

        subscription.onDocs(docs)
      }
    }
  }

  updateDocIds(
    collectionPath: string,
    hookId: string,
    ids: string[]
  ) {
    this.docIdsByHookId[hookId] = ids

    const collectionSubscriptions =
      this.subscriptionsByCollectionPath[collectionPath]

    const docCache =
      this.docsCacheByCollectionPath[collectionPath]

    const someDocsUncached = ids.some((id) => !docCache[id])

    this.log(
      "Updated ids for",
      hookId,
      "to",
      ids,
      someDocsUncached
        ? "need to resubscribe"
        : "all docs cached"
    )

    this.snapshotListenersByCollectionPath[
      collectionPath
    ].addIds(ids)

    if (someDocsUncached) {
      return
    }

    const subscription = collectionSubscriptions.find(
      (subscription) => subscription.hookId === hookId
    )

    if (!subscription) {
      throw new Error(
        `Cannot notify ${hookId} about its updated docs because no subscription was found`
      )
    }

    const docs = ids.map((id) => docCache[id])

    subscription.onDocs(docs)
  }
}
