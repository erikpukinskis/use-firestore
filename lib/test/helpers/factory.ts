import type { FirebaseApp } from "firebase/app"
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
} from "firebase/firestore"

export type Tag = {
  id: string
  text: string
  color: string
}

let tagCount = 0

export async function setUpTag(
  app: FirebaseApp,
  overrides: Partial<Tag> = {}
) {
  tagCount++

  const properties = {
    text: `Tag No.${tagCount}`,
    color: "green",
    ...overrides,
  }

  const ref = await addDoc(
    collection(getFirestore(app), "tags"),
    properties
  )

  const tag = {
    id: ref.id,
    ...properties,
  } as Tag

  return { tag }
}

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
    url: `https://github.com/${ownerId}/repo-${repoCount}`,
    starCount: Math.floor(Math.random() * 3),
    tagIds: [],
    ...overrides,
  }

  const ref = await addDoc(
    collection(getFirestore(app), "repos"),
    properties
  )

  const repo = {
    id: ref.id,
    ...properties,
  } as Repo

  return { repo }
}

export type Highlight = {
  id: string
  tagId: string
  start: number
  end: number
}

export async function setUpHighlight(
  app: FirebaseApp,
  overrides: Partial<Highlight> = {}
) {
  let tag: Tag

  if (overrides.tagId) {
    const snapshot = await getDoc(
      doc(getFirestore(app), "tags", overrides.tagId)
    )
    tag = {
      id: snapshot.id,
      ...snapshot.data(),
    } as Tag
  } else {
    const result = await setUpTag(app)
    tag = result.tag
  }

  const properties = {
    start: 0,
    end: 100,
    tagId: tag.id,
    ...overrides,
  }

  const ref = await addDoc(
    collection(getFirestore(app), "highlights"),
    properties
  )

  const highlight = {
    id: ref.id,
    ...properties,
  } as Highlight

  return { highlight, tag }
}

export type Document = {
  id: string
  text: string
  highlightIds: string[]
}

export async function setUpDocument(
  app: FirebaseApp,
  overrides: Partial<Document> = {}
) {
  const properties = {
    text: "some text",
    highlightIds: [],
    ...overrides,
  }

  const ref = await addDoc(
    collection(getFirestore(app), "documents"),
    properties
  )

  const document = {
    id: ref.id,
    ...properties,
  } as Document

  return { document }
}
