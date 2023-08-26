import {
  type CollectionReference,
  onSnapshot,
  type QuerySnapshot,
  query,
  where,
  documentId,
} from "firebase/firestore"
import { difference } from "./helpers"
import chunk from "./helpers/chunk"
import { serializeQuery } from "./serializeQuery"

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

export class ChunkedSnapshotListener {
  collectionRef: CollectionReference
  subscribedIds: string[] = []
  currentIds: string[]
  chunks: string[][] = []
  unsubscribes: (() => void)[] = []
  onSnapshot: (snapshot: QuerySnapshot) => void
  status: "waiting" | "started" | "stopped" = "waiting"
  debug: boolean

  constructor(
    debug: boolean,
    collectionRef: CollectionReference,
    initialIds: string[],
    onSnapshot: (snapshot: QuerySnapshot) => void
  ) {
    this.collectionRef = collectionRef
    this.currentIds = [...initialIds]
    this.onSnapshot = onSnapshot
    this.debug = debug

    this.log(
      "Created waiting chunked listener for",
      this.collectionRef.path,
      "with",
      this.currentIds.length,
      "ids initially"
    )
  }

  log(...args: Parameters<typeof console.log>) {
    if (!this.debug) return
    console.log(`${red("use-firestore")} 🔥`, ...args)
  }

  start() {
    this.log(
      "Starting",
      this.collectionRef.path,
      "listener, listening to",
      this.currentIds.length,
      "ids"
    )
    this.status = "started"
    this.subscribeNewChunks(this.currentIds)
    this.subscribedIds.push(...this.currentIds)
  }

  private subscribeNewChunks(ids: string[]) {
    const newChunks = chunk(ids, 30)

    for (const chunk of newChunks) {
      const q = query(
        this.collectionRef,
        where(documentId(), "in", chunk)
      )
      const unsubscribe = onSnapshot(q, this.onSnapshot)

      this.log(
        "Subscribing to",
        this.collectionRef.path,
        "chunk No.",
        this.chunks.length + 1,
        serializeQuery(q)
      )

      this.chunks.push(chunk)
      this.unsubscribes.push(unsubscribe)
    }
  }

  addIds(newIds: string[]) {
    if (this.status === "stopped") {
      throw new Error(
        `Tried to use snapshot listener for ${this.collectionRef.path} but it was shut down`
      )
    }

    const idsToSubscribe = difference(newIds, this.subscribedIds)

    if (this.status === "waiting") {
      this.currentIds.push(...idsToSubscribe)

      this.log(
        "Ids",
        newIds,
        "on",
        this.collectionRef.path,
        "added during the waiting period.",
        idsToSubscribe.length,
        "are new"
      )

      return
    }

    if (idsToSubscribe.length < 1) {
      this.log(
        "No new",
        this.collectionRef.path,
        "ids in",
        newIds
      )

      return
    }

    this.log(
      "Will resubscribe after adding ids",
      newIds,
      "on",
      this.collectionRef.path,
      idsToSubscribe.length,
      "are new"
    )

    const lastChunkIndex = this.chunks.length - 1
    const lastChunk = this.chunks[lastChunkIndex]

    let idsForFutureChunks = idsToSubscribe

    if (lastChunk) {
      const spaceLeftInLastChunk = 30 - lastChunk.length

      const idsForLastChunk = idsToSubscribe.slice(
        0,
        spaceLeftInLastChunk
      )

      idsForFutureChunks = idsToSubscribe.slice(
        spaceLeftInLastChunk
      )

      if (idsForLastChunk.length > 0) {
        this.resubscribe(lastChunkIndex, [
          ...this.chunks[lastChunkIndex],
          ...idsForLastChunk,
        ])
      }
    }

    if (idsForFutureChunks.length > 0) {
      this.subscribeNewChunks(idsForFutureChunks)
    }

    this.subscribedIds.push(...idsToSubscribe)
  }

  private resubscribe(chunkIndex: number, chunk: string[]) {
    const oldUnsubscribe = this.unsubscribes[chunkIndex]

    oldUnsubscribe()

    const q = query(
      this.collectionRef,
      where(documentId(), "in", chunk)
    )

    const newUnsubscribe = onSnapshot(q, this.onSnapshot)

    this.log(
      "Resubscribing",
      this.collectionRef.path,
      "chunk No.",
      chunkIndex + 1,
      serializeQuery(q)
    )

    this.chunks[chunkIndex] = chunk
    this.unsubscribes[chunkIndex] = newUnsubscribe
  }

  shutDown() {
    this.log(
      "Shutting down chunked listener for",
      this.collectionRef.path
    )
    for (const unsubscribe of this.unsubscribes) {
      unsubscribe()
    }

    this.status = "stopped"
  }
}
