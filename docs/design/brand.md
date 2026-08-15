# Brand — mark, wordmark, app icon

## The mark

Three overlapping triangles fanning from a single vertex at the bottom left — a sheet being turned, and three artifacts stacked.

```
viewBox="0 0 64 64"   stroke-width 3.5   stroke-linejoin/linecap round
fill = stroke on every path (the round join is what softens the corners)

path A  M10.86 49  L31.76 14.8 L38.72 26.2 Z
path B  M11.1  49.4 L38.97 26.6 L45.93 38   Z
path C  M11.34 49.8 L46.18 38.4 L53.14 49.8 Z
```

The three offsets (0, 0.4, 0.8) are deliberate: they keep a hairline of background between blades at small sizes.

### Fills

| Context | A | B | C |
| --- | --- | --- | --- |
| App (light) | `#B5ADA5` | `#6B5F57` | `#1E1915` |
| Landing / accent | `#B5ADA5` | `#A87531` | `#1E1915` |
| On dark | `#6B5F57` | `#B5ADA5` | `#F5F3EF` |

Never a gradient, never more than three values, never an outline-only version.

### Sizes

| Use | Size |
| --- | --- |
| Landing nav | 26px |
| Auth card | 24px in a 44px ink tile, radius 13 |
| Splash | 34px in a 64px ink tile, radius 18, shadow `0 12px 34px rgba(35,24,15,.22)` |
| Footer | 22px |
| Favicon | 16–32px, inline SVG data URI |

Below 20px, drop path A: three blades stop reading and the mark turns to mud.

## Wordmark

"Artifact Studio" in **Geist 500**, `-0.01em` (`-0.02em` at 30px+). Geist is used for nothing else in the product. Gap between mark and wordmark: 11px at 26px mark.

Never Lora for the wordmark. Never all-caps. Never a tagline locked to the mark.

## App icon (Tauri / macOS)

Ink tile `#1E1915`, mark at 54 % of the canvas, optically centered (the mark's mass sits low-left, so it needs ~2 % up and ~1 % right of geometric center). macOS applies its own squircle: ship a square canvas with no rounding baked in. Existing files: `app/icon.png`, `public/icon.png`, `public/favicon.png`, `src-tauri/icons/*` — all need regeneration from the SVG above.

## Implementation (ODE-424)

The geometry above is mirrored once in `lib/brand/mark-geometry.ts`, which is the runtime source of truth: paths, stroke width, the three palettes, and the sub-20px rule. `components/brand/artifact-mark.tsx` renders it inline — `ArtifactMark`, `ArtifactMarkTile`, `ArtifactWordmark`, `ArtifactLockup` — and drops path A below 20px itself, so no caller can scale three blades past the threshold.

Static assets are generated, never hand-edited:

```bash
node scripts/generate-brand-assets.mjs                       # public/brand/*.svg, icons, favicon
npx tauri icon src-tauri/icons/icon-source-1024.png          # src-tauri/icons/*
```

`tests/brand-geometry.test.ts` pins the offsets, the three-value palettes and the threshold, and fails if the generated files drift from the runtime geometry.

`public/brand/mark-app.svg` is also served from the legacy `public/odessay-logo.svg` path. The favicon is inlined as a data URI in `app/layout.tsx`; `public/favicon.png` is the raster fallback.

## Explorations kept for reference

`docs/design/reference/Artifact Studio Logo Fan.dc.html` and `docs/design/reference/Artifact Studio Logo Lateral.dc.html` hold the variants that were considered (tighter fan, lateral stack). They are not approved marks; the geometry above is.
