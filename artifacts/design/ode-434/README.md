# ODE-434 — evidence

Captured from the built app (`ODESSAY_PERF_HARNESS_ENABLED=true`) against
`docs/design/reference/` served locally.

```bash
npm run build
ODESSAY_PERF_HARNESS_ENABLED=true npm run start -- --hostname 127.0.0.1 --port 4011 &
npx serve -l 4321 docs/design/reference &
node scripts/capture-preview-overlay-evidence.mjs \
  --app http://127.0.0.1:4011 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
```

`/perf/preview-overlay-harness` seeds ten artifacts into the local store and opens
the **real** `WritingPreviewModal` over them, so the side-by-side compares the
shipped overlay against the prototype and the ← → walk exercises the real
navigation and hydration path.

## Files

| File | What it shows |
| --- | --- |
| `preview-overlay-{1440,1100,768}.png` | The overlay at the three widths. |
| `side-by-side-{chrome,sheet-header,properties,full}-1440.png` | Implemented against the prototype, per region the fidelity gate names. |
| `sharing-card-no-link-1440.png` | The sharing card with no link generated. |
| `keyboard-walk-end-1440.png` | The last artifact of the ← → walk, with `→` disabled. |
| `preview-walk.har`, `network-gate-report.json`, `network-metrics.json` | The ten-artifact walk and `ops:network:gate` over it. |
| `measurements.json` | Computed geometry and the keyboard walk. |

## Measured results

| Claim | Measured |
| --- | --- |
| Chrome row 48px | 48px |
| Counter in the chrome | `1 of 10` |
| Properties column | **308px** (the prototype's, not the prose's 276) |
| Title in Lora 500/28 | `500 28px/35px -0.42px Lora` |
| Path in mono, truncated | `11px ui-monospace ellipsis`, full value in `title` |
| Sharing card radius 10, bordered | `10px`, 1px border |
| Rule between the card's two blocks | 1px tall, 256px wide |
| **← → walk over ten artifacts** | `1 of 10` … `10 of 10`, in order |
| **Range ends hold** | `←` at the first leaves `1 of 10`; `→` at the last leaves `10 of 10`; `next` is `disabled` |
| `ops:network:gate` | **`required_failures: 0`** — 9 pass, 1 informational fail (below) |

### Payload per artifact

The walk issues **one request per artifact** — the preview link lookup, 78 bytes
uncompressed each. The artifact's **body carries no network payload**: it is read
locally through the document service, which is why the ten-artifact walk moves
780 bytes in total rather than ten document bodies.

`startup.writings_requests = 10` is reported as `fail` against a budget of ≤2.
That budget is an **informational guard** (`required: false`) about *startup*
fan-out — "second startup should be manifest plus at most one body batch" — and
this capture is a deliberate ten-artifact navigation, so ten lookups is the
intended shape, not fan-out. `duplicate_identical_requests` is 0, which is the
metric that would catch a real regression here. `required_failures` is 0, which
is what the brief asks for.

**Worth flagging for the sharing owner:** the preview-link lookup fires once per
artifact as you walk. Changing that mechanism is explicitly out of this issue's
scope ("Fuera de alcance: cambiar el mecanismo de publicación web o de preview
links"), so it is recorded rather than changed.

**Failure mode 3, captured live.** In `side-by-side-full-1440.png` the sharing
card shows `Invalid writing id.` under an enabled "Generate link" — the fixture
artifacts have no cloud record, so the rotate call fails. That is the failure
mode the brief specifies: the error is visible in the card, the button returns to
enabled, and no half-made link is left in local state.

## Divergences from the prose — the prototype wins

Per `docs/design/migration-plan.md` §4.

| # | `docs/design/views/desk.md` §Preview overlay | Prototype | Shipped |
| --- | --- | --- | --- |
| 1 | `inset: 0` full-viewport overlay | A centred dialog, `min(1160px,100%) × min(840px,100%)`, radius 14 on the canvas colour with `0 8px 8px` padding | prototype |
| 2 | Scrim `rgba(35,24,15,.26)` | `rgba(35,24,15,.22)` with `blur(14px) saturate(115%)` | prototype |
| 3 | Right column 276px | **308px** | prototype |
| 4 | Order: Artifact type, Status, Workspace/path, metrics, sharing | Status, Artifact type, Workspace, **Collections**, Sharing | prototype |
| 5 | Workspace **and path** in the right column, mono 12, truncated from the left | Workspace is a field button; the **path** lives in the left sheet's header in mono 11, truncated from the right | prototype |
| 6 | Metrics (words · characters · reading time) in the right column | `N words · date` in the left sheet's header; no character count, no reading time | prototype |
| 7 | Chrome action reads "Open full artifact" | "Open full writing" | prototype (vocabulary is ODE-439's sweep) |

One in the other direction:

- **The title stays editable.** The prototype draws a static `h2`; the repo lets
  you rename from the preview, and `onTitleChange` is wired from the Desk. The
  painted type is the prototype's — Lora 500/28 at `-0.015em` — and the input is
  transparent and borderless, so the capability survives without changing the
  render. Recorded rather than silently dropped.

## Kept beyond the prototype's inventory

The prototype's properties column ends at Sharing. **Export**, **Metadata** and
**Annotations** are existing capabilities with no other entry point from the Desk,
so they are kept, styled to match, and placed after the five the prototype
defines. Removing them would delete features rather than restyle them.
