---
name: skill-design-landing
description: Visual system for the marketing layer of Artifact Studio (public landing, product pages, branded shared/preview surfaces). Use this skill whenever you work in app/(marketing)/**, on the public home, or on any surface seen by someone who is not yet a user. Do NOT use it for the product (Desk, Workspace, Studio, Settings, editor, modals) — that layer is governed by skill-design. If the color, type, spacing or component decision happens inside the app shell, this skill does not apply.
---

# Skill: Design System — Marketing Layer (Artifact Studio)

Artifact Studio has **two visual systems that never mix**:

| Layer | Skill | Where | What it says |
| --- | --- | --- | --- |
| Product | `skill-design` | `app/(app)`, `app/(auth)`, `app/(reading)` | a tool: dense, legible at 13px, warm grey |
| Marketing | **this skill** | `app/(marketing)` | a publication: cream, light serif at scale, gold used sparingly |

They share exactly three things: the mark, the warm-grey family, and Roboto Mono. **Nothing else.** An app button on the landing looks cheap; landing type inside the app becomes illegible.

Before implementing a marketing view, read `.agents/skills/skill-design-landing/design.md` — it holds the per-section values, the anatomy of each block, and the validation checklists.

---

## Philosophy

The app serves the text. The landing **argues a thesis**: the files AI produces need a place where they read as documents. So the landing looks like neither a tool nor a SaaS template — it looks like a publication. Large light-serif headlines, generous cream, and one warm color used three times per screen.

Origin rules:

- No background gradients. No emoji. No cards with a left accent border.
- No shadows: blocks separate by color, not elevation.
- Radius 4px everywhere. (The app uses 6–12; do not import those.)
- Filled buttons only in the final CTA if the brief asks for one; the default action is an arrow link.

---

## Tokens

Marketing tokens are **scoped**, never in `:root`. This is mandatory: overwriting the global `--bg` breaks the app.

```css
/* app/globals.css — new block, after the existing @theme */
[data-layer="marketing"] {
  --mkt-canvas:      #F5F3EF;  /* page background */
  --mkt-panel-warm:  #EFE7DB;  /* alternate block, max 1 per view */
  --mkt-panel-dark:  #1E1915;  /* screenshots, pull quote, final CTA */
  --mkt-ink:         #1E1915;  /* headlines */
  --mkt-body:        #5C534C;  /* paragraphs on cream */
  --mkt-muted:       #8E837B;  /* captions, footer */
  --mkt-rule:        #DFD9CF;  /* 1px rules */
  --mkt-gold:        #A87531;  /* accent on light */
  --mkt-gold-light:  #C79B58;  /* accent on dark panels */
  --mkt-on-dark:     #F5F3EF;
  --mkt-on-dark-dim: rgba(245, 243, 239, 0.6);
  --mkt-radius:      4px;
}
```

`--mkt-ink` and `hsl(var(--ink))` resolve to the same warm black — the one value shared across layers, deliberately.

Exposed to Tailwind v4 inside `@theme` with an `mkt-` prefix:

```css
@theme {
  --color-mkt-canvas: var(--mkt-canvas);
  --color-mkt-panel-warm: var(--mkt-panel-warm);
  --color-mkt-panel-dark: var(--mkt-panel-dark);
  --color-mkt-gold: var(--mkt-gold);
  --color-mkt-gold-light: var(--mkt-gold-light);
  --color-mkt-body: var(--mkt-body);
  --color-mkt-rule: var(--mkt-rule);
  --font-display: var(--font-newsreader), Georgia, serif;
}
```

---

## Type

Three families, no overlapping roles:

| Role | Family | Weight | Note |
| --- | --- | --- | --- |
| Display (h1, h2, panel and quote titles) | **Newsreader** | 200 for h1/h2, 300 for panels | Lora does not go below 400 — unusable at display size |
| UI and body | **DM Sans** | 400, 500 for names | already loaded in `app/layout.tsx` |
| Overline / diagram labels | **Roboto Mono** | 400 | already an `@font-face` in `globals.css` |

Newsreader is loaded in `app/(marketing)/layout.tsx`, not the root layout — the app must not download it:

```tsx
import { Newsreader } from "next/font/google"

const newsreader = Newsreader({
  subsets: ["latin"],
  variable: "--font-newsreader",
  style: ["normal", "italic"],
  weight: ["200", "300", "400"],
  display: "swap"
})
```

### Scale

| Element | Spec |
| --- | --- |
| Hero h1 | Newsreader 200 · `clamp(52px, 7vw, 104px)` / 1.04 · `-0.03em` · max 24ch |
| Section h2 | Newsreader 200 · `clamp(34px, 3.6vw, 52px)` / 1.16 · `-0.02em` · max 26ch |
| Panel / step title | Newsreader 300 · 30px / 1.25 · `-0.015em` |
| Pull quote | Newsreader 200 · `clamp(38px, 4.6vw, 68px)` / 1.16 · `--mkt-gold-light` on dark · max 34ch |
| Hero deck | DM Sans 400 · 17px / 1.65 · max 46ch |
| Panel / step body | DM Sans 400 · 15–16px / 1.65–1.7 |
| Overline | Roboto Mono 400 · 12px / 1 · `.14em` · uppercase · gold |
| Diagram label | DM Sans 400 · 12px in a 32px-tall chip |
| Footer | DM Sans 400 · 13px · `--mkt-muted` |

Rules: `text-wrap: balance` on headlines, `text-wrap: pretty` on paragraphs. One gold italic per headline. Never Newsreader below 24px. Never Lora in this layer.

---

## Gold budget

Maximum **three appearances per screen**: the overline, one italic in the headline, the action arrow. Never as a large block background, never in body copy, never two gold headlines in a row.

On dark panels gold becomes `--mkt-gold-light` and body drops to `--mkt-on-dark-dim` — never a newly invented grey on dark.

---

## Components

Five, and they cover the whole landing. They live in `components/marketing/`.

| Component | Anatomy |
| --- | --- |
| `<MarketingNav>` | sticky, `rgba(245,243,239,.9)` + `backdrop-filter: blur(10px)`, 26px mark + DM Sans 500/16 wordmark, 15px links, gold on hover |
| `<SectionHeader>` | grid `240px 1fr`: mono overline left, h2 + body right |
| `<ArrowLink>` | the landing's only action: 20px Lucide arrow in gold + DM Sans 400/18 label, `white-space: nowrap`, hover turns the label gold |
| `<Panel>` | radius-4 block with `warm` / `dark` variants; screenshots bleed to the right edge (`width: 118%`) instead of sitting centered |
| `<ShotFrame>` | `aspect-ratio` container + `<img>` positioned in % to frame a region of a screenshot; never px crops |

`<ArrowLink>` is **not** ShadCN's `<Button>`. Do not install ShadCN components in this layer: their layer-2 defaults (float shadows, radius 8–10) are tuned for the app and contaminate the landing.

---

## Layout

```
max-width: 1320px · 48px side padding
vertical rhythm: 130px between sections · 110px when two belong together · 70px under the nav
content sections: grid 240px 1fr (overline / content)
panels: grid 1fr 1fr, gap 24px
```

Product screenshots always live inside a dark or cream panel, bleeding to one edge. Never a screenshot floating with a shadow on the page background.

---

## Motion

The landing is nearly static. Color transitions on hover (150ms ease) and, if the brief asks, a 220ms fade-in on viewport entry. No parallax, no animated counters, no `transition: all`.

---

## Invariables

- Never app tokens (`--bg`, `--sb`, `--cursor`, `shadow-float*`, `radius-lg`) inside `app/(marketing)`.
- Never `--mkt-*` outside `[data-layer="marketing"]`.
- No shadows. No background gradients. No emoji.
- Radius always 4px.
- Lucide icons, `strokeWidth 1.5`, only arrows and the problem-diagram set.
- At most one cream panel (`--mkt-panel-warm`) per view.
- Screenshots are real captures of the build, never drawn mockups.
- `DesktopStartupRedirect` stays on the home: the landing must never appear inside the desktop app.
