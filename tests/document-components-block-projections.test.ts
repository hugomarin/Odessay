/**
 * @vitest-environment happy-dom
 */
import JSZip from "jszip"
import { extractText, getDocumentProxy } from "unpdf"
import { describe, expect, it } from "vitest"
import type { JSONContent } from "@tiptap/core"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"
import { validateComponentAttribute } from "@/lib/document-components/registry"
import { buildWritingExportDocument, buildWritingMarkdown } from "@/lib/export/writing-export"
import { renderWritingToDocxBuffer } from "@/lib/export/to-docx"
import { renderWritingToPdfBuffer } from "@/lib/export/to-pdf"
import { renderWritingBodyHtml as renderClient } from "@/lib/reading/render-body-html-client"
import { renderWritingBodyHtml as renderServer } from "@/lib/reading/render-body-html"

// Fase 12 — Tip/Info/Card projections (surface-projections.md, kind matrix):
// body_text = optional title then body; reading = shared accessible block with
// a safe link; clean export = titled structure with safe link, then body. The
// title and href live in node attributes, so any projection that only walks
// child text (editor.getText, collectBlocks) silently drops them.

const SOURCE = [
  "Intro with **bold** text.",
  '<Card title="ONLY_TITLE" icon="star" href="https://example.com/card">\nONLY_BODY paragraph.\n</Card>',
  '<Tip title="TIP_TITLE">\nTIP_BODY text.\n</Tip>',
  "<Info>\nINFO_BODY text.\n</Info>",
  "Outro.",
].join("\n\n")

const snapshot = () => parseMarkdownToSnapshot(SOURCE)

const INLINE_LINK_EXPORT_BODY: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "SAFE_LINK",
          marks: [{ type: "link", attrs: { href: "https://example.com/safe" } }],
        },
        {
          type: "text",
          text: " JAVASCRIPT_LINK",
          marks: [{ type: "link", attrs: { href: "javascript:alert(1)" } }],
        },
        {
          type: "text",
          text: " DATA_LINK",
          marks: [{ type: "link", attrs: { href: "data:text/html,unsafe" } }],
        },
        {
          type: "text",
          text: " FILE_LINK",
          marks: [{ type: "link", attrs: { href: "file:///private/unsafe" } }],
        },
      ],
    },
  ],
}

const UNSAFE_LINKS = [
  { label: "JAVASCRIPT_LINK", scheme: "javascript:" },
  { label: "DATA_LINK", scheme: "data:" },
  { label: "FILE_LINK", scheme: "file:" },
]

const ENCODED_UNSAFE_LINKS = [
  { label: "HTML_COLON_LINK", href: "javascript&colon;alert(1)" },
  { label: "PERCENT_COLON_LINK", href: "javascript%3Aalert(1)" },
  { label: "ENTITY_TAB_LINK", href: "java&#x09;script:alert(1)" },
  { label: "NUMERIC_LETTER_LINK", href: "&#106;avascript:alert(1)" },
  { label: "FILE_PERCENT_LINK", href: "file%3A///etc/passwd" },
  { label: "DATA_HTML_COLON_LINK", href: "data&colon;text/html,x" },
] as const

const ENCODED_LINK_EXPORT_BODY: JSONContent = {
  type: "doc",
  content: [
    {
      type: "paragraph",
      content: [
        {
          type: "text",
          text: "SAFE_ENCODED_CONTROL",
          marks: [{ type: "link", attrs: { href: "https://example.com/safe-encoded" } }],
        },
        ...ENCODED_UNSAFE_LINKS.map(({ label, href }) => ({
          type: "text" as const,
          text: ` ${label}`,
          marks: [{ type: "link", attrs: { href } }],
        })),
      ],
    },
  ],
}

describe("Tip/Info/Card projections", () => {
  it("body_text carries each title before its body, in reading order", () => {
    const { bodyText } = snapshot()
    expect(bodyText).toContain("ONLY_TITLE\nONLY_BODY paragraph.")
    expect(bodyText).toContain("TIP_TITLE\nTIP_BODY text.")
    expect(bodyText).toContain("INFO_BODY text.")
    expect(bodyText.indexOf("Intro")).toBeLessThan(bodyText.indexOf("ONLY_TITLE"))
    expect(bodyText.indexOf("ONLY_BODY")).toBeLessThan(bodyText.indexOf("TIP_TITLE"))
    expect(bodyText, "the href is an attribute, not visible text").not.toContain("example.com")
  })

  it.each([
    ["client", renderClient],
    ["server", renderServer],
  ])("%s reader renders components richly instead of falling back for the whole document", (_label, render) => {
    const { bodyJson, bodyText } = snapshot()
    const rendered = render(bodyJson, bodyText)
    expect(rendered.mode).toBe("rich")
    // The rest of the document keeps its rich rendering.
    expect(rendered.bodyHtml).toContain("<strong>bold</strong>")
    expect(rendered.bodyHtml).toContain("ONLY_TITLE")
    expect(rendered.bodyHtml).toContain("ONLY_BODY paragraph.")
    expect(rendered.bodyHtml).toContain('href="https://example.com/card"')
    expect(rendered.bodyHtml).toContain("TIP_TITLE")
    expect(rendered.bodyHtml).toContain("INFO_BODY text.")
    expect(rendered.bodyHtml.indexOf("ONLY_TITLE")).toBeLessThan(rendered.bodyHtml.indexOf("ONLY_BODY"))
    // No authoring chrome reaches readers.
    expect(rendered.bodyHtml).not.toContain("<input")
    expect(rendered.bodyHtml).not.toContain("<button")
  })

  it("never activates an unsafe href that reached body_json", () => {
    const bodyJson = {
      type: "doc",
      content: [
        {
          type: "card",
          attrs: { title: "Unsafe", icon: "", href: "javascript:alert(1)" },
          content: [{ type: "paragraph", content: [{ type: "text", text: "Body" }] }],
        },
      ],
    }
    const rendered = renderClient(bodyJson, "Unsafe\nBody")
    expect(rendered.mode).toBe("rich")
    expect(rendered.bodyHtml).toContain("Unsafe")
    expect(rendered.bodyHtml).not.toContain("javascript:")
  })

  it("export document keeps titles and the safe link ahead of each body", () => {
    const exported = buildWritingExportDocument(snapshot().bodyJson)
    const texts = exported.blocks.map((block) =>
      "inlines" in block ? block.inlines.map((run) => run.text).join("") : block.type,
    )
    const cardTitle = exported.blocks.find(
      (block) => "inlines" in block && block.inlines.some((run) => run.text === "ONLY_TITLE"),
    )
    expect(cardTitle).toMatchObject({ type: "heading" })
    expect(cardTitle && "inlines" in cardTitle ? cardTitle.inlines[0].linkHref : null).toBe(
      "https://example.com/card",
    )
    expect(texts.indexOf("ONLY_TITLE")).toBeLessThan(texts.indexOf("ONLY_BODY paragraph."))
    expect(texts.indexOf("TIP_TITLE")).toBeLessThan(texts.indexOf("TIP_BODY text."))
    expect(texts).toContain("INFO_BODY text.")
  })

  it("real DOCX and PDF artifacts contain titles, bodies and the card link", async () => {
    const { bodyJson, bodyText } = snapshot()
    const document = buildWritingExportDocument(bodyJson)

    const docx = await JSZip.loadAsync(await renderWritingToDocxBuffer({ title: "Components", bodyText, document }))
    const xml = (await docx.file("word/document.xml")?.async("string")) ?? ""
    const rels = (await docx.file("word/_rels/document.xml.rels")?.async("string")) ?? ""
    for (const sentinel of ["ONLY_TITLE", "ONLY_BODY paragraph.", "TIP_TITLE", "TIP_BODY text.", "INFO_BODY text."]) {
      expect(xml, `DOCX: ${sentinel}`).toContain(sentinel)
    }
    expect(rels).toContain("https://example.com/card")

    const pdf = await renderWritingToPdfBuffer({ title: "Components", bodyText, document })
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(pdf)), { mergePages: true })
    for (const sentinel of ["ONLY_TITLE", "ONLY_BODY", "TIP_TITLE", "TIP_BODY", "INFO_BODY"]) {
      expect(text, `PDF: ${sentinel}`).toContain(sentinel)
    }
    expect(text.indexOf("ONLY_TITLE")).toBeLessThan(text.indexOf("ONLY_BODY"))
  }, 30_000)
})

describe("inline link export safety", () => {
  it("keeps a percent-encoded relative destination valid for Card", () => {
    expect(validateComponentAttribute("Card", "href", "notes%20v2.md")).toBe(true)
  })

  it("normalizes encoded schemes before projecting clean Markdown and real DOCX links", async () => {
    const markdown = buildWritingMarkdown(ENCODED_LINK_EXPORT_BODY)

    expect(markdown).toContain("[SAFE\\_ENCODED\\_CONTROL](https://example.com/safe-encoded)")
    for (const link of ENCODED_UNSAFE_LINKS) {
      expect(markdown).toContain(link.label.replaceAll("_", "\\_"))
      expect(markdown).not.toContain(link.href)
    }

    const document = buildWritingExportDocument(ENCODED_LINK_EXPORT_BODY)
    const docx = await JSZip.loadAsync(await renderWritingToDocxBuffer({ title: "Encoded links", document }))
    const xml = (await docx.file("word/document.xml")?.async("string")) ?? ""
    const rels = (await docx.file("word/_rels/document.xml.rels")?.async("string")) ?? ""
    const hyperlinks = xml.match(/<w:hyperlink\b/g) ?? []

    expect(xml).toContain("SAFE_ENCODED_CONTROL")
    for (const link of ENCODED_UNSAFE_LINKS) expect(xml).toContain(link.label)
    expect(hyperlinks).toHaveLength(1)
    expect(rels).toContain("https://example.com/safe-encoded")
    for (const link of ENCODED_UNSAFE_LINKS) expect(rels).not.toContain(link.href)
  })

  it("keeps unsafe links inert in clean Markdown while preserving their labels", () => {
    const markdown = buildWritingMarkdown(INLINE_LINK_EXPORT_BODY)

    expect(markdown).toContain("[SAFE\\_LINK](https://example.com/safe)")
    for (const link of UNSAFE_LINKS) {
      expect(markdown).toContain(link.label.replaceAll("_", "\\_"))
      expect(markdown).not.toContain(`](${link.scheme}`)
    }
  })

  it("keeps unsafe links inert in the real DOCX artifact while preserving their labels", async () => {
    const document = buildWritingExportDocument(INLINE_LINK_EXPORT_BODY)
    const docx = await JSZip.loadAsync(await renderWritingToDocxBuffer({ title: "Links", document }))
    const xml = (await docx.file("word/document.xml")?.async("string")) ?? ""
    const rels = (await docx.file("word/_rels/document.xml.rels")?.async("string")) ?? ""
    const hyperlinks = xml.match(/<w:hyperlink\b/g) ?? []

    expect(xml).toContain("SAFE_LINK")
    expect(xml).toContain("JAVASCRIPT_LINK")
    expect(xml).toContain("DATA_LINK")
    expect(xml).toContain("FILE_LINK")
    expect(hyperlinks).toHaveLength(1)
    expect(rels).toContain("https://example.com/safe")
    for (const link of UNSAFE_LINKS) {
      expect(rels).not.toContain(link.scheme)
    }
  })
})
