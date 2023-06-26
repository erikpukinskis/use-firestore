import { waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import { collection, getFirestore, query, where } from "firebase/firestore"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { DocsProvider } from "./DocsProvider"
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { useDocs } from "./useDocs"
import * as factory from "~/test/helpers/factory"
import type { Repo } from "~/test/helpers/factory"

describe("useDocs", () => {
  connectToEmulators(beforeAll, afterAll)

  it("returns a doc", async () => {
    await factory.setUpRepo(testApp, {
      ownerId: "talia",
    })

    const { result } = renderHook(
      () =>
        useDocs<Repo>(
          query(
            collection(getFirestore(testApp), "repos"),
            where("ownerId", "==", "talia")
          )
        ),
      {
        wrapper: DocsProvider,
      }
    )

    await waitFor(() => expect(result.current).toHaveLength(1))

    const docs = result.current as Repo[]

    expect(docs).toHaveLength(1)
    expect(docs[0]).toMatchObject({
      ownerId: "talia",
    })
  })
})
