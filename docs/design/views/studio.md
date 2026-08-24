# View — Studio (editor)

Route: `app/(app)/write/[id]`. Repo files: `components/editor/*` (`editor-shell.tsx` is 220KB — treat it as the integration point, not a file to rewrite), `components/editor/panels/*`, `components/editor/status-bar.tsx`.
Prototype: `docs/design/reference/Artifact Studio Studio.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


## Anatomy

```
titlebar 44        traffic lights · rail toggle · tabs · focus · share · properties toggle
rail 52            collapsed by default in Studio
left panel 236     TOC or workspace tree (layer 0, optional)
sheet              max-width 720, padding 48 24 140
right panel 276    properties / notes (layer 0, optional)
status bar 46      save state · edit mode · metrics
```

## Tabs

Tab item 32px tall, radius 7, 10px gap from the next; active tab gets the sheet's white and ink label, idle is transparent with ink-4. `plus` button 32px after the last tab. Tabs are per-artifact, not per-workspace.

## Header row inside the sheet

Left: panel toggles (`list-tree` TOC, `folder-tree` workspace) in a grouped ghost rail · breadcrumb lead (workspace › folder) · artifact name 14/400 with a `pencil` rename button. Double-click on the name also opens rename.
Right: format toolbar — `bold` `italic` `strikethrough` `code-xml`, 1px divider, block/insert menus. Icons 16px, `strokeWidth 2` for bold/italic only.

## The sheet

- Artifact title: Lora 500/32, `-0.02em`, 28px bottom margin.
- Body: DM Sans 400 · 17px / 1.9 · `#2F2A25`.
- H2 inside body: DM Sans 600/17, 40px top margin.
- Ghost rail: when both panels are closed, the two panel toggles float at the sheet's left edge at low opacity.

## AI bar

Anchored above the status bar, inside the sheet column, radius 12.

States:

| State | UI |
| --- | --- |
| Idle | single-line input, `sparkles` prefix, "Save" button disabled |
| Typing | `mic` dictate button appears; Save enabled |
| Running | elapsed timer 18/400 tabular-nums, `x` discard, pause/resume, square stop button (13px white square on ink) |
| Recording | waveform placeholder, red dot, elapsed time, stop = transcribe |

The timer is tabular-nums so the bar does not shift width while counting.

## Grammar / correction suggestions

Inline: wavy underline `#c87341` (`.pub-suggestion-pending` already in `globals.css`). Bubble above the span: ink background, 11px label, three actions — **Apply** (ink), **Ignore** (ghost), **Learn** (`book-plus`, adds to learned words). Learned words appear in the notes panel as 26px chips with an `x` to forget.

Annotation colors are already tokenized in the repo: AI `#5B5BD6`, highlight `#C07B2A`, personal/footnote `#999990`. Do not introduce new ones.

## Panels

- **TOC** (`list-tree`): heading tree with 16px indent guides (`border-left` on a 16px spacer, `margin-left: 5px`), active heading highlighted, count badge in the panel header.
- **Workspace** (`folder-tree`): the same tree component as the Workspace view, read-only, with the current artifact highlighted.
- **Notes / properties** (276px): type, status, path, metrics, learned words.

Only one left panel and one right panel open at a time.

## Status bar

Three-column grid `minmax(0,1fr) auto minmax(0,1fr)`: left save state (`cloud-upload` + "Saved"), center edit-mode segmented control (Rich · Markdown), right metrics + `keyboard` shortcuts + `align-left` notes. Metrics string: "696 words · 4,326 chars · 34 sentences · 4 min · 2.8 pg", truncated from the right.

## Modals

Rename (small, 440px) and Keyboard shortcuts (large, Lora 34 title, three-column grid of `kbd` rows) — both specified in `docs/design/overlays.md`.

Embedded images in Rich mode expose a quiet expansion affordance on hover. Clicking the image opens the presentation viewer in the existing `FullOverlay`: the Studio shell remains visible through a light frosted scrim, while the image is centered and contained. The viewer is presentation-only, with previous/next controls, keyboard navigation, and no document mutation.

## Focus mode

`scan` in the titlebar. Rail and panels fade to `opacity 0 / width 0` over 350ms (the repo already has `body.od-editor-focus-mode` rules). The sheet stays put — the text must not reflow when entering focus mode.

## Checklist

- [ ] Sheet width 720px and body 17/1.9 in every editing mode.
- [ ] Focus mode causes zero text reflow.
- [ ] AI bar never overlaps the status bar or the last line of text.
- [ ] Tab bar scrolls horizontally without shrinking tab height.
- [ ] Suggestion bubbles reposition on scroll and never leave the sheet.
