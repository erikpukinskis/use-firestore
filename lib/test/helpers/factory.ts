import type { FirebaseApp } from "firebase/app"
import { addDoc, collection, getFirestore } from "firebase/firestore"

export type Tag = {
  id: string
  text: string
}

let tagIndex = 0

export async function setUpTag(app: FirebaseApp, overrides: Partial<Tag> = {}) {
  tagIndex++

  const properties = {
    text: `Tag No.${tagIndex}`,
    ...overrides,
  }

  const ref = await addDoc(collection(getFirestore(app), "tags"), properties)

  const tag = {
    id: ref.id,
    ...properties,
  } as Tag

  return { tag }
}

let repoIndex = 0

export type Repo = {
  id: string
  url: string
  starCount: number
  tagIds: string[]
  ownerId: string
}

export async function setUpRepo(
  app: FirebaseApp,
  overrides: Partial<Repo> = {}
) {
  repoIndex++

  const ownerId = overrides.ownerId ?? `owner-for-${repoIndex}`

  const properties = {
    ownerId,
    url: `https://github.com/${ownerId}/repo-${repoIndex}`,
    starCount: Math.floor(Math.random() * 3),
    tagIds: [],
    ...overrides,
  }

  const ref = await addDoc(collection(getFirestore(app), "repos"), properties)

  const repo = {
    id: ref.id,
    ...properties,
  } as Repo

  return { repo }
}
