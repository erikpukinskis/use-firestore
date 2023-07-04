import type { DocumentData, Query } from "firebase/firestore"

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
export function serializeQuery(query: Query<DocumentData>) {
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
