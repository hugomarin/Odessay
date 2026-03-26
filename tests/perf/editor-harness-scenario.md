# Editor Perf Harness Scenario

Canonical interaction sequence used by `scripts/capture-editor-trace.mjs`:

1. Open `/perf/editor-harness`.
2. Focus `.odessay-editor-content`.
3. Type sustained text bursts (continuous keydown/input workload).
4. Paste one large block (`insertFromPaste` path).
5. Execute repeated click + selection gestures.
6. Wait for deferred editor side effects to settle.

This scenario is intentionally deterministic so CI can regenerate comparable traces
against the budget in `workflow/perf-budgets.json`.
