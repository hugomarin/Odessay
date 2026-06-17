/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it, vi } from "vitest"
import { applyAnnotationToBody, getBodyMarkdown } from "@/lib/editor/annotation-document"

describe("annotation-document", () => {
  // Stable UUIDs for deterministic assertions
  const uuids = [
    "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
    "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb",
    "cccccccc-cccc-4ccc-cccc-cccccccccccc",
  ]
  let uuidCounter = 0

  vi.stubGlobal("crypto", {
    randomUUID: () => {
      const id = uuids[uuidCounter % uuids.length]
      uuidCounter++
      return id
    },
  })

  describe("getBodyMarkdown", () => {
    it("returns empty string for null/undefined body_json", () => {
      expect(getBodyMarkdown(null)).toBe("")
      expect(getBodyMarkdown(undefined)).toBe("")
    })

    it("serializes a simple paragraph to markdown", () => {
      const bodyJson = {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }],
      }
      expect(getBodyMarkdown(bodyJson)).toBe("Hello world")
    })
  })

  describe("applyAnnotationToBody", () => {
    it("inserts an annotation into a document with text", () => {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Hello world" }],
          },
        ],
      }

      const result = applyAnnotationToBody({
        bodyJson,
        bodyText: "Hello world",
        anchorStart: 0,
        anchorEnd: 5,
        type: "ai",
        text: "simplify",
      })

      // bodyText preserves the original plain text (annotation text is not part of body_text)
      expect(result.bodyText).toBe("Hello world")
      expect(result.bodyMarkdown).toContain("==Hello==")
      expect(result.bodyMarkdown).toMatch(/\[@1\|[^\]:|]+: simplify\]/)
      expect(result.bodyJson.content?.length).toBeGreaterThan(0)
    })

    it("inserts an annotation at the correct range in existing text", () => {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "The quick brown fox" }],
          },
        ],
      }

      const result = applyAnnotationToBody({
        bodyJson,
        bodyText: "The quick brown fox",
        anchorStart: 4, // "quick"
        anchorEnd: 9,
        type: "personal",
        text: "important detail",
      })

      expect(result.bodyMarkdown).toContain("==quick==")
      expect(result.bodyMarkdown).toMatch(/\[@p1\|[^\]:|]+: important detail\]/)
    })

    it("increments index sequentially for same-type annotations", () => {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "First note " },
              {
                type: "annotationReference",
                attrs: { id: "x", type: "ai", index: 1, text: "note" },
              },
              { type: "text", text: " second" },
            ],
          },
        ],
      }

      const result = applyAnnotationToBody({
        bodyJson,
        bodyText: "First note second",
        anchorStart: 11,
        anchorEnd: 17,
        type: "ai",
        text: "second note",
      })

      expect(result.bodyMarkdown).toMatch(/\[@2\|[^\]:|]+: second note\]/)
    })

    it("round-trips highlight + annotation through body_json and markdown", () => {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Passage to annotate" }],
          },
        ],
      }

      const result = applyAnnotationToBody({
        bodyJson,
        bodyText: "Passage to annotate",
        anchorStart: 0,
        anchorEnd: 7,
        type: "ai",
        text: "clarify",
      })

      // Markdown must contain both the highlight mark and the annotation sigil
      expect(result.bodyMarkdown).toContain("==Passage==")
      expect(result.bodyMarkdown).toContain("[@1|")
      expect(result.bodyMarkdown).toContain(": clarify]")

      // body_json must contain the annotationReference node
      const paragraph = result.bodyJson.content?.[0]
      expect(paragraph?.type).toBe("paragraph")
      const hasAnnotation = paragraph?.content?.some(
        (node: { type?: string; attrs?: Record<string, unknown> }) =>
          node.type === "annotationReference" && node.attrs?.text === "clarify",
      )
      expect(hasAnnotation).toBe(true)

      // Re-serializing the resulting body_json produces equivalent markdown
      const reMarkdown = getBodyMarkdown(result.bodyJson)
      expect(reMarkdown).toContain("==Passage==")
      expect(reMarkdown).toBe(result.bodyMarkdown)
    })

    it("replaces an existing annotation reference when the same text is re-annotated", () => {
      const bodyJson = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              {
                type: "text",
                text: "Hello",
                marks: [{ type: "highlight" }],
              },
              {
                type: "annotationReference",
                attrs: { id: "existing", type: "personal", index: 1, text: "keep an eye on this" },
              },
              { type: "text", text: " world" },
            ],
          },
        ],
      }

      const result = applyAnnotationToBody({
        bodyJson,
        bodyText: "Hello world",
        anchorStart: 0,
        anchorEnd: 5,
        type: "ai",
        text: "simplify this",
      })

      const paragraph = result.bodyJson.content?.[0]
      const annotationNodes =
        paragraph?.content?.filter(
          (node: { type?: string }) => node.type === "annotationReference",
        ) ?? []

      expect(annotationNodes).toHaveLength(1)
      expect(annotationNodes[0]).toMatchObject({
        attrs: { type: "ai", index: 1, text: "simplify this" },
      })
      expect(result.bodyMarkdown).toContain("==Hello==")
      expect(result.bodyMarkdown).toContain("[@1|")
      expect(result.bodyMarkdown).toContain(": simplify this]")
      expect(result.bodyMarkdown).not.toContain("keep an eye on this")
    })

    it("throws on invalid annotation range", () => {
      expect(() =>
        applyAnnotationToBody({
          bodyJson: null,
          bodyText: "",
          anchorStart: 5,
          anchorEnd: 5,
          type: "ai",
          text: "bad range",
        }),
      ).toThrow("Invalid annotation range.")
    })

    it("rejects null body with out-of-bounds range", () => {
      // An empty doc has no text, so any positive range is invalid
      expect(() =>
        applyAnnotationToBody({
          bodyJson: null,
          bodyText: "",
          anchorStart: 0,
          anchorEnd: 1,
          type: "ai",
          text: "test",
        }),
      ).toThrow("Invalid annotation range.")
    })
  })
})
