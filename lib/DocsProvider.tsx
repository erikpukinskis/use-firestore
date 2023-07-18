import { createContext, useContext, useState } from "react"
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

export function DocsProvider({ children, debug = false }: DocsProviderProps) {
  const [services] = useState(() => ({
    queryService: new QueryService(debug),
    collectionService: new CollectionService(debug),
  }))

  return (
    <DocsContext.Provider value={services}>{children}</DocsContext.Provider>
  )
}

export function useQueryService(hookName: string) {
  const context = useContext(DocsContext)

  if (!isInitialized(context)) {
    throw new Error(`${hookName} cannot be used outside of a DocsProvider`)
  }

  return context.queryService
}

export function useCollectionService(hookName: string) {
  const context = useContext(DocsContext)

  if (!isInitialized(context)) {
    throw new Error(`${hookName} cannot be used outside of a DocsProvider`)
  }

  return context.collectionService
}
