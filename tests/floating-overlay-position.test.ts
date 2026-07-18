import { describe, expect, it } from "vitest"
import { calculateFloatingOverlayPosition } from "@/lib/reading/floating-overlay-position"

const viewport = { width: 1000, height: 800 }
const bubble = { width: 260, height: 240 }

describe("calculateFloatingOverlayPosition", () => {
  it("flips an annotation bubble above a selection near the bottom", () => {
    const position = calculateFloatingOverlayPosition({
      anchor: { x: 500, top: 720, bottom: 742 },
      overlay: bubble,
      viewport,
      preferredPlacement: "below",
    })

    expect(position.placement).toBe("above")
    expect(position.top).toBe(472)
    expect(position.left).toBe(370)
  })

  it("flips a selection popup below the topbar when there is no room above", () => {
    const position = calculateFloatingOverlayPosition({
      anchor: { x: 500, top: 50, bottom: 72 },
      overlay: { width: 220, height: 34 },
      viewport,
      preferredPlacement: "above",
    })

    expect(position.placement).toBe("below")
    expect(position.top).toBe(80)
    expect(position.top).toBeGreaterThanOrEqual(54)
  })

  it("clamps overlays at the left and right viewport margins", () => {
    const left = calculateFloatingOverlayPosition({
      anchor: { x: 12, top: 300, bottom: 320 },
      overlay: bubble,
      viewport,
      preferredPlacement: "below",
    })
    const right = calculateFloatingOverlayPosition({
      anchor: { x: 992, top: 300, bottom: 320 },
      overlay: bubble,
      viewport,
      preferredPlacement: "below",
    })

    expect(left.left).toBe(8)
    expect(right.left).toBe(732)
  })

  it("repositions when a live bubble grows and keeps every control reachable", () => {
    const anchor = { x: 500, top: 560, bottom: 582 }
    const compact = calculateFloatingOverlayPosition({
      anchor,
      overlay: { width: 260, height: 120 },
      viewport,
      preferredPlacement: "below",
    })
    const grown = calculateFloatingOverlayPosition({
      anchor,
      overlay: { width: 260, height: 260 },
      viewport,
      preferredPlacement: "below",
    })

    expect(compact.placement).toBe("below")
    expect(grown.placement).toBe("above")
    expect(grown.top).toBe(292)
  })

  it("clamps an oversized bubble to the usable viewport with internal scroll", () => {
    const position = calculateFloatingOverlayPosition({
      anchor: { x: 180, top: 110, bottom: 132 },
      overlay: { width: 260, height: 600 },
      viewport: { width: 360, height: 320 },
      preferredPlacement: "below",
    })

    expect(position.top).toBe(54)
    expect(position.maxHeight).toBe(258)
    expect(position.left).toBe(50)
  })
})
