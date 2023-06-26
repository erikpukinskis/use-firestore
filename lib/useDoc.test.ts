import { waitFor } from "@testing-library/react"
import { renderHook } from "@testing-library/react-hooks"
import { doc, getDoc, getFirestore } from "firebase/firestore"
import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { DocsProvider } from "./DocsProvider"
import { connectToEmulators, testApp } from "./test/helpers/connectToEmulators"
import { useDoc } from "./useDoc"
import * as factory from "~/test/helpers/factory"
import type { Repo } from "~/test/helpers/factory"

describe("useDoc", () => {
  connectToEmulators(beforeAll, afterAll)

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
})
