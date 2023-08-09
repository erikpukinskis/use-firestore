import {
  documentId,
  onSnapshot,
  query,
  where,
} from "firebase/firestore"
import type {
  CollectionReference,
  DocumentData,
} from "firebase/firestore"
import intersect from "./intersect"
import { serializeQuery } from "./serializeQuery"

type CachedDocument = DocumentData & { id: string }

// type CollectionState =
//   | "offline"
//   | "waiting-to-subscribe"
//   | "waiting-for-snapshot"
//   | "up-to-date"
//   | "waiting-to-re-subscribe"

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

type CollectionSubscription = {
  hookId: string
  collection: CollectionReference
  onDocs(docs: CachedDocument[] | undefined): void
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

  unsubscribeFunctionsByCollectionPath: Record<
    string,
    () => void
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
  waitingForRegistrationsOn: Record<string, boolean> = {}

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
    onDocs: (docs: CachedDocument[]) => void
  ) {
    this.collectionReferencesByPath[collection.path] = collection

    const hasOwner = Boolean(
      this.unsubscribeFunctionsByCollectionPath[collection.path]
    )

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
      collection,
    }

    collectionSubscriptions.push(subscription)

    this.log(
      "registering",
      hookId,
      hasOwner
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
      this.log("unregistering hook", hookId)

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
        this.unsubscribeFunctionsByCollectionPath[
          collection.path
        ]

      if (!unsubscribeFromSnapshots) {
        throw new Error(
          `No unsubscribe function found for collection ${collection.path} even though ${hookId} was subscribed?`
        )
      }

      delete this.unsubscribeFunctionsByCollectionPath[
        collection.path
      ]

      unsubscribeFromSnapshots()

      this.log("unsubscribed from", collection.path)
    }

    if (!hasOwner) {
      this.unsubscribeFunctionsByCollectionPath[
        collection.path
      ] = noop
      this.log(
        "waiting to see if other hooks will register",
        collection.path,
        "ids..."
      )
      this.waitingForRegistrationsOn[collection.path] = true
      setTimeout(() => {
        this.log("Done waiting for", collection.path, "ids.")
        this.subscribe(collection.path)
      })
    }

    const idsMissing: string[] = []

    const docs = this.docIdsByHookId[subscription.hookId].map(
      (id) => {
        if (!docsCache[id]) idsMissing.push(id)
        return docsCache[id]
      }
    )

    const hookIsFullyCached = idsMissing.length === 0

    if (
      !this.waitingForRegistrationsOn[collection.path] &&
      !hookIsFullyCached
    ) {
      this.log(
        collection.path,
        "collection is missing ids",
        idsMissing,
        "resubscribing..."
      )
      this.resubscribe(collection.path)
    }

    return {
      unregister,
      cachedDocs: hookIsFullyCached ? docs : undefined,
    }
  }

  subscribe(collectionPath: string) {
    this.waitingForRegistrationsOn[collectionPath] = false
    const allIds = new Set<string>()

    const collectionSubscriptions =
      this.subscriptionsByCollectionPath[collectionPath]

    const docsCache =
      this.docsCacheByCollectionPath[collectionPath]

    for (const subscription of collectionSubscriptions) {
      for (const id of this.docIdsByHookId[
        subscription.hookId
      ]) {
        allIds.add(id)
      }
    }

    this.subscribedIdsByPath[collectionPath] = [...allIds]

    if (this.subscribedIdsByPath[collectionPath].length < 1) {
      this.log(
        "collection",
        collectionPath,
        "has no documents to query, skipping."
      )
      this.unsubscribeFunctionsByCollectionPath[collectionPath] =
        noop

      return
    }

    const q = query(
      this.collectionReferencesByPath[collectionPath],
      where(
        documentId(),
        "in",
        this.subscribedIdsByPath[collectionPath]
      )
    )

    this.log(
      "subscribing to collection snapshots with query:",
      serializeQuery(q),
      "there are",
      collectionSubscriptions.length,
      "subscriptions"
    )

    const unsubscribeFromSnapshots = onSnapshot(
      q,
      (querySnapshot) => {
        const dirtyIds: string[] = []

        this.log(
          collectionPath,
          "snapshot with",
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

        for (const subscription of collectionSubscriptions) {
          const dirtyIdsForHook = intersect([
            dirtyIds,
            this.docIdsByHookId[subscription.hookId],
          ])

          if (dirtyIdsForHook.length === 0) {
            this.log(
              subscription.hookId,
              "does not need to be notified"
            )

            continue
          }

          const missingIds = this.docIdsByHookId[
            subscription.hookId
          ].filter((id) => !docsCache[id])

          if (missingIds.length > 0) {
            this.log(
              subscription.hookId,
              "still waiting on ids",
              missingIds
            )
            subscription.onDocs(undefined)
          } else {
            this.log(
              "notifying",
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
    )

    this.unsubscribeFunctionsByCollectionPath[collectionPath] =
      unsubscribeFromSnapshots
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
      "updated ids for",
      hookId,
      "to",
      ids,
      someDocsUncached
        ? "need to resubscribe"
        : "all docs cached"
    )

    if (someDocsUncached) {
      this.resubscribe(collectionPath)
    } else {
      const subscription = collectionSubscriptions.find(
        (subscription) => subscription.hookId === hookId
      )

      if (!subscription) {
        throw new Error(
          `Cannot notify ${hookId} about its updated docs because no subscription was found`
        )
      }

      subscription.onDocs(ids.map((id) => docCache[id]))
    }
  }

  resubscribe(collectionPath: string) {
    const unsubscribe =
      this.unsubscribeFunctionsByCollectionPath[collectionPath]

    if (!unsubscribe) {
      throw new Error(
        "Can't resubscribe when we're not already subcribed?"
      )
    }

    unsubscribe()

    this.log(
      `temporarily unsubscribed from ${collectionPath}, resubscribing...`
    )

    this.subscribe(collectionPath)
  }
}

function noop() {
  return
}
