/**
 * Keeps the inline suggestion bubble inside the sheet.
 *
 * `docs/design/views/studio.md` §Grammar asks for a bubble anchored to the span
 * that "repositions on scroll and never leaves the sheet". The bubble is
 * positioned by CSS relative to the span, so scrolling already carries it along;
 * what CSS cannot do on its own is notice that the sheet's edge would clip it.
 * This module answers that with pure geometry so it can be tested without a DOM.
 */

export type BubbleBox = {
  top: number
  bottom: number
  left: number
  right: number
}

export type BubblePlacement = {
  /** Render below the span instead of above it. */
  flip: boolean
  /** Horizontal correction, in px, applied on top of the -50% centring. */
  dx: number
}

/** Breathing room kept between the bubble and the sheet edge. */
export const BUBBLE_EDGE_PADDING = 8

export const resolveBubblePlacement = (
  bubble: BubbleBox,
  sheet: BubbleBox,
  padding: number = BUBBLE_EDGE_PADDING,
): BubblePlacement => {
  const flip = bubble.top < sheet.top + padding

  let dx = 0
  const overflowLeft = sheet.left + padding - bubble.left
  const overflowRight = bubble.right - (sheet.right - padding)

  if (overflowLeft > 0) {
    dx = overflowLeft
  } else if (overflowRight > 0) {
    dx = -overflowRight
  }

  // A bubble wider than the sheet cannot satisfy both edges; pin it to the left
  // one rather than letting the correction push it off the other side.
  if (bubble.right - bubble.left > sheet.right - sheet.left - padding * 2) {
    dx = sheet.left + padding - bubble.left
  }

  return { flip, dx }
}
