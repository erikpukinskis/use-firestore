import type { DocumentData, Query } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"
import { useEffect, useState } from "react"

type Listener<T extends object | unknown> = (docs: Array<T>) => void

const docsArraysByKey: Record<string, Array<object>> = {}
const unsubscribeByKey: Record<string, () => void> = {}
const listenersByKey: Record<string, Listener<object>[]> = {}

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
          docs.push({ id: doc.id, ...doc.data() } as unknown as T)
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

    return () => {
      const index = listeners.indexOf(listener)
      listeners.splice(index, 1)
    }
  }, [setDocs])

  return docs
}

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
          return `${filter.op.toUpperCase()}(${filter.filters
            .map(serializeFilter)
            .join(`,`)})`
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

function serializeFilter(filter: SingleFilter) {
  const {
    field: { segments },
    op,
    value,
  } = filter

  return `${segments.join("/")}${op}${serialize(Object.values(value)[0])}`
}

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

type SingleFilter = {
  field: { segments: string[] }
  op: string
  value: Record<string, string | number | boolean>
}

type CompoundFilter = {
  filters: Array<SingleFilter>
  op: string
}

type FirestoreFilter = SingleFilter | CompoundFilter

function isSingleFilter(filter: FirestoreFilter): filter is SingleFilter {
  return Object.prototype.hasOwnProperty.call(filter, "field")
}

type Serializable = string | number | null | undefined | boolean

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

  throw new Error(`Don't know how to serialize ${JSON.stringify(value)}`)
}
