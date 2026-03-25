import { describe, expect, it } from "vitest"
import { isPasteTransaction } from "@/lib/editor/transactions"

const transactionWithMeta = (meta: Record<string, unknown>) => ({
  getMeta: (key: string) => meta[key],
})

describe("isPasteTransaction", () => {
  it("detects explicit paste meta flag", () => {
    expect(isPasteTransaction(transactionWithMeta({ paste: true }))).toBe(true)
  })

  it("detects paste uiEvent meta", () => {
    expect(isPasteTransaction(transactionWithMeta({ uiEvent: "paste" }))).toBe(true)
  })

  it("returns false for non-paste transactions", () => {
    expect(isPasteTransaction(transactionWithMeta({ uiEvent: "keydown", paste: false }))).toBe(false)
  })
})
