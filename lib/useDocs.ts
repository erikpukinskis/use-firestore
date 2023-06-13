import type { DocumentData, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"
import type { Association } from "./associations"

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
export function useDocs<T extends object>(
  query: Query<DocumentData>,
  ...associations: Association[]
) {
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

/**
 * Returns a unique string for a Firestore query.
 *
 * The string will be querystring-like, although not URL encoded. For example, given the following query:
 *
 *           query(
 *             collection(getFirestore(app), "stories"),
 *             where("ownerUid", "==", "abc123"),
 *             where("projectId", "==", "xyz")
 *           )
 *
 * `serializeQuery` will return:
 *
 *           "path=stories&filters=ownerUid==abc123,projectId==xyz"
 */
function serializeQuery(query: Query<DocumentData>) {
  const { _query } = query as Firestore3Query

  try {
    const path = _query.path.segments.join("/")

    const orders = _query.explicitOrderBy
      .map(({ dir, field: { segments } }) => `${dir}-${segments.join("/")}`)
      .join(",")

    const filters = _query.filters
      .map((filter) => {
        if (isSingleFilter(filter)) {
          return serializeFilter(filter)
        } else {
          return serializeCompoundFilter(filter)
        }
      })
      .join(" && ")

    const { limit, limitType, startAt, endAt } = _query

    const parameters = [`path=${path}`]

    if (orders.length) parameters.push(`orders=${orders}`)
    if (filters.length) parameters.push(`filters=${filters}`)
    if (limit != null)
      parameters.push(
        `limit=${serialize(limit)}`,
        `limitType=${serialize(limitType)}`
      )
    if (startAt != null) parameters.push(`startAt=${serialize(startAt)}`)
    if (endAt != null) parameters.push(`endAt=${serialize(endAt)}`)

    return parameters.join("&")
  } catch (e) {
    console.error(
      `Error serializing query:\n${JSON.stringify(_query, null, 4)}`
    )

    throw e
  }
}

/**
 * Serialize a single Firebase filter. Returns something like:
 *
 *       "ownerUid==abc123"
 */
function serializeFilter(filter: SingleFilter) {
  const {
    field: { segments },
    op,
    value,
  } = filter

  return `${segments.join("/")}${op}${serialize(Object.values(value)[0])}`
}

/**
 * Serialize a compound Firebase filter. Returns something like:
 *
 *       "AND(filters=ownerUid==abc123,projectId==xyz)"
 */
function serializeCompoundFilter(filter: CompoundFilter) {
  return `${filter.op.toUpperCase()}(${filter.filters
    .map(serializeFilter)
    .join(`,`)})`
}

/**
 * Data type representing the private `_query` property of a Firestore
 * `Query<DocumentData>` object. This is likely to change and break things with
 * new versions of Firestore.
 */
type Firestore3Query = Query<DocumentData> & {
  _query: {
    path: {
      segments: string[]
    }
    explicitOrderBy: { dir: string; field: { segments: string[] } }[]
    filters: FirestoreFilter[]
    limit: number | null
    startAt: Serializable
    endAt: Serializable
    limitType: Serializable
  }
}

/**
 * Type representing the various filter objects in a Firebase query object
 */
type FirestoreFilter = SingleFilter | CompoundFilter

type SingleFilter = {
  field: { segments: string[] }
  op: string
  value: Record<string, Serializable>
}

type CompoundFilter = {
  filters: Array<SingleFilter>
  op: string
}

function isSingleFilter(filter: FirestoreFilter): filter is SingleFilter {
  return Object.prototype.hasOwnProperty.call(filter, "field")
}

/**
 * Returns a unique string representation of any scalar data type that Firestore
 * supports.
 */
function serialize(value: Serializable) {
  if (value === "NULL_VALUE") return "null"

  if (typeof value === "string") {
    return `"${value.replace('"', '"')}"`
  }

  if (
    typeof value === "number" ||
    value === null ||
    value === undefined ||
    typeof value === "boolean"
  ) {
    return String(value)
  }

  throw new Error(
    `use-firestore doesn't know how to serialize ${JSON.stringify(value)}`
  )
}

type Serializable = string | number | null | undefined | boolean
