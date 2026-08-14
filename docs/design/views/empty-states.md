# View states — first run and empty

Repo files: `components/editor/editor-empty-state.tsx`, `components/studio/studio-empty-state.tsx`, `components/collections/uncategorized-banner.tsx`, `components/workspace/workspace-desktop-required.tsx`.
Prototype: `docs/design/reference/Artifact Studio Empty States.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


Three distinct states. They are not interchangeable, and the difference is *what the user has to do next*.

## 1. First run — seeded

The user just installed and a folder is connected. Left-aligned block, max-width 680, padding `64px 16px 40px`.

```
h2 24/500 -0.01em      "Start here"
p 15/1.65 max 56ch     "We left two artifacts written for you. They're ordinary markdown: edit them, delete them, or point the app at another folder."
two option rows        each = icon tile 36 + title 14/500 + line 13/400 ink-4
divider
secondary actions      "New Artifact" (ink) · "Connect another folder" (ghost)
```

Never a checklist with progress. The seeded artifacts *are* the tutorial.

## 2. Connected but empty

Centered, min-height 440. Dashed 52px tile (`file-plus`, border `#D6D1CA`, ink-5 icon), `h2` 20/500 "No artifacts yet", 14/1.6 max 40ch: "This workspace is connected and empty. Whatever you write here is saved as markdown in that folder." Actions: "New Artifact" (ink) + "Restore starter documents" (ghost).

## 3. No workspace connected

Left-aligned, max-width 620. `h2` 24/500 "You haven't connected a folder yet" + 15/1.65 max 54ch: "A workspace is a folder of yours that Artifact Studio watches. Nothing is moved and nothing is copied." Then the two option rows from the add-workspace flow (existing folder / from scratch), and a footnote with `info` 15px: where the starter documents currently live.

## Rules

- Empty states live **inside the sheet**, with the view's header and primary action still present. The user must never lose the nav.
- Exactly one primary action per state.
- No illustrations, no mascots, no emoji.
- Copy names the filesystem explicitly — it is the product's differentiator, and the empty state is where it is most believable.

## Checklist

- [ ] Header and rail remain visible in all three states.
- [ ] "Restore starter documents" is idempotent and does not overwrite edited files.
- [ ] The no-workspace state is reachable from Settings, not a dead end.
