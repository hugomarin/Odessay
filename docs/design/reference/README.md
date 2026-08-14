# Reference prototypes — the visual authority of Fase 10

These are the working prototypes the specs were written from.

**They are not production code. They are the visual source of truth: read values out of them, never copy their nodes.**

That distinction is the whole point of this folder. The prose specs in `docs/design/views/` are a reading of these files — they record decisions, not the hundreds of values a render contains. When a spec is silent, the answer is here, not in your judgement.

## The rule, in full

1. Where the prose is silent, **read the value from the prototype**.
2. Where prose and prototype differ on a visual value, **the prototype wins**, and the divergence is recorded in the PR.
3. `.agents/skills/skill-design/SKILL.md` and the tokens govern **how** a value is expressed in the repo: a token class, never a literal hex; 0.5px where the prototype draws 1px. That is not licence to reinterpret geometry.
4. **Any value the prototype does not define is a question for the design owner, not an invention.**

Inline styles here are a constraint of the prototyping environment, not a instruction. In the repo they become token classes. The values themselves — `clamp()` expressions, crop percentages, map coordinates — are copied **literally**: they are the design, not approximations.

Full protocol: `docs/design/migration-plan.md` §4.

## How to open

Every `.dc.html` file is a standalone document. Open it directly in a browser from this folder — `support.js`, `lucide-icon.js`, `image-slot.js` and `assets/` are included here and are the only local dependencies. No build step, no server needed.

```bash
open "docs/design/reference/Artifact Studio Desk.dc.html"
# or, to avoid file:// font-loading quirks:
npx serve docs/design/reference
```

**Network:** the prototypes load their webfonts from Google Fonts. Geometry, spacing, colour and layout read correctly offline; typography falls back to system fonts. Open them online when the type is what you are measuring. The files are deliberately left as the design tool produced them — vendoring the fonts would make this copy diverge from the design source, which is a worse trade than needing a connection.

## What each file backs

| File | Specs it backs |
| --- | --- |
| `Artifact Studio Landing.dc.html` | `.agents/skills/skill-design-landing/design.md`, `.agents/skills/skill-design-landing/SKILL.md` |
| `Artifact Studio Desk.dc.html` | `docs/design/views/desk.md`, the preview overlay, the selection bar, part of `docs/design/overlays.md` |
| `Artifact Studio Studio.dc.html` | `docs/design/views/studio.md`, including the AI bar and suggestion bubbles |
| `Artifact Studio Workspace.dc.html` | `docs/design/views/workspace.md` (index) |
| `Artifact Studio Workspace Folder B.dc.html` | `docs/design/views/workspace.md` (detail + tree column) |
| `Artifact Studio Add Workspace.dc.html` | `docs/design/views/add-workspace.md` |
| `Artifact Studio Settings.dc.html` | `docs/design/views/settings.md`, and the archive selection bar |
| `Artifact Studio Auth.dc.html` | `docs/design/views/auth-splash.md` |
| `Artifact Studio Empty States.dc.html` | `docs/design/views/empty-states.md` |
| `Artifact Studio UI Kit.dc.html` | `docs/design/system-app.md`, `docs/design/layout.md`, `docs/design/globals-additions.css` |
| `Artifact Studio Logo Fan.dc.html`, `… Lateral.dc.html` | `docs/design/brand.md` — **explorations, not approved marks**; the approved geometry is the one written in that document |

No prototype backs `docs/design/views/settings-workflows.md`: that view was never designed, which is why it needs a design pass before implementation.

## How to read a prototype

Each file has two parts: the markup (between `<x-dc>` tags) and a logic class at the bottom. Style values live inline in the markup, or as named strings in the logic class's `renderVals()` — search there for `ghostBtn`, `railBtn`, `primaryBtn`, `modalStyle` and similar names to find a component's canonical style.

## Known differences from what should ship

- Borders are 1px here; ship 0.5px (`skill-design`, delta 4).
- Copy is mixed Spanish/English; ship English everywhere, product and landing.
- Interactive state is local and fake — no catalog, no filesystem, no auth.
- The include screen in `Artifact Studio Add Workspace.dc.html` shows an **Ignore** control. It does **not** ship: it would need durable state, and the owner decided against it (2026-08-14). Ship checkboxes + "Only this" only.
- The landing's screenshots in `assets/` are real captures but will go stale; regenerate into `public/marketing/` when the UI changes.
- `Artifact Studio Workspace.dc.html` links to a `… Workspace Folder A.dc.html` that is not part of the package. Dead link in the prototype; nothing depends on it.
