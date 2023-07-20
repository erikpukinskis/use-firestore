import { cleanup, fireEvent, render, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  query,
  where,
} from "firebase/firestore"
import React, { useState } from "react"
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  vi,
  beforeEach,
} from "vitest"
import { DocsProvider } from "./DocsProvider"
import { UNSUBSCRIBE_DELAY } from "./QueryService"
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { mockSubscriptions } from "./test/helpers/mockSubscriptions"
import { useDoc } from "./useDoc"
import { useQuery } from "./useQuery"
import type { Repo } from "~/test/helpers/factory"
import { setUpRepo, setUpTag } from "~/test/helpers/factory"

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

  it.only("returns a doc and provides a function to update it", async () => {
    const { repo } = await setUpRepo(testApp, {
      ownerId: "zeeke",
    })

    const { result } = renderHook(
      () => useDoc<Repo>(doc(getFirestore(testApp), "repos", repo.id)),
      {
        wrapper: DocsProvider,
      }
    )

    expect(result.current).toHaveLength(2)

    await waitFor(() => {
      expect(result.current[0]).toMatchObject({
        ownerId: "zeeke",
      })
    })

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

  // function RepoDetails({ id }: { id: string }) {
  //   const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

  //   if (!repo) return <>{id} not loaded</>

  //   return <div>{repo.starCount} stars</div>
  // }

  // function ReposPage({ ownerId }: { ownerId: string }) {
  //   const [expandedId, setExpandedId] = useState<string | undefined>()
  //   const [focusMode, setFocusMode] = useState(false)

  //   return (
  //     <>
  //       {focusMode ? null : (
  //         <ListRepos ownerId={ownerId} onClickRepo={setExpandedId} />
  //       )}
  //       {expandedId && <RepoDetails id={expandedId} />}
  //       <button onClick={() => setFocusMode(true)}>Focus mode</button>
  //     </>
  //   )
  // }

  function ListRepos({ ownerId }: { ownerId: string }) {
    const repos = useQuery<Repo>(
      query(
        collection(getFirestore(testApp), "repos"),
        where("ownerId", "==", ownerId)
      )
    )

    if (!repos) return null

    return (
      <>
        {repos.map(({ id, slug, tagIds }) => (
          <Repo key={id} slug={slug} tagIds={tagIds} />
        ))}
      </>
    )
  }

  function Repo({ slug, tagIds }: { slug: string; tagIds: string[] }) {
    const tags = useDocs(collection(getFirestore(testApp), "tags"), tagIds)

    if (!tags) return null

    return (
      <div>
        {slug}
        {tags.map((tag) => (
          <span key={tag.id} className={`tag-${tag.color}`}>
            {tag.text}
          </span>
        ))}
      </div>
    )
  }

  it("batches docs into a single subscription", async () => {
    const { tag: tag1 } = await setUpTag(testApp)
    const { tag: tag2 } = await setUpTag(testApp)

    const { repo: repo1 } = await setUpRepo(testApp, { tagIds: [tag1.id] })
    const { repo: repo2 } = await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag2.id],
    })
    const { repo: repo3 } = await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag1.id, tag2.id],
    })

    const {} = render(<ListRepos ownerId={repo1.ownerId} />, {
      wrapper: DocsProvider,
    })
  })

  // function RepoRouter({
  //   id,
  //   route,
  // }: {
  //   id: string
  //   route: "details" | "owner"
  // }) {
  //   return route === "details" ? <RepoDetails id={id} /> : <RepoOwner id={id} />
  // }

  // function RepoOwner({ id }: { id: string }) {
  //   const [repo] = useDoc<Repo>(doc(getFirestore(testApp), "repos", id))

  //   if (!repo) return null

  //   return <div>Owned by {repo.ownerId}</div>
  // }

  // it("hands off doc subscription to another hook during a navigation change", async () => {
  //   const { repo } = await factory.setUpRepo(testApp, {
  //     starCount: 1000,
  //     ownerId: "Kim",
  //   })

  //   const { onSnapshot, unsubscribes } = mockSubscriptions()

  //   const { rerender, getByText, unmount } = render(
  //     <RepoRouter id={repo.id} route="details" />,
  //     {
  //       wrapper: DocsProvider,
  //     }
  //   )

  //   await waitFor(() => {
  //     expect(onSnapshot).toHaveBeenCalledTimes(1)
  //     expect(getByText("1000 stars"))
  //     expect(unsubscribes).toHaveLength(0)
  //   })

  //   rerender(<RepoRouter id={repo.id} route="owner" />)

  //   await sleep(UNSUBSCRIBE_DELAY)

  //   await waitFor(() => {
  //     expect(getByText("Owned by Kim"))
  //     expect(unsubscribes).toHaveLength(0)
  //   })

  //   expect(onSnapshot).toHaveBeenCalledTimes(1)

  //   unmount()

  //   expect(onSnapshot).toHaveBeenCalledTimes(1)

  //   await waitFor(() => {
  //     expect(unsubscribes).toHaveLength(1)
  //   })
  // })
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
