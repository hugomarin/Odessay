# Editor Perf Harness Scenario

Canonical interaction sequence used by `scripts/capture-editor-trace.mjs`:

1. Open `/perf/editor-harness` and wait until the editor is fully interactive.
2. Warm-up phase (excluded from trace): focus editor, type short text, clear content.
3. Seed the harness with a deterministic writing of roughly 5k words before tracing starts.
4. Measured phase: trigger one paste into the seeded editor so the generic paste budget remains enforced.
5. Open integrated find with `Cmd/Ctrl+F`, type `alpha beta` (10 chars), and keep live highlight updates enabled.
6. Navigate forward through 5 matches with `Enter`.
7. Expand replace with `Cmd/Ctrl+H`, replace all matches with `omega beta`, confirm the exact replacement count, execute a short deterministic editor click sequence, and wait for deferred editor side effects to settle.

This scenario is intentionally deterministic so CI can regenerate comparable traces
against the budget in `workflow/perf-budgets.json`.
