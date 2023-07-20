import type { CollectionReference, WriteBatch } from "firebase/firestore"
import { getDocs, query, where, writeBatch, doc } from "firebase/firestore"
import { serializeQuery } from "./serializeQuery"

type Association = {
  __type: "remove-from-ids" | "delete-associated-docs"
  collection: CollectionReference
  field: string
}

export async function deleteDocs(
  collection: CollectionReference,
  idsToDelete: string[],
  ...associations: Association[]
) {
  let currentBatch = writeBatch(collection.firestore)

  const batches: WriteBatch[] = []

  let operationCount = 0

  function incrementOperation() {
    operationCount++
    if (operationCount < 500) return

    batches.push(currentBatch)
    currentBatch = writeBatch(collection.firestore)
    operationCount = 0
  }

  for (const association of associations) {
    if (association.__type === "delete-associated-docs") {
      const associatedDocs = await getDocs(
        query(
          association.collection,
          where(association.field, "in", idsToDelete)
        )
      )

      for (const associatedDoc of associatedDocs.docs) {
        currentBatch.delete(associatedDoc.ref)
        incrementOperation()
      }
    } else if (association.__type === "remove-from-ids") {
      const docsReferencingDeletedIds = await getDocs(
        query(
          association.collection,
          where(association.field, "array-contains-any", idsToDelete)
        )
      )

      for (const doc of docsReferencingDeletedIds.docs) {
        const idsToScrub = doc.data()[association.field] as string[]
        if (!Array.isArray(idsToScrub)) {
          throw new Error(
            `Field ${association.field} in andRemoveFromIds(collection, "${association.field}") must be an array field.`
          )
        }
        const scrubbedIds = idsToScrub.filter((id) => !idsToDelete.includes(id))

        currentBatch.update(doc.ref, { [association.field]: scrubbedIds })
        incrementOperation()
      }
    } else {
      throw new Error(`Unknown association type: ${String(association.__type)}`)
    }
  }

  for (const id of idsToDelete) {
    const ref = doc(collection, id)
    currentBatch.delete(ref)
    incrementOperation()
  }

  for (const batch of batches) {
    await batch.commit()
  }

  if (operationCount > 0) {
    await currentBatch.commit()
  }
}

export function andRemoveFromIds(
  collection: CollectionReference,
  key: string
): Association {
  return {
    __type: "remove-from-ids",
    collection,
    field: key,
  }
}

export function andDeleteAssociatedDocs(
  collection: CollectionReference,
  key: string
): Association {
  return {
    __type: "delete-associated-docs",
    collection,
    field: key,
  }
}
