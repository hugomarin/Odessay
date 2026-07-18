import { describe, expect, it } from "vitest"
import { buildSelectionGeometry } from "@/lib/reading/selection-geometry"

describe("buildSelectionGeometry", () => {
  it("uses a single coordinate contract for preview + popup + bubble", () => {
    const geometry = buildSelectionGeometry({
      rects: [
        { top: 160, left: 100, width: 80, height: 20 },
        { top: 192, left: 102, width: 76, height: 20 },
      ],
      bodyRect: { top: 120, left: 60 },
      anchorStart: 15,
      anchorEnd: 40,
    })

    expect(geometry).not.toBeNull()
    expect(geometry?.previewRects).toEqual([
      { top: 40, left: 40, width: 80, height: 20, key: "15-40-0" },
      { top: 72, left: 42, width: 76, height: 20, key: "15-40-1" },
    ])
    expect(geometry?.popupPosition).toEqual({ x: 140, y: 152, top: 160, bottom: 212 })
    expect(geometry?.bubblePosition).toEqual({ x: 140, y: 220, top: 160, bottom: 212 })
  })

  it("ignores zero-area rects and returns null when selection has no visible boxes", () => {
    const geometry = buildSelectionGeometry({
      rects: [
        { top: 100, left: 80, width: 0, height: 12 },
        { top: 112, left: 80, width: 10, height: 0 },
      ],
      bodyRect: { top: 90, left: 60 },
      anchorStart: 1,
      anchorEnd: 2,
    })

    expect(geometry).toBeNull()
  })
})
