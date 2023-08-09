import {
  createContext,
  useContext,
  useEffect,
  useState,
} from "react"
import { CollectionService } from "./CollectionService"
import {
  isInitialized,
  makeUninitializedContext,
} from "./makeUninitializedContext"
import { QueryService } from "./QueryService"

type SubscriptionServices = {
  queryService: QueryService
  collectionService: CollectionService
}

const DocsContext = createContext<SubscriptionServices>(
  makeUninitializedContext(
    "The useDoc and useQuery hooks do not work outside of a DocsProvider"
  )
)

type DocsProviderProps = {
  children: React.ReactNode
  debug?: boolean
}

export function DocsProvider({
  children,
  debug = false,
}: DocsProviderProps) {
  useEffect(() => {
    if (!debug) return
    addGapsToConsoleLog()
  }, [])

  const [services] = useState(() => ({
    queryService: new QueryService(debug),
    collectionService: new CollectionService(debug),
  }))

  return (
    <DocsContext.Provider value={services}>
      {children}
    </DocsContext.Provider>
  )
}

export function useQueryService(hookName: string) {
  const context = useContext(DocsContext)

  if (!isInitialized(context)) {
    throw new Error(
      `${hookName} cannot be used outside of a DocsProvider`
    )
  }

  return context.queryService
}

export function useCollectionService(hookName: string) {
  const context = useContext(DocsContext)

  if (!isInitialized(context)) {
    throw new Error(
      `${hookName} cannot be used outside of a DocsProvider`
    )
  }

  return context.collectionService
}

export function useLog() {
  const context = useContext(DocsContext)

  return (...args: Parameters<typeof console.log>) => {
    context.queryService.log(...args)
  }
}

/**
 * This function adds gaps in between console.logs when there is a 1 second pause. Can make it easier to
 */
function addGapsToConsoleLog() {
  const originalLog = console.log
  let gapTimeout: NodeJS.Timer | null = null
  function mindTheGap() {
    originalLog("\n\n\n\n\n\n")
  }
  const newLog: typeof console.log = (...args) => {
    originalLog(...args)
    if (gapTimeout !== null) {
      clearTimeout(gapTimeout)
      gapTimeout = null
    }
    gapTimeout = setTimeout(mindTheGap, 1000)
  }
  console.log = newLog
}
