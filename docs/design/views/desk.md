# View — Desk

Route: `app/(app)/desk`. Repo files: `components/desk/*`, `components/shared/artifact-table*`, `hooks/useDeskFilters.ts`.
Prototype: `docs/design/reference/Artifact Studio Desk.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


The Desk answers one question: *what do I have, and what state is it in?* It is a table, not a gallery.

## Anatomy

```
titlebar 44          traffic lights · rail toggle
rail 52/232          layer 0
sheet                layer 1, radius 10
  header             h1 "Desk" 32/500 + subtitle 14/400 ink-4 + primary action
  filter bar 38      search · type · status · workspace · group-by · view toggle
  groups             date group label + artifact rows
  selection bar      floating, only when rows are selected
```

## Header

`h1` DM Sans 500/32, `-0.02em`, baseline-aligned with the subtitle 16px to its right. Padding `12px 16px 16px`. Primary action right-aligned: ink button 40px, radius 9, `plus` 15px + "New Artifact".

## Filter bar

One row, 38px tall controls, 8px gaps, wrapping allowed:

| Control | Behavior |
| --- | --- |
| Search field | flex:1, min 160px, `search` 15px icon, placeholder "Filter by name…" |
| Type · Status · Workspace | dropdown buttons; open a menu with checkbox items and a footer showing "N selected" + "Clear all" |
| Group by | dropdown: Date · Type · Status · Workspace |
| View toggle | two icon buttons, segmented, radius 8 |

Applied filters show as a count on the trigger, never as chips below the bar — the bar must not change height.

## Artifact row

Height 60px, hover `#FCFBFA`, hairline `#EDEBE8` between rows.

```
[checkbox 20]  [title 15/500] [type badge] [pencil] [eye]        [status] [workspace] [date] [⋯]
               [excerpt 13/400 ink-4, max 88ch, 1 line]
```

- Checkbox appears at all times, not on hover: selection is a primary flow here.
- `pencil` (edit) and `eye` (preview) are 14px icon buttons at 32px hit size, revealed at 38 % opacity and full on row hover.
- Type badge: 12px icon in the type's tinted chip.
- Status: pill, the user's color at 20 % tint.
- Date column: relative ("2d"), absolute on hover via `title`.

## Selection bar

Appears when ≥1 row is selected. Dark `#1E1915`, 56px tall, radius 14, centered, 26px from the bottom, shadow `0 18px 44px rgba(35,24,15,.34)`.

Contents: "N selected" 14/500 · "Select all" · "Deselect" · divider · action chips (`folder-tree` Move, `shapes` Set type, `circle-dashed` Set status, `archive` Archive) · destructive chip (`trash-2` Delete) in `rgba(150,83,44,.42)` on hover.

## Preview overlay

Opens from the `eye` action. Full-viewport overlay, scrim `rgba(35,24,15,.26)`.

```
chrome 48            ← → · "3 of 24" · PREVIEW overline · Open full artifact · ⋯ · ✕
content              two columns
  left  (sheet)      Title overline + Lora 500/28 title + badges + prose
  right (276)        properties
```

Right column, top to bottom:

1. **Artifact type** — field button with the type icon and name, opens the type dropdown.
2. **Status** — same pattern.
3. **Workspace / path** — Roboto Mono 12, truncated from the left.
4. **Metrics** — words · chars · reading time.
5. **Sharing card** — bordered, radius 10, two blocks separated by a 1px rule: *Web publishing* ("Publishing and link sharing continue on web") with an ink button, and *Preview link* ("Share with anyone — no Artifact Studio account needed") with "Generate link".

Keyboard: `←` `→` move between artifacts, `Esc` closes, `⏎` opens the full artifact.

## Empty and loading

- No artifacts at all → the first-run state from `docs/design/views/empty-states.md`.
- Filters return nothing → inline block inside the sheet, not a full-page state: 18px Lora "No results" + 13px hint + "Clear all" button.
- Loading → skeleton rows at the row height, never a spinner.

## Checklist

- [ ] Row actions reachable by keyboard, not hover-only.
- [ ] Filter bar height constant with 0 and with 6 filters applied.
- [ ] Selection bar does not cover the last row (sheet gets 96px bottom padding while active).
- [ ] Preview overlay traps focus and restores it to the triggering row on close.
- [ ] Type and status colors come from user config, never hardcoded.
