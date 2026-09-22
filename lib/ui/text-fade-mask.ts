/**
 * Single-sided fade for a line of text that may be clipped by its own
 * container's edge — used instead of a text-overflow ellipsis. Shared so a
 * future tweak to the cutoff doesn't have to be repeated at every call site.
 */
export const TEXT_FADE_MASK_STYLE = {
  WebkitMaskImage: "linear-gradient(90deg, #000 85%, transparent)",
  maskImage: "linear-gradient(90deg, #000 85%, transparent)",
} as const
