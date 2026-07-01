import { Schema } from "@tiptap/pm/model"
import { describe, expect, it } from "vitest"
import { resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"
import type { PublicationSuggestion } from "@/lib/local-db/schema"

const schema = new Schema({
  nodes: {
    doc: { content: "block+" },
    paragraph: {
      content: "text*",
      group: "block",
      toDOM: () => ["p", 0],
    },
    text: { group: "inline" },
  },
  marks: {
    em: {
      toDOM: () => ["em", 0],
    },
  },
})

const createSuggestion = (overrides: Partial<PublicationSuggestion> = {}): PublicationSuggestion => ({
  id: "spelling-1",
  kind: "spelling",
  title: "Spelling",
  reason: "Typo",
  original_text: "prueva",
  replacement_text: "prueba",
  context_before: null,
  context_after: null,
  block_id: "block-1",
  correction_fingerprint: "block-1|spelling|prueva|prueba",
  status: "pending",
  ...overrides,
})

describe("AI correction decorations", () => {
  it("resolves pending suggestions to stable ProseMirror ranges", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Esta es una prueva.")]),
    ])

    expect(resolveCorrectionDecorationRanges(doc, [createSuggestion()])).toEqual([
      {
        suggestion: createSuggestion(),
        from: 13,
        to: 19,
      },
    ])
  })

  it("uses context to avoid decorating the first repeated text blindly", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("prueva inicial. Otra prueva final.")]),
    ])

    const [resolved] = resolveCorrectionDecorationRanges(doc, [
      createSuggestion({
        context_before: "Otra",
        context_after: "final",
      }),
    ])

    expect(resolved?.from).toBe(22)
    expect(resolved?.to).toBe(28)
  })

  it("ignores resolved, missing, and overlapping suggestions", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("Esta es una prueva.")]),
    ])

    expect(
      resolveCorrectionDecorationRanges(doc, [
        createSuggestion({ id: "accepted", status: "accepted" }),
        createSuggestion({ id: "missing", original_text: "ausente" }),
        createSuggestion({ id: "first" }),
        createSuggestion({ id: "overlap", replacement_text: "prueba final" }),
      ]).map((item) => item.suggestion.id),
    ).toEqual(["first"])
  })

  it("honors occurrence metadata for repeated corrections", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("prueva inicial. Otra prueva final.")]),
    ])

    const [resolved] = resolveCorrectionDecorationRanges(doc, [
      createSuggestion({
        occurrence: 1,
      }),
    ])

    expect(resolved?.from).toBe(22)
    expect(resolved?.to).toBe(28)
  })

  it("maps first-block phrases after a space without consuming adjacent characters", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("aplicació de escritorio creo")]),
    ])

    const [resolved] = resolveCorrectionDecorationRanges(doc, [
      createSuggestion({
        original_text: "escritorio creo",
        replacement_text: "escritorio. Creo",
      }),
    ])

    expect(resolved?.from).toBe(14)
    expect(resolved?.to).toBe(29)
    expect(doc.textBetween(resolved?.from ?? 0, resolved?.to ?? 0, "", "")).toBe("escritorio creo")
  })

  it("preserves exact ranges for marked text inside a block", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [
        schema.text("Texto "),
        schema.text("prueva", [schema.mark("em")]),
        schema.text(" final"),
      ]),
    ])

    const [resolved] = resolveCorrectionDecorationRanges(doc, [createSuggestion()])

    expect(resolved?.from).toBe(7)
    expect(resolved?.to).toBe(13)
    expect(doc.textBetween(resolved?.from ?? 0, resolved?.to ?? 0, "", "")).toBe("prueva")
  })

  it("anchors stale suggestions to their source block instead of decorating another occurrence", () => {
    const doc = schema.node("doc", null, [
      schema.node("paragraph", null, [schema.text("prueva inicial.")]),
      schema.node("paragraph", null, [schema.text("Otra prueba final.")]),
    ])
    let secondBlockPos = 0

    doc.descendants((node, pos) => {
      if (node.type.name === "paragraph" && node.textContent === "Otra prueba final.") {
        secondBlockPos = pos
        return false
      }

      return true
    })

    expect(
      resolveCorrectionDecorationRanges(doc, [
        createSuggestion({
          status: "pending-stale",
          block_id: `correction-block:old-hash:${secondBlockPos}`,
        }),
      ]),
    ).toEqual([])
  })
})
