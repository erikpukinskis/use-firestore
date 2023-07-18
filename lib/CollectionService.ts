import type { CollectionReference, DocumentData } from "firebase/firestore"
import { onSnapshot } from "firebase/firestore"

type CachedDocument = DocumentData & { id: string; __path: string }

export const UNSUBSCRIBE_DELAY = 100

function red(text: string) {
  return `\x1b[31m${text}\x1b[0m`
}

/**
 * The CollectionService keeps track of:
 *
 * 1) Which hooks are currently listening for changes to queries or individual
 *    documents
 *
 * 2) Which subscriptions are providing updates for which documents
 *
 * 3) Which other subscriptions are available to provide updates for those
 *    documents should the existing one unsubscribe
 *
 * The service manages handoffs between those subscriptions, and fires up new
 * subscriptions as needed, to keep all of the hooks fed with up-to-date data.
 */
export class CollectionService {
  debug: boolean

  // For documents...
  ownerByDocPath: Record<string, string> = {}
  unsubscribeFunctionsByDocPath: Record<string, () => void> = {}
  docListenersByPath: Record<string, Array<(doc: CachedDocument) => void>> = {}
  lastDocByPath: Record<string, CachedDocument> = {}
  assignDocOwnerFunctionsByPath: Record<string, Array<() => void>> = {}

  constructor(debug: boolean) {
    this.debug = debug
  }

  log(...args: Parameters<typeof console.log>) {
    if (!this.debug) return
    console.log(`${red("use-firestore")} |`, ...args)
  }

  registerDocsHook(
    hookId: string,
    collection: CollectionReference,
    ids: string[],
    onDocs: (docs: CachedDocument[]) => void
  ) {
    const path = ref.path

    // First we make sure these arrays are present for this path
    let listeners = this.docListenersByPath[path]

    if (!listeners) {
      listeners = []
      this.docListenersByPath[path] = listeners
    }

    let assignDocOwnerFunctions = this.assignDocOwnerFunctionsByPath[path]

    if (!assignDocOwnerFunctions) {
      assignDocOwnerFunctions = []
      this.assignDocOwnerFunctionsByPath[path] = assignDocOwnerFunctions
    }

    listeners.push(onDoc)

    /**
     * Stop passing document updates to the hook
     */
    const removeListener = () => {
      const index = listeners.findIndex((func) => func === onDoc)

      if (index < 0) {
        throw new Error(
          `Document listener for hook ${hookId} was already gone before unlisten() was called`
        )
      }

      listeners.splice(index, 1)
    }

    /**
     * Subscribe to updates from this document and provide them to any and all
     * listeners to this path.
     */
    const subscribe = () => {
      this.log("doc hook", hookId, "subscribing to", path)
      if (this.ownerByDocPath[path]) {
        throw new Error(
          `Path ${path} is already owned by ${this.ownerByDocPath[path]}`
        )
      }

      const unsubscribeFromSnapshot = onSnapshot(ref, (snapshot) => {
        if (!snapshot.exists()) {
          throw new Error(
            `Received a snapshot suggesting document ${ref.path} does not exist`
          )
        }

        const newDoc = {
          id: ref.id,
          ...snapshot.data(),
        } as CachedDocument

        this.lastDocByPath[path] = newDoc

        for (const listener of listeners) {
          listener(newDoc)
        }
      })

      this.unsubscribeFunctionsByDocPath[path] = unsubscribeFromSnapshot

      this.ownerByDocPath[path] = hookId
    }

    /**
     * Give up ownership of the path, and pass on ownership to another hook if
     * there is one available or otherwise unsubscribe from snapshots.
     */
    const unsubscribe = () => {
      this.log(
        "unsubscribing hook",
        hookId,
        "owner is",
        this.ownerByDocPath[path]
      )
      // If we're not the owner of the current subscription, there's nothing to unsubscribe
      if (this.ownerByDocPath[path] !== hookId) {
        return
      }

      const assignNextOwner = assignDocOwnerFunctions?.shift()

      // Give up ownership
      delete this.ownerByDocPath[path]

      this.log(path, "has another owner?", assignNextOwner ? "yes" : "no")
      // If there's someone else waiting to be the new owner, let 'em have the subscription
      if (assignNextOwner) {
        assignNextOwner()
        return
      }

      // Else shut it down
      const unsubscribeFromSnapshots = this.unsubscribeFunctionsByDocPath[path]

      if (!unsubscribeFromSnapshots) {
        throw new Error(
          `No unsubscribe function found for path ${path} even though ${hookId} is the owner?`
        )
      }

      unsubscribeFromSnapshots()
      this.log("unsubscribed from", path)
    }

    /**
     * Listen for updates to the document from a pre-existing subscription, and
     * be ready to take over if needed.
     */
    const listen = () => {
      this.log("listening", hookId)
      // There's already a document subscription, owned by someone else. Just
      // register ourselves as a potential next owner:
      assignDocOwnerFunctions.push(takeOwnership)

      this.log(assignDocOwnerFunctions.length, "owners waiting on", path) ///

      const lastDoc = this.lastDocByPath[path]

      if (lastDoc) onDoc(lastDoc)
    }

    const takeOwnership = () => {
      this.log(hookId, "is taking ownership of", path)
      if (this.unsubscribeFunctionsByDocPath[path]) {
        this.ownerByDocPath[path] = hookId
      } else {
        subscribe()
      }
      this.log(
        hookId,
        "now owns",
        path,
        "remaining owners are",
        assignDocOwnerFunctions
      )
    }

    /**
     * If we're just a quiet little listener (not an owner) we can just quietly
     * unregister ourselves when the hook is done
     */
    const ignoreOwnershipRequests = () => {
      const index = assignDocOwnerFunctions.findIndex(
        (func) => func === takeOwnership
      )

      if (index < 0) {
        throw new Error(
          `zup Doc ownership function for hook ${hookId} was already gone before unlisten() was called ${assignDocOwnerFunctions.length}`
        )
      }

      assignDocOwnerFunctions.splice(index, 1)

      this.log(assignDocOwnerFunctions.length, "owners waiting")
    }

    /**
     * Either unlistens or unsubscribes depending on whether this hook is the
     * current subscription owner.
     */
    const unregister = () => {
      const weAreTheOwner = this.ownerByDocPath[path] === hookId
      this.log(
        "unregistering",
        hookId,
        `(${weAreTheOwner ? "owner" : "not the owner"})`
      )
      // First remove ourselves as a listener so we immediately stop sending snapshots to the callback
      removeListener()

      if (weAreTheOwner) {
        // We wait a little bit before unsubscribing, just in case we're
        // navigating or something and we're about to get a new wave of hooks
        // that might want to take over ownership.
        setTimeout(unsubscribe, UNSUBSCRIBE_DELAY)
      } else {
        ignoreOwnershipRequests()
      }
    }

    let cachedDocs: CachedDocument[] | undefined

    // if (this.ownerByDocPath[path]) {
    //   cachedDoc = this.lastDocByPath[path]
    //   listen()
    // } else {
    //   subscribe()
    // }

    return { unregister, cachedDocs }
  }
}
