# ODE-430 — evidence

Captured from the built app (`ODESSAY_PERF_HARNESS_ENABLED=true`) against
`docs/design/reference/` served locally.

```bash
npm run build
ODESSAY_PERF_HARNESS_ENABLED=true npm run start -- --hostname 127.0.0.1 --port 4010 &
npx serve -l 4321 docs/design/reference &
node scripts/capture-desk-evidence.mjs \
  --app http://127.0.0.1:4010 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
```

`/perf/desk-harness?state=…` renders the **real** header, toolbar, sheet, rows
and selection bar over fixture rows shaped like the prototype's own data, so the
side-by-side compares shipped components rather than a mock-up of them.

## Files

| File | What it shows |
| --- | --- |
| `desk-{populated,filtered,selection,loading,empty,grouped}-{1440,1100,768}.png` | Every state the brief enumerates, at the three widths. |
| `side-by-side-populated-{header,filter-bar,rows,full}-1440.png` | Implemented against the prototype, per region. |
| `side-by-side-{loading,empty}-full-1440.png` | The two remaining states against the prototype. |
| `keyboard-walk-1440.png` | Tab order reaching the row actions. |
| `measurements.json` | Computed geometry, filter-bar height, keyboard walk, time to interactive. |
| `desk-cold-load.har`, `network-gate-report.json`, `network-metrics.json` | The cold-load capture and `ops:network:gate` run over it. |

## Measured results

| Claim | Measured |
| --- | --- |
| `h1` 32/500 at `-0.02em` | `500 32px/32px -0.64px` |
| Primary action 40px, radius 9, ink | 40px, `9px`, `rgb(30,25,21)` |
| Filter-bar controls 38px | 38px |
| **Filter-bar height constant at 0 and 6 filters** | 52px and 52px — `constant: true` |
| Applied filters as a count on the trigger | `Filter · 6` |
| Sheet radius 10, white | `10px`, `rgb(255,255,255)` |
| Hairline between rows | `rgb(240,238,235)` = `#F0EEEB` |
| Checkbox visible without hover | `checkboxVisible: true` |
| **Row actions reachable by keyboard** | Tab order reaches `Select …` → `Rename …` → `Preview …` |
| Controls collapse below the prototype's threshold | visible at 1440, hidden at 1100 and 768 |
| Time to interactive < 1.5s | rows visible at **320ms** |
| `ops:network:gate` `required_failures = 0` | 10 pass, 0 warn, 0 fail — 38 requests, 3894 bytes, 0 duplicate requests, 0 listener churn |

## Performance Contract — scope limitation, declared

The brief scopes the measurement to "a cold load of `/desk` with a catalog of at
least 200 artifacts". `/desk` is behind auth and redirects to `/login` in a build
running on fixture credentials, so both the timing and the HAR were captured on
`/perf/desk-harness`, which loads the same route bundle and the same component
tree. What this PR changed is that tree; the catalog reads behind it are
untouched, and the gate confirms the view issues no writings, collections or
writing-collections requests of its own.

## Divergences from the prose — the prototype wins

Per `docs/design/migration-plan.md` §4. Each of these is a place where
`docs/design/views/desk.md` (and `layout.md` §3, which repeats it) and the render
disagree; the render is the authority, and the divergence is recorded here and in
the PR.

| # | Prose | Prototype | Shipped |
| --- | --- | --- | --- |
| 1 | Row height 60px | Two-line flex row padded `14px 26px` — 78px as rendered | prototype |
| 2 | Hairline `#EDEBE8` (`--line-soft`) | `#F0EEEB` (`--line-softer`) | prototype |
| 3 | Row grid `20px 1fr auto auto auto auto` with a **date column** | Flex row; the date sits inside the title block's second line, before the excerpt | prototype |
| 4 | Status as a pill at 20 % tint | 160px dropdown trigger with a 9px dashed ring in the status colour | prototype |
| 5 | Type badge = 12px icon on a tinted chip beside the title | The badge beside the title is the **sync state**; the type is a 160px trigger | prototype |
| 6 | Row actions 14px at 32px hit size, 38 % opacity | 26px buttons de-emphasised by colour (`--ink-5`), full ink on hover **and on focus** | prototype |
| 7 | Separate Type · Status · Workspace dropdowns + a view toggle | One **Filter** dropdown with a section per facet, plus Group by and Sort; no view toggle is rendered | prototype |
| 8 | Filter footer reads "N selected" | Footer reads the result count — "N artifacts" — next to "Clear all" | prototype |
| 9 | Group by: Date · Type · Status · Workspace | None · Workspace · Status · Type | prototype |
| 10 | No-results block: Lora 18 + 13px hint | Lora 20 + 14px hint | prototype for the type |
| 11 | Columns collapse at 1100 (workspace) and 900 (date) | The whole control cluster drops below 1240 | prototype |

Two more, in the other direction:

- **"Clear all" in the no-results block.** The prose requires the button; the
  prototype's empty block does not draw one. Behaviour the prose owns, so it
  ships — with the prototype's type. Recorded rather than silently dropped.
- **The sheet's shadow.** The prototype paints
  `0 1px 2px rgba(35,24,15,.05), 0 10px 30px rgba(35,24,15,.05)`; the repo has one
  elevated-surface token, `--shadow-float`, which every sheet uses. Kept the token
  rather than fragmenting it for one view. **Open question for the design owner:**
  should `--shadow-float` move to the prototype's value for every sheet?

## Open questions for the design owner

1. **`canceled` has no colour in the prototype.** It has six statuses, the repo
   has seven. It is drawn like `archived` (`--ink-5`) — both mean "out of
   circulation" — and flagged rather than invented. `lib/writings/status-color.ts`.
2. **Per-user type and status colours do not exist yet.** Requirement 8 asks for
   colours from user configuration; `UserSettings` carries only
   `disabledStatuses`, and adding a store is forbidden by Requirement 12. The
   prototype's palette is centralised in one module so the future setting
   overrides it there and nowhere else.
3. **`Import` is kept in the header.** The prototype draws only "New Artifact";
   Import is an existing repo capability with no other entry point, so removing it
   would delete a feature rather than restyle one.
