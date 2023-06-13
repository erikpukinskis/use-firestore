import { waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import { initializeApp } from "firebase/app"
import {
  collection,
  connectFirestoreEmulator,
  getFirestore,
  query,
  where,
} from "firebase/firestore"
import { describe, it, expect } from "vitest"
import { manyToMany } from "./associations"
import { useDocs } from "./useDocs"
import * as factory from "~/test/helpers/factory"

describe("useDocs", () => {
  it("adds many-to-many associations to docs", async () => {
    const app = initializeApp({ projectId: "many-to-many" })

    connectFirestoreEmulator(getFirestore(app), "127.0.0.1", 6002)

    const tag = await factory.createTag(app)
    await factory.createRepo(app, {
      ownerId: "talia",
      tagIds: [tag.id],
    })

    const { result } = renderHook(() =>
      useDocs(
        query(
          collection(getFirestore(app), "repos"),
          where("ownerId", "==", "talia")
        ),
        manyToMany({
          field: "tagIds",
          collection: collection(getFirestore(app), "tags"),
        })
      )
    )

    await waitFor(() => expect(result.current).toHaveLength(1))
  })
})
