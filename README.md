**use-firestore** provides a set of React hooks which let you load Firestore
data at the component level.

It does this by caching results on a per-query basis, so that you can call the same hook 50 times on the same page, and `use-firestore` will only create one single subscription, and will return the exact same object or array of objects to all 50 of those hooks.

### Example

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

If you would like to create some sort of derived state from your Firestore data, which is globally cached you can use the `useGlobalMemo` hook:

```tsx
import { useDocs, useGlobalMemo } from "use-firestore"
import { query, getFirestore } from "firebase/firestore"
import { groupBy } from "lodash"

const assignments = useDocs(
  query(collection(getFirestore(app), "assignments"))
)

const assignmentsByUserId = useGlobalMemo("assignments", () => {
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
