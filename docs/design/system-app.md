# Product layer — design system as built in the prototypes

Complements `.agents/skills/skill-design/SKILL.md`. Where a value here differs from that skill, the delta is called out explicitly — those are decisions to merge, not accidents.

## Status of this document

**`.agents/skills/skill-design/SKILL.md` is the implementation authority.** This document does not replace it: it records what the prototypes added or changed relative to that skill, so each delta can be merged deliberately instead of by osmosis.

**The five deltas below are CLOSED — resolved in ODE-425.** Each one now has a single answer, written into `.agents/skills/skill-design/SKILL.md`. No view issue re-decides them; if a prototype or this document disagrees with the skill, the skill wins.

| Delta | Subject | Status |
| --- | --- | --- |
| 1 | Neutrals, hairlines and the rest of the token set | **closed** — 8 colour, 10 size, 2 radius and 4 shadow tokens merged into `app/globals.css` from `globals-additions.css`; HSL recomputed so each token renders its prototype hex exactly |
| 2 | DM Sans as the UI font, Geist reserved for the wordmark | **closed** — DM Sans is the UI font in the skill, `vistas.md` and the typography table; Geist is wordmark-only. Implemented in code by ODE-446: `--font-sans` resolves to DM Sans, so the `font-sans` utility and `--od-font-ui` now agree |
| 3 | Editor body 17/1.9 vs 18/1.85 | **closed** — **17/1.9**, the Studio prototype value; reasoning in `skill-design/tipografia.md` |
| 4 | 1px vs 0.5px borders | **closed** — **0.5px**, in favour of the skill; the prototype's 1px is a tooling limit and is not copied |
| 5 | "artifact" as the product noun | **closed** — "artifact" in all new UI; file and symbol renames deferred to the mechanical pass (ODE-439) |

### What ODE-425 did *not* take from `globals-additions.css`

- The `[data-layer="marketing"]` block and its `@theme` colours — they belong to ODE-440.
- `--font-display: var(--font-newsreader)` — it is the marketing display face and travels with the marketing layer, not the product layer.

### Transcription drift found and corrected

`globals-additions.css` writes each new colour as an HSL triplet with the prototype hex in a comment, but the two do not agree: `hsl(25 6% 64%)` renders `#A9A29E`, not the `#B5ADA5` its comment claims. Per the fidelity gate, the render wins, so ODE-425 recomputed every triplet from the hex the prototypes actually paint. Six of the eight moved:

| Token | Hex in the prototypes | HSL in `globals-additions.css` | HSL shipped |
| --- | --- | --- | --- |
| `--ink-5` | `#B5ADA5` | `25 6% 64%` | `30 9.8% 67.8%` |
| `--ink-6` | `#CFC9C1` | `25 6% 76%` | `34.3 12.7% 78.4%` |
| `--line-soft` | `#EDEBE8` | `38 8% 93%` | `36 12% 92%` |
| `--line-softer` | `#F0EEEB` | `34 8% 95%` | `36 14% 93%` |
| `--surface-selected` | `#FAF7F3` | `30 30% 97%` | `34.3 41.2% 96.7%` |
| `--surface-row-hover` | `#FCFBFA` | `34 12% 98%` | `30 25% 98.4%` |
| `--success` | `#2E7D4F` | `145 45% 33%` | `145.1 46.2% 33.5%` |
| `--success-tint` | `#E4F0E7` | `138 30% 92%` | `135 28.6% 91.8%` |

### Still open after ODE-425

- **Rail width. RESOLVED (ODE-447): 244px.** Three of the four prototypes that draw the rail declare it as a named constant — `RAIL_FULL = 244` in `Artifact Studio Desk.dc.html`, `Workspace.dc.html` and `Workspace Folder B.dc.html`. Only `Studio.dc.html` carries an inline `mini ? 52 : 232`, in the view where the rail starts collapsed and is therefore least exercised. The prose originally read that 232 and rationalised the 244 as the Settings section nav; measured, the 244 is the rail itself. Per the fidelity gate the prototypes win, and where they disagree the design owner decides — they chose 244. `--size-rail-expanded`, `skill-design` and `layout.md` §2 were corrected to match. This line previously pointed the delta at ODE-433, which scoped itself to Studio and never took the rail; ODE-447 is the issue that owns it.
- **9px radius has no token.** The scale is declared closed in the skill, but the input/nav step is still written `rounded-[9px]`.

**The prototypes in `docs/design/reference/` are the visual authority.** This document describes; the `.dc.html` files show. Where the two differ, the render wins.

---

## 1. Color

Flat hex is used in the prototypes for legibility; in the repo these map to the existing HSL tokens.

| Role | Value | Repo token |
| --- | --- | --- |
| Shell / layer 0 | `#F3F2F0` | `hsl(var(--bg))` |
| Sheet / layer 1 | `#FFFFFF` | `hsl(var(--sb))` |
| Muted surface | `#FAF9F8` · `#FCFBFA` on row hover | `hsl(var(--muted) / …)` |
| Warm selected surface | `#FAF7F3` | new — see delta 1 |
| Hover on layer 0 | `#E9E7E3` | `hsl(var(--muted-h))` |
| Border | `#E4E1DC` | `hsl(var(--border))` |
| Hairline inside sheet | `#EDEBE8` · `#F0EEEB` | new — see delta 1 |
| Ink | `#1E1915` | `hsl(var(--ink))` |
| Ink 2 | `#3F3731` | `hsl(var(--ink-2))` |
| Ink 3 | `#6B5F57` | `hsl(var(--ink-3))` |
| Ink 4 | `#8E837B` | `hsl(var(--ink-4))` |
| Ink 5 (placeholder, disabled) | `#B5ADA5` · `#CFC9C1` | new — see delta 1 |
| Terracotta (destructive, links) | `#96532C` | `hsl(var(--cursor))` |
| Amber (highlight) | `#C07B2A` | `--od-annotation-highlight` |
| Violet (AI) | `#5B5BD6` | `--od-annotation-ai` |
| Green (success, done) | `#2E7D4F` | new |

**Delta 1 — CLOSED (ODE-425).** All eight colour tokens now live in `app/globals.css` with `@theme` entries: `--ink-5`, `--ink-6`, `--line-soft`, `--line-softer`, `--surface-selected`, `--surface-row-hover`, `--success`, `--success-tint`. The prose above named three; the source was `globals-additions.css`, which named eight. No component hardcodes these hex any more.

Type and status colors are user data, not tokens. The palette offered in Settings is: Ink `#1E1915`, Terracotta `#96532C`, Amber `#C07B2A`, Violet `#5B5BD6`, Green `#2E7D4F`, Grey `#8E837B`. Each is rendered as a 20 %-tinted chip background with the full color as foreground.

---

## 2. Type

| Family | Role |
| --- | --- |
| DM Sans | all UI: nav, rows, labels, buttons, inputs, metrics |
| Lora | artifact content, preview title, workspace card titles, modal display titles |
| Geist | wordmark only (splash, landing nav) |
| Roboto Mono | filesystem paths, counts in trees, diagram labels |

| Element | Spec |
| --- | --- |
| View title (Desk, Workspace, Settings) | DM Sans 500 · 32px / 1–1.1 · `-0.02em` |
| View subtitle | DM Sans 400 · 14px / 1.5 · ink-4 |
| Section title in sheet | DM Sans 500 · 20–24px / 1.25 |
| Artifact title (row) | DM Sans 500 · 15px / 1.3 |
| Preview / editor artifact title | Lora 500 · 28–32px / 1.2–1.25 · `-0.015em` |
| Editor body | DM Sans 400 · 17px / 1.9 |
| Editor h2 | DM Sans 600 · 17px / 1.5 |
| Row meta, counts | DM Sans 400 · 12px |
| Controls, buttons | DM Sans 500 · 13–14px |
| Overline | DM Sans 600 · 10–11px · `.09–.13em` · uppercase · ink-4 |
| Path, tree count | Roboto Mono 400 · 11–13px |

**Delta 2 — CLOSED (ODE-425), implemented (ODE-446).** DM Sans is the UI font. `skill-design/SKILL.md` and `vistas.md` were updated by ODE-425; ODE-446 closed the code side by pointing `--font-sans` at `--font-dm-sans`, so the Tailwind `font-sans` utility and `--od-font-ui` now resolve to the same family. `--font-geist-sans` is still defined on `<html>` but has no consumer: it is reserved for the wordmark. DM Sans loads 300/400/500/600 — 600 is required by the overline and editor h2 rows above.

**Delta 3 — CLOSED (ODE-425): 17/1.9.** The Studio prototype value wins. It also unifies editor and reading body, and the `ch`-based measure means it does not wait on the 720px sheet. Applied once, in the grouped `.odessay-editor-content, .prose-odessay` rule that governs all four presentation surfaces. Full reasoning in `.agents/skills/skill-design/tipografia.md`.

---

## 3. Geometry

| Thing | Value |
| --- | --- |
| Sidebar rail, collapsed | 52px |
| Sidebar rail, expanded | 244px (Settings section nav: also 244px) |
| Rail item | 40px box, 38–40px tall, radius 9 |
| Titlebar (desktop) | 44px, traffic lights 12px at 8px gaps |
| Editor topbar | 48px |
| Status bar | 46px, grid `minmax(0,1fr) auto minmax(0,1fr)` |
| Right panel (properties, notes) | 276px |
| Left panel (TOC, workspace tree) | 236px |
| Editor sheet | max-width 720px, padding `48px 24px 140px` |
| Reading width | max-width 660px |
| Selection bar | 56px tall, radius 14, 26px from bottom, centered |
| Modal (flow) | 640px, radius 18, `max-height: calc(100vh - 48px)` |
| Modal (auth card) | 440px, radius 18, padding 36 |
| Radius scale | 6 badge · 7–8 icon button · 9 input/nav · 10 card/panel · 13–14 pill/bar · 18 modal · 50 % avatar |

Borders are 1px in the prototypes. `skill-design` mandates 0.5px. **Delta 4 — CLOSED (ODE-425): 0.5px, in favour of the skill.** The prototype's 1px is a limit of its rendering environment, not a design decision, and is not copied into the repo.

The radius scale above is declared closed in `skill-design`. `--radius-bar: 14px` and `--radius-modal: 18px` are now tokens; the 9px input/nav step is still written `rounded-[9px]`.

---

## 4. The two-layer shell

The invariant that governs every app view:

```
layer 0 — shell        #F3F2F0, no border, holds titlebar, rail, panels
layer 1 — the sheet    #FFFFFF, radius 10, shadow-float, holds content
```

- Rail and side panels have **no background of their own** — they sit on layer 0.
- Everything that belongs to the content (header, toolbar, footer, status bar) lives **inside** the sheet's column, never spanning the shell.
- Only one elevated surface per view. Overlays are the exception and they dim the shell.

---

## 5. Navigation

Rail order, top to bottom: New Artifact (`plus`), Search (`search`) · separator · Studio (`lamp-desk`), Desk (`layout-grid`), Workspace (`folder-tree`) · scroll · recents · user bar.

- Icons 19px in the rail, 15–18px elsewhere, Lucide, `strokeWidth 1.5`.
- Active item: `#E4E1DC` background, ink label. Hover: `#E9E7E3`.
- Labels fade at `opacity 0 / width 0`; the icon never changes X position when collapsing.
- User bar: 36px avatar circle (ink fill, initials DM Sans 600/12), name 13/500, handle 11/400 ink-4, gear → Settings.

Vocabulary: **artifact**, not writing or document, everywhere in new UI. The repo still says "writing" in component names and copy (`writing-preview-modal`, "Search writings…"). **Delta 5 — CLOSED (ODE-425):** "artifact" is the product noun in all new UI, declared in `skill-design`. Copy migrates first; file and symbol renames go in the mechanical pass (ODE-439).

---

## 6. Motion

| Transition | Duration / easing |
| --- | --- |
| Rail collapse / expand, panels | 300ms `cubic-bezier(.4,0,.15,1)` |
| Modal in (`odModalIn`) | 260ms, from `translateY(10px) scale(.985)` |
| Step in (`odStepIn`) | 220ms, from `translateX(10px)` |
| Splash mark in (`odMarkIn`) | 420ms |
| Hover / color | 140–180ms ease |
| Focus mode | 350ms |

Never `transition: all`. Never linear easing on layout.

---

## 7. Scrollbars

Every scroll region uses the `.od-scroll` treatment: 10px wide, thumb `#E3E0DB` with a 3px transparent border and `background-clip: content-box`, transparent track, `scrollbar-width: thin`.

Shipped in `app/globals.css` by ODE-425, including the `height: 10px` for horizontal regions that the prototypes declare and `globals-additions.css` omits. No component defines its own scrollbar.
