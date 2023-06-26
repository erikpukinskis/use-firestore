import { createContext, useContext, useState } from "react"
import {
  isInitialized,
  makeUninitializedContext,
} from "./makeUninitializedContext"
import { SubscriptionService } from "./SubscriptionService"

const DocsContext = createContext<SubscriptionService>(
  makeUninitializedContext(
    "The useDoc and useDocs hooks do not work outside of a DocsProvider"
  )
)

type DocsProviderProps = {
  children: React.ReactNode
}

export function DocsProvider({ children }: DocsProviderProps) {
  const [service] = useState(() => new SubscriptionService())

  return <DocsContext.Provider value={service}>{children}</DocsContext.Provider>
}

export function useSubscriptionService(hookName: string) {
  const context = useContext(DocsContext)

  if (!isInitialized(context)) {
    throw new Error(`${hookName} cannot be used outside of a DocsProvider`)
  }

  return context
}
