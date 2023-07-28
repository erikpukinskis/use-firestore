<p align="center">
<img src="./icon.png" width="128" height="128" alt="the use-firestore logo, a painting of a red can with a flame on the label" />
</p>

<b>use-firestore</b> provides a set of React hooks which let you load Firestore
data at the component level.

**Table of Contents**

- [What it does](#what-it-does)
- [Alternatives](#alternatives)
- [API Reference](#api-reference)
  - [`useQuery` hook](#usequery-hook)
  - [`useDoc` hook with optimistic updates](#usedoc-hook-with-optimistic-updates)
  - [`useDocs` hook](#usedocs-hook)
  - [`deleteDocs` function](#deletedocs-function)
- [Why](#why)
- [Todo](#todo)

## What it does

The `useQuery`, hook caches results on a per-query basis, such that you can call
the same hook with the same query 50 times on the same page, and
`use-firestore` will only create one single subscription, and will return the
exact same object or array of objects to all 50 of those hooks.

The `QueryReference` object that you pass in doesn't even need to be the same
object for this to work, as long as it has the same path, filters, and
conditions it will produce a cache hit.

The `useDoc` and `useDocs` hooks cache results on a per-collection basis, and
create only one subscription per collection.

The returned documents will be normal JavaScript objects like:

```js
{
  id: "[document id string]",
  field1: value2,
  field2: value2,
  ...etc
}
```

You can provide a type assertion as well:

```ts
const users = useQuery<Users>(query)
```

A subscription to Firestore will be created for each unique query, and the
results of the hook will be updated in realtime.

Lastly, `use-firestore` provides `useDocs` hook which batches collection subscriptions globally, which allows you to fetch associated documents deep in your React Component tree without triggering the N+1 problem.

For example, if you wanted to query a collection, and then grab associated tags off each document in the result set, this would only require two subscriptions to your Firestore database:

```tsx
function ListRepos({ ownerId }: ListReposProps) {
  const repos = useQuery<Repo>(
    query(
      collection(getFirestore(testApp), "repos"),
      where("ownerId", "==", ownerId)
    )
  )

  if (!repos) return null

  return (
    <>
      {repos.map(({ id, slug, tagIds }) => (
        <Repo key={id} slug={slug} tagIds={tagIds} />
      ))}
    </>
  )
}

function Repo({
  slug,
  tagIds,
}: {
  slug: string
  tagIds: string[]
}) {
  const tags = useDocs<Tag>(
    collection(getFirestore(testApp), "tags"),
    tagIds
  )

  if (!tags) return null

  return (
    <li>
      {slug}
      {tags.map((tag) => (
        <span key={tag.id} className={`tag-${tag.color}`}>
          {tag.text}
        </span>
      ))}
    </li>
  )
}
```

## Alternatives

For an alternative approach, check out [Chris Bianca's](@chrisbianca) [react-firebase-hooks](https://www.npmjs.com/package/react-firebase-hooks). It's an awesome package that I've used in many projects and Chris is a fantastic developer and maintainer. `react-firebase-hooks` is oriented more towards the "denomalized" architecture used in many Firestore projects, where you copy associated data onto your documents so you can get a sub-graph of associated documents in a single database read.

If you want to take this "denormalized" approach check out [Anish Karandikar's](@anishkny) [integrify](https://www.npmjs.com/package/integrify) package which lets you declaratively set up relations between your collections. It automatically maintains Firestore triggers that synchronize the data between those collections.

`use-firestore` takes a different approach. It encourages you do keep your data normalized, so there's a single source of truth. And then it helps you efficiently aggregate the queries needed to support your relations within a React app.

|                                                   | use-firestore | react-firebase-hooks + integrify    |
| ------------------------------------------------- | ------------- | ----------------------------------- |
| React-based                                       | ✅            | ✅                                  |
| Realtime updates                                  | ✅            | ✅                                  |
| Fetch a sub-graph of documents with a single read | ❌            | ✅                                  |
| Re-use queries application-wide                   | ✅            | ❌                                  |
| Throws errors                                     | ✅            | ❌ require manual error handling    |
| Memory efficient derived state on top of queries  | ✅            | ❌ each hook returns unique objects |
| Optimistic updates                                | ✅            | ✅ via the Firebase SDK?            |
| Batch document reads to avoid N+1 problem         | ✅            | ❌                                  |

Of course you could combine `use-firestore` with `integrify` to mix and match the benefits of the two approaches.

## API Reference

### `useQuery` hook

```tsx
import { useQuery, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"

type User = {
  id: string
  name: string
  email: string
  teamId: string
}

export function App() {
  const [teamId] = useQueryParam("teamId")

  const users = useQuery(
    query(
      collection(getFirestore(app), "users"),
      where("teamId", "==", teamId)
    )
  )

  if (!users) return null

  return users.map((user) => <div>{user.name}</div>)
}
```

If you would like to create some sort of derived state from your Firestore data, which will be efficiently cached, you can use the `useGlobalMemo` hook.

For example, if you have a "users" collection and each user has N "assignments", you can wire this up the following way, such that you only query Firebase twice, and get an array of users each with an array of assignments:

```tsx
import { useQuery, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { groupBy } from "lodash"

const assignments = useQuery(
  query(collection(getFirestore(app), "assignments"))
)

const assignmentsByUserId = useGlobalMemo("assignmentsByUserId", () => {
  return groupBy(assignments, "userId")
}, [assignments])

const userDocs = useQuery(
  query(collection(getFirestore(app), "users"))
)

const users = useGlobalMemo("users", () => userDocs.map((user)) => ({
  ...user,
  assignments: assignmentsByUserId[user.id] ?? []
}), [userDocs, assignmentsById])
```

### `useDoc` hook with optimistic updates

The `useDoc` hook returns both the document and an update function that immediately updates the document state while firing off a write to Firestore in the background:

```tsx
import { useDoc } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { groupBy } from "lodash"

function Repo({ repoId }) {
  const [repo, updateRepo] = useDoc<Repo>(
    doc(getFirestore(testApp), "repos", repoId)
  )

  if (!repo) return null

  return (
    <input
      type="text"
      value={repo.name}
      onChange={(event) => {
        updateRepo({
          name: event.target.value,
        })
      }}
    />
  )
}
```

### `useDocs` hook

```tsx
import { useDocs } from "use-firestore"
import { collection, getFirestore } from "firebase/firestore"

const tags = useDocs<Tag>(
  collection(getFirestore(app), "tags"),
  tagIds
)

if (!tags) return null

return (
  <>
    {tags.map((tag) => (
      <span key={tag.id} className={`tag-${tag.color}`}>
        {tag.text}
      </span>
    ))}
  </>
)
```

### `deleteDocs` function

Basic deletion:

```ts
import { deleteDocs } from "use-firestore"
import { collection, getFirestore } from "firebase/firestore"

await deleteDocs(collection(getFirestore(app), "tags"), [
  "tag123",
  "tag456",
  "tag789",
])
```

Also remove the deleted doc's `id` from the `tagIds` field on an associated collection:

```ts
import { deleteDocs, andRemoveFromIds } from "use-firestore"

await deleteDocs(
  collection(getFirestore(app), "tags"),
  ["tag123"],
  andRemoveFromIds(
    collection(getFirestore(app), "repos"),
    "tagIds"
  )
)
```

Delete related docs with a 1:1 or 1:N relation:

```ts
import {
  deleteDocs,
  andDeleteAssociatedDocs,
} from "use-firestore"

await deleteDocs(
  collection(getFirestore(app), "tags"),
  ["tag123"],
  andDeleteAssociatedDocs(
    collection(getFirestore(app), "highlights"),
    "tagId"
  )
)
```

The above code will also delete any documents in the "highlights" collection which have the `tagId` field set to `"tag123"`, before deleting `/tags/tag123`.

You can also go multiple levels deep with your deletions. For example, if every "highlight" belongs to a "tag" and every "document" has many "highlights", when you delete a tag you want to:

1. Delete all of the highlights associated with that tag
2. Remove all of those highlights from any documents they are referenced in
3. Finally, delete the highlights.

The code for that would look like:

```ts
import {
  deleteDocs,
  andDeleteAssociatedDocs,
  andRemoveFromIds,
} from "use-firestore"

await deleteDocs(
  collection(getFirestore(app), "tags"),
  [tag.id],
  andDeleteAssociatedDocs(
    collection(getFirestore(app), "highlights"),
    "tagId",
    andRemoveFromIds(
      collection(getFirestore(app), "documents"),
      "highlightIds"
    )
  )
)
```

**Warnings**:

The `deleteDocs` function will do all of the deletions and updates in a series of [batched writes](https://firebase.google.com/docs/firestore/manage-data/transactions#batched-writes). However note that if there are more than 500 updates and/or writes to do, `deleteDocs` will do several batched writes. If any batch fails this can create inconsistencies in your data.

In addition, as part of its execution `deleteDocs` has to query the relations it will delete/update. If the underlying data is modified between when it does those queries and when the batches are committed, this can also introduce inconsistencies.

## Why

Applications can be built a lot more simply when individual components can request the data they need, without having to worry about triggering the N+1 problem.

This especially matters when working with Firestore because it's a non-relational database. That means joins must either be created manually at query time, or they must be updated manually every time either side of the relation changes.

For example, if I have a collection of stories, each of which has a number of tags, and I want to show a table that lists the stories along with their tags, I either have to:

1. Copy the tag objects into the stories collection every time a tag changes color or is renamed, or
2. Query the tags and the stories and then knit them together on the client

**Option 1**—often called "de-normalization"—is a great option, but it means you need to maintain a lot of event triggers, and data can get out of sync.

`use-firestore` is useful if you want to pursue **Option 2**—i.e. "normalization".

Instead of copying the tags onto every story, you can efficiently maintain an index of tags to be looked up at the row level:

```tsx
import { useQuery, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { keyBy } from "lodash"

function StoryTable() {
  const stories = useQuery(
    query(collection(getFirestore(app), "stories"))
  )

  if (!stories) return null

  return (
    <table>
      {stories.map((story) => (
        <StoryRow key={story.id} {...story} />
      ))}
    </table>
  )
}

function StoryRow({ title, tagIds }) {
  const tags = useQuery(
    query(collection(getFirestore(app), "tags"))
  )
  const tagsById = useGlobalMemo(
    "tagsById",
    () => tags && keyBy(tags),
    [tags]
  )

  if (!tagsById) return null

  return (
    <tr>
      <td>
        {title}
        {tagIds.map((id) => {
          const { name, color } = tagsById[id]
          return (
            <Badge key={id} color={color}>
              {name}
            </Badge>
          )
        })}
      </td>
    </tr>
  )
}
```

In this scenario, we get a few nice performance benefits:

1. The "tags" collection is only queried once, even if there are 50 rows in the table
2. There will only be one `tags` array allocated in memory, and it will be used in all 50 rows
3. The `keyBy` function will only be called once

Additionally, if we were to use that `tags` array as a prop to a memoized component, it would only trigger a re-render when the collection actually changes, regardless of how many times the parent component renders.

### Todo

- [x] Unsubscribe from query when no more listeners are left
- [x] Add tests
- [x] useDoc()
- [x] useDocs()
- [x] deleteDocs
- [ ] For small collections, just query the entire thing instead of just getting a subset
- [ ] Add post-processing/validation/type guard function to everything
