import { waitFor } from "@testing-library/react"
import {
  collection,
  doc,
  getDoc,
  getFirestore,
} from "firebase/firestore"
import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
} from "vitest"
import {
  andDeleteAssociatedDocs,
  andRemoveFromIds,
  deleteDocs,
} from "./deleteDocs"
import {
  connectToEmulators,
  setUpDocument,
  setUpHighlight,
  setUpRepo,
  setUpTag,
  testApp,
} from "./test/helpers"

describe("deleteDocs", () => {
  connectToEmulators(beforeAll, afterAll)

  it("removes the doc id from the arrays in a related collection", async () => {
    const { tag } = await setUpTag(testApp)
    const { repo } = await setUpRepo(testApp, {
      tagIds: [tag.id],
    })

    await deleteDocs(
      collection(getFirestore(testApp), "tags"),
      [tag.id],
      andRemoveFromIds(
        collection(getFirestore(testApp), "repos"),
        "tagIds"
      )
    )

    await waitFor(async () => {
      const getTagResult = await getDoc(
        doc(getFirestore(testApp), "tags", tag.id)
      )

      expect(getTagResult.exists()).toBe(false)
    })

    const getRepoResult = await getDoc(
      doc(getFirestore(testApp), "repos", repo.id)
    )

    expect(getRepoResult.data()?.tagIds).toHaveLength(0)
  })

  it("deletes child docs", async () => {
    const { highlight, tag } = await setUpHighlight(testApp)

    await deleteDocs(
      collection(getFirestore(testApp), "tags"),
      [tag.id],
      andDeleteAssociatedDocs(
        collection(getFirestore(testApp), "highlights"),
        "tagId"
      )
    )

    const getTagResult = await getDoc(
      doc(getFirestore(testApp), "tags", tag.id)
    )

    expect(getTagResult.exists()).toBe(false)

    const getHighlightResult = await getDoc(
      doc(getFirestore(testApp), "highlights", highlight.id)
    )

    expect(getHighlightResult.exists()).toBe(false)
  })

  it("associations can go two levels deep", async () => {
    const { highlight, tag } = await setUpHighlight(testApp)
    const { document } = await setUpDocument(testApp, {
      highlightIds: [highlight.id, "defg789"],
    })

    await deleteDocs(
      collection(getFirestore(testApp), "tags"),
      [tag.id],
      andDeleteAssociatedDocs(
        collection(getFirestore(testApp), "highlights"),
        "tagId",
        andRemoveFromIds(
          collection(getFirestore(testApp), "documents"),
          "highlightIds"
        )
      )
    )

    const getTagResult = await getDoc(
      doc(getFirestore(testApp), "tags", tag.id)
    )

    expect(getTagResult.exists()).toBe(false)

    const getHighlightResult = await getDoc(
      doc(getFirestore(testApp), "highlights", highlight.id)
    )

    expect(getHighlightResult.exists()).toBe(false)

    const getDocumentResult = await getDoc(
      doc(getFirestore(testApp), "documents", document.id)
    )

    const highlightIds = getDocumentResult.data()
      ?.highlightIds as string[] | undefined

    expect(highlightIds).toContain("defg789")
    expect(highlightIds).not.toContain(highlight.id)
  })
})
