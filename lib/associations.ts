import type { CollectionReference, DocumentData } from "firebase/firestore"

type manyToManyArgs = {
  field: string
  collection: CollectionReference<DocumentData>
}

export type Association = {}

export function manyToMany({
  field,
  collection,
}: manyToManyArgs): Association {}
