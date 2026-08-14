# Views — Workspace index and Workspace detail

Routes: `app/(app)/workspace` and `app/(app)/workspace/[id]`. Repo files: `components/workspace/*`, `hooks/useWorkspaceReconciler.ts`, `hooks/useWorkspaceTableFilters.ts`.
Prototypes: `docs/design/reference/Artifact Studio Workspace.dc.html` (index), `docs/design/reference/Artifact Studio Workspace Folder B.dc.html` (detail).

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


A workspace **is a folder**. The view organizes; it never owns documents.

## Index

Header: `h1` "Workspace" 32/500 + subtitle "Synced folders, who writes in each one, and what moved last." Primary action: "Add workspace" → the flow in `docs/design/views/add-workspace.md`.

Filter row identical in geometry to the Desk's (38px, search + sort + view toggle) so the two views feel like the same table family.

**Folder card** — layer 1, radius 10, `shadow-float`:

```
[folder icon 17 in 38 tinted tile]  Name (Lora 500/19)        [⋯]
                                    meta 12/400 ink-4
path (Roboto Mono 12, truncated left)
counts row: N artifacts · N folders · last change
```

Row menu (`⋯`): Open · Reveal in Finder · Rename · Re-scan · Manage included files · Disconnect. Disconnect is destructive-styled but does not delete files — the copy must say so.

## Detail

Adds the third column of layer 0: a 236px tree between rail and sheet, transparent background, 1px rule on its right.

```
rail 52 | tree 236 | sheet
```

Tree header: "← All workspaces" link 32px, then the workspace name with `folder-tree` 16px and a `folder-plus` action. Tree rows 32px, indent 18px per level, chevron 13px rotating `-90deg → 0` in 180ms, count in Roboto Mono 11 right-aligned.

The tree navigates. The sheet manages (rename, move, type, status, include/exclude). Never the reverse.

## Checklist

- [ ] Card title truncates at one line; path truncates from the left, never the right.
- [ ] Tree and Studio's workspace panel are the same component.
- [ ] "Disconnect" copy states that local files stay untouched.
- [ ] Counts come from the catalog, never from a filesystem read in the view.
