import type {
  CollectionReference,
  DocumentReference,
  Query,
} from "firebase/firestore"
import { useState } from "react"
import { useQueryService } from "./DocsProvider"
import { getQueryPath, serializeQuery } from "./serializeQuery"

let hookCount = 0

function isDocumentReference(
  context: Query | DocumentReference | CollectionReference
): context is DocumentReference {
  return context.type === "document"
}

function isCollectionReference(
  context: Query | DocumentReference | CollectionReference
): context is CollectionReference {
  return context.type === "collection"
}

const IGNORE_FUNCTIONS = [
  "renderWithHooks",
  "useState",
  "Object.useState",
  "mountIndeterminateComponent",
  "Module.useHookId",
  "Proxy.useState",
]

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
  context:
    | Query
    | DocumentReference
    | CollectionReference
    | string,
  ids?: string[]
): string {
  const { debug } = useQueryService("useHookId")

  const [id] = useState(() => {
    let loc = ""

    if (debug) {
      const stack =
        new Error("Getting stacktrace...").stack
          ?.split("\n")
          .slice(3, 10) ?? []

      let line: string | undefined
      const functionNames: string[] = []

      while ((line = stack.shift())) {
        const functionName = line
          .match(/ {4}at [^ ]+/)?.[0]
          ?.slice(7)
        if (!functionName) continue
        if (functionName.length < 3) continue
        if (IGNORE_FUNCTIONS.includes(functionName)) continue
        functionNames.push(functionName)
      }

      functionNames.reverse()

      loc = functionNames?.join(">")
    }

    const path =
      typeof context === "string"
        ? ""
        : isCollectionReference(context)
        ? context.path
        : isDocumentReference(context)
        ? context.path
        : getQueryPath(context)

    if (loc) {
      if (typeof context === "string") {
        return `${context}@${loc} #${++hookCount}`
      } else if (isDocumentReference(context)) {
        return `${loc}(${path}) #${++hookCount}`
      } else if (isCollectionReference(context)) {
        return `${loc}(${path}) #${++hookCount}`
      } else {
        return `${loc}(${path}) #${++hookCount}`
      }
    }

    if (typeof context === "string") {
      return `${context} #${++hookCount}`
    } else if (isDocumentReference(context)) {
      return `useDoc(${context.path}) #${++hookCount}`
    } else if (isCollectionReference(context)) {
      const idsString =
        ids && ids.length ? ids.join(",") : "no ids"
      return `useDocs(${
        context.path
      }, [${idsString}]) #${++hookCount}`
    } else {
      return `useQuery(${serializeQuery(context).slice(
        0,
        100
      )}) #${++hookCount}`
    }
  })

  return id
}
