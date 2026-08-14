# Design migration plan — prototypes → hugomarin/Odessay

Written against `main` @ `c38006e4` (read 2026-08-14). Covers the whole project: the product layer and the new marketing layer.

---

## 0. Where the repo stands

**Already there:**

- `app/page.tsx` — current public home ("Write with calm. Publish with intent."), built on app tokens, with a radial gradient and a placeholder `<aside>`.
- `app/layout.tsx` — Geist Sans + DM Sans + Lora.
- `app/globals.css` — app tokens in `:root`, Tailwind v4 `@theme`, Roboto Mono `@font-face`, and ~800 lines of the content typography contract (`odessay-rich-content`, `prose-odessay`).
- `components/` — desk, editor, workspace, settings, auth, ui (ShadCN, layer-2 configured), shared artifact table.
- Conventions: skills in `.agents/skills/<skill>/SKILL.md`, agent roles in `.agents/agents/`, protocol in `workflow/workflow.md`, commands `/wf-define` → `/wf-build` → `/wf-review` → `/wf-ship`, evidence in `artifacts/<issue>/`.
- Hard guardrails in `AGENTS.md`: the materialized `.md` governs content, `.odessay/index.json` is the durable ledger, SQLite is the only operational catalog, the UI never queries SQLite/manifests/Supabase/filesystem paths directly.

**What this migration is allowed to touch:** presentation. Views, components, tokens, copy.
**What it must not touch:** the document architecture in `AGENTS.md`. Every design in this package reads from `DocumentCatalog`; none of it needs a new store. The one place to be careful is the **Ignore rule** in the add-workspace flow (§4, phase 4) — it is durable state, so it needs an ADR or it ships without persistence.

---

## 1. Two tracks

| Track | Scope | Independent? |
| --- | --- | --- |
| **A — Marketing layer** | `app/(marketing)`, new tokens, Newsreader, 11 landing sections | yes; ships without touching the app |
| **B — Product layer** | Desk, Studio, Workspace, Settings, Auth, empty states, overlays | incremental, view by view |

Run A first: it is self-contained, it is the most visible, and it forces the token-scoping discipline that keeps track B honest.

---

## 2. Track A — Marketing layer

### Structure

```
app/(marketing)/layout.tsx     ← Newsreader + data-layer="marketing"
app/(marketing)/page.tsx       ← the home (moved from app/page.tsx)
components/marketing/          ← marketing-nav, section-header, arrow-link, panel,
                                 shot-frame, problem-map, landing-sections
public/marketing/*.png         ← desk, workspace, editor, types, voice, share
```

Route group, not a loose page: the group's layout is the only place Newsreader loads and `data-layer="marketing"` applies, so app routes pay for neither.

```tsx
// app/(marketing)/layout.tsx
export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div data-layer="marketing" className={\`\${newsreader.variable} min-h-screen bg-mkt-canvas text-mkt-ink\`}>
      {children}
    </div>
  )
}
```

Known trap: `body` carries `@apply bg-bg text-ink`. The marketing wrapper sets its own background and color; **do not** change the `body` rule.

### Phases

| Phase | Deliverable | Gate |
| --- | --- | --- |
| A1 | `[data-layer="marketing"]` tokens + `@theme` entries + group layout + both skill files | no app route changes by a pixel (before/after captures of `/desk` and `/write/[id]`) |
| A2 | `ArrowLink`, `SectionHeader`, `Panel`, `ShotFrame`, `MarketingNav` | grep of the diff: zero `shadow-float`, `bg-card`, `bg-sb`, `text-ink-`, `rounded-[8px|10px|12px]` under `components/marketing/` |
| A3 | Static sections: hero, what it does, panels, notes, method, CTA, footer; captures into `public/marketing` via `next/image` | `ArrowLink` on one line at 1320/1100/900; no CLS from captures |
| A4 | Graphics: problem map, "Up close" cards, Voices panel | zero chip overlap at 1320/1100/960; % crops; aspect-ratio held |
| A5 | Home cutover: `app/page.tsx` → `app/(marketing)/page.tsx`, `DesktopStartupRedirect` kept as the first child, old placeholder deleted | desktop home still redirects to app startup; `/login` and `/signup` untouched; nav links resolve |

---

## 3. Track B — Product layer

Each view is one issue, in this order. The order is chosen so shared components land before the views that consume them.

| # | Issue | Design doc | Repo surface | Depends on |
| --- | --- | --- | --- | --- |
| B1 | Token deltas 1–5 (neutrals, hairlines, DM Sans as UI font, editor body size, 0.5px borders) merged into `skill-design` + `globals.css` | `docs/design/system-app.md` | `app/globals.css`, `.agents/skills/skill-design/SKILL.md` | — |
| B2 | Overlay primitives: flow modal, form modal, display modal, full overlay, dropdown | `docs/design/overlays.md` | `components/ui/dialog.tsx`, `dropdown-menu.tsx`, new `components/ui/flow-modal.tsx` | B1 |
| B3 | Selection bar as one shared component | `docs/design/views/desk.md` §selection | `components/desk/bulk-action-bar.tsx` | B1 |
| B4 | Brand refresh: mark geometry, wordmark in Geist, app icon + favicon regeneration | `docs/design/brand.md` | `public/odessay-logo.svg`, `app/icon.png`, `src-tauri/icons/*` | — |
| B5 | Splash + auth screens | `docs/design/views/auth-splash.md` | `components/auth/*`, `app/(auth)/layout.tsx` | B4 |
| B6 | Desk: header, filter bar, rows, groups | `docs/design/views/desk.md` | `components/desk/*`, `components/shared/artifact-table*` | B1–B3 |
| B7 | Artifact preview overlay + sharing card | `docs/design/views/desk.md` §preview | `components/desk/writing-preview-modal.tsx`, `components/sharing/preview-link-section.tsx` | B2, B6 |
| B8 | Workspace index + detail with tree column | `docs/design/views/workspace.md` | `components/workspace/*` | B1, B2 |
| B9 | Add-workspace flow incl. the include/exclude screen | `docs/design/views/add-workspace.md` | `components/workspace/folder-tree-picker.tsx` | B2, B8 |
| B10 | Settings: account, types, statuses, archive + editor modal | `docs/design/views/settings.md` | `components/settings/*`, `components/ui/artifact-type-selector.tsx` | B2 |
| B11 | Studio: shell, tabs, panels, status bar | `docs/design/views/studio.md` | `components/editor/*` | B1, B2 |
| B12 | Studio: AI bar, suggestions, learned words | `docs/design/views/studio.md` §AI | `hooks/useManualCorrections.ts`, `lib/ai/*`, `components/editor/*` | B11 |
| B13 | Empty and first-run states | `docs/design/views/empty-states.md` | `components/studio/studio-empty-state.tsx`, `components/editor/editor-empty-state.tsx` | B6, B8 |
| B14 | "Artifact" vocabulary sweep in copy | `docs/design/system-app.md` delta 5 | all views | B6–B13 |
| B15 | Workflows section — **design pass required first** | `docs/design/views/settings-workflows.md` | `components/settings/*` | B10 |

`editor-shell.tsx` is 220KB. B11 and B12 are integration issues against it, not rewrites: change presentation in place, extract only what a second view already needs.

---

## 4. Fidelity protocol: prototype → repo

**This section is normative for every view issue in Fase 10.** Each of those briefs cites it by name. It exists because the prose specs in `docs/design/views/` are a reading of the prototypes, not an inventory of them: the Settings prototype alone is 522 lines with ~40 distinct px values and 38 colours against a 67-line document. An implementer who works only from the prose fills the gap by invention.

**Precedence — never an average:**

1. The `.dc.html` prototype is the **visual authority**. Where the prose is silent, open the prototype in a browser and read the value.
2. Where prose and prototype differ on a visual value, **the prototype wins**, and the divergence is recorded in the PR.
3. `skill-design` and the tokens are the authority on **how** that value is expressed in the repo — a token instead of a literal hex, 0.5px instead of 1px. That is not licence to reinterpret geometry.
4. Where two prototypes disagree on the same shared pattern, do not pick one by taste: escalate to the design owner and write the decision into the relevant spec.

**Evidence:** every view issue ships a side-by-side capture of the implemented surface against its prototype, per region, at the same viewport width. An unrecorded divergence is a REVIEW rejection, not a note.

### Translation rules

- The `.dc.html` files are the visual reference, not code. Read values out of them; never copy them in.
- Prototype styles are inline by tooling constraint. In the repo: token classes, never literal hex; `clamp()` values, crop percentages and map coordinates copied **literally** — they are the design, not approximations.
- Prototype borders are 1px; ship 0.5px per `skill-design`.
- Prototype copy is mixed Spanish/English. **Ship everything in English**, product and landing.
- Any value the prototype does not define is a question for the design owner, not an invention.

---

## 5. Risks

| Risk | Mitigation |
| --- | --- |
| Marketing tokens leaking into the app | `[data-layer="marketing"]` scope + grep gate in review |
| Newsreader loaded globally | imported only in the group layout; verify on `/desk`'s network panel |
| Screenshots going stale as the UI evolves | `public/marketing/README` naming each view and date; regenerate when Desk or the editor changes |
| Someone reuses ShadCN `<Button>` on the landing | explicit rule in the skill + grep gate |
| `editor-shell.tsx` regressions | B11/B12 restricted to presentation; existing editor tests must stay green |
| The Ignore rule needs durable state | ships without persistence unless an ADR approves it (see §0) |
| Two design skills drifting apart | `docs/design/system-app.md` deltas merged into `skill-design` in B1, then this package's app docs become read-only history |

---

## 6. Evidence per issue (`/wf-review`)

In `artifacts/<issue>/`:

- captures at 1440 / 1100 / 768 of every changed view;
- before/after captures of one unchanged app route (non-regression);
- output of the forbidden-token grep;
- for A-track issues: `document.fonts.check('200 44px Newsreader')` true on the home, false on `/desk`;
- for B9: the include tree at 540 / 700 / 860px viewport height.

---

## 7. Open decisions for the owner

1. **Nav routes.** "Studio", "Method" and "Voices" are anchors today. Anchors or real pages?
2. **Testimonials.** The prototype names are placeholders. Three real ones, or cut the section to the pull quote alone?
3. **Version history.** In the brief, absent from the landing. Add it as a fourth "Up close" card marked *coming soon*?
4. **CTA targets.** "Download for Mac" / "Try in the browser" assume a published Tauri build. Confirm what each link points to today.
5. **Ignore semantics.** Persistent ignore rule (needs an ADR) or drop the control and ship checkboxes + "Only this"?
6. **Workflows.** Answer the three questions in `docs/design/views/settings-workflows.md` before B15 gets a design pass.
