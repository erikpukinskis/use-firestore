import type { DocumentReference, Query } from "firebase/firestore"
import { useState } from "react"
import { serializeQuery } from "./serializeQuery"

let hookCount = 0

function isReference(
  context: Query | DocumentReference
): context is DocumentReference {
  return context.type === "document"
}

/**
 * Provides state representing a unique ID for a hook
 */
export function useHookId(context: Query | DocumentReference) {
  const [id] = useState(() => {
    if (isReference(context)) {
      return `[doc ${context.path} #${++hookCount}]`
    } else {
      return `[query ${serializeQuery(context).slice(0, 100)} #${++hookCount}]`
    }
  })

  return id
}
