# ODE-427 — overlay primitives, visual evidence

Regenerate with the app built and served with the harness enabled, and the
prototypes served from `docs/design/reference`:

```bash
ODESSAY_PERF_HARNESS_ENABLED=true npm run build
ODESSAY_PERF_HARNESS_ENABLED=true npm run start -- -H 127.0.0.1 -p 3000 &
npx serve docs/design/reference -l 4321 &
node scripts/capture-overlay-evidence.mjs
```

- `*-side-by-side-{1440,1100}.png` — each pattern as implemented (left, from
  `/perf/overlay-harness`) against the overlay it was read from in the
  prototypes (right), at the same viewport width, scrim included.
- `keyboard-walkthrough/*.webm` — a three-step flow modal opened, advanced and
  closed with the keyboard only.

Divergences between the prototypes and their resolution are recorded in
`docs/design/overlays.md`.
