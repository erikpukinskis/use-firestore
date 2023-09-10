import type {
  CollectionReference,
  DocumentData,
  DocumentReference,
} from "firebase/firestore"
import { collection, updateDoc } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import { useCollectionService, useLog } from "./DocsProvider"
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
export function useDoc<T extends { id: string }>(
  ref: DocumentReference | undefined
) {
  const subscribedIdRef = useRef(ref?.id)
  const [doc, setDoc] = useState<T | undefined>()
  const hookId = useHookId(ref ?? "useDoc")
  const service = useCollectionService("useDoc")
  const firstRenderRef = useRef(true)
  const mountedRef = useRef(true)
  const log = useLog()
  const [error, setError] = useState<Error | undefined>()

  if (error) {
    throw error
  }

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  useEffect(() => {
    if (!firstRenderRef.current) {
      setDoc(undefined)
    }

    if (!ref) {
      setDoc(undefined)
      return
    }

    const { unregister, cachedDocs } = service.registerDocsHook(
      hookId,
      collection(ref.firestore, ref.parent.path),
      [ref.id],
      ([doc]) => {
        if (!mountedRef.current) return
        setDoc(doc as unknown as T)
      },
      setError
    )

    if (cachedDocs) {
      setDoc(cachedDocs[0] as unknown as T)
    }

    return unregister
  }, [ref?.parent.path])

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
      return
    }

    if (!ref) {
      return
    }

    if (subscribedIdRef.current === ref.id) return

    log("doc id for", hookId, "changed to", ref.id)
    setDoc(undefined)
    service.updateDocIds(ref.parent.path, hookId, [ref.id])

    subscribedIdRef.current = ref.id
  }, [ref?.parent.path, ref?.id])

  async function update(updates: Partial<T>) {
    if (!ref) {
      throw new Error("Cannot update doc, no id provided")
    }

    setDoc((doc) => {
      if (!doc) {
        throw new Error(
          "Cannot update doc before it has been loaded"
        )
      }

      return { ...doc, ...updates }
    })

    log(
      "Updating",
      ref.path,
      "fields:",
      Object.keys(updates).join(", "),
      "..."
    )

    await updateDoc(ref, updates as DocumentData)
  }

  return [doc, update] as const
}

export function useDocs<T extends { id: string }>(
  collection: CollectionReference,
  ids: string[] | undefined
) {
  const [docs, setDocs] = useState<T[] | undefined>(() => {
    return !ids || ids.length < 1 ? [] : undefined
  })
  const hookId = useHookId(collection, ids)
  const service = useCollectionService("useDoc")
  const firstRenderRef = useRef(true)
  const mountedRef = useRef(true)
  const [error, setError] = useState<Error | undefined>()

  if (error) {
    throw error
  }

  useEffect(
    () => () => {
      mountedRef.current = false
    },
    []
  )

  useEffect(
    function registerHook() {
      setDocs(!ids || ids.length < 1 ? [] : undefined)

      const { unregister, cachedDocs } =
        service.registerDocsHook(
          hookId,
          collection,
          ids ?? [],
          (docs) => {
            if (!mountedRef.current) return

            setDocs(docs as unknown as T[])
          },
          setError
        )

      if (cachedDocs) {
        setDocs(cachedDocs as unknown as T[])
      }

      return unregister
    },
    [collection.path]
  )

  useEffect(
    function updateDocIds() {
      if (firstRenderRef.current) {
        firstRenderRef.current = false
        return
      }

      setDocs(!ids || ids.length < 1 ? [] : undefined)

      service.updateDocIds(collection.path, hookId, ids ?? [])
    },
    [ids?.join()]
  )

  return docs
}
