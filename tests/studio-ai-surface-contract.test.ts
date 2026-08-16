import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ODE-436 — the Studio AI surfaces, guarded at source level like the shell
 * contract of ODE-433. The authority is the render of
 * `docs/design/reference/Artifact Studio Studio.dc.html`: the AI composer is a
 * 322px popover anchored to the selection with a typing and a recording mode,
 * corrections are cards in the panel, and learned words are 26px chips.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("studio AI surface contract", () => {
  it("gives the AI composer the prototype's geometry without touching the other bubbles", () => {
    const bubble = read("components/reading/margins/annotation-bubble.tsx")

    expect(bubble).toContain("min(322px, calc(100vw - 16px))")
    // The personal and footnote bubbles keep the geometry they shipped with.
    expect(bubble).toContain("min(260px, calc(100vw - 16px))")
    expect(bubble).toContain("shadow-[var(--shadow-ai-composer)]")
    expect(bubble).toContain("min-h-[74px]")
    // Six instruction chips, 32px tall, in the prototype's order.
    expect(bubble).toContain(
      `["eliminar", "modificar", "expandir", "valida esto", "simplifica", "mantén tono"]`,
    )
    expect(bubble).toContain("h-8 rounded-lg border-[0.5px] border-border bg-transparent px-[13px]")
  })

  it("keeps the recording timer from changing the composer's width", () => {
    const controls = read("components/reading/margins/voice-recorder-controls.tsx")

    expect(controls).toContain("tabular-nums")
    expect(controls).toContain("text-[18px]")
    // The elapsed time must render alone: "Paused at …" would widen the row.
    expect(controls).not.toContain("Paused at")
    // Stop is a 13px white square on the destructive token, not a raw hex.
    expect(controls).toContain('className="block h-[13px] w-[13px] rounded-[2px] bg-white"')
    expect(controls).toContain("bg-destructive")
    expect(controls).not.toContain("#ef4444")
    expect(controls).toContain("WAVEFORM_BAR_COUNT = 22")
  })

  it("renders corrections as cards with a kind dot and three actions", () => {
    const panel = read("components/editor/panels/corrections-panel.tsx")

    expect(panel).toContain("SUGGESTION_KIND_PRESENTATION")
    // The three dot colours are the tokens that already existed; no new hex.
    expect(panel).toContain("var(--od-suggestion-spelling)")
    expect(panel).toContain("var(--od-annotation-highlight)")
    expect(panel).toContain("var(--od-annotation-ai)")
    expect(panel).not.toMatch(/#[0-9a-fA-F]{6}/)
    expect(panel).toContain("h-[7px] w-[7px] shrink-0 rounded-full")
    expect(panel).toContain("BookPlus")
  })

  it("renders learned words as 26px chips with a forget affordance", () => {
    const panel = read("components/editor/panels/corrections-panel.tsx")

    expect(panel).toContain("h-[26px]")
    expect(panel).toContain("rounded-[13px]")
    expect(panel).toContain("h-[18px] w-[18px]")
    expect(panel).toContain("Forget ${item.word}")
  })

  it("keeps the suggestion bubble inside the sheet on both axes", () => {
    const extension = read("lib/editor/publication-suggestion-extension.ts")
    const css = read("app/globals.css")

    expect(extension).toContain("resolveBubblePlacement")
    // A single live bubble means a single scroll listener; it must be released.
    expect(extension).toContain("destroy: destroySuggestionWidget")
    expect(extension).toContain("removeEventListener")
    expect(css).toContain(".pub-suggestion-bubble-below")
    expect(css).toContain("--pub-bubble-dx")
  })
})
