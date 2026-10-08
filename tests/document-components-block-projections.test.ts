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

const MARKDOWN_LINK_DESTINATION_INJECTION_VECTORS = [
  "https://a.com) [x](javascript:alert(1))",
  "#frag) [x](javascript:alert(1))",
  "rel/path) [x](javascript:alert(1))",
] as const

const ENCODED_UNSAFE_LINKS = [
  { label: "HTML_COLON_LINK", href: "javascript&colon;alert(1)" },
  { label: "PERCENT_COLON_LINK", href: "javascript%3Aalert(1)" },
  { label: "ENTITY_TAB_LINK", href: "java&#x09;script:alert(1)" },
  { label: "NUMERIC_LETTER_LINK", href: "&#106;avascript:alert(1)" },
  { label: "FILE_PERCENT_LINK", href: "file%3A///etc/passwd" },
  { label: "DATA_HTML_COLON_LINK", href: "data&colon;text/html,x" },
  { label: "INVALID_UTF8_SCHEME_LINK", href: "javascript%3A%2F%2A%E0%2A%2Falert(1)" },
  { label: "INVALID_UTF8_SCHEME_SHORT_LINK", href: "javascript%3A%2F%2A%E0alert(1)" },
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
  it.each(MARKDOWN_LINK_DESTINATION_INJECTION_VECTORS)(
    "keeps accepted inline mark destinations as one Markdown link: %s",
    (href) => {
      const bodyJson: JSONContent = {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [{ type: "text", text: "SAFE_MARK", marks: [{ type: "link", attrs: { href } }] }],
          },
        ],
      }
      const markdown = buildWritingMarkdown(bodyJson)

      expect.soft(markdown).not.toContain("](javascript:")
      expect.soft(markdown.match(/\]\([^)]*\)/g) ?? []).toHaveLength(1)
    },
  )

  it.each(MARKDOWN_LINK_DESTINATION_INJECTION_VECTORS)(
    "keeps accepted Card destinations as one Markdown link: %s",
    (href) => {
      const bodyJson: JSONContent = {
        type: "doc",
        content: [
          {
            type: "card",
            attrs: { title: "SAFE_CARD", icon: "", href },
            content: [{ type: "paragraph", content: [{ type: "text", text: "Card body" }] }],
          },
        ],
      }
      const markdown = buildWritingMarkdown(bodyJson)

      expect.soft(markdown).not.toContain("](javascript:")
      expect.soft(markdown.match(/\]\([^)]*\)/g) ?? []).toHaveLength(1)
    },
  )

  it("keeps a percent-encoded relative destination byte-for-byte in Card Markdown", () => {
    const href = "notes%20v2.md"
    expect(validateComponentAttribute("Card", "href", href)).toBe(true)

    const markdown = buildWritingMarkdown({
      type: "doc",
      content: [{ type: "card", attrs: { title: "Relative", icon: "", href } }],
    })

    expect(markdown).toContain(`[Relative](${href})`)
  })

  it("percent-encodes Markdown destination delimiters for inline marks and Cards", () => {
    const href = "https://example.com/<chapter>(draft) copy"
    const bodyJson: JSONContent = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [{ type: "text", text: "MARK", marks: [{ type: "link", attrs: { href } }] }],
        },
        { type: "card", attrs: { title: "CARD", icon: "", href } },
      ],
    }

    const markdown = buildWritingMarkdown(bodyJson)
    const encodedHref = "https://example.com/%3Cchapter%3E%28draft%29%20copy"

    expect(markdown).toContain(`[MARK](${encodedHref})`)
    expect(markdown).toContain(`[CARD](${encodedHref})`)
    expect(markdown.match(/\]\([^)]*\)/g) ?? []).toHaveLength(2)
  })

  it("keeps unsafe Card hrefs inert in clean Markdown and a real DOCX artifact", async () => {
    const cardLinks = [
      { title: "Safe Card", href: "https://example.com/card-safe" },
      { title: "Unsafe Literal Card", href: "javascript:alert(1)" },
      { title: "Unsafe Encoded Card", href: "javascript&colon;alert(1)" },
    ]
    const bodyJson: JSONContent = {
      type: "doc",
      content: cardLinks.map(({ title, href }) => ({
        type: "card",
        attrs: { title, href },
        content: [{ type: "paragraph", content: [{ type: "text", text: `${title} body` }] }],
      })),
    }
    const markdown = buildWritingMarkdown(bodyJson)
    expect(markdown).toContain("[Safe Card](https://example.com/card-safe)")
    for (const card of cardLinks.slice(1)) {
      expect(markdown).toContain(card.title)
      expect(markdown).not.toContain(`](${card.href})`)
    }

    const document = buildWritingExportDocument(bodyJson)
    const docx = await JSZip.loadAsync(await renderWritingToDocxBuffer({ title: "Card links", document }))
    const xml = (await docx.file("word/document.xml")?.async("string")) ?? ""
    const rels = (await docx.file("word/_rels/document.xml.rels")?.async("string")) ?? ""
    const hyperlinks = xml.match(/<w:hyperlink\b/g) ?? []

    expect(xml).toContain("Safe Card")
    expect(xml).toContain("Unsafe Literal Card")
    expect(xml).toContain("Unsafe Encoded Card")
    expect(hyperlinks).toHaveLength(1)
    expect(rels).toContain("https://example.com/card-safe")
    for (const card of cardLinks.slice(1)) expect(rels).not.toContain(card.href)
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

describe("image source safety in clean Markdown", () => {
  const imageMarkdown = (src: string, alt = "IMAGEALT") =>
    buildWritingMarkdown({
      type: "doc",
      content: [{ type: "image", attrs: { src, alt } }],
    })

  it.each([
    ["web upload asset API path", "/api/writing-assets/123e4567-e89b-12d3-a456-426614174000"],
    ["desktop upload asset API URL", "https://app.odessay.test/api/writing-assets/123e4567-e89b-12d3-a456-426614174000"],
    ["relative desktop asset path", "images/photo.png"],
    ["case-sensitive relative desktop asset path", "images/Photo.PNG"],
    ["remote HTTPS image URL", "https://example.com/photo.png?size=original"],
  ])("preserves the %s source byte-for-byte", (_form, src) => {
    expect(imageMarkdown(src)).toBe(`![IMAGEALT](${src})`)
  })

  it.fails("keeps an image URL containing Markdown delimiters as one destination", () => {
    const markdown = imageMarkdown("https://a.com/x.png) [x](javascript:alert(1))")

    expect(markdown).not.toContain("[x](")
    expect(markdown).not.toContain("](javascript:")
    expect(markdown.match(/\]\([^)]*\)/g) ?? []).toHaveLength(1)
  })

  it.fails("rejects a literal javascript image source and keeps plain alt text", () => {
    const markdown = imageMarkdown("javascript:alert(1)")

    expect(markdown).toContain("IMAGEALT")
    expect(markdown).not.toContain("![IMAGEALT](")
    expect(markdown).not.toContain("](javascript:")
  })

  it.fails("rejects a non-image data URL and keeps plain alt text", () => {
    const markdown = imageMarkdown("data:text/html,<script>alert(1)</script>")

    expect(markdown).toContain("IMAGEALT")
    expect(markdown).not.toContain("![IMAGEALT](")
    expect(markdown).not.toContain("](data:text/html")
  })

  it.fails("rejects an entity-obfuscated javascript image source", () => {
    const markdown = imageMarkdown("java&#x09;script:alert(1)")

    expect(markdown).toContain("IMAGEALT")
    expect(markdown).not.toContain("![IMAGEALT](")
    expect(markdown).not.toContain("](javascript:")
  })

  it.fails("rejects a percent-encoded javascript image source", () => {
    const markdown = imageMarkdown("javascript%3Aalert(1)")

    expect(markdown).toContain("IMAGEALT")
    expect(markdown).not.toContain("![IMAGEALT](")
    expect(markdown).not.toContain("](javascript:")
  })

  it.fails("preserves the complete alt as plain text when an image source is rejected", () => {
    const markdown = imageMarkdown("file:///private/image.png", "Alt (safe) [label]")

    expect(markdown).toBe("Alt \\(safe\\) \\[label\\]")
    expect(markdown).not.toContain("![")
    expect(markdown).not.toContain("](file:")
  })

  it.fails("emits no active javascript or HTML-data image destination for the attack vectors", () => {
    const sources = [
      "https://a.com/x.png) [x](javascript:alert(1))",
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "java&#x09;script:alert(1)",
      "javascript%3Aalert(1)",
    ]
    const markdown = sources.map((src) => imageMarkdown(src)).join("\n\n")

    expect(markdown).not.toContain("](javascript:")
    expect(markdown).not.toContain("](data:text/html")
    expect(markdown).not.toContain("[x](")
  })
})
