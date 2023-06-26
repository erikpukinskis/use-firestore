import { waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import fetch from "cross-fetch"
import { initializeApp } from "firebase/app"
import {
  collection,
  connectFirestoreEmulator,
  getFirestore,
  query,
  where,
} from "firebase/firestore"
import { describe, it, expect } from "vitest"
import { DocsProvider } from "./DocsProvider"
import { useDocs } from "./useDocs"
import * as factory from "~/test/helpers/factory"
import type { Repo, Tag } from "~/test/helpers/factory"

type RepoWithTags = Repo & {
  tags: Tag[]
}

const FIRESTORE_EMULATOR_HOST = "127.0.0.1"
const FIRESTORE_EMULATOR_PORT = 5002
const FIRESTORE_PROJECT = "use-firestore-test"

describe("useDocs", () => {
  it("adds many-to-many associations to docs", async () => {
    const app = initializeApp({ projectId: FIRESTORE_PROJECT })

    await fetch(
      `http://${FIRESTORE_EMULATOR_HOST}:${FIRESTORE_EMULATOR_PORT}/emulator/v1/projects/${FIRESTORE_PROJECT}/databases/(default)/documents`,
      {
        method: "DELETE",
      }
    )

    connectFirestoreEmulator(
      getFirestore(app),
      FIRESTORE_EMULATOR_HOST,
      FIRESTORE_EMULATOR_PORT
    )

    const tag = await factory.createTag(app, { text: "Firebase" })

    await factory.createRepo(app, {
      ownerId: "talia",
      tagIds: [tag.id],
    })

    const { result } = renderHook(
      () =>
        useDocs(
          query(
            collection(getFirestore(app), "repos"),
            where("ownerId", "==", "talia")
          )
        ),
      {
        wrapper: DocsProvider,
      }
    )

    await waitFor(() => expect(result.current).toHaveLength(1))

    const docs = result.current as RepoWithTags[]

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      ownerId: "talia",
    })
  })
})
