/**
 * @vitest-environment node
 *
 * Node, not happy-dom: isomorphic-dompurify picks its sanitization backend by
 * detecting a global `window` — happy-dom provides one that isn't fully
 * DOMPurify-compatible and silently no-ops instead of sanitizing (verified
 * directly against plain Node, which matches the real API route runtime).
 * The browser-side call in insert-image-modal.tsx runs against a real
 * window (actual Chromium/WebKit, not a DOM shim), so it isn't affected.
 */
import { describe, expect, it } from "vitest"
import { sanitizeSvgMarkup } from "@/lib/security/sanitize-svg"

describe("sanitizeSvgMarkup", () => {
  it("strips <script> tags", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="5"/></svg>`
    const clean = sanitizeSvgMarkup(dirty)
    expect(clean).not.toContain("<script")
    expect(clean).not.toContain("alert(1)")
    expect(clean).toContain("<circle")
  })

  it("strips on* event handler attributes", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onload="alert(1)" onclick="alert(2)" width="10" height="10"/></svg>`
    const clean = sanitizeSvgMarkup(dirty)
    expect(clean).not.toMatch(/on\w+\s*=/i)
  })

  it("strips javascript: hrefs", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert(1)"><circle r="5"/></a></svg>`
    const clean = sanitizeSvgMarkup(dirty)
    expect(clean).not.toContain("javascript:")
  })

  it("strips foreignObject content", () => {
    const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>`
    const clean = sanitizeSvgMarkup(dirty)
    expect(clean).not.toContain("<script")
    expect(clean).not.toContain("alert(1)")
  })

  it("keeps ordinary SVG markup intact", () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><circle cx="5" cy="5" r="4" fill="red"/></svg>`
    const clean = sanitizeSvgMarkup(svg)
    expect(clean).toContain("<circle")
    expect(clean).toContain('fill="red"')
  })
})
