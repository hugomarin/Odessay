# Editor Performance Baseline (ODE-49)

## Baseline source

- Trace file: `/Users/hugomarin/Downloads/Trace-20260324T200043.json.gz`
- Generated at: `2026-03-25`
- Analyzer: `node scripts/analyze-editor-trace.mjs`
- Scope: editor interaction path (`keydown`, `input`, `paste`, `click`), interaction latency, long tasks.

## Measurement contract

This baseline defines the canonical metrics for editor performance decisions.

- `EventDispatch` (handler cost): `keydown`, `input`, `paste`, `click`.
- `EventTiming` (interaction latency): `keydown`, `input`, `click`.
- Interaction latency aggregate:
  - `editor_inputs` (all tracked editor input events).
  - `with_interaction_id` (subset with `interactionId > 0`).
- Long tasks: `RunTask >= 50ms`.

`paste` does not emit `EventTiming` in this trace, so baseline and budget enforce `paste` via `EventDispatch`.

## Baseline metrics

### EventDispatch (ms)

| Metric | Count | p95 | Max |
| --- | ---: | ---: | ---: |
| keydown | 20 | 19.56 | 24.38 |
| input | 13 | 13.57 | 13.57 |
| paste | 1 | 112.81 | 112.81 |
| click | 42 | 61.58 | 64.26 |

### EventTiming (ms)

| Metric | Count | p95 | Max |
| --- | ---: | ---: | ---: |
| keydown | 20 | 60.40 | 61.08 |
| input | 13 | 45.91 | 45.91 |
| click | 42 | 144.35 | 159.85 |

### Interaction latency (ms)

| Metric | Count | p95 | Max |
| --- | ---: | ---: | ---: |
| editor_inputs | 75 | 128.81 | 159.85 |
| with_interaction_id | 62 | 128.81 | 159.85 |

### Long tasks (RunTask >= 50ms)

| Metric | Value |
| --- | ---: |
| count | 8 |
| p95 | 362.48 |
| max | 362.48 |

## Approval and rejection criteria

The operational criteria are versioned in `workflow/perf-budgets.json`.

- Pass: metric value is `<= warn_lte`.
- Warn: metric value is `> warn_lte` and `<= fail_lte`.
- Fail: metric value is `> fail_lte`.

A trace is approved only when all required metrics are `pass` or `warn` and no required metric is `fail`.
A trace is rejected when any required metric is `fail` or any required metric is missing.

## How to regenerate baseline

1. Capture a fresh editor trace using the same interaction scenario (continuous typing, large paste, click/selection).
2. Run the analyzer:

```bash
node scripts/analyze-editor-trace.mjs /absolute/path/to/trace.json.gz > /tmp/editor-trace-metrics.json
```

3. Compare `/tmp/editor-trace-metrics.json` against `workflow/perf-budgets.json`.
4. If the scenario changed intentionally, document the reason and update both baseline and budget in the same issue.

## Automated gate pipeline (ODE-52)

### Local

1. Start the app:

```bash
npm run dev -- --hostname 127.0.0.1 --port 4010
```

2. In a separate terminal, capture a trace from the editor harness route:

```bash
npm run ops:perf:capture -- --base-url http://127.0.0.1:4010 --output artifacts/perf/editor-local-trace.json.gz
```

3. Run the performance gate directly or through the delivery gate:

```bash
npm run ops:perf:gate -- --trace artifacts/perf/editor-local-trace.json.gz
OPS_PERF_TRACE_PATH=artifacts/perf/editor-local-trace.json.gz npm run ops:delivery:gate
```

### CI

`Traceability Gates` now executes:

1. `npx playwright install --with-deps chromium`
2. `npm run build`
3. `npm run start -- --hostname 127.0.0.1 --port 4010` with `ODESSAY_PERF_HARNESS_ENABLED=true`
4. `npm run ops:perf:capture` against `/perf/editor-harness`
5. `npm run ops:delivery:gate` with `OPS_PERF_TRACE_PATH`

Generated artifacts are uploaded in every run:

- `artifacts/perf/editor-ci-trace.json.gz`
- `artifacts/perf/editor-ci-metrics.json`
- `artifacts/perf/editor-ci-report.json`
