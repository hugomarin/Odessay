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

Paragraph with **bold**, *italic*, ~~strike~~, ==highlight== and a footnote [^1|footnote-1: Footnote body].

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

  it("accepts legacy canonical frontmatter and round-trips the markdown body", () => {
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

Paragraph with ==highlight== and [^1|footnote-1: Footnote body].`

    const result = engine.validateRoundTrip(source)
    expect(result.ok).toBe(true)
  })

  it("round-trips foreign frontmatter byte-for-byte as a frontmatter node", () => {
    const source = `---
doc: linear-issue-creation
titulo: Create Linear issues
capa: tool-policy
tipo: policy
funcion: Create issues safely
cuando_usar: On issue creation
relaciones: ODE-322
---

# Tool Policy

Body text here.`

    const parsed = engine.sourceToRich(source)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: source.slice(4, source.indexOf("\n---")) },
    })

    const serialized = engine.serializeBodyJson(parsed.snapshot.bodyJson)
    expect(serialized).toEqual({ success: true, markdown: source })
    expect(engine.validateRoundTrip(source)).toEqual({ ok: true })
  })

  it("preserves foreign frontmatter that happens to include an id key", () => {
    const source = `---
id: my-note-2024
title: My Note
tags: journal
---

# Body

Text.`

    const parsed = engine.sourceToRich(source)
    expect(parsed.success).toBe(true)
    if (!parsed.success) return
    expect(parsed.snapshot.bodyJson.content?.[0]).toMatchObject({
      type: "frontmatter",
      attrs: { raw: source.slice(4, source.indexOf("\n---")) },
    })

    const serialized = engine.serializeBodyJson(parsed.snapshot.bodyJson)
    expect(serialized).toEqual({ success: true, markdown: source })
    expect(engine.validateRoundTrip(source)).toEqual({ ok: true })
  })

  it("preserves folded YAML frontmatter through the desktop save path", () => {
    const source = `---
name: pm-orchestrator
description: >
  Garante del flujo de planeación del Planning Harness. Recibe una intención (crear épica,
  crear issue, validar issue, aprender) y responde por que se convierta en el resultado que su
  flujo define: arranca la cadena, lanza cada subagente siguiendo el ruteo del Refiner, la
  monitorea vía el estado, y cierra (presenta al usuario y crea en Linear con su aprobación).
  El contenido lo producen el Refiner, los especialistas y el Planning Auditor.
tools: Read, Glob, Grep, Write, Edit, Task, Skill, Linear
model: inherit
---
`

    const parsed = engine.sourceToRich(source)
    expect(parsed).toMatchObject({ success: true })
    if (!parsed.success) return

    const saved = engine.serializeBodyJson(parsed.snapshot.bodyJson)
    expect(saved).toEqual({ success: true, markdown: source.trimEnd() })
  })
})
