# Design QA — ODE-382 Desk / Workspace responsive parity

- Source visual truth: `/Users/hugomarin/Desktop/Screenshot 2026-07-17 at 4.53.44 p.m..png`
- Packaged implementation: `dist/releases/ArtifactStudio-0.3.8-aarch64.dmg`
- Runtime: app copied directly from the generated DMG and launched from `/private/tmp/ode382-dmg-accepted.6HOCQo/Artifact Studio ODE-382 Accepted.app`
- State: authenticated local catalog, light theme, `Post costos GPT 5.6` visible in Desk and the `Writings` workspace

## Evidence

| Surface | Wide | Medium | Narrow |
| --- | --- | --- | --- |
| Desk | `01-desk-wide.png` (1228 × 768) | `02-desk-medium.png` (1001 × 768) | `03-desk-narrow.png` (803 × 768) |
| Workspace | `04-workspace-wide.png` (1235 × 768) | `05-workspace-medium.png` (1005 × 768) | `06-workspace-narrow.png` (803 × 768) |

- Same-writing side-by-side: `07-desk-workspace-same-writing.png`
- Source-to-DMG comparison: `08-reference-dmg-comparison.png`

## Full-view comparison evidence

The six packaged-app captures were opened and inspected at original resolution. Desk and Workspace preserve the same row hierarchy at all three widths: leading checkbox, adjacent title/state/actions, two-line description, date plus collection chip, and Status/Type/Workspace/actions columns. At medium and narrow widths the table keeps its 920 px internal width and clips through the table scroll region instead of hiding columns or switching to cards.

## Focused region comparison evidence

`08-reference-dmg-comparison.png` puts the approved source and the packaged Desk row in one comparison image. `07-desk-workspace-same-writing.png` puts Desk and Workspace together for `Post costos GPT 5.6`. The comparison confirms Geist UI typography, permanent checkbox placement, adjacent inline actions, description rhythm, the collection icon inside the chip, and aligned property controls.

The source mock uses illustrative Agent/Tutorial values while the local document is General and belongs to Writings. This is expected live metadata, not structural drift.

## Required fidelity surfaces

- Fonts and typography: passed. Both views use the shared Geist writing cell at 15/600 for the title and 13 px for the description.
- Spacing and layout rhythm: passed. Checkbox-to-title spacing, inline actions, 24 px row padding, and the 6 px date-to-collection stack are shared.
- Colors and tokens: passed. Ink, muted, border, status, and collection-chip tokens match across both views.
- Image and icon fidelity: passed. Controls use the existing Lucide and Odessay state icons; no placeholder asset substitutes are present.
- Copy and content: passed. Both views show the clean writing title without `.md` and load the authoritative `.md` body excerpt.

## Comparison history

1. Initial capture: blocked. Computer Use addressed the installed pre-change application instead of the branch build.
2. First DMG capture: blocked by two P2 findings — Desk hid unchecked selection controls until hover and desktop catalog rows had no body excerpt.
3. Fix: made the shared checkbox permanently visible and added intersection-observed description hydration through `DocumentService.openWriting`, so only near-viewport rows read the authoritative `.md`.
4. Second DMG capture: blocked by one P2 finding — Workspace displayed the filename extension while Desk and the source showed the clean title.
5. Fix: Workspace now passes the extension-free title through the same `ArtifactWritingCell`; the integration test asserts `.md` is absent.
6. Final DMG capture: no actionable P0/P1/P2 differences remain across wide, medium, narrow, source comparison, or same-writing comparison.

## Findings

No actionable P0, P1, or P2 visual findings remain.

## Evidence limits

- Screenshots confirm responsive reflow, visible labels, hierarchy, and control presence; they do not establish full WCAG compliance.
- Workspace rename, preview, collection assignment, and multi-select controls are intentionally visual-only and disabled, as requested for ODE-382.
- Performance TTI remains a separate delivery-contract item; these screenshots do not measure it.

## Follow-up polish

- P3: the live Desk filter result count pluralizes `2 writings` with separated accessibility text in the AX tree; visual copy is correct.

final result: passed
