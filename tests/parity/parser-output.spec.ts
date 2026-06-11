/**
 * @vitest-environment happy-dom
 */
import { readFileSync, readdirSync } from "node:fs"
import { basename, join } from "node:path"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DesktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { parseDocumentFileToSnapshot, parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"

const FIXTURE_DIR = join(process.cwd(), "tests/parity/fixtures")
const fixtureNames = readdirSync(FIXTURE_DIR).filter((name) => name.endsWith(".md")).sort()

const normalizeForComparison = (value: string) => value.replaceAll(/\s+data-id="[^"]+"/g, "")

describe("canonical markdown parser parity", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "11111111-1111-4111-8111-111111111111"),
    })
  })

  it.each(fixtureNames)("%s keeps shared parser and desktop engine structurally equivalent", (fixtureName) => {
    const source = readFileSync(join(FIXTURE_DIR, fixtureName), "utf8")
    const shared = parseDocumentFileToSnapshot(source)
    const desktop = new DesktopDocumentEngine().parseSourceDocument(source)

    expect(desktop.success).toBe(true)
    if (!desktop.success) return

    expect(desktop.document.metadata).toEqual(shared.metadata)
    expect(desktop.document.snapshot.bodyJson).toEqual(shared.snapshot.bodyJson)
    expect(desktop.document.snapshot.bodyText).toBe(shared.snapshot.bodyText)
    expect(normalizeForComparison(desktop.document.snapshot.markdown)).toBe(
      normalizeForComparison(shared.snapshot.markdown),
    )
  })

  it("documents intentional normalization instead of treating it as runtime divergence", () => {
    const source = readFileSync(join(FIXTURE_DIR, "intentional-divergences.md"), "utf8")
    const snapshot = parseMarkdownToSnapshot(source)

    expect(snapshot.markdown).toContain("==HTML highlight==")
    expect(snapshot.markdown).toContain("| A | B |")
    expect(snapshot.markdown).not.toContain("[^1]:")
    expect(snapshot.bodyText).toContain("Intentional divergences")
  })

  it.each(fixtureNames)("%s survives a second parse without semantic drift", (fixtureName) => {
    const source = readFileSync(join(FIXTURE_DIR, fixtureName), "utf8")
    const first = parseDocumentFileToSnapshot(source)
    const second = parseMarkdownToSnapshot(first.snapshot.markdown)

    expect(second.bodyJson).toEqual(first.snapshot.bodyJson)
    expect(second.bodyText).toBe(first.snapshot.bodyText)
    expect(normalizeForComparison(second.markdown)).toBe(normalizeForComparison(first.snapshot.markdown))
  })

  it("keeps fixture coverage explicit", () => {
    expect(fixtureNames.map((name) => basename(name, ".md"))).toEqual([
      "core-profile",
      "intentional-divergences",
    ])
  })
})
