import { render, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import {
  doc,
  getDoc,
  getFirestore,
  type DocumentReference,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore"
import * as Firestore from "firebase/firestore"
import { describe, it, expect, beforeAll, afterAll, vi } from "vitest"
import { DocsProvider } from "./DocsProvider"
import { UNSUBSCRIBE_DELAY } from "./SubscriptionService"
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { useDoc } from "./useDoc"
import * as factory from "~/test/helpers/factory"
import type { Repo } from "~/test/helpers/factory"

vi.mock("firebase/firestore", async (importOriginal) => {
  const original: { onSnapshot(this: void): void } = await importOriginal()

  return {
    ...original,
    onSnapshot: vi.fn().mockImplementation(original.onSnapshot),
  }
})

describe("useDoc", () => {
  connectToEmulators(beforeAll, afterAll)

  afterAll(() => {
    vi.clearAllMocks()
  })

  it("returns a doc and provides a function to update it", async () => {
    const { repo } = await factory.setUpRepo(testApp, {
      ownerId: "zeeke",
    })

    const { result } = renderHook(
      () => useDoc<Repo>(doc(getFirestore(testApp), "repos", repo.id)),
      {
        wrapper: DocsProvider,
      }
    )

    expect(result.current).toHaveLength(2)

    await waitFor(() =>
      expect(result.current[0]).toMatchObject({
        ownerId: "zeeke",
      })
    )

    const update = result.current[1]

    expect(update).toBeInstanceOf(Function)

    await update({
      ownerId: "whitney",
    })

    const freshDoc = await getDoc(doc(getFirestore(testApp), "repos", repo.id))

    expect(freshDoc.data()).toMatchObject({
      ownerId: "whitney",
    })
  })

  // it("unsubscribes on unmount")

  // it(
  //   "doesn't resubscribe if pulling doc that's already be pulled in a collection"
  // )

  // it("triggers subscribe when query unmounts")

  it("hands off subscription to another listener during a navigation change", async () => {
    const { repo } = await factory.setUpRepo(testApp, {
      starCount: 1000,
      ownerId: "Kim",
    })

    const { onSnapshot, unsubscribes } = mockSubscriptions()

    function RepoRouter({
      id,
      route,
    }: {
      id: string
      route: "details" | "owner"
    }) {
      return route === "details" ? (
        <RepoDetails id={id} />
      ) : (
        <RepoOwner id={id} />
      )
    }

    function RepoDetails({ id }: { id: string }) {
      const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

      if (!repo) return null

      return <div>{repo.starCount} stars</div>
    }

    function RepoOwner({ id }: { id: string }) {
      const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

      if (!repo) return null

      return <div>Owned by {repo.ownerId}</div>
    }

    // First render, should render <RepoDetails />
    const { rerender, getByText, unmount, debug } = render(
      <RepoRouter id={repo.id} route="details" />,
      {
        wrapper: DocsProvider,
      }
    )

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledTimes(1)
      expect(getByText("1000 stars"))
      expect(unsubscribes).toHaveLength(0)
    })

    rerender(<RepoRouter id={repo.id} route="owner" />)

    await sleep(UNSUBSCRIBE_DELAY)

    await waitFor(() => {
      expect(getByText("Owned by Kim"))
      expect(unsubscribes).toHaveLength(0)
    })

    expect(onSnapshot).toHaveBeenCalledTimes(1)

    unmount()

    expect(onSnapshot).toHaveBeenCalledTimes(1)

    await waitFor(() => {
      expect(unsubscribes).toHaveLength(1)
    })
  })
})

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

let onSnapshotCallCount = 0
const originalOnSnapshot = Firestore.onSnapshot

/**
 * Mocks the Firestore onSnapshot function
 */
function mockSubscriptions() {
  const unsubscribes: number[] = []

  function mockOnSnapshot<T>(
    reference: DocumentReference<T>,
    onNext: (snapshot: DocumentSnapshot<T>) => void
    // onError?: (error: FirestoreError) => void,
    // onCompletion?: () => void
  ): Unsubscribe {
    const originalUnsubscribe = originalOnSnapshot(reference, onNext)
    const callId = onSnapshotCallCount++

    const mockUnsubscribe = () => {
      unsubscribes.push(callId)
      originalUnsubscribe()
    }

    return mockUnsubscribe
  }

  const onSnapshot = vi
    .spyOn(Firestore, "onSnapshot")
    // Not sure why TypeScript is unhappy with the mockOnSnapshot signature.
    // It seems to only be wanting a query not a reference?
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    .mockImplementation(mockOnSnapshot as any)

  return { onSnapshot, unsubscribes }
}
