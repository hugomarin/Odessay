# Layout specification

Everything an implementer needs to place regions without guessing. Values are the prototypes'; where the repo already fixes one (topbar 46, reading 660), the repo wins and it is flagged.

## 1. Spacing scale

4px base. Only these steps: **2 · 4 · 6 · 8 · 10 · 12 · 14 · 16 · 20 · 22 · 26 · 30 · 34 · 40 · 48 · 64**.

| Step | Use |
| --- | --- |
| 2 | gap between rail items, tab strips |
| 6–8 | icon-to-label, chip padding |
| 10–12 | gaps inside a control row |
| 14–16 | between form fields; sheet header padding |
| 20–22 | modal padding, card padding |
| 26–34 | between blocks inside a section |
| 40–48 | sheet top padding, marketing side padding |
| 64 | marketing column gap |

Never an odd value that is not on the scale. Never negative margins for layout.

## 2. App window regions

```
┌───────────────────────────────────────────────────────────────┐
│ titlebar 44          layer 0 — traffic lights, rail toggle    │
├──────┬───────────┬────────────────────────────┬───────────────┤
│ rail │ left      │  sheet (layer 1)           │ right panel   │
│ 52   │ panel 236 │  radius 10, shadow-float   │ 276           │
│ /244 │ (opt.)    │  ┌──────────────────────┐  │ (opt.)        │
│      │           │  │ header               │  │               │
│      │           │  │ toolbar              │  │               │
│      │           │  │ content (scrolls)    │  │               │
│      │           │  └──────────────────────┘  │               │
├──────┴───────────┴────────────────────────────┴───────────────┤
│ status bar 46        only in Studio                           │
└───────────────────────────────────────────────────────────────┘
```

**Ownership rules (the recurring mistake):**

- The titlebar and status bar are **siblings of the whole middle band**, not of the sheet — they run edge to edge.
- Everything that accompanies the content — header, toolbar, footer, empty state — lives **inside the sheet's column**.
- Rail and panels are transparent: they sit on layer 0 and have no fill of their own.
- Only the middle band splits into columns.

| Region | Width / height | Notes |
| --- | --- | --- |
| Titlebar | 44 | desktop only; traffic lights 12px, 8px gaps, 20px left inset |
| Rail collapsed | 52 | 6px side padding → 40px item box |
| Rail expanded | 244 | label fades `opacity 0 → 1`, icon X never moves |
| Settings nav | 244 | its own scale, not the rail |
| Left panel | 236 | transparent, 1px rule on the right |
| Right panel | 276 | transparent, 1px rule on the left |
| Sheet gutter | 16 | between sheet and window edge / panels |
| Editor topbar | 48 | inside the sheet column (repo has 46 for the app topbar — keep 46 outside Studio) |
| Status bar | 46 | grid `minmax(0,1fr) auto minmax(0,1fr)` |
| Editor sheet | max 720, padding `48 24 140` | 140 bottom clears the AI bar |
| Reading width | max 660 | repo value, authoritative |
| Desk / Workspace content | fluid, padding `12 16 16` header | table is full width of the sheet |

## 3. Sheet-internal grids

| View | Grid |
| --- | --- |
| Desk row | `20px 1fr auto auto auto auto` — checkbox, title block, status, workspace, date, ⋯ (columns collapse right-to-left below 1100px) |
| Desk filter bar | flex, wrap, 8px gap, all controls 38px |
| Preview overlay | `1fr 276px`, chrome row 48px above both |
| Workspace card grid | `repeat(auto-fill, minmax(320px, 1fr))`, gap 20 |
| Workspace detail | `52px 236px 1fr` |
| Settings section | single column, max 720, groups separated by 34–38px |
| Settings type/status card | `38px 1fr auto auto` — chip, text, Edit, switch |
| Include tree row | `16px 20px 16px 1fr auto auto auto` — chevron, checkbox, icon, name, count, Only this, Ignore |
| Status bar | `minmax(0,1fr) auto minmax(0,1fr)` |

## 4. Overlay positioning

| Overlay | Position |
| --- | --- |
| Flow / form modal | centered, `max-height: calc(100vh - 48px)`, flex column: fixed header, scrolling middle (`min-height: 150px`), fixed footer |
| Display modal | centered, max 860, scrolls internally |
| Full overlay | `inset: 0`, own 48px chrome row, content centered with the view's own max-width |
| Dropdown | anchored to trigger, 4px offset, flips on collision, min 200 max 320 wide |
| Selection bar | `position: absolute; left: 50%; bottom: 26px; transform: translateX(-50%)` |
| Suggestion bubble | anchored to the text span, `bottom: calc(100% + 6px)`, flips below when clipped |

While the selection bar is visible the sheet gets 96px bottom padding so the last row stays reachable.

## 5. Breakpoints

| Width | App behavior |
| --- | --- |
| ≥ 1440 | all panels can be open at once |
| 1100–1440 | right panel becomes an overlay above the sheet rather than a column |
| 900–1100 | left panel overlays; Desk drops the workspace column |
| 700–900 | rail forced collapsed; Desk drops the date column |
| < 700 | repo already hides the app shell (`#app-sidebar-shell`); Studio shows the mobile notice |

Marketing breakpoints are in `.agents/skills/skill-design-landing/design.md` §6.

## 6. Marketing layout

```
max-width 1320 · side padding 48
vertical rhythm: 70 under nav · 130 between sections · 110 when two belong together
content section: grid 240px 1fr, gap 64
panels: grid 1fr 1fr, gap 24
panel with a bleeding shot: padding 48 0 0 48 (no right padding)
```

## 7. Checklist

- [ ] No layout value off the spacing scale.
- [ ] Titlebar and status bar span the window; header/toolbar do not.
- [ ] Panels have no background of their own.
- [ ] One elevated surface per view.
- [ ] Sheet gets 96px bottom padding while the selection bar shows.
- [ ] Every scroll region uses `.od-scroll`.
- [ ] Modal middle section has `min-height: 150px` and the header yields first.
