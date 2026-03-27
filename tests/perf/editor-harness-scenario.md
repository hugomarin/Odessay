# Editor Perf Harness Scenario

Canonical interaction sequence used by `scripts/capture-editor-trace.mjs`:

1. Open `/perf/editor-harness` and wait until the editor is fully interactive.
2. Warm-up phase (excluded from trace): focus editor, type short text, clear content.
3. Measured phase: type short baseline text (keydown/input sample).
4. Paste one large block (`insertFromPaste` path).
5. Execute repeated click + one drag selection gesture.
6. Wait for deferred editor side effects to settle.

This scenario is intentionally deterministic so CI can regenerate comparable traces
against the budget in `workflow/perf-budgets.json`.
