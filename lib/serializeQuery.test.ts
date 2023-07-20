import {
  collection,
  documentId,
  getFirestore,
  orderBy,
  query,
  where,
} from "firebase/firestore"
import { describe, expect, it } from "vitest"
import { serializeQuery } from "./serializeQuery"
import { testApp } from "./test/helpers"

describe("serializeQuery", () => {
  it("serializes 'in' constraints", () => {
    const serialized = serializeQuery(
      query(
        collection(getFirestore(testApp), "repos"),
        where("propertyX", "in", ["a", 1, 1.5, true, null])
      )
    )

    expect(serialized).toEqual(`repos?filter=propertyX.in:"a",1,1.5,true,null`)
  })

  it("serializes multiple constraints", () => {
    const serialized = serializeQuery(
      query(
        collection(getFirestore(testApp), "stories"),
        where("ownerUid", "==", "abc123"),
        where("projectId", "==", "xyz")
      )
    )

    expect(serialized).toEqual(
      `stories?filter=ownerUid=="abc123"&filter=projectId=="xyz"`
    )
  })

  it("serializes sorts", () => {
    const serialized = serializeQuery(
      query(
        collection(getFirestore(testApp), "stories"),
        orderBy("projectId", "asc"),
        orderBy("title", "asc")
      )
    )

    expect(serialized).toEqual(`stories?order=projectId:asc,title:asc`)
  })

  it("serializes reference values", () => {
    const serialized = serializeQuery(
      query(
        collection(getFirestore(testApp), "repos"),
        where(documentId(), "in", ["abc123"])
      )
    )

    expect(serialized).toEqual(
      `repos?filter=__name__.in:projects/use-firestore-test/databases/(default)/documents/repos/abc123`
    )
  })
})
