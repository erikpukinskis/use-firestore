import type { FirebaseApp } from "firebase/app"
import { addDoc, collection, getFirestore } from "firebase/firestore"

type Tag = {
  id: string
  text: string
}

let tagIndex = 0

export async function createTag(
  app: FirebaseApp,
  overrides: Partial<Tag> = {}
): Promise<Tag> {
  tagIndex++

  const tag = {
    text: `Tag No.${tagIndex}`,
    ...overrides,
  }

  const ref = await addDoc(collection(getFirestore(app), "tags"), tag)

  return {
    id: ref.id,
    ...tag,
  }
}

let repoIndex = 0

type Repo = {
  id: string
  url: string
  starCount: number
  tagIds: string[]
  ownerId: string
}

export async function createRepo(
  app: FirebaseApp,
  overrides: Partial<Repo> = {}
): Promise<Repo> {
  repoIndex++

  const ownerId = overrides.ownerId ?? `owner-for-${repoIndex}`

  const repo = {
    ownerId,
    url: `https://github.com/${ownerId}/repo-${repoIndex}`,
    starCount: Math.floor(Math.random() * 3),
    tagIds: [],
    ...overrides,
  }

  const ref = await addDoc(collection(getFirestore(app), "repos"), repo)

  return {
    id: ref.id,
    ...repo,
  }
}
