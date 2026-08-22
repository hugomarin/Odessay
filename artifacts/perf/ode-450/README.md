# ODE-450 desktop sync baseline

Capture recipe:

1. Run `npm run desktop:release` and install the generated DMG.
2. Open DevTools in the packaged app and preserve console output.
3. Edit a local writing several times, pause after each edit, then wait until the SQLite queue is idle.
4. Export only JSON objects from `[sync:metrics]` lines, one object per line, to `desktop-sync-metrics.jsonl`. Do not export the complete console log.
5. Run `node scripts/report-sync-metrics.mjs desktop-sync-metrics.jsonl desktop-sync-report.json`.

The reporter rejects unknown keys. Desktop (`desktop/sqlite`) and web (`web/indexeddb`) are always aggregated as separate series. Empty flushes and idle ticks are excluded from sync/write counts; superseded web mutations are recorded but not counted as cloud writes.
