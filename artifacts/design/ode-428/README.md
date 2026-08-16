# ODE-428 — evidence

Captured at 1440px from the built app (`ODESSAY_PERF_HARNESS_ENABLED=true`) against
`docs/design/reference/` served locally.

```bash
npm run build
ODESSAY_PERF_HARNESS_ENABLED=true npm run start -- --hostname 127.0.0.1 --port 4010 &
npx serve -l 4321 docs/design/reference &
node scripts/capture-selection-bar-evidence.mjs \
  --app http://127.0.0.1:4010 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
```

`--vendor` and `PLAYWRIGHT_CHROMIUM_PATH` exist for sandboxes without egress to
unpkg or with a pinned Chromium; see `scripts/lib/prototype-page.mjs`.

## Files

| File | What it shows |
| --- | --- |
| `three-band-selection-bar-1440.png` | The blocking capture: the shared component with the Desk action set, the Desk prototype's bar, the Settings prototype's bar, and the shared component with the Archived artifacts action set — same viewport width, same order the brief asks for. |
| `last-row-reachable-1440.png` | The sheet scrolled to the bottom with the bar up. The click on the last row registered (`lastRowReachable: true` in `measurements.json`), which is requirement 4. |
| `measurements.json` | Computed geometry of all four bars. |

## Result

Every measured value matches across the four bars:

| | implemented | prototype |
| --- | --- | --- |
| height | 56px | 56px |
| radius | 14px | 14px |
| background | `rgb(30,25,21)` (#1E1915) | `rgb(30,25,21)` |
| shadow | `0 26px 70px rgba(35,24,15,.3), 0 2px 6px rgba(35,24,15,.2)` | same |
| offset from the sheet's bottom | 26px | 26px |
| count | 500 14px, `rgb(251,250,249)` | 500 14px, `rgb(251,250,249)` |
| destructive chip | `rgba(150,83,44,.3)` on `rgb(232,168,124)` | same |
| chip box | 36px tall, radius 9 | 36px tall, radius 9 |

The two prototypes agree with each other on every one of these, so the
"one component" requirement needed no escalation to the design owner: the
geometry is shared and only the action set differs.

## Divergence from the prose

`docs/design/views/desk.md` §Selection bar specifies the shadow as
`0 18px 44px rgba(35,24,15,.34)`. Both prototypes render the two-layer shadow in
the table above. Per `docs/design/migration-plan.md` §4 the prototype wins;
`--shadow-selection-bar` in `app/globals.css` now carries the prototype value.
