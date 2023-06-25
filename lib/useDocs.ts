import type { DocumentData, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"
import { serializeQuery } from "./serializeQuery"

type Listener<T extends object> = (docs: Array<T>) => void

const docsArraysByKey: Record<string, Array<object>> = {}
const unsubscribeByKey: Record<string, () => void> = {}
const listenersByKey: Record<string, Listener<object>[]> = {}

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
  const key = serializeQuery(query)

  const [docs, setDocs] = useState(docsArraysByKey[key] as Array<T> | undefined)

  useEffect(() => {
    let listeners = listenersByKey[key]

    if (!listeners) {
      listeners = []
      listenersByKey[key] = listeners

      const unsubscribe = onSnapshot(query, (snapshot) => {
        const docs: T[] = []

        snapshot.forEach((doc) => {
          docs.push({ id: doc.id, ...doc.data() } as T)
        })

        docsArraysByKey[key] = docs

        for (const listener of listenersByKey[key]) {
          listener(docs)
        }
      })

      unsubscribeByKey[key] = unsubscribe
    }

    const listener: Listener<object> = (docs) => {
      setDocs(docs as Array<T>)
    }

    listeners.push(listener)

    return function cleanup() {
      const index = listeners.indexOf(listener)
      listeners.splice(index, 1)

      if (listeners.length === 0) {
        setTimeout(() => {
          if (listeners.length > 0) return

          const unsubscribe = unsubscribeByKey[key]

          if (!unsubscribe) return

          delete unsubscribeByKey[key]

          unsubscribe()
        }, 100)
      }
    }
  }, [setDocs])

  return docs
}
