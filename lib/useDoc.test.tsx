import { cleanup, render, waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  query,
  updateDoc,
  where,
} from "firebase/firestore"
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
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { mockSubscriptions } from "./test/helpers/mockSubscriptions"
import { useDoc, useDocs } from "./useDoc"
import { useQuery } from "./useQuery"
import type { Repo, Tag } from "~/test/helpers/factory"
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

  it("returns a doc and provides a function to update it", async () => {
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
    const tags = useDocs<Tag>(collection(getFirestore(testApp), "tags"), tagIds)

    if (!tags) return null

    return (
      <li>
        {slug}
        {tags.map((tag) => (
          <span key={tag.id} className={`tag-${tag.color}`}>
            {tag.text}
          </span>
        ))}
      </li>
    )
  }

  it("batches docs into a single subscription", async () => {
    const { tag: tag1 } = await setUpTag(testApp)
    const { tag: tag2 } = await setUpTag(testApp)

    const { repo: repo1 } = await setUpRepo(testApp, { tagIds: [tag1.id] })
    await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag2.id],
    })
    await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag1.id, tag2.id],
    })

    const { onSnapshot } = mockSubscriptions()

    const { getAllByRole } = render(<ListRepos ownerId={repo1.ownerId} />, {
      wrapper: DocsProvider,
    })

    await waitFor(() => expect(getAllByRole("listitem")).toHaveLength(3))

    expect(onSnapshot).toHaveBeenCalledTimes(2)
  })

  it("re-subscribes a collection when we add new ids", async () => {
    const { tag: tag1 } = await setUpTag(testApp, { text: "one" })
    const { tag: tag2 } = await setUpTag(testApp, { text: "two" })

    const { repo } = await setUpRepo(testApp, { tagIds: [tag1.id] })

    const { onSnapshot } = mockSubscriptions()

    const { getAllByRole, getByText } = render(
      <ListRepos ownerId={repo.ownerId} />,
      {
        wrapper: DocsProvider,
      }
    )

    await waitFor(() => expect(getAllByRole("listitem")).toHaveLength(1))

    expect(onSnapshot).toHaveBeenCalledTimes(2)

    await updateDoc(doc(getFirestore(testApp), "repos", repo.id), {
      tagIds: [tag1.id, tag2.id],
    })

    await waitFor(() => getByText("two"))

    expect(onSnapshot).toHaveBeenCalledTimes(3)
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
