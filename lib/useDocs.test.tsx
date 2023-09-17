import {
  cleanup,
  fireEvent,
  render,
  waitFor,
} from "@testing-library/react"
import {
  renderHook,
  suppressErrorOutput,
} from "@testing-library/react-hooks"
import {
  collection,
  doc,
  getDoc,
  getFirestore,
  query,
  updateDoc,
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
import {
  connectToEmulators,
  testApp,
} from "./test/helpers/connectToEmulators"
import { mockSubscriptions } from "./test/helpers/mockSubscriptions"
import { useDoc, useDocs } from "./useDocs"
import { useQuery } from "./useQuery"
import type { Repo, Tag } from "~/test/helpers/factory"
import { setUpRepo, setUpTag } from "~/test/helpers/factory"

vi.mock("firebase/firestore", async (importOriginal) => {
  const original: { onSnapshot(this: void): void } =
    await importOriginal()

  return {
    ...original,
    onSnapshot: vi.fn().mockImplementation(original.onSnapshot),
  }
})

describe("useDocs", () => {
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
      () =>
        useDoc<Repo>(
          doc(getFirestore(testApp), "repos", repo.id)
        ),
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

    const freshDoc = await getDoc(
      doc(getFirestore(testApp), "repos", repo.id)
    )

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

  function Repo({
    slug,
    tagIds,
  }: {
    slug: string
    tagIds: string[]
  }) {
    const tags = useDocs<Tag>(
      collection(getFirestore(testApp), "tags"),
      tagIds
    )

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

    const { repo: repo1 } = await setUpRepo(testApp, {
      tagIds: [tag1.id],
    })
    await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag2.id],
    })
    await setUpRepo(testApp, {
      ownerId: repo1.ownerId,
      tagIds: [tag1.id, tag2.id],
    })

    const { onSnapshot } = mockSubscriptions()

    const { getAllByRole } = render(
      <ListRepos ownerId={repo1.ownerId} />,
      {
        wrapper: ({ children }) => (
          <DocsProvider testEnv>{children}</DocsProvider>
        ),
      }
    )

    await waitFor(() =>
      expect(getAllByRole("listitem")).toHaveLength(3)
    )

    expect(onSnapshot).toHaveBeenCalledTimes(2)
  })

  it("re-subscribes a collection when we add new ids", async () => {
    const { tag: tag1 } = await setUpTag(testApp, {
      text: "one",
    })
    const { tag: tag2 } = await setUpTag(testApp, {
      text: "two",
    })

    const { repo } = await setUpRepo(testApp, {
      tagIds: [tag1.id],
    })

    const { onSnapshot } = mockSubscriptions()

    const { getAllByRole, getByText } = render(
      <ListRepos ownerId={repo.ownerId} />,
      {
        wrapper: ({ children }) => (
          <DocsProvider testEnv>{children}</DocsProvider>
        ),
      }
    )

    await waitFor(() =>
      expect(getAllByRole("listitem")).toHaveLength(1)
    )

    expect(onSnapshot).toHaveBeenCalledTimes(2)

    await updateDoc(
      doc(getFirestore(testApp), "repos", repo.id),
      {
        tagIds: [tag1.id, tag2.id],
      }
    )

    await waitFor(() => getByText("two"))

    expect(onSnapshot).toHaveBeenCalledTimes(3)
  })

  function DocsPlusOneMore({ ids }: { ids: string[] }) {
    const docs = useDocs<Tag>(
      collection(getFirestore(testApp), "tags"),
      ids
    )

    if (!docs) return <div>Loading...</div>

    return (
      <ul>
        {docs.map((doc) => (
          <li key={doc.id}>{doc.text}</li>
        ))}
        <OneMore />
      </ul>
    )
  }

  function OneMore() {
    const [ids, setIds] = useState<string[]>([])

    const docs = useDocs<Tag>(
      collection(getFirestore(testApp), "tags"),
      ids
    )

    if (!docs) return <>Loading....</>

    const addOneMore = () => {
      setIds(["id-not-to-be-found"])
    }

    return (
      <>
        {ids.length === 0 ? (
          <button onClick={addOneMore}>Add one more</button>
        ) : (
          <li>clicked!</li>
        )}
        {docs.map((doc) => (
          <li key={doc.id}>{doc.text}</li>
        ))}
      </>
    )
  }

  it.only("throws an error when docs are not found", async () => {
    const ids: string[] = []

    for (let i = 0; i < 30; i++) {
      const { tag } = await setUpTag(testApp, {
        text: `this ${i} will be found`,
      })

      ids.push(tag.id)
    }

    const result = render(<DocsPlusOneMore ids={ids} />, {
      wrapper: ({ children }) => (
        <DocsProvider>
          <TestErrorBoundary>{children}</TestErrorBoundary>
        </DocsProvider>
      ),
    })

    await waitFor(() => {
      expect(result.getAllByRole("listitem")).toHaveLength(30)
    })

    fireEvent.click(
      result.getByRole("button", { name: "Add one more" })
    )

    const restoreConsole = suppressErrorOutput()

    try {
      await waitFor(() => {
        result.getByText(
          "Error: No document in collection tags with id(s) id-not-to-be-found"
        )
      })
    } finally {
      restoreConsole()
    }
  })
})

class TestErrorBoundary extends React.Component {
  state: { error?: Error } = {}

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  render() {
    const { error } = this.state
    const { children } = this.props

    if (error) {
      return <div>Error: {error.message}</div>
    }
    return children
  }
}
