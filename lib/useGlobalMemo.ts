const map = new WeakMap()

const ADDRESS_START = Number.MAX_SAFE_INTEGER / 100
let next = ADDRESS_START

const cache: Record<string, unknown> = {}

const Undefined = Symbol("undefined")

/**
 * Calls the generator function you provide whenever the dependencies change,
 * same as React's useMemo hook.
 *
 * HOWEVER, it also caches the result, and if `useGlobalMemo` is ever called
 * twice in your app with the same `cacheKey` and `dependencies` then it will
 * return the globally cached value returned from the generator. That means you
 * can call `useGlobalMemo` 50 times on the same page with the same dependencies
 * and the generator will only be called once.
 */
export function useGlobalMemo<V>(
  cacheKey: string,
  generator: () => V,
  dependencies: Serializable[]
) {
  if (/\|/.test(cacheKey)) {
    throw new Error("keys cannot use the | character")
  }

  const serialized = dependencies.map(serialize)

  const address = `${cacheKey}|${serialized.join("|")}`

  const cached = cache[address]

  if (cached === Undefined) return undefined

  if (cached === undefined) {
    console.log(address, "cache miss")
    const fresh = generator()
    cache[address] = fresh === undefined ? Undefined : fresh
    return fresh
  }

  return cached
}

type Serializable = object | string | number | null | undefined | boolean

function serialize(value: Serializable) {
  if (value instanceof Object) {
    if (map.has(value)) return map.get(value) as string
    next++
    const address = String(next)
    map.set(value, address)
    return address
  }

  if (typeof value === "string") {
    return `"${value.replace('"', '"')}"`
  }

  return String(value)
}
