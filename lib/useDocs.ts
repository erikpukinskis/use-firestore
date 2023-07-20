import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
} from "firebase/firestore"
import { collection, updateDoc } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import { useCollectionService } from "./DocsProvider"
import { useHookId } from "./useHookId"

/**
 * Returns and caches the results of a Firestore single document query. Also
 * provides an `update` function.
 *
 * If the document has already been queried as part of a collection, it will not
 * be
 *
 * The returned documents will be normal JavaScript objects like:
 *
 *       {
 *         id: "[document id string]",
 *         field1: value2,
 *         field2: value2,
 *         ...etc
 *       }
 *
 * You can provide a type assertion as well:
 *
 *       const users = useQuery<Users>(query)
 *
 * A subscription to Firestore will be created for each unique query, and the
 * results of the hook will be updated in realtime.
 *
 * @returns a `[doc, updateDoc]` tuple, similar to what `useState` returns.
 */
export function useDoc<T extends { id: string }>(ref: DocumentReference) {
  const [doc, setDoc] = useState<T | undefined>()
  const hookId = useHookId(ref)
  const service = useCollectionService("useDoc")

  useEffect(() => {
    setDoc(undefined)
    const { unregister, cachedDocs } = service.registerDocsHook(
      hookId,
      collection(ref.firestore, ref.parent.path),
      [ref.id],
      ([doc]) => {
        setDoc(doc as unknown as T)
      }
    )

    if (cachedDocs) setDoc(cachedDocs[0] as unknown as T)

    return unregister
  }, [ref.parent.path])

  useEffect(() => {
    setDoc(undefined)
    service.updateDocIds(ref.parent.path, hookId, [ref.id])
  }, [ref.parent.path, ref.id])

  async function update(updates: Partial<T>) {
    setDoc((doc) => {
      if (!doc) {
        throw new Error("Cannot update doc before it has been loaded")
      }

      return { ...doc, ...updates }
    })

    await updateDoc(ref, updates as DocumentData)
  }

  return [doc, update] as const
}

export function useDocs<T extends { id: string }>(
  collection: CollectionReference,
  ids: string[]
) {
  const [docs, setDocs] = useState<T[] | undefined>()
  const hookId = useHookId(collection, ids)
  const service = useCollectionService("useDoc")
  const firstRenderRef = useRef(true)

  useEffect(() => {
    setDocs(undefined)
    const { unregister, cachedDocs } = service.registerDocsHook(
      hookId,
      collection,
      ids,
      (docs) => {
        setDocs(docs as unknown as T[])
      }
    )

    if (cachedDocs) setDocs(cachedDocs as unknown as T[])

    return unregister
  }, [collection.path])

  useEffect(() => {
    setDocs(undefined)

    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }
    service.updateDocIds(collection.path, hookId, ids)
  }, [ids.join()])

  return docs
}
