import type { DocumentData, DocumentReference } from "firebase/firestore"
import { updateDoc } from "firebase/firestore"
import { useEffect, useState } from "react"
import { useSubscriptionService } from "./DocsProvider"
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
  const service = useSubscriptionService("useDoc")

  const path = ref.path

  useEffect(() => {
    const { unregister, cachedDoc: doc } = service.registerDocHook(
      hookId,
      ref,
      (doc) => {
        setDoc(doc as unknown as T)
      }
    )

    if (doc) setDoc(doc as unknown as T)

    return unregister
  }, [path])

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
