import { describe, expect, it } from "vitest"
import {
  isValidVocabularyColor,
  isValidVocabularyIcon,
  validateVocabularyItemFields,
} from "@/lib/vocabulary/validate"

describe("isValidVocabularyIcon", () => {
  it("accepts a type icon only for kind=type", () => {
    expect(isValidVocabularyIcon("type", "bot")).toBe(true)
    expect(isValidVocabularyIcon("status", "bot")).toBe(false)
  })

  it("accepts a status icon only for kind=status", () => {
    expect(isValidVocabularyIcon("status", "circle-check")).toBe(true)
    expect(isValidVocabularyIcon("type", "circle-check")).toBe(false)
  })

  it("rejects an icon outside both closed sets", () => {
    expect(isValidVocabularyIcon("type", "nonexistent-icon")).toBe(false)
    expect(isValidVocabularyIcon("status", "nonexistent-icon")).toBe(false)
  })

  it("rocket is a type icon, not a status icon", () => {
    expect(isValidVocabularyIcon("type", "rocket")).toBe(true)
    expect(isValidVocabularyIcon("status", "rocket")).toBe(false)
  })
})

describe("isValidVocabularyColor", () => {
  it("accepts one of the admissible hex colors, case-insensitively", () => {
    expect(isValidVocabularyColor("#5B5BD6")).toBe(true)
    expect(isValidVocabularyColor("#5b5bd6")).toBe(true)
  })

  it("rejects a hex outside the closed palette — no arbitrary CSS vector", () => {
    expect(isValidVocabularyColor("#FF0000")).toBe(false)
    expect(isValidVocabularyColor("red")).toBe(false)
  })
})

describe("validateVocabularyItemFields", () => {
  it("rejects an empty name", () => {
    const errors = validateVocabularyItemFields("type", { name: "   " })
    expect(errors.some((e) => e.field === "name")).toBe(true)
  })

  it("rejects a name over the length cap", () => {
    const errors = validateVocabularyItemFields("type", { name: "x".repeat(61) })
    expect(errors.some((e) => e.field === "name")).toBe(true)
  })

  it("rejects a description over 180 characters", () => {
    const errors = validateVocabularyItemFields("status", { description: "x".repeat(181) })
    expect(errors.some((e) => e.field === "description")).toBe(true)
  })

  it("rejects an icon outside the closed set for the kind", () => {
    const errors = validateVocabularyItemFields("status", { icon: "bot" })
    expect(errors.some((e) => e.field === "icon")).toBe(true)
  })

  it("rejects a color outside the admissible colors", () => {
    const errors = validateVocabularyItemFields("type", { color: "#123456" })
    expect(errors.some((e) => e.field === "color")).toBe(true)
  })

  it("accepts a fully valid set of fields", () => {
    const errors = validateVocabularyItemFields("type", {
      name: "Research",
      description: "Notes gathered before writing.",
      icon: "compass",
      color: "#5B5BD6",
    })
    expect(errors).toEqual([])
  })
})
