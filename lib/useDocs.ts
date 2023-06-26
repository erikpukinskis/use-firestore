import type { DocumentData, Query } from "firebase/firestore"
import { useEffect, useState } from "react"
import { useSubscriptionService } from "./DocsProvider"
import { serializeQuery } from "./serializeQuery"
import type { DocumentWithId } from "./SubscriptionService"
import { useHookId } from "./useHookId"

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
export function useDocs<T extends DocumentWithId>(query: Query<DocumentData>) {
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
