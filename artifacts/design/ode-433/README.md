# ODE-433 — Studio shell, visual and performance evidence

Regenerate with the app built and served with the harness enabled and the
prototypes served from `docs/design/reference`:

```bash
ODESSAY_PERF_HARNESS_ENABLED=true npm run build
ODESSAY_PERF_HARNESS_ENABLED=true npm run start -- -H 127.0.0.1 -p 3000 &
npx serve docs/design/reference -l 4321 &
node scripts/capture-studio-evidence.mjs
```

- `shell-*-{1440,1100,768}.png` — every panel combination at the three widths:
  both closed (ghost rail visible), TOC, workspace tree, both open, right only.
- `tab-strip-overflow-1100.png` — eight tabs overflowing; every tab still 34px.
- `focus-mode-1440.png` + `focus-mode/*.webm` — entering and leaving focus mode.
- `side-by-side-*-1440.png` — each region against the Studio prototype at the
  same width: titlebar with tabs, sheet header, status bar, and the full shell.
- `measurements.json` — the numbers behind the contracts:
  - `tabs`: 8 tabs, one distinct height (34px), strip scrolls.
  - `focusModeReflow`: the first paragraph's box before / during / after focus
    mode — identical, so no line moves or re-wraps.
  - `timeToInteractive`: `editorEditableMs` is the time until the editor surface
    is interactive (< 1s required by the brief).

The interaction-latency trace lives in `artifacts/perf/ode-433-studio-shell-trace.json.gz`
(`node scripts/capture-editor-trace.mjs --scenario studio-shell`).

Divergences from the prototype are recorded in the PR body.
