import { describe, expect, it } from "vitest"
import { isPasteTransaction, isPointerTransaction, shouldDeferRichModeSideEffects } from "@/lib/editor/transactions"

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

describe("isPointerTransaction", () => {
  it("detects explicit pointer meta flag", () => {
    expect(isPointerTransaction(transactionWithMeta({ pointer: true }))).toBe(true)
  })

  it("detects click uiEvent meta", () => {
    expect(isPointerTransaction(transactionWithMeta({ uiEvent: "click" }))).toBe(true)
  })

  it("returns false for non-pointer transactions", () => {
    expect(isPointerTransaction(transactionWithMeta({ uiEvent: "keydown", pointer: false }))).toBe(false)
  })
})

describe("shouldDeferRichModeSideEffects", () => {
  it("defers paste transactions", () => {
    expect(shouldDeferRichModeSideEffects(transactionWithMeta({ paste: true }))).toBe(true)
  })

  it("defers pointer transactions", () => {
    expect(shouldDeferRichModeSideEffects(transactionWithMeta({ pointer: true }))).toBe(true)
  })

  it("keeps keyboard transactions in the sync path", () => {
    expect(shouldDeferRichModeSideEffects(transactionWithMeta({ uiEvent: "keydown", pointer: false }))).toBe(false)
  })
})
