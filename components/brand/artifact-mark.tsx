import { cn } from "@/lib/utils"
import {
  MARK_PALETTES,
  MARK_PATHS,
  MARK_STROKE_WIDTH,
  MARK_VIEWBOX,
  bladesForSize,
  wordmarkTracking,
  type MarkPalette
} from "@/lib/brand/mark-geometry"

type ArtifactMarkProps = {
  /** Rendered box in px. Under 20 the mark drops to two blades on its own. */
  size?: number
  palette?: MarkPalette
  className?: string
  /** Set when the mark sits next to the wordmark, which carries the name. */
  decorative?: boolean
}

/**
 * The mark. Inline rather than an `<img>` so it costs no request and stays
 * crisp at the small sizes the brand actually uses.
 */
export function ArtifactMark({
  size = 26,
  palette = "app",
  className,
  decorative = false
}: ArtifactMarkProps) {
  const fills = MARK_PALETTES[palette]

  return (
    <svg
      width={size}
      height={size}
      viewBox={MARK_VIEWBOX}
      className={className}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Artifact Studio"}
      aria-hidden={decorative || undefined}
    >
      {bladesForSize(size).map((blade) => (
        <path
          key={blade}
          d={MARK_PATHS[blade]}
          fill={fills[blade]}
          stroke={fills[blade]}
          strokeWidth={MARK_STROKE_WIDTH}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      ))}
    </svg>
  )
}

type MarkTileProps = ArtifactMarkProps & {
  /** Tile edge in px. The mark sits at 54 % of it — 34 in 64, 24 in 44. */
  tile: number
  radius: number
  shadow?: string
}

/**
 * The mark on an ink tile, the form the splash and auth cards use.
 */
export function ArtifactMarkTile({
  tile,
  radius,
  shadow,
  className,
  ...markProps
}: MarkTileProps) {
  return (
    <span
      className={cn("inline-flex shrink-0 items-center justify-center bg-ink", className)}
      style={{
        width: tile,
        height: tile,
        borderRadius: radius,
        boxShadow: shadow
      }}
    >
      <ArtifactMark palette="onDark" size={Math.round(tile * 0.54)} {...markProps} />
    </span>
  )
}

type WordmarkProps = {
  fontSize?: number
  className?: string
}

/**
 * "Artifact Studio" in Geist 500 — the only place Geist is used in the product.
 */
export function ArtifactWordmark({ fontSize = 17, className }: WordmarkProps) {
  return (
    <span
      className={cn("whitespace-nowrap text-ink", className)}
      style={{
        fontFamily: "var(--font-geist-sans), system-ui, sans-serif",
        fontWeight: 500,
        fontSize,
        letterSpacing: wordmarkTracking(fontSize)
      }}
    >
      Artifact Studio
    </span>
  )
}

type LockupProps = {
  markSize?: number
  fontSize?: number
  palette?: MarkPalette
  className?: string
}

/**
 * Mark + wordmark. The gap is 11px at a 26px mark and scales with it.
 */
export function ArtifactLockup({
  markSize = 26,
  fontSize = 17,
  palette = "app",
  className
}: LockupProps) {
  return (
    <span className={cn("inline-flex items-center", className)} style={{ gap: (markSize * 11) / 26 }}>
      <ArtifactMark size={markSize} palette={palette} decorative />
      <ArtifactWordmark fontSize={fontSize} />
    </span>
  )
}
