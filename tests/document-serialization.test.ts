/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { JSONContent } from "@tiptap/core"
import {
  BODY_JSON_PERSISTENCE_ROLE,
  CANONICAL_DOCUMENT_CONTRACT,
  CANONICAL_DOCUMENT_EXTENSION,
  CANONICAL_DOCUMENT_FORMAT,
  ODESSAY_MARKDOWN_PROFILE_ID,
} from "@/lib/editor/document-profile"
import {
  parseDocumentFileToSnapshot,
  parseMarkdownToSnapshot,
  serializeCanonicalFrontmatter,
  serializeDocumentFile,
  serializeDocumentToMarkdown,
  serializeDocumentToSnapshot,
} from "@/lib/editor/document-serialization"
import { buildWritingMarkdown } from "@/lib/export/writing-export"

describe("document profile", () => {
  it("declares markdown as the canonical document contract", () => {
    expect(CANONICAL_DOCUMENT_FORMAT).toBe("markdown")
    expect(CANONICAL_DOCUMENT_EXTENSION).toBe(".md")
    expect(ODESSAY_MARKDOWN_PROFILE_ID).toBe("odessay-markdown-v1")
    expect(BODY_JSON_PERSISTENCE_ROLE).toBe("transitional")
    expect(CANONICAL_DOCUMENT_CONTRACT.bodyJsonRole).toBe("transitional")
  })
})

describe("document serialization", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    })
  })

  it("serializes rich body_json through the canonical markdown route", () => {
    const markdown = serializeDocumentToMarkdown({
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Alpha " },
            { type: "text", text: "Beta", marks: [{ type: "highlight" }] },
            { type: "text", text: " " },
            {
              type: "annotationReference",
              attrs: { id: "ann-1", type: "footnote", index: 1, text: "Footnote body" },
            },
          ],
        },
      ],
    })

    expect(markdown).toContain("# Title")
    expect(markdown).toContain("Alpha ==Beta==")
    expect(markdown).toContain("[^1|ann-1: Footnote body]")
  })

  it("creates a stable snapshot for empty inputs", () => {
    const snapshot = serializeDocumentToSnapshot(null)

    expect(snapshot.bodyJson).toEqual({ type: "doc", content: [{ type: "paragraph" }] })
    expect(snapshot.bodyText).toBe("")
    expect(snapshot.markdown).toBe("")
  })

  it("keeps export markdown equivalent to the rich serializer on the supported subset", () => {
    const bodyJson: JSONContent = {
      type: "doc",
      content: [
        {
          type: "heading",
          attrs: { level: 1 },
          content: [{ type: "text", text: "Title" }],
        },
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Alpha " },
            { type: "text", text: "Beta", marks: [{ type: "bold" }] },
            { type: "text", text: " " },
            {
              type: "annotationReference",
              attrs: { id: "ann-1", type: "footnote", index: 1, text: "Footnote body" },
            },
          ],
        },
      ],
    }

    expect(buildWritingMarkdown(bodyJson)).toBe("# Title\n\nAlpha **Beta** [^1]\n\n[^1]: Footnote body")
    expect(serializeDocumentToMarkdown(bodyJson)).toBe("# Title\n\nAlpha **Beta** [^1|ann-1: Footnote body]")
  })

  it("serializes canonical front-matter with stable field ordering", () => {
    expect(
      serializeCanonicalFrontmatter({
        id: "writing-123",
        slug: "hello-world",
        status: "draft",
        visibility: "private",
        version: 2,
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T01:00:00.000Z",
      }),
    ).toBe(`---
id: writing-123
slug: hello-world
status: draft
visibility: private
version: 2
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T01:00:00.000Z'
---`)
  })

  it("serializes document files as markdown content only", () => {
    const source = serializeDocumentFile(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "Canonical body" }],
          },
        ],
      },
      {
        id: "writing-123",
        slug: "canonical-body",
        status: "draft",
        visibility: "private",
        version: 4,
        createdAt: "2026-06-03T00:00:00.000Z",
        updatedAt: "2026-06-03T02:00:00.000Z",
      },
    )

    expect(source).toBe("Canonical body")
    expect(source).not.toContain("---")
    expect(source).not.toContain("id: writing-123")
  })

  it("treats legacy Odessay-shaped front-matter as document content", () => {
    const source = `---
id: writing-123
slug: canonical-body
status: draft
visibility: private
version: 4
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T02:00:00.000Z'
---

Canonical body`

    const parsed = parseDocumentFileToSnapshot(source)

    expect(parsed.metadata).toBeNull()
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: source.slice(4, source.indexOf("\n---")) },
    })
    expect(parsed.snapshot.markdown).toBe(source)
    expect(parsed.snapshot.bodyText).toContain("id: writing-123")
    expect(parsed.snapshot.bodyText).toContain("Canonical body")
  })

  it("preserves legacy Odessay-shaped front-matter in markdown snapshots", () => {
    const snapshot = parseMarkdownToSnapshot(`---
id: writing-123
slug: hello-world
status: draft
visibility: private
version: 2
created_at: '2026-06-03T00:00:00.000Z'
updated_at: '2026-06-03T01:00:00.000Z'
---

# Hello world`)

    expect(snapshot.markdown).toContain("id: writing-123")
    expect(snapshot.bodyText).toContain("id: writing-123")
    expect(snapshot.bodyText).toContain("Hello world")
  })

  it("keeps non-Odessay front-matter as document content", () => {
    const source = `---
name: skill-example
description: Keep this YAML untouched
---

# Skill Body`

    const parsed = parseDocumentFileToSnapshot(source)

    expect(parsed.metadata).toBeNull()
    expect(parsed.markdown).toContain("name: skill-example")
    expect(parsed.markdown).toContain("# Skill Body")
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: "name: skill-example\ndescription: Keep this YAML untouched" },
    })
    expect(parsed.snapshot.bodyText).toContain("name: skill-example")
    expect(parsed.snapshot.bodyText).toContain("Skill Body")
    expect(parsed.snapshot.markdown).toBe(source)
  })
})
