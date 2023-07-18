import type {
  CollectionReference,
  DocumentReference,
  Query,
} from "firebase/firestore"
import { useState } from "react"
import { serializeQuery } from "./serializeQuery"

let hookCount = 0

function isDocumentReference(
  context: Query | DocumentReference | CollectionReference
): context is DocumentReference {
  return context.type === "document"
}

function isCollectionReference(
  context: Query | DocumentReference | CollectionReference
): context is CollectionReference {
  return context.type === "document"
}

/**
 * Returns a state string representing a unique ID for a hook, one of:
 *
 *  - [doc repos/id123 #3]
 *  - [docs repos #72 (id456, id789)]
 *  - [query path=stories&filters=ownerUid==abc123,projectId==xyz #1]
 *
 * Does not change unless the hook is unmounted (even if the arguments change).
 */
export function useHookId(
  context: Query | DocumentReference | CollectionReference,
  ids?: string[]
): string {
  const [id] = useState(() => {
    if (isDocumentReference(context)) {
      return `[doc ${context.path} #${++hookCount}]`
    } else if (isCollectionReference(context)) {
      const idsString = ids && ids.length ? ids.join(",") : "no ids"
      return `[docs ${context.path} #${++hookCount} (${idsString})]`
    } else {
      return `[query ${serializeQuery(context).slice(0, 100)} #${++hookCount}]`
    }
  })

  return id
}
