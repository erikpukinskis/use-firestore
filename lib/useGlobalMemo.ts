/**
 * This is a map that we use to store every Object dependency that we see.
 * Because it's a WeakMap, it shouldn't interfere with garbage collection.
 *
 * And I believe that also means these objects could potentially get garbage
 * collected and then have to be re-generated from time to time. But that feels
 * like a feature not a bug? Otherwise this WeakMap could get fairly large. TBH
 * I'm not 100% sure what would happen when a key got garbage collected, in
 * terms of the memory size of this map.
 */
const map = new WeakMap()

/**
 * Each object in the map is mapped to an integer id. We split the integer space
 * in two, and take the larger half for ourselves. That means you can't use
 * integers over 4,503,599,627,370,494 as a dependency. Which seems fine.
 */
const ADDRESS_START = Math.floor(Number.MAX_SAFE_INTEGER / 2)
let next = ADDRESS_START

/**
 * Here is where we store the actual cached return values of the generators.
 *
 * The address for a generated value will be a string combination of the
 * cacheKey and the dependencies array. For example, if you call:
 *
 *       const a = 1
 *       const b = 2
 *       useGlobalMemo("sum", () => a + b, [a, b])
 *
 * Then the cache key will be "sum|1|2" and cache["sum|1|1"] will be set to 3
 */
const cache: Record<string, unknown> = {}

/**
 * We use `cache[key] === undefined` as our test to see if a generator has been
 * cached. So if a generator returns undefined we store that in the cache as
 * this symbol. That way we don't accidentally re-run the generator even though
 * we've already run it for that address.
 */
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
 *
 * Ex:
 *
 *       const a = 1
 *       const b = 2
 *       const sum = useGlobalMemo("sum", () => a + b, [a, b])
 *
 * In this example, `a + b` will only be calculated once, even if you call this
 * hook a hundred times with the same values in a hundred different components.
 */
export function useGlobalMemo<GeneratedValue>(
  cacheKey: string,
  generator: () => GeneratedValue,
  dependencies: Array<Serializable>
) {
  if (/\|/.test(cacheKey)) {
    throw new Error("useGlobalMemo cacheKey cannot use the | character")
  }

  const serialized = dependencies.map(serialize)

  const address = `${cacheKey}|${serialized.join("|")}`

  const cached = cache[address]

  if (cached === Undefined) return undefined as GeneratedValue

  if (cached === undefined) {
    const fresh = generator()
    cache[address] = fresh === undefined ? Undefined : fresh
    return fresh
  }

  return cached
}

/**
 * These are the data types that can be used as dependencies
 */
type Serializable = object | string | number | null | undefined | boolean

/**
 * Returns a unique string for a given dependency
 */
function serialize(dependency: Serializable) {
  if (dependency instanceof Object) {
    if (map.has(dependency)) return map.get(dependency) as string
    next++
    const address = String(next)
    map.set(dependency, address)
    return address
  }

  if (typeof dependency === "number" && dependency > ADDRESS_START) {
    throw new Error(
      `Cannot use ${dependency} as a dependency with useGlobalMemo because it's too large. We use the integers over ${
        ADDRESS_START - 1
      } to index objects.`
    )
  }
  if (typeof dependency === "string") {
    return `"${dependency.replace('"', '"')}"`
  }

  return String(dependency)
}
