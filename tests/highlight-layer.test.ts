/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html"
import { applyHighlight, type MarginHighlight } from "@/components/reading/margins/highlight-layer"

const createMargin = (overrides: Partial<MarginHighlight> = {}): MarginHighlight => ({
  id: "margin-1",
  anchor_start: 0,
  anchor_end: 4,
  note: "note",
  type: "ai",
  ...overrides,
})

describe("applyHighlight", () => {
  it("decorates existing mark elements instead of nesting a second highlight wrapper", () => {
    const { bodyHtml } = renderWritingBodyHtml(
      {
        type: "doc",
        content: [
          {
            type: "paragraph",
            content: [
              { type: "text", text: "Intro " },
              { type: "text", text: "Bold", marks: [{ type: "highlight" }, { type: "bold" }] },
              { type: "text", text: " tail", marks: [{ type: "highlight" }] },
            ],
          },
        ],
      },
      "Intro Bold tail",
    )

    const root = document.createElement("div")
    root.innerHTML = bodyHtml

    const applied = applyHighlight(
      root,
      createMargin({
        anchor_start: 6,
        anchor_end: 15,
      }),
    )

    expect(applied).toBe(true)
    expect(root.querySelectorAll("mark.hl[data-id='margin-1']").length).toBeGreaterThan(0)
    expect(root.querySelectorAll("mark .hl").length).toBe(0)
  })

  it("falls back to wrapping plain text when no mark exists in the rendered body", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Plain text only</p>"

    const applied = applyHighlight(
      root,
      createMargin({
        anchor_start: 0,
        anchor_end: 5,
      }),
    )

    expect(applied).toBe(true)
    expect(root.querySelector("span.hl[data-id='margin-1']")?.textContent).toBe("Plain")
  })

  it("applies hl-ai class for AI margins", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Plain text only</p>"

    applyHighlight(root, createMargin({ type: "ai", anchor_start: 0, anchor_end: 5 }))

    const wrapper = root.querySelector("span.hl-ai")
    expect(wrapper).not.toBeNull()
  })

  it("applies hl-personal class for personal margins", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Plain text only</p>"

    applyHighlight(root, createMargin({ type: "personal", anchor_start: 0, anchor_end: 5 }))

    const wrapper = root.querySelector("span.hl-personal")
    expect(wrapper).not.toBeNull()
  })

  it("adds annotated class when note is present", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Plain text only</p>"

    applyHighlight(root, createMargin({ type: "ai", note: "A note", anchor_start: 0, anchor_end: 5 }))

    const wrapper = root.querySelector("span.hl-ai.annotated")
    expect(wrapper).not.toBeNull()
  })

  it("omits annotated class when note is absent", () => {
    const root = document.createElement("div")
    root.innerHTML = "<p>Plain text only</p>"

    applyHighlight(root, createMargin({ type: "ai", note: null, anchor_start: 0, anchor_end: 5 }))

    const wrapper = root.querySelector("span.hl-ai")
    expect(wrapper?.classList.contains("annotated")).toBe(false)
  })
})
