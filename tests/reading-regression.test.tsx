/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"
import { renderWritingBodyHtml as renderClientBodyHtml } from "@/lib/reading/render-body-html-client"
import { renderWritingBodyHtml as renderServerBodyHtml } from "@/lib/reading/render-body-html"
import { renderPreviewBodyHtml } from "@/lib/sharing/test-link-access"

const CROSS_SURFACE_MARKDOWN = `# Reading fixture

This paragraph contains a long URL that should survive every reading surface:
https://example.com/a/really/long/url/that/should/stay/visible/without/changing/the/document/contract?with=query&and=more

\`\`\`
const invariant = "code blocks stay readable"
console.log(invariant)
\`\`\`

| Surface | Status |
| --- | --- |
| preview | stable |
| public | stable |
`

describe("reading regression harness", () => {
  it("keeps write, preview, and public reading HTML aligned for supported markdown", () => {
    const snapshot = parseMarkdownToSnapshot(CROSS_SURFACE_MARKDOWN)

    const writeSurface = renderClientBodyHtml(snapshot.bodyJson, snapshot.bodyText)
    const publicSurface = renderServerBodyHtml(snapshot.bodyJson, snapshot.bodyText)
    const previewSurface = renderPreviewBodyHtml({
      body_json: snapshot.bodyJson,
      body_text: snapshot.bodyText,
    })

    expect(writeSurface.mode).toBe("rich")
    expect(publicSurface.mode).toBe("rich")
    expect(previewSurface.mode).toBe("rich")
    expect(publicSurface.bodyHtml).toBe(writeSurface.bodyHtml)
    expect(previewSurface.bodyHtml).toBe(writeSurface.bodyHtml)
    expect(writeSurface.bodyHtml).toContain("odessay-table-wrap")
    expect(writeSurface.bodyHtml).toContain("<pre")
    expect(writeSurface.bodyHtml).toContain("<code>")
    expect(writeSurface.bodyHtml).toContain("https://example.com/a/really/long/url")
  })

  it("keeps plain-text fallback rendering aligned when rich rendering is unavailable", () => {
    const bodyText = "First line\nSecond line\n\nThird paragraph"

    const writeSurface = renderClientBodyHtml(null, bodyText)
    const publicSurface = renderServerBodyHtml(null, bodyText)
    const previewSurface = renderPreviewBodyHtml({
      body_json: null as unknown as Record<string, unknown>,
      body_text: bodyText,
    })

    expect(writeSurface.mode).toBe("plain-text")
    expect(publicSurface.mode).toBe("plain-text")
    expect(previewSurface.mode).toBe("plain-text")
    expect(publicSurface.bodyHtml).toBe(writeSurface.bodyHtml)
    expect(previewSurface.bodyHtml).toBe(writeSurface.bodyHtml)
    expect(writeSurface.bodyHtml).toContain("<br />")
    expect(writeSurface.bodyHtml).toContain("<p>Third paragraph</p>")
  })
})
