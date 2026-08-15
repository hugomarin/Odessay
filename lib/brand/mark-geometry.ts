/**
 * The Artifact Studio mark — single runtime source of truth.
 *
 * Authority: `docs/design/brand.md`. Three overlapping triangles fanning from a
 * single vertex at the bottom left: a sheet being turned, and three artifacts
 * stacked.
 *
 * The 0 / 0.4 / 0.8 offsets baked into the coordinates below look like noise and
 * are not — they keep a hairline of background between blades at small sizes.
 * `tests/brand-geometry.test.ts` fails if they are "cleaned up", and if the
 * generated files in `public/brand/` drift from these values.
 */

export const MARK_VIEWBOX = "0 0 64 64"

/** Round joins are what soften the corners, so fill = stroke on every path. */
export const MARK_STROKE_WIDTH = 3.5

export type BladeKey = "A" | "B" | "C"

export const MARK_PATHS: Record<BladeKey, string> = {
  A: "M10.86 49 L31.76 14.8 L38.72 26.2 Z",
  B: "M11.1 49.4 L38.97 26.6 L45.93 38 Z",
  C: "M11.34 49.8 L46.18 38.4 L53.14 49.8 Z"
}

export type MarkPalette = "app" | "landing" | "onDark"

/** Exactly three values per context. Never a gradient, never a fourth value. */
export const MARK_PALETTES: Record<MarkPalette, Record<BladeKey, string>> = {
  app: { A: "#B5ADA5", B: "#6B5F57", C: "#1E1915" },
  landing: { A: "#B5ADA5", B: "#A87531", C: "#1E1915" },
  onDark: { A: "#6B5F57", B: "#B5ADA5", C: "#F5F3EF" }
}

/**
 * Below this size path A is dropped: three blades stop reading and the mark
 * turns to mud. The three-blade version is never scaled under the threshold.
 */
export const TWO_BLADE_THRESHOLD_PX = 20

export function bladesForSize(size: number): BladeKey[] {
  return size < TWO_BLADE_THRESHOLD_PX ? ["B", "C"] : ["A", "B", "C"]
}

/**
 * Wordmark tracking tightens at display sizes — `docs/design/brand.md`.
 */
export function wordmarkTracking(fontSize: number): string {
  return fontSize >= 30 ? "-0.02em" : "-0.01em"
}
