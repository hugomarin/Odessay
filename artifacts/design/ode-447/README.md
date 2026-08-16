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
| **Icon X travel across the expansion** | **0px** — 16px in both states |
| Recents block | `overflow-y: auto`, outside the views and outside the user bar |
| Forced collapse below 900 | 244 → **52**, and back to **244** when the window widens |
| Toggle while width-forced | absent (`toggleHiddenWhileForced: true`) |
| Time to interactive | **76ms** to a usable rail (`domInteractive` 73ms), budget 1000ms |

The icon travel is the headline: the spec words it as "the icon never changes X position when collapsing", and it is measured from the rendered box, not asserted from a class list.

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
