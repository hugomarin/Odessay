# ODE-447 — the app rail

Evidence for `Redesign the app rail: inventory, order, widths and recents`.

Captured with `node scripts/capture-rail-evidence.mjs --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321`, driving the real `components/navigation/sidebar.tsx` through `app/perf/rail-harness`.

## The divergence that decided the width

`docs/design/layout.md` and `docs/design/system-app.md` both said the expanded rail is **232px**, and explained a 244 seen elsewhere as "the Settings section nav". Measured against the prototypes, that reading does not hold: 244 **is** the rail.

| Prototype | Rail expanded | How it is written |
| --- | --- | --- |
| `Artifact Studio Desk.dc.html` | 244 | `const RAIL_MINI = 52, RAIL_FULL = 244` |
| `Artifact Studio Workspace.dc.html` | 244 | `const RAIL_MINI = 52, RAIL_FULL = 244` |
| `Artifact Studio Workspace Folder B.dc.html` | 244 | `const RAIL_MINI = 52, RAIL_FULL = 244` |
| `Artifact Studio Studio.dc.html` | 232 | inline `mini ? 52 : 232` |

Three named constants against one inline value, in the view where the rail starts collapsed and is therefore least exercised. The fidelity gate escalates a disagreement **between** prototypes to the design owner rather than letting the implementer pick; the owner chose **244**.

Corrected in the same change: `--size-rail-expanded` in `app/globals.css` and `docs/design/globals-additions.css`, the geometry tables in `docs/design/layout.md` §2 and `docs/design/system-app.md` §3, the five places `skill-design` still said 292, and `tests/design-tokens-contract.test.ts`.

Rendered widths of the prototypes' own rails, read from the running documents (`measurements.json → prototypeWidths`): desk 244, workspace 244, settings 244, studio 52 — Studio opens collapsed, which is what the spec says it should do.

## Measured

| Claim | Measured |
| --- | --- |
| Rail expanded | **244px** |
| Rail collapsed | **52px** |
| Layer 0 — no fill of its own | `background: rgba(0, 0, 0, 0)` |
| Layer 0 — no border of its own | `border-right-width: 0px` |
| Item box | **40px**, radius **9px** |
| Rail icons | **19px** |
| **Icon X travel across the expansion** | **0px** — 16.5px in both states |
| Workspace folder block | `overflow-y: auto`, hanging off the Workspace row at `padding-left: 50px` |
| Avatar | **36px** (the repo drew 28) |
| Wordmark in the title bar row | **absent** |
| **Labels clipped vertically** | **none** (`clippedLabels: []`) |
| Forced collapse below 900 | 244 → **52**, and back to **244** when the window widens |
| Toggle while width-forced | absent (`toggleHiddenWhileForced: true`) |
| Time to interactive | **74ms** to a usable rail (`domInteractive` 79ms), budget 1000ms |

The icon travel is the headline: the spec words it as "the icon never changes X position when collapsing", and it is measured from the rendered box, not asserted from a class list.

## Second pass — what the first delivery got wrong

The first version of this change moved the geometry and left the rail's *contents* as they were. The owner caught it against the prototype. Corrected here:

| | First pass | Prototype | Now |
| --- | --- | --- | --- |
| Studio icon | `PenLine` | `lamp-desk` | `lamp-desk` |
| Workspace icon | `Layers3` | `folder-tree` | `folder-tree` |
| Title bar | `ArtifactLockup` + "Artifact Studio" | toggle and empty space, nothing else | no wordmark |
| Under Workspace | a "RECENT" list of writings | the workspace folders | the workspace folders |
| Avatar | 28px | 36px | 36px |
| Item padding | `px-[10px]` on the row | `padding: 0` with a fixed 40px icon column | fixed 40px column |
| Item type | 15px | `400 14px/1`, active `500` | 14px, active 500 |
| Toggle glyph | `PanelLeftDashed` 17px | `panel-left` 18px | `panel-left` 18px |

`system-app.md` §5 names the icons in the same sentence that fixes the order — the first pass read that line as being about order alone. The folder block is `WS` in the prototypes' logic (`workspaceListStyle`, `folder` at 15px, rows of 32px at radius 8, indented 50px): **the rail is an inventory of places, not of history**, which is why Recent had no seat in it. `components/navigation/sidebar-recent-writings.tsx` is deleted rather than left orphaned; `useRecentWritings` survives because Search still uses it.

The folders come from `getWorkspaceAssignmentService().listWorkspaces()` — the same service the Desk and the Workspace view already read, not a second source. On web that service reports `isAvailable: false`, so **the block is empty in these captures**: the folder list is a desktop surface, and the DMG is where it renders with real folders.

## The descender the prototype's own value would have cut

`railRow` writes `font: 400 14px/1`, and the label clips horizontally to stay on one line. Copied literally, that makes a 14px line box over 14px text with `overflow: hidden` — and the tail of the "g" in "New writing" disappears. The owner caught it on screen.

The line box is now `1.45`. The row is 40px and centres its content, so nothing is gained by squeezing it. This is a case where rule 3 of the translation protocol applies over rule 1: the tokens and `skill-design` govern *how* a value is expressed, and a line-height that eats descenders is a rendering artefact of the prototyping environment, not a design decision — the same reasoning that turns the prototype's 1px borders into 0.5px.

`measurements.json → geometry.*.clippedLabels` now records every rail label whose glyphs overflow its line box. **The detector was verified against the defect before being trusted:** with `leading-none` restored it reports `["Studio","Desk","Workspace","Collections"]`, and with the fix it reports `[]`. A check that cannot fail is not evidence.

## Divergences from the spec, recorded

1. **Collections stays in the rail.** `system-app.md` §5 lists New Artifact, Search · separator · Studio, Desk, Workspace · recents · user bar — no Collections. `/collections` has no other entry point, so removing it would delete a capability rather than reorder one. Decision by the design owner; same treatment ODE-430 gave Import in the Desk header.
2. **Shortcuts stay on their destinations.** The visual order becomes the spec's (Studio · Desk · Workspace) but `⌘⌥1/2/3` still open Desk / Workspace / Studio. Renumbering would have repointed three existing bindings.
3. **Active and hover were inverted.** The spec makes the active state the darker of the two (`#E4E1DC` active over `#E9E7E3` hover); the repo had active on the lighter token. Corrected to `bg-muted-hover` active over `bg-muted` hover.
4. **Layer 0's exact hex is not this issue's to change.** The spec paints layer 0 `#F3F2F0`; the repo's `--bg` resolves lighter. The rail now correctly has *no fill of its own*, which is the requirement — but the shell colour it sits on is a palette question ODE-425 closed, and repainting it would change every view. Raised, not touched.

## Ordering note for the reviewer

The rail is now transparent with no right-hand border, which is correct against layer 0 — but the separation from the content is meant to come from each view's own **sheet** (layer 1). Desk gets its sheet in PR #390, Workspace in ODE-431, Studio already has one from ODE-433. Until those land, the un-redesigned views sit flat against the rail. That is the intended end state arriving in pieces, not a regression in this change.

## Files

| File | What it shows |
| --- | --- |
| `rail-expanded-{1440,1100,900}.png` | the expanded rail at each width above the forced-collapse band |
| `rail-collapsed-{1440,1100,900,768}.png` | the collapsed rail; at 768 this is the only state, by design |
| `side-by-side-implemented-1440.png` | the shipped rail, expanded |
| `side-by-side-prototype-{desk,studio,workspace,settings}-1440.png` | the same column in each prototype that draws it |
| `measurements.json` | every number in the tables above |

There is no `rail-expanded-768.png`: below 900 the rail has no expanded state, and a capture labelled with a state that never rendered is worse than a missing one.
