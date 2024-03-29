import type { DocumentData, Query } from "firebase/firestore"
import { useEffect, useRef, useState } from "react"
import { useLog, useQueryService } from "./DocsProvider"
import { serializeQuery } from "./serializeQuery"
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
 *       const users = useQuery<Users>(query)
 *
 * A subscription to Firestore will be created for each unique query, and the
 * results of the hook will be updated in realtime.
 */
export function useQuery<T extends { id: string }>(
  query: Query<DocumentData>
) {
  const [docs, setDocs] = useState<Array<T> | undefined>()
  const hookId = useHookId(query)
  const service = useQueryService("useQuery")
  const log = useLog()

  const firstRenderRef = useRef(true)

  useEffect(() => {
    if (firstRenderRef.current) {
      firstRenderRef.current = false
    } else {
      log(hookId, "query changed to", serializeQuery(query))
    }

    const { unregister, cachedResults } =
      service.registerQueryHook(hookId, query, (docs) => {
        setDocs(docs as Array<unknown> as Array<T>)
      })

    if (cachedResults)
      setDocs(cachedResults as Array<unknown> as Array<T>)

    return unregister
  }, [serializeQuery(query)])

  return docs
}
