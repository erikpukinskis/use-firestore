import type {
  Query,
  QuerySnapshot,
  DocumentReference,
  DocumentSnapshot,
  Unsubscribe,
  QueryDocumentSnapshot,
} from "firebase/firestore"
import { doc, getFirestore } from "firebase/firestore"
import * as Firestore from "firebase/firestore"
import { vi } from "vitest"
import { testApp } from "./connectToEmulators"

const originalOnSnapshot = Firestore.onSnapshot

type SnapshotHandler = (
  snapshot: DocumentSnapshot | QuerySnapshot
) => void

/**
 * Mocks the Firestore onSnapshot function
 */
export function mockSubscriptions(stillHitEmulator = true) {
  const unsubscribes: number[] = []
  const onNextById: Record<number, SnapshotHandler> = {}
  let onSnapshotCallCount = 0

  function fireOnNext(
    callId: number,
    reference: DocumentSnapshot | QuerySnapshot
  ) {
    const onNext = onNextById[callId]

    if (!onNext) {
      throw new Error(
        `Cannot fire onNext for subscription ${callId} because no handler was found`
      )
    }

    onNext(reference)
  }

  function mockOnSnapshot(
    ref: DocumentReference | Query,
    onNext: SnapshotHandler
    // onError?: (error: FirestoreError) => void,
    // onCompletion?: () => void
  ): Unsubscribe {
    const originalUnsubscribe = stillHitEmulator
      ? originalOnSnapshot(ref as DocumentReference, onNext)
      : undefined
    const callId = onSnapshotCallCount++
    onNextById[callId] = onNext

    const mockUnsubscribe = () => {
      unsubscribes.push(callId)
      originalUnsubscribe?.()
    }

    return mockUnsubscribe
  }

  const onSnapshot = vi
    .spyOn(Firestore, "onSnapshot")
    // Not sure why TypeScript is unhappy with the mockOnSnapshot signature.
    // It seems to only be wanting a query not a reference?
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    .mockImplementation(mockOnSnapshot as any)

  return { onSnapshot, fireOnNext, unsubscribes }
}

const metadata = {
  hasPendingWrites: false,
  fromCache: false,
  isEqual: () => false,
}

export function mockDocumentSnapshot(
  collectionPath: string,
  id: string,
  data: Record<string, unknown>
): DocumentSnapshot & QueryDocumentSnapshot {
  const ref = doc(getFirestore(testApp), collectionPath, id)

  return {
    id: ref.id,
    ref,
    data: () => data,
    metadata,
    exists: () => true,
    get: vi.fn(),
  }
}

export function mockQuerySnapshot(
  docs: Array<QueryDocumentSnapshot>,
  query: Query = {} as Query
): QuerySnapshot {
  return {
    metadata,
    query,
    docs,
    size: 2,
    empty: docs.length < 1,
    forEach: vi.fn(),
    docChanges: vi.fn(),
  }
}
