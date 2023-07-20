import { describe, it, expect } from "vitest"
import { useQuery, useGlobalMemo } from "~/index"

describe("MyComponent", () => {
  it("should import", () => {
    expect(typeof useQuery).toBe("function")
    expect(typeof useGlobalMemo).toBe("function")
  })
})
