/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"

const SOURCE_MARKDOWN = `# Title

Paragraph with **bold**, *italic*, ~~strike~~, ==highlight==, [link](https://example.com) and \`code\`.

> Quoted line

1. First
2. Second

- Uno
- Dos

| A | B |
| --- | --- |
| C | D |

![Alt text](https://example.com/image.png)

[^1: Footnote body]`

describe("markdown round-trip", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn(() => "22222222-2222-4222-8222-222222222222"),
    })
  })

  it("keeps the supported markdown profile stable across parse/serialize cycles", () => {
    const first = parseMarkdownToSnapshot(SOURCE_MARKDOWN)
    const second = parseMarkdownToSnapshot(first.markdown)

    expect(first.markdown).toContain("# Title")
    expect(first.markdown).toContain("==highlight==")
    expect(first.markdown).toContain("| A | B |")
    expect(first.markdown).toContain("![Alt text](https://example.com/image.png)")
    expect(first.markdown).toContain("[^1: Footnote body]")
    expect(second.markdown).toBe(first.markdown)
    expect(second.bodyText).toBe(first.bodyText)
  })
})
