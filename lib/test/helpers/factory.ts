import type { FirebaseApp } from "firebase/app"
import { addDoc, collection, getFirestore } from "firebase/firestore"

export type Tag = {
  id: string
  text: string
  color: string
}

let tagIndex = 0

export async function setUpTag(app: FirebaseApp, overrides: Partial<Tag> = {}) {
  tagIndex++

  const properties = {
    text: `Tag No.${tagIndex}`,
    color: "green",
    ...overrides,
  }

  const ref = await addDoc(collection(getFirestore(app), "tags"), properties)

  const tag = {
    id: ref.id,
    ...properties,
  } as Tag

  return { tag }
}

const repoIndex = 0

export type Repo = {
  id: string
  slug: string
  url: string
  starCount: number
  tagIds: string[]
  ownerId: string
}

let repoCount = 0

export async function setUpRepo(
  app: FirebaseApp,
  overrides: Omit<Partial<Repo>, "id"> = {}
) {
  const uniqueId = ++repoCount

  const slug = overrides.slug ?? `repo-${uniqueId}`

  const ownerId = overrides.ownerId ?? `owner-${uniqueId}`

  const properties = {
    ownerId,
    slug,
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
