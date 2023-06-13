**use-firestore** provides a set of React hooks which let you load Firestore
data at the component level.

**Table of Contents**

- [What it does](#what-it-does)
- [Example code](#example-code)
- [Why](#why)
- [Todo](#todo)

### What it does

It does this by caching results on a per-query basis, such that you can call
the same hook with the same query 50 times on the same page, and
`use-firestore` will only create one single subscription, and will return the
exact same object or array of objects to all 50 of those hooks.

The `query` object doesn't need to be the same object for this to work, as long as
its the same path, filters, and conditions it will produce a cache hit.

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
const users = useDocs<Users>(query)
```

A subscription to Firestore will be created for each unique query, and the
results of the hook will be updated in realtime.

### Example code

```tsx
import { useDocs, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"

type User = {
  id: string
  name: string
  email: string
  teamId: string
}

export function App() {
  const [teamId] = useQueryParam("teamId")

  const users = useDocs(
    query(collection(getFirestore(app), "users"), where("teamId", "==", teamId))
  )

  if (!users) return null

  return users.map((user) => <div>{user.name}</div>)
}
```

If you would like to create some sort of derived state from your Firestore data, which will be efficiently cached, you can use the `useGlobalMemo` hook.

For example, if you have a "users" collection and each user has N "assignments", you can wire this up the following way, such that you only query Firebase twice, and get an array of users each with an array of assignments:

```tsx
import { useDocs, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { groupBy } from "lodash"

const assignments = useDocs(
  query(collection(getFirestore(app), "assignments"))
)

const assignmentsByUserId = useGlobalMemo("assignmentsByUserId", () => {
  return groupBy(assignments, "userId")
}, [assignments])

const userDocs = useDocs(
  query(collection(getFirestore(app), "users"))
)

const users = useGlobalMemo("users", () => userDocs.map((user)) => ({
  ...user,
  assignments: assignmentsByUserId[user.id] ?? []
}), [userDocs, assignmentsById])
```

### Associations

`use-firestore` also provides a set of tools for working with documents with associations.

The Firestore philosophy generally says to de-normalize data when you need to load data from two collections that are associated with one another. So for example, if you want to show a list of `repos` each with a set of `tags`, de-normalization might suggest a Firestore document structure like:

```javascript
// /repos/:id
{
  url: "https://github.com/erikpukinskis/use-firestore",
  starCount: 0,
  tags: [
    {
      id: "abc123",
      text: "MIT Licensed"
      color: "blue",
    },
    {
      id: "def456",
      text: "Firestore",
      color: "aqua",
    }
  ],
}
```

However, this creates a lot of headache when it comes to editing tags:

1. Every time you want to write to the `tags` collection, by changing the `test` or the `color`, you need to also hunt down all the documents in the `repos` collection which use it, and update the array at `/repos/:id/tags` as well.

2. If you ever want to delete a tag, you need to go splice that tag out of all of the repos too.

Instead of doing things this way, `use-firestore` provides some ways to use a _normalized_ document structure.

The manual way to do this is simply to use dictionaries like the `assignmentsByUserId` dictionary demonstrated above. This works great as long as your collection query is small enough that it can be efficiently downloaded in its entirity on the client.

However, when the data accessible to a given user gets sufficiently large, you may not want to download an entire data set. In this case you can use the `associations` option on the various hooks and functions in `use-firestore`.

**Example:** Including associations with a collection query

```tsx
import { useDocs, manyToMany } from "use-firestore"
import { getFirestore, query, collection, where } from "firebase/firestore"

const repos = useDocs(
  query(
    collection(getFirestore(app), "repos"),
    where("ownerId", "==", ownerId)
  ),
  manyToMany({
    field: "tagIds",
    collection: collection(getFirestore(app), "tags"),
  })
)
```

The hook above will first run the `repos` query directly. It will then look at each of the documents returned for a `tagIds` field which should be an array of string document ids.

Then `useDocs` will do a second query, on the tags collection, adding a where clause like `where("id", "in", flattenedTagIds)`.

And finally, it will map each of the original `tagIds` arrays to an array `tags` and add those to the respective "repo" doc.

**Example:** Deleting associated data

```tsx
import { deleteDocs, manyToMany } from "use-firestore"
import { collection, getFirestore } from "firebase/firestore"

await deleteDocs(
  db,
  "tags",
  ["tag123"],
  manyToMany({
    collection: collection(getFirestore(app), "repos")
    field: "tagIds",
  })
)
```

That code will first query the `repos` collection, and download any repos that have `tagIds` in the list of tag ids to delete. So in this example it will query repos `where("tagIds", "array-contains-any", ["tag123"])`.

Then it will update all of those `tagIds` arrays to exclude `"tag123"`.

And finally, it will delete the `/tags/tag123` document.

**Example:** Bulk dissociation

```tsx
import { dissociateDocs, manyToMany } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"

await dissociateDocs(
  db,
  "tags",
  ["tag123"],
  manyToMany({
    collection: collection(getFirestore(app), "repos")
    field: "tagIds",
  })
)
```

`dissociateDocs` works just the same as `deleteDocs`, it just doesn't delete them. It only breaks the associations.

### Why

Applications can be built a lot more simply when individual components can request the data they need, without having to worry about triggering the N+1 problem.

This especially matters when working with Firestore because it's a non-relational database. That means joins must either be created manually at query time, or they must be updated manually every time either side of the relation changes.

For example, if I have a collection of stories, each of which has a number of tags, and I want to show a table that lists the stories along with their tags, I either have to:

1. Copy the tag objects into the stories collection every time a tag changes color or is renamed, or
2. Query the tags and the stories and then knit them together on the client

**Option 1**—often called "de-normalization"—is a great option, but it means you need to maintain a lot of event triggers, and data can get out of sync.

`use-firestore` is useful if you want to pursue **Option 2**—i.e. "normalization".

Instead of copying the tags onto every story, you can efficiently maintain an index of tags to be looked up at the row level:

```tsx
import { useDocs, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { keyBy } from "lodash"

function StoryTable() {
  const stories = useDocs(query(collection(getFirestore(app), "stories")))

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
  const tags = useDocs(query(collection(getFirestore(app), "tags")))
  const tagsById = useGlobalMemo("tagsById", () => tags && keyBy(tags), [tags])

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

- [ ] Unsubscribe from query when no more listeners are left
- [ ] Add tests
