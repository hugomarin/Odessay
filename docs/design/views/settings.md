# View — Settings

Route: `app/(app)/settings/*`. Repo files: `components/settings/*`, `components/writings/writing-status-picker.tsx`, `components/ui/artifact-type-selector.tsx`, `components/ui/document-state-*`.
Prototype: `docs/design/reference/Artifact Studio Settings.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


## Shell

```
rail 52 | settings nav 244 | sheet
```

Nav: "Settings" 20/500, then 38px rows (34px icon column + label) with the same active/hover treatment as the app rail, and "Sign out" (`log-out`) at the bottom.

Sections: **Account** (`user-round`) · **Artifact types** (`shapes`) · **Status** (`circle-dashed`) · **Archived artifacts** (`archive`).

Page header: `h1` from the section + a one-line subtitle, max 56ch.

| Section | Subtitle |
| --- | --- |
| Account | "Your profile and how you sign in. Artifacts live in your folders, not here." |
| Artifact types | "Each type has its own icon and color, and appears in the editor selector and the Desk filters." |
| Writing statuses | "Choose which statuses appear in menus and filters, and how they look." |
| Archived artifacts | "Download, restore or permanently delete what you archived." |

## Account

Group label 15/500 with a bottom rule. Profile: two-column grid — Display name, Username — plus the note "Your public URL updates when you save a new username."
Sign in: bordered list, 78px label column, value, "Change" ghost button per row (Email, Password).
Danger zone: label in terracotta, card `#FDF8F4` / border `#F0E2D8`, "Delete account" with the copy "Deletes the account and everything in the cloud. Local files are untouched." — that second sentence is load-bearing for a local-first product.

## Artifact types and Status — the editors

Both sections are the same component with a different item shape.

**Card** (radius 10, layer 1): 38px color chip (icon in full color on a 20 % tint) · name 14/500 + description 12/400 ink-4 · "Required" marker for locked items · "Edit" ghost button · switch (statuses only, "show in menus").

Built-in items (`General`, `Agent`, …) and required statuses cannot be deleted or hidden; their Edit modal shows a lock note instead of the delete action.

Seeded types: General (`file-text`) · Agent (`bot`) · Skill (`wrench`) · Prompt (`message-square`) · Template (`layout-template`) · Transcript (`mic`).
Seeded statuses: New (`circle-dot`) · Exploring (`circle-dashed`) · Draft (`circle`) · In review (`eye`) · Done (`circle-check`) · Archived (`archive`) · Dropped (`circle-x`).

Add row: dashed 44px button, `plus` + "New type" / "New status". It creates an empty item **and opens the modal immediately** — never an untitled row in the list.

### Editor modal

520px, radius 18. Fields, in order:

1. **Name** — 44px input.
2. **When to use it** — 92px textarea, placeholder "An artifact that…". Below it: a "Recommend to me" toggle and **Improve with AI** (`sparkles`), disabled until there is a name or some text — the disabled reason goes in `title`.
3. **Icon** — wrapping grid of 38px buttons. Types get 12 options (`file-text bot wrench message-square layout-template sticky-note book-open compass flask-conical quote list-checks mic`); statuses get 8 (`circle-dot circle-dashed circle eye circle-check archive circle-x flame`).
4. **Color** — six 30px circles with a 2px ring when selected: Ink `#1E1915` · Terracotta `#96532C` · Amber `#C07B2A` · Violet `#5B5BD6` · Green `#2E7D4F` · Grey `#8E837B`.

Footer: "Delete" (link, terracotta on hover) or the lock note · spacer · "Cancel" ghost · "Save" ink.

Types and statuses are user data written to the artifact's frontmatter. Changing a type's color must repaint every badge that references it without a reload.

## Archived artifacts

Search field + scope chips (All · Cloud · Local) at 38px. Tri-state "select all" row on `#FAF7F3`. Rows: 38px chip, name, origin pill, `⋯` menu. Selection uses the same dark floating bar as the Desk, with Restore (`undo-2`), Download (`download`) and Delete forever (`trash-2`, terracotta hover).

## Checklist

- [ ] Built-in types/statuses cannot be deleted or renamed into an empty string.
- [ ] Turning a status off removes it from menus but never rewrites existing artifacts.
- [ ] Color change propagates to Desk badges, editor selector and preview without reload.
- [ ] Danger-zone copy states that local files are untouched.
- [ ] Archive selection bar and Desk selection bar are one component.
