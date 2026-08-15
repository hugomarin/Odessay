#!/usr/bin/env node
// Generates every brand asset from the single geometry in docs/design/brand.md.
//
// The geometry is the authority: three overlapping triangles fanning from one
// vertex at the bottom left. The 0 / 0.4 / 0.8 offsets baked into the path
// coordinates are what keep a hairline of background between blades at small
// sizes — they look like noise and are not. Never "clean" them.
//
// Usage: node scripts/generate-brand-assets.mjs
// Then:  npx tauri icon src-tauri/icons/icon-source-1024.png

import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import sharp from "sharp"

const root = join(dirname(fileURLToPath(import.meta.url)), "..")

// docs/design/brand.md — "The mark". Order matters: A is the top blade.
const PATHS = {
  A: "M10.86 49 L31.76 14.8 L38.72 26.2 Z",
  B: "M11.1 49.4 L38.97 26.6 L45.93 38 Z",
  C: "M11.34 49.8 L46.18 38.4 L53.14 49.8 Z"
}

const STROKE_WIDTH = 3.5

// docs/design/brand.md — "Fills". Exactly three values per context, no gradients.
const PALETTES = {
  app: { A: "#B5ADA5", B: "#6B5F57", C: "#1E1915" },
  landing: { A: "#B5ADA5", B: "#A87531", C: "#1E1915" },
  onDark: { A: "#6B5F57", B: "#B5ADA5", C: "#F5F3EF" }
}

const INK = "#1E1915"

/**
 * fill = stroke on every path: the round join is what softens the corners, so
 * the shape has to be painted twice rather than given a separate outline.
 */
function blade(key, palette) {
  const color = palette[key]
  return (
    `  <path d="${PATHS[key]}" fill="${color}" stroke="${color}" ` +
    `stroke-width="${STROKE_WIDTH}" stroke-linejoin="round" stroke-linecap="round"/>`
  )
}

/**
 * @param {object} palette
 * @param {boolean} twoBlade Below 20px path A is dropped — three blades turn to mud.
 */
function markSvg(palette, { twoBlade = false, title } = {}) {
  const keys = twoBlade ? ["B", "C"] : ["A", "B", "C"]
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="${title}">`,
    `  <title>${title}</title>`,
    ...keys.map((key) => blade(key, palette)),
    "</svg>",
    ""
  ].join("\n")
}

const marks = {
  "mark-app.svg": markSvg(PALETTES.app, { title: "Artifact Studio" }),
  "mark-landing.svg": markSvg(PALETTES.landing, { title: "Artifact Studio" }),
  "mark-on-dark.svg": markSvg(PALETTES.onDark, { title: "Artifact Studio" }),
  "mark-small-20.svg": markSvg(PALETTES.app, {
    twoBlade: true,
    title: "Artifact Studio"
  })
}

// The favicon renders at 16–32px, so it uses the two-blade variant on the ink
// tile that the browser chrome expects.
const faviconSvg = [
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="Artifact Studio">',
  "  <title>Artifact Studio</title>",
  `  <rect width="64" height="64" fill="${INK}"/>`,
  '  <g transform="translate(32 32) scale(0.62) translate(-32 -33)">',
  ...["B", "C"].map((key) => `  ${blade(key, PALETTES.onDark)}`),
  "  </g>",
  "</svg>",
  ""
].join("\n")

// Wordmark: Geist 500, -0.01em at 26px. Gap between mark and wordmark is 11px
// at a 26px mark, which is 11/26 of the mark box.
const MARK_BOX = 26
const GAP = 11
const WORDMARK_SIZE = 17
const lockupSvg = [
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${MARK_BOX + GAP + 118} ${MARK_BOX}" role="img" aria-label="Artifact Studio">`,
  "  <title>Artifact Studio</title>",
  `  <svg x="0" y="0" width="${MARK_BOX}" height="${MARK_BOX}" viewBox="0 0 64 64">`,
  ...["A", "B", "C"].map((key) => `  ${blade(key, PALETTES.app)}`),
  "  </svg>",
  `  <text x="${MARK_BOX + GAP}" y="${MARK_BOX / 2}" dominant-baseline="central"` +
    ` font-family="Geist, 'Geist Sans', system-ui, sans-serif" font-weight="500"` +
    ` font-size="${WORDMARK_SIZE}" letter-spacing="-0.01em" fill="${INK}">Artifact Studio</text>`,
  "</svg>",
  ""
].join("\n")

const brandDir = join(root, "public/brand")
mkdirSync(brandDir, { recursive: true })

for (const [name, contents] of Object.entries(marks)) {
  writeFileSync(join(brandDir, name), contents)
}
writeFileSync(join(brandDir, "favicon.svg"), faviconSvg)
writeFileSync(join(brandDir, "lockup-horizontal.svg"), lockupSvg)

// public/odessay-logo.svg is the legacy path. Keep it resolving so nothing
// 404s, but serve the new mark from it.
writeFileSync(join(root, "public/odessay-logo.svg"), marks["mark-app.svg"])

/**
 * App icon: square ink canvas, mark at 54 % of the canvas, no rounding baked in
 * (macOS applies its own squircle). The mark's mass sits low-left, so it is
 * nudged ~2 % up and ~1 % right of geometric center to sit optically centered.
 */
async function renderAppIcon(size) {
  const markSize = Math.round(size * 0.54)
  const mark = await sharp(Buffer.from(markSvg(PALETTES.onDark, { title: "Artifact Studio" })))
    .resize(markSize, markSize)
    .png()
    .toBuffer()

  const left = Math.round((size - markSize) / 2 + size * 0.01)
  const top = Math.round((size - markSize) / 2 - size * 0.02)

  return sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: INK
    }
  })
    .composite([{ input: mark, left, top }])
    .png({ compressionLevel: 9, palette: true })
    .toBuffer()
}

const iconSource = await renderAppIcon(1024)
writeFileSync(join(root, "src-tauri/icons/icon-source-1024.png"), iconSource)

// Next.js serves app/icon.png as the route icon; public/icon.png is the static
// copy. 512 is plenty for both and a fraction of the previous weight.
const icon512 = await renderAppIcon(512)
writeFileSync(join(root, "app/icon.png"), icon512)
writeFileSync(join(root, "public/icon.png"), icon512)

// PNG fallback for the favicon, for the browsers that ignore the SVG.
const favicon = await sharp(Buffer.from(faviconSvg))
  .resize(64, 64)
  .png({ compressionLevel: 9, palette: true })
  .toBuffer()
writeFileSync(join(root, "public/favicon.png"), favicon)

console.log("[brand] wrote public/brand/*.svg, public/odessay-logo.svg")
console.log("[brand] wrote app/icon.png, public/icon.png, public/favicon.png")
console.log("[brand] wrote src-tauri/icons/icon-source-1024.png")
console.log("[brand] next: npx tauri icon src-tauri/icons/icon-source-1024.png")
