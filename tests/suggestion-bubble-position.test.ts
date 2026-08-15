import { describe, expect, it } from "vitest"
import {
  BUBBLE_EDGE_PADDING,
  resolveBubblePlacement,
  type BubbleBox,
} from "@/lib/editor/suggestion-bubble-position"

/**
 * @contract ODE-436 — the suggestion bubble never leaves the sheet
 * docs/design/views/studio.md §Grammar and its checklist line
 * "Suggestion bubbles reposition on scroll and never leave the sheet."
 */

const sheet: BubbleBox = { top: 100, bottom: 700, left: 200, right: 920 }

const bubbleAt = (top: number, left: number, width = 240, height = 30): BubbleBox => ({
  top,
  bottom: top + height,
  left,
  right: left + width,
})

describe("resolveBubblePlacement", () => {
  it("leaves a comfortably placed bubble untouched", () => {
    expect(resolveBubblePlacement(bubbleAt(300, 400), sheet)).toEqual({ flip: false, dx: 0 })
  })

  it("flips below when the sheet's top edge would clip the bubble", () => {
    expect(resolveBubblePlacement(bubbleAt(102, 400), sheet).flip).toBe(true)
  })

  it("does not flip when the bubble clears the top edge by the padding", () => {
    expect(resolveBubblePlacement(bubbleAt(100 + BUBBLE_EDGE_PADDING, 400), sheet).flip).toBe(false)
  })

  it("nudges right when the bubble overflows the left edge", () => {
    const placement = resolveBubblePlacement(bubbleAt(300, 150), sheet)
    expect(placement.dx).toBe(58) // 200 + 8 - 150
  })

  it("nudges left when the bubble overflows the right edge", () => {
    // left 750 + width 240 = 990, which is 78px past the 912 usable right edge.
    const placement = resolveBubblePlacement(bubbleAt(300, 750), sheet)
    expect(placement.dx).toBe(-78)
  })

  it("pins a bubble wider than the sheet to the left edge instead of oscillating", () => {
    const placement = resolveBubblePlacement(bubbleAt(300, 150, 900), sheet)
    expect(placement.dx).toBe(58)
  })

  it("corrects both axes at once", () => {
    const placement = resolveBubblePlacement(bubbleAt(101, 150), sheet)
    expect(placement).toEqual({ flip: true, dx: 58 })
  })
})
