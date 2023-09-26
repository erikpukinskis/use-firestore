import {
  type CollectionReference,
  onSnapshot,
  type QuerySnapshot,
  query,
  where,
  documentId,
} from "firebase/firestore"
import chunk from "./helpers/chunk"
import { serializeQuery } from "./serializeQuery"

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

export class ChunkedSnapshotListener {
  collectionRef: CollectionReference
  ids = new Set<string>()
  chunks: string[][] = []
  chunkIsLoaded: boolean[] = []
  unsubscribes: (() => void)[] = []
  onSnapshot: (snapshot: QuerySnapshot) => void
  status: "waiting" | "started" | "stopped" = "waiting"
  debug: boolean
  isLoaded = false

  constructor(
    debug: boolean,
    collectionRef: CollectionReference,
    initialIds: string[],
    onSnapshot: (snapshot: QuerySnapshot) => void
  ) {
    this.collectionRef = collectionRef
    initialIds.forEach((id) => this.ids.add(id))
    this.onSnapshot = onSnapshot
    this.debug = debug

    this.log(
      "Created waiting chunked listener for",
      this.collectionRef.path,
      "with",
      initialIds.length,
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
      this.ids.size,
      "ids"
    )
    this.status = "started"
    this.subscribeNewChunks([...this.ids])
  }

  private subscribeNewChunks(ids: string[]) {
    const newChunks = chunk(ids, 30)

    for (const chunk of newChunks) {
      const q = query(
        this.collectionRef,
        where(documentId(), "in", chunk)
      )
      const chunkIndex = this.chunks.length
      const unsubscribe = onSnapshot(
        q,
        this.handleSnapshot(chunkIndex)
      )

      this.log(
        "Subscribing to",
        this.collectionRef.path,
        "chunk No.",
        this.chunks.length + 1,
        serializeQuery(q)
      )

      this.chunks.push(chunk)
      this.unsubscribes.push(unsubscribe)
      this.chunkIsLoaded.push(false)
    }
  }

  /**
   * @param newIds ids to listen for. Can be a mixture of ids already being listened to and new ids
   * @returns the subset ids that weren't already subscribed
   */
  addIds(newIds: string[]): string[] {
    if (this.status === "stopped") {
      throw new Error(
        `Tried to use snapshot listener for ${this.collectionRef.path} but it was shut down`
      )
    }

    const idsToSubscribe = newIds.filter(
      (newId) => !this.ids.has(newId)
    )

    idsToSubscribe.forEach((idToSubscribe) => {
      this.ids.add(idToSubscribe)
    })

    if (this.status === "waiting") {
      this.log(
        "Ids",
        newIds,
        "on",
        this.collectionRef.path,
        "added during the waiting period.",
        idsToSubscribe.length,
        "are new"
      )

      return idsToSubscribe
    }

    if (idsToSubscribe.length < 1) {
      this.log(
        "No new",
        this.collectionRef.path,
        "ids in",
        newIds
      )

      return idsToSubscribe
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

    return idsToSubscribe
  }

  private handleSnapshot(chunkIndex: number) {
    return (snapshot: QuerySnapshot) => {
      this.chunkIsLoaded[chunkIndex] = true
      if (
        !this.isLoaded &&
        this.chunkIsLoaded.every((isLoaded) => isLoaded)
      ) {
        this.isLoaded = true
      }
      this.onSnapshot(snapshot)
    }
  }

  private resubscribe(chunkIndex: number, chunk: string[]) {
    const oldUnsubscribe = this.unsubscribes[chunkIndex]

    oldUnsubscribe()

    const q = query(
      this.collectionRef,
      where(documentId(), "in", chunk)
    )

    this.chunkIsLoaded[chunkIndex] = false
    this.isLoaded = false

    const newUnsubscribe = onSnapshot(
      q,
      this.handleSnapshot(chunkIndex)
    )

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
