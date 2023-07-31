import type {
  CollectionReference,
  Firestore,
  WriteBatch,
} from "firebase/firestore"
import {
  getDocs,
  query,
  where,
  writeBatch,
  doc,
} from "firebase/firestore"

type Association = {
  __type: "remove-from-ids" | "delete-associated-docs"
  collection: CollectionReference
  field: string
  associations: Association[]
}

export async function deleteDocs(
  collection: CollectionReference,
  idsToDelete: string[],
  ...associations: Association[]
) {
  const batches = new BatchOfBatches(collection.firestore)

  await addAssociationOperationsToBatches(
    batches,
    associations,
    idsToDelete
  )

  for (const id of idsToDelete) {
    const ref = doc(collection, id)
    batches.currentBatch.delete(ref)
    batches.incrementOperation()
  }

  for (const batch of batches.batches) {
    await batch.commit()
  }

  if (batches.operationCount > 0) {
    await batches.currentBatch.commit()
  }
}

class BatchOfBatches {
  firestore: Firestore
  currentBatch: WriteBatch
  batches: WriteBatch[] = []
  operationCount = 0

  constructor(firestore: Firestore) {
    this.firestore = firestore
    this.currentBatch = writeBatch(firestore)
  }

  incrementOperation() {
    this.operationCount++
    if (this.operationCount < 500) return

    this.batches.push(this.currentBatch)
    this.currentBatch = writeBatch(this.firestore)
    this.operationCount = 0
  }
}

async function addAssociationOperationsToBatches(
  batches: BatchOfBatches,
  associations: Association[],
  idsToDelete: string[]
) {
  if (idsToDelete.length < 1) return

  for (const association of associations) {
    if (association.__type === "delete-associated-docs") {
      const associatedDocs = await getDocs(
        query(
          association.collection,
          where(association.field, "in", idsToDelete)
        )
      )

      const associatedIds = associatedDocs.docs.map(
        (snapshot) => snapshot.id
      )

      await addAssociationOperationsToBatches(
        batches,
        association.associations,
        associatedIds
      )

      for (const associatedDoc of associatedDocs.docs) {
        batches.currentBatch.delete(associatedDoc.ref)
        batches.incrementOperation()
      }
    } else if (association.__type === "remove-from-ids") {
      const docsReferencingDeletedIds = await getDocs(
        query(
          association.collection,
          where(
            association.field,
            "array-contains-any",
            idsToDelete
          )
        )
      )

      for (const doc of docsReferencingDeletedIds.docs) {
        const idsToScrub = doc.data()[
          association.field
        ] as string[]
        if (!Array.isArray(idsToScrub)) {
          throw new Error(
            `Field ${association.field} in andRemoveFromIds(collection, "${association.field}") must be an array field.`
          )
        }
        const scrubbedIds = idsToScrub.filter(
          (id) => !idsToDelete.includes(id)
        )

        batches.currentBatch.update(doc.ref, {
          [association.field]: scrubbedIds,
        })
        batches.incrementOperation()
      }
    } else {
      throw new Error(
        `Unknown association type: ${String(association.__type)}`
      )
    }
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
    associations: [],
  }
}

export function andDeleteAssociatedDocs(
  collection: CollectionReference,
  key: string,
  ...associations: Association[]
): Association {
  return {
    __type: "delete-associated-docs",
    collection,
    field: key,
    associations,
  }
}
