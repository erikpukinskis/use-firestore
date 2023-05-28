import { describe, it, expect } from "vitest"
import { useDocs, useGlobalMemo } from "~/index"

describe("MyComponent", () => {
  it("should import", () => {
    expect(typeof useDocs).toBe("function")
    expect(typeof useGlobalMemo).toBe("function")
  })
})
