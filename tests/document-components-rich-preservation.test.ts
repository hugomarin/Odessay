/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { canonicalizeControlledMarkdown } from "@/lib/document-components"
import { parseControlledMarkdown } from "@/lib/document-components/parser"
import {
  parseMarkdownToSnapshot,
  serializeDocumentToMarkdown,
} from "@/lib/editor/document-serialization"
import { buildWritingExportDocument } from "@/lib/export/writing-export"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html-client"

// R12 (release-test-plan.md): source the Rich adapter cannot author must cross
// Markdown → body_json → Markdown with its exact bytes. The core engine already
// preserved it; the TipTap adapter used to drop tags and attributes while
// keeping the visible text, so body_text-only assertions could not see it.

const fixture = (name: string) =>
  readFileSync(path.join(process.cwd(), "tests/fixtures/document-components", name), "utf8")

const richRoundTrip = (markdown: string) =>
  serializeDocumentToMarkdown(parseMarkdownToSnapshot(markdown).bodyJson)

const PRESERVED_SOURCE: Array<[string, string]> = [
  ["invalid Entity (missing id)", 'Hello <Entity type="person">missing id</Entity> world'],
  ["unknown block component", 'Para\n\n<Future kind="x">\nKeep exact\n</Future>\n\nAfter'],
  [
    "ProtectedText without a Rich adapter",
    'Hi <ProtectedText id="lock-1" reason="private">Keep lock</ProtectedText> there',
  ],
  [
    "adapter-less inline inside an adapted Card",
    '<Card title="T">\nBody <ProtectedText id="l">x</ProtectedText>\n</Card>',
  ],
  ["unknown tag inside inline code", "Use `<Foo>` inline.\n\nAfter."],
  ["unclosed unknown tag in prose", "Type List<String> here.\n\nAfter."],
  ["invalid tag token in prose", "Map<String, Int> is useful.\n\nNext paragraph."],
]

describe("Rich adapter preserves source it cannot author", () => {
  it.each(PRESERVED_SOURCE)("%s survives the Rich round-trip byte for byte", (_label, source) => {
    expect(richRoundTrip(source)).toBe(source)
  })

  it.each([
    ["invalid/attributes.md"],
    ["invalid/unbalanced.md"],
    ["invalid/unknown-tag.md"],
    ["valid/nesting.md"],
  ])("fixture %s keeps every opaque or adapter-less byte", (name) => {
    const source = fixture(name).trimEnd()
    const once = richRoundTrip(source)
    expect(once).toBe(canonicalizeControlledMarkdown(source).trimEnd())
    // Canonical idempotence: a second Rich pass changes nothing.
    expect(richRoundTrip(once)).toBe(once)
  })

  it("keeps the rest of the document editable after an unclosed unknown tag", () => {
    const { bodyJson } = parseMarkdownToSnapshot("Type List<String> here **bold**.\n\nAfter.")
    const paragraph = bodyJson.content?.[0]
    const types = paragraph?.content?.map((node) => node.type)
    expect(types).toContain("opaqueSource")
    // Text after the token is ordinary Rich text with its marks, not source.
    expect(paragraph?.content?.some((node) => node.marks?.some((mark) => mark.type === "bold"))).toBe(true)
  })

  it("recovers only an unclosed unknown token before a same-line component without losing bytes", () => {
    const source = '<Future><Annotation id="a1" type="ai" comment="note">editable</Annotation>'
    const core = parseControlledMarkdown(source)
    const coreOpaque = core.document.children.find((node) => node.type === "opaque")
    const { bodyJson, bodyText } = parseMarkdownToSnapshot(source)
    const paragraphNodes = bodyJson.content?.[0]?.content ?? []
    const opaqueToken = paragraphNodes.find((node) => node.type === "opaqueSource")

    // The default core contract still leaves the complete unclosed suffix opaque.
    expect(coreOpaque?.type === "opaque" ? coreOpaque.raw : undefined).toBe(source)
    // The Rich adapter treats only the unknown opener as opaque; the registered
    // Annotation suffix is available to Rich and retains its visible text.
    expect(opaqueToken?.attrs?.raw).toBe("<Future>")
    expect(bodyText).toContain("editable")
    // Positive control for preservation: this real Rich round-trip restores all bytes.
    expect(richRoundTrip(source)).toBe(source)
  })

  it("projects visible text only: titles before bodies, no private attributes", () => {
    const protectedSnapshot = parseMarkdownToSnapshot(
      'Hi <ProtectedText id="lock-1" reason="SECRET_REASON">Keep lock</ProtectedText> there',
    )
    expect(protectedSnapshot.bodyText).toBe("Hi Keep lock there")

    const tabs = parseMarkdownToSnapshot(fixture("valid/nesting.md"))
    expect(tabs.bodyText).toContain("Overview\nOverview body.")
    expect(tabs.bodyText).toContain("Prepare\nPrepare the material.")
    expect(tabs.bodyText).toContain("Details\nAll disclosure content remains in source.")
    expect(tabs.bodyText).not.toContain("<Tab")
  })

  it("reading renders preserved spans richly without leaking raw private source", () => {
    const { bodyJson, bodyText } = parseMarkdownToSnapshot(
      'Hi <ProtectedText id="lock-1" reason="SECRET_REASON">Keep lock</ProtectedText> there\n\n' +
        '<Future kind="x">\nKeep exact\n</Future>',
    )
    const rendered = renderWritingBodyHtml(bodyJson, bodyText)
    // Positive control: the source really carries the private sentinel.
    expect(JSON.stringify(bodyJson)).toContain("SECRET_REASON")
    expect(rendered.mode).toBe("rich")
    expect(rendered.bodyHtml).toContain("Keep lock")
    expect(rendered.bodyHtml).toContain("Keep exact")
    expect(rendered.bodyHtml).not.toContain("SECRET_REASON")
    expect(rendered.bodyHtml).not.toContain("lock-1")
  })

  it("export keeps preserved spans as text instead of dropping them", () => {
    const { bodyJson } = parseMarkdownToSnapshot(
      'Hi <ProtectedText id="lock-1" reason="SECRET_REASON">Keep lock</ProtectedText> there\n\n' +
        '<Future kind="x">\nKeep exact\n</Future>',
    )
    const exported = JSON.stringify(buildWritingExportDocument(bodyJson))
    expect(exported).toContain("Keep lock")
    expect(exported).toContain("Keep exact")
    expect(exported).not.toContain("SECRET_REASON")
  })
})
