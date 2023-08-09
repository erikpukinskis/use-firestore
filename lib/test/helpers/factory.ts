import type { FirebaseApp } from "firebase/app"
import {
  addDoc,
  collection,
  doc,
  getDoc,
  getFirestore,
} from "firebase/firestore"

export type User = {
  id: string
  name: string
}

let userCount = 0

export async function setUpUser(
  app: FirebaseApp,
  overrides: Partial<User> = {}
) {
  const properties = {
    name: `Person ${++userCount}`,
    ...overrides,
  }

  const ref = await addDoc(
    collection(getFirestore(app), "owner"),
    properties
  )

  const user = {
    id: ref.id,
    ...properties,
  } as User

  return { user }
}

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
  const properties = {
    text: `Tag No.${++tagCount}`,
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
  const slug = overrides.slug ?? `repo-${++repoCount}`

  let ownerId = overrides.ownerId

  if (!ownerId) {
    const { user } = await setUpUser(app)
    ownerId = user.id
  }

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
