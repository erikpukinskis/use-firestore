import type { DocumentData, DocumentReference, Query } from "firebase/firestore"
import { updateDoc, onSnapshot } from "firebase/firestore"
import { createContext, useEffect, useState } from "react"
import { useSubscriptionService } from "./DocsProvider"
import { serializeQuery } from "./serializeQuery"
import type { DocumentWithId } from "./SubscriptionService"

let hookCount = 0

function isReference(
  context: Query | DocumentReference
): context is DocumentReference {
  return context.type === "document"
}

/**
 * Provides state representing a unique ID for a hook
 */
function useHookId(context: Query | DocumentReference) {
  const [id] = useState(() => {
    if (isReference(context)) {
      return `path=${context.path.replace("/", "-")}/${++hookCount}`
    } else {
      const pathPlus = serializeQuery(context).split("=")[0]
      return `query=${pathPlus}/${++hookCount}`
    }
  })

  return id
}

/**
 * Returns and caches the results of a Firestore query, such that you can call
 * the same hook with the same query 50 times on the same page, and
 * `use-firestore` will only create one single subscription, and will return the
 * exact same object or array of objects to all 50 of those hooks.
 *
 * The `query` object doesn't need to be the same for this to work, as long as
 * its the same path, filters, and conditions it will produce a cache hit.
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
 *       const users = useDocs<Users>(query)
 *
 * A subscription to Firestore will be created for each unique query, and the
 * results of the hook will be updated in realtime.
 */
export function useDocs<T extends object>(query: Query<DocumentData>) {
  const [docs, setDocs] = useState<Array<T> | undefined>()
  const hookId = useHookId(query)
  const service = useSubscriptionService("useDocs")

  useEffect(() => {
    const unregister = service.registerQueryHook(hookId, query, (docs) => {
      setDocs(docs as Array<T>)
    })

    return unregister
  }, [serializeQuery(query)])

  return docs
}

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
 *       const users = useDocs<Users>(query)
 *
 * A subscription to Firestore will be created for each unique query, and the
 * results of the hook will be updated in realtime.
 *
 * @returns a `[doc, updateDoc]` tuple, similar to what `useState` returns.
 */
export function useDoc<T extends DocumentWithId>(ref: DocumentReference) {
  const [doc, setDoc] = useState<T | undefined>()
  const hookId = useHookId(ref)
  const service = useSubscriptionService("useDoc")

  const path = ref.path

  useEffect(() => {
    const unregister = service.registerDocumentHook(hookId, ref, (doc) => {
      setDoc(doc as T)
    })

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
