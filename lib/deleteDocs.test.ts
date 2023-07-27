import { waitFor } from "@testing-library/react"
import { collection, doc, getDoc, getFirestore } from "firebase/firestore"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import {
  andDeleteAssociatedDocs,
  andRemoveFromIds,
  deleteDocs,
} from "./deleteDocs"
import {
  connectToEmulators,
  setUpHighlight,
  setUpRepo,
  setUpTag,
  testApp,
} from "./test/helpers"

describe("deleteDocs", () => {
  connectToEmulators(beforeAll, afterAll)

  it("removes the doc id from the arrays in a related collection", async () => {
    const { tag } = await setUpTag(testApp)
    const { repo } = await setUpRepo(testApp, { tagIds: [tag.id] })

    await deleteDocs(
      collection(getFirestore(testApp), "tags"),
      [tag.id],
      andRemoveFromIds(collection(getFirestore(testApp), "repos"), "tagIds")
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

  it("removes doc id from array, even if some of the deleted ids are missing")

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
})
