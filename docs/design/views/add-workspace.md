# Flow — Add workspace (and include / exclude)

Repo files: `components/workspace/folder-tree-picker.tsx`, `components/desk/import-writing-dialog.tsx` (pattern reference).
Prototype: `docs/design/reference/Artifact Studio Add Workspace.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


One modal, five steps, 640px wide, radius 18, `max-height: calc(100vh - 48px)`, `odModalIn` 260ms. Each step animates in with `odStepIn` 220ms. `Esc` closes and returns to the previous view.

## Step 1 — Origin

Title "Add a workspace" 32/500. Two option rows (radius 12, `#FAF9F8`, 44px icon tile):

- **Use an existing folder** — `folder` — "Connect a folder you already work from."
- **Create from scratch** — `plus` — "Create a new folder and start clean."

## Step 2a — Existing folder

Copy: "Artifact Studio watches the markdown inside it. Nothing is moved or copied — the folder stays exactly where it is." One picker button + a recents line.

## Step 2b — From scratch

Name input 46px + location row with a "Change" ghost button. Primary is disabled until the name is non-empty.

## Step 3 — Choose what to include

The most important screen in the flow: it is how a workspace is curated, not just created. A user with forty folders needs three.

Header (compact — it must never starve the tree):

```
[← back]  path in Roboto Mono 12                       ← one row, 32px
"Choose what to include"  26/500
"N markdown found. Untick what you don't want, or use Only this to keep one folder."  13/1.5
[search 38]        placeholder "Search folder or file…", clears with ✕
[summary 40]       "Tracking N of M"  ·  "N ignored" + Restore  ·  All / None
```

Tree region: `flex: 1 1 auto; min-height: 150px; overflow-y: auto`. **The header yields before the tree does** — this is a hard constraint; a 540px-tall window must still show rows.

**Row** — 38px, indent 18px per level:

```
[chevron 16] [checkbox 20] [icon 16] Name  count(mono 11)   [⌖ Only this] [⊘ Ignore]
```

- Checkbox: tri-state on folders (all / some = 9×1.5px dash / none).
- **Only this** (`crosshair`): selects exactly that subtree and unticks everything else. One click for the "just these three" case.
- **Ignore** (`ban`) / **Restore** (`rotate-ccw`): hard exclusion. The row's label goes line-through, its checkbox disables, and it leaves the totals.
- Both actions are 24px text buttons at 55 % opacity, full on hover — discoverable without being loud.

**Semantics to preserve in the implementation:** unticking is *this session's selection*; ignoring is *persistent* — it should be written as an ignore rule (`.odessay/index.json` or an `.artifactignore`-style list) so files an agent creates later in that folder are also excluded. If persistence is not built, drop Ignore entirely and ship only checkboxes + Only this. Two controls that do the same thing is worse than one.

Footer: "Back" ghost + "Add workspace · N" ink, disabled at 0 selected.

## Step 4 — Done

Success tile (52px, `#E4F0E7` / `#2E7D4F`), workspace name, "N files tracked", "Add another" + "Open workspace".

## Checklist

- [ ] Tree visible with ≥4 rows at 540, 700 and 860px viewport height.
- [ ] Search auto-expands matches and keeps ancestors visible.
- [ ] Only this + Ignore both reachable by keyboard.
- [ ] Counts always exclude ignored files.
- [ ] Primary disabled at 0 selected, with the count in its label otherwise.
