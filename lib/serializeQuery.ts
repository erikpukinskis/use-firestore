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
 *           "stories?filter=ownerUid==abc123&projectId==xyz"
 */
export function serializeQuery(query: Query<DocumentData>) {
  const { _query } = query as Firestore3Query

  try {
    const path = _query.path.segments.join("/")

    const orders = _query.explicitOrderBy
      .map(({ dir, field: { segments } }) => `${segments.join("/")}:${dir}`)
      .join(",")

    const filters = _query.filters.map((filter) => {
      if (isSingleFilter(filter)) {
        return serializeFilter(filter)
      } else {
        return serializeCompoundFilter(filter)
      }
    })

    filters.sort()

    const { limit, limitType, startAt, endAt } = _query

    const parameters = []

    if (orders.length) parameters.push(`order=${orders}`)
    if (filters.length) parameters.push(`filter=${filters.join("&filter=")}`)
    if (limit != null)
      parameters.push(
        `limit=${serialize(limit)}`,
        `limitType=${serialize(limitType)}`
      )
    if (startAt != null) parameters.push(`startAt=${serialize(startAt)}`)
    if (endAt != null) parameters.push(`endAt=${serialize(endAt)}`)

    return `${path}?${parameters.join("&")}`
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

  return `${segments.join("/")}+${op}+${serialize(Object.values(value)[0])}`
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
      canonicalString(): string
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
function serialize(value: Serializable): string {
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

  if (isValuesObject(value)) {
    return value.values.map(serializeValue).join(",")
  }

  throw new Error(
    `use-firestore doesn't know how to serialize ${JSON.stringify(value)}`
  )
}

type ValueObject = {
  stringValue?: string
  integerValue?: string
  booleanValue?: boolean
  nullValue?: "NULL_VALUE"
  doubleValue?: number
  referenceValue?: string
}

const VALUE_OBJECT_KEYS = [
  "stringValue",
  "integerValue",
  "booleanValue",
  "nullValue",
  "doubleValue",
  "referenceValue",
]

function isValueObject(object: Record<string, unknown>): object is ValueObject {
  return VALUE_OBJECT_KEYS.some((key) =>
    Object.prototype.hasOwnProperty.call(object, key)
  )
}

type ValuesObject = {
  values: ValueObject[]
}

function isValuesObject(value: Serializable): value is ValuesObject {
  if (typeof value !== "object") return false

  const values = (value as ValuesObject).values

  return values.every(isValueObject)
}

function serializeValue(value: ValueObject) {
  if (typeof value.booleanValue === "boolean") {
    return String(value.booleanValue)
  } else if (typeof value.stringValue === "string") {
    return serialize(value.stringValue)
  } else if (typeof value.integerValue === "string") {
    return value.integerValue
  } else if (typeof value.nullValue === "string") {
    return serialize(value.nullValue)
  } else if (typeof value.doubleValue === "number") {
    return serialize(value.doubleValue)
  } else if (typeof value.referenceValue === "string") {
    return value.referenceValue
  } else {
    throw new Error(
      `use-firestore can't serialize value object ${JSON.stringify(value)}`
    )
  }
}

type Serializable = string | number | null | undefined | boolean | ValuesObject
