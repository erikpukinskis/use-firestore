import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  query,
  where,
  type DocumentReference,
  type DocumentSnapshot,
  type Unsubscribe,
} from "firebase/firestore"
import * as Firestore from "firebase/firestore"
import React, { useState } from "react"
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  afterEach,
  beforeEach,
} from "vitest"
import { DocsProvider } from "./DocsProvider"
import { UNSUBSCRIBE_DELAY } from "./SubscriptionService"
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { useDoc } from "./useDoc"
import { useDocs } from "./useDocs"
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

  beforeEach(() => {
    cleanup()
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

  function RepoDetails({ id }: { id: string }) {
    const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

    if (!repo) return <>{id} not loaded</>

    return <div>{repo.starCount} stars</div>
  }

  function ReposPage({ ownerId }: { ownerId: string }) {
    const [expandedId, setExpandedId] = useState<string | undefined>()
    const [focusMode, setFocusMode] = useState(false)

    return (
      <>
        {focusMode ? null : (
          <ListRepos ownerId={ownerId} onClickRepo={setExpandedId} />
        )}
        {expandedId && <RepoDetails id={expandedId} />}
        <button onClick={() => setFocusMode(true)}>Focus mode</button>
      </>
    )
  }

  function ListRepos({
    ownerId,
    onClickRepo,
  }: {
    ownerId: string
    onClickRepo(id: string): void
  }) {
    const repos = useDocs(
      query(
        collection(getFirestore(testApp), "repos"),
        where("ownerId", "==", ownerId)
      )
    )

    if (!repos) return null

    return (
      <>
        {repos.map(({ slug, id }) => (
          <React.Fragment key={id}>
            <h1>{slug}</h1>
            <button key={id} onClick={() => onClickRepo(id)}>
              Expand {slug}
            </button>
          </React.Fragment>
        ))}
      </>
    )
  }

  it("reuses query subscription when pulling a doc in the query", async () => {
    const {
      repo: { ownerId },
    } = await factory.setUpRepo(testApp, { slug: "one", starCount: 850 })

    const { onSnapshot, unsubscribes } = mockSubscriptions()

    const { getByRole, getByText } = render(<ReposPage ownerId={ownerId} />, {
      wrapper: DocsProvider,
    })

    await waitFor(() => {
      expect(onSnapshot).toHaveBeenCalledTimes(1)
      getByRole("button", { name: "Expand one" })
    })

    fireEvent.click(getByRole("button", { name: "Expand one" }))

    await waitFor(() => getByText("850 stars"))
    await sleep(UNSUBSCRIBE_DELAY) // just in case

    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(unsubscribes).toHaveLength(0)
  })

  it("adds a doc subscription when the query unmounts", async () => {
    const {
      repo: { ownerId },
    } = await factory.setUpRepo(testApp, { slug: "one", starCount: 2 })

    const { onSnapshot, unsubscribes } = mockSubscriptions()

    const { findByRole, queryByRole } = render(
      <ReposPage ownerId={ownerId} />,
      {
        wrapper: DocsProvider,
      }
    )

    fireEvent.click(await findByRole("button", { name: "Expand one" }))
    fireEvent.click(await findByRole("button", { name: "Focus mode" }))

    expect(queryByRole("button", { name: "Expand one" })).toBeNull()
    expect(onSnapshot).toHaveBeenCalledTimes(1)
    expect(unsubscribes).toHaveLength(0)

    await sleep(UNSUBSCRIBE_DELAY)

    expect(onSnapshot).toHaveBeenCalledTimes(2)
    expect(unsubscribes).toHaveLength(1)
  })

  function RepoRouter({
    id,
    route,
  }: {
    id: string
    route: "details" | "owner"
  }) {
    return route === "details" ? <RepoDetails id={id} /> : <RepoOwner id={id} />
  }

  function RepoOwner({ id }: { id: string }) {
    const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

    if (!repo) return null

    return <div>Owned by {repo.ownerId}</div>
  }

  it("hands off doc subscription to another hook during a navigation change", async () => {
    const { repo } = await factory.setUpRepo(testApp, {
      starCount: 1000,
      ownerId: "Kim",
    })

    const { onSnapshot, unsubscribes } = mockSubscriptions()

    const { rerender, getByText, unmount } = render(
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

/**
 * Async helper to wait a few milliseconds for the subscriptions to be
 * processed. Ideally we would use vi.useFakeTimers but when I tried that, the
 * tests hung when trying to use the factories. Maybe Firestore doesn't play
 * nicely with vi.useFakeTimers()?
 */
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
