**use-firestore** provides a set of React hooks which let you load Firestore
data at the component level.

**Table of Contents**

- [What it does](#what-it-does)
- [Example code](#example-code)
- [Why](#why)

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
