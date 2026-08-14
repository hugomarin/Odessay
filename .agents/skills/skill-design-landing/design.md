# design.md — Artifact Studio landing

Full specification of the marketing layer. Companion to `skill-design-landing`. Source: `docs/design/reference/Artifact Studio Landing.dc.html` (approved prototype) + `docs/design/reference/Artifact Studio UI Kit.dc.html` §8.

---

## 1. The thesis

Artifact Studio is **not** an AI editor and not a note manager. It is the workspace for the files AI already produces in your project.

The argument has five pieces, and the order matters:

1. Creating documents with AI got easy; working with what it creates did not.
2. One file, two interfaces: markdown for machines, a document for people.
3. A workspace, not a folder full of `.md`: project, type and status instead of filename conventions.
4. Interoperability: Claude Code, Codex and Cursor keep working as they do; the studio gives their output a home.
5. Local-first, cloud-enabled: the filesystem is the source of truth; the cloud adds sync, links and collaboration.

Every section serves one of those pieces. A section that maps to none is cut.

---

## 2. Page structure

| # | Section | Piece | Anatomy |
| --- | --- | --- | --- |
| 0 | Sticky nav | — | mark + 4 links (Studio, Method, Voices, Sign in) |
| 1 | Hero | 1 | mono overline · h1 with gold italic · grid 1fr 1fr: deck + two `ArrowLink`s |
| 2 | Desk shot | — | dark panel, overline `THE DESK`, full-width capture cropped to 640px tall |
| 3 | The problem | 1 | `SectionHeader` + **broken-workflow map** + contrast rail |
| 4 | What it does | 2 | `SectionHeader` + two-column body + `ArrowLink` to the method |
| 5 | Two panels | 3 | Workspaces (dark) and Editor (cream), each with a bleeding capture |
| 6 | Note pair | 4 and 5 | two columns with a top rule: Interoperability · Local-first |
| 7 | Up close | 3 | three cards: types, voice note, share |
| 8 | Voices | — | near-bleed dark panel: quote in gold-light + three names |
| 9 | The method | 3 steps | rows of `80px 1fr 1fr` separated by rules |
| 10 | Final CTA | — | dark panel: h2 with gold-light italic + deck + `ArrowLink` |
| 11 | Footer | — | mark + origin line + 3 links |

Non-negotiable order: the problem comes **before** the solution. The landing loses its force if it opens with features.

---

## 3. The problem map (section 3)

The landing's one graphic, and the easiest thing to ruin.

**Canvas:** SVG `viewBox="0 0 1224 700"`, `aspect-ratio: 1224 / 700`, inside a `--mkt-panel-warm` block with 34px padding. Chips are HTML positioned in % over the SVG — not SVG text.

**Seven stops**, each a 32px white chip with a 14px Lucide icon, rotated ±1–2°, `white-space: nowrap`:

| Stop | Icon | left / top |
| --- | --- | --- |
| Claude · Codex | `bot` | 19.6% / 8.6% |
| spec.md | `file-code` | 57.2% / 25% |
| copy / paste | `copy` | 27% / 42.9% |
| Google Docs | `file-text` | 67% / 60% |
| export and send | `send` | 34.3% / 77.1% |
| spec-final-v2.docx | `files` | 62.1% / 92.1% |
| back to the agent (gold chip) | `rotate-ccw` | 16.3% / 92.1% |

**Routes:** 2.5px curves in `#C6BCAE`. Five solid between stops, three dashed (`7 10`) for the hops that leave a copy, and the return-to-agent route dashed in `--mkt-gold`.

**Contrast block immediately below:** dark panel, overline `WITH ARTIFACT STUDIO · ONE STOP`, and a single-line rail: `agent — [spec.md] — you`, where `spec.md` is a 42px gold pill and the ends are outlined pills. Under it, a mono footer split left/right: `filesystem · source of truth` / `sync · link · versions`.

**Invariants:** the map must look messy but stay legible; no chip may overlap another at 1320px or 960px; the rail never wraps (`flex-wrap: nowrap` + `flex-shrink: 0` on all three nodes).

---

## 4. Screenshot framing

All captures are real PNGs of the build. Two treatments:

**Bleed (panels, section 5):** `width: 118%; max-width: none; height: 300px; object-fit: cover` with `object-position` at the left edge, inside a container with `overflow: hidden` and `border-radius: 3px 0 0 0`. The panel uses `padding: 48px 0 0 48px` — no right padding.

**Detail framing (section 7):** container with `aspect-ratio: 4 / 3`, `position: relative; overflow: hidden`, and the image `position: absolute` with `left`, `top` and `width` **in percentages**. Never px: the cards are fluid and a px crop drifts as the width changes.

Content rule: each detail card shows exactly one recognizable UI state (an open dropdown, a dialog, a panel), never a whole view scaled down.

---

## 5. Copy rules

- Short sentences. No exclamation marks. No "AI-powered", "revolutionize", "effortless".
- Filenames are set in mono and are plausible: `spec.md`, `spec-final-v2.docx`.
- Name the user's real tools: Claude Code, Codex, Cursor, Google Docs. Naming them *is* the interoperability argument.
- Headlines oppose two ideas ("Markdown for machines. Documents for people."). The gold italic lands on the word carrying the contrast.
- Testimonials come from applied-AI roles, not writers.
- **Language:** English. The prototype was drafted in Spanish; the shipped landing is English, matching the app. Keep one voice per surface — no mixed-language pages.

---

## 6. Responsive

| Width | Behavior |
| --- | --- |
| ≥ 1320px | full grid, 48px padding |
| 1024–1320px | content shrinks; the 240px overline column holds |
| < 1024px | `1fr 1fr` grids collapse to one column; the overline moves above the h2; the map keeps its `aspect-ratio` and scales |
| < 720px | h1 at the clamp minimum (52px); captures lose the bleed (100% width); nav reduces to mark + Sign in |

The map is not redesigned on mobile — it scales. If it becomes illegible at 400px, replace it with the stop list in mono, never with a smaller map.

---

## 7. Validation checklist

- [ ] No `--bg`, `--sb`, `--cursor` or `shadow-float*` anywhere in the tree.
- [ ] No `border-radius` other than 4px (3px only on the inner edge of a bleeding capture).
- [ ] Gold ≤ 3 appearances per screen.
- [ ] One cream panel per view.
- [ ] Newsreader loaded at weight 200 (`document.fonts.check('200 44px Newsreader')`).
- [ ] Every `ArrowLink` on one line at 1320, 1100 and 900px.
- [ ] No overlapping map chips at 1320, 1100 and 960px.
- [ ] Captures cropped in %, not px.
- [ ] `DesktopStartupRedirect` present on the home.
- [ ] No extra font layer loaded on app routes.
