/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopDocumentEngine } from "@/lib/editor/desktop-document-engine"

const engine = new DesktopDocumentEngine()

const FIXTURES = [
  {
    name: "nested lists",
    markdown: `# Nested Lists

1. First
   - Alpha
   - Beta
2. Second

- Uno
  1. Child one
  2. Child two`,
  },
  {
    name: "tables and fenced code",
    markdown: `# Tables and Code

| Column A | Column B |
| --- | --- |
| Left | Right |

\`\`\`ts
const table = new Map<string, number>()
table.set("alpha", 1)
\`\`\``,
  },
  {
    name: "footnotes and mixed marks",
    markdown: `# Notes

Paragraph with **bold**, *italic*, ~~strike~~, ==highlight== and a footnote [^1: Footnote body].

> Quote with [link](https://example.com).`,
  },
] as const

describe("editor markdown round-trip fixtures", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "44444444-4444-4444-8444-444444444444"),
    })
  })

  for (const fixture of FIXTURES) {
    it(`keeps ${fixture.name} stable across round-trip`, () => {
      const result = engine.validateRoundTrip(fixture.markdown)
      expect(result.ok).toBe(true)
    })
  }

  it("preserves canonical front-matter with the markdown body", () => {
    const source = `---
id: writing-123
slug: canonical-roundtrip
status: draft
visibility: private
version: 3
created_at: 2026-06-03T00:00:00.000Z
updated_at: 2026-06-03T01:00:00.000Z
---

# Canonical File

Paragraph with ==highlight== and [^1: Footnote body].`

    const result = engine.validateRoundTrip(source)
    expect(result.ok).toBe(true)
  })
})
