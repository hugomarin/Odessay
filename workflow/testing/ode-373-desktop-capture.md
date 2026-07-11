# ODE-373 — Desktop capture checklist (human step)

The catalog cutover, integration tests and the automatable performance evidence
(reactive fan-out, local-first render) ship in the PR and run in CI. The items
below need the **running authenticated app** and, for Workspace, the **packaged
desktop build** — they cannot be produced headlessly in CI (Desk requires a
session; Workspace only exists in the Tauri runtime). Capture these on your
machine and attach them to PR #338 / ODE-373 before re-review.

## 1. Side-by-side Desk ↔ Workspace visual evidence (required)

Goal: show the **same document** with the **same UUID and the same state badge**
in both surfaces, sourced from the DocumentCatalog.

1. Build/run the desktop app using the shipped default configuration:
   ```bash
   npm run desktop:dev
   ```
   (or the signed DMG). The catalog is default-on in M4; setting
   `NEXT_PUBLIC_DESKTOP_CATALOG_DUAL_WRITE=false` is reserved for explicit rollback
   validation and must not be used for acceptance capture.
2. Add a BindingRoot/Workspace folder with at least one `.md` file and sign in so
   at least one document is `synced` and one is `local-only`.
3. Screenshot **Desk** showing the documents with their state badges.
4. Open **Workspace** for that root; screenshot the same documents.
5. Confirm each shared document shows the **same title, same UUID target on open,
   and the same state badge** in both. Put the two screenshots side by side.

## 2. Watcher discovery across views (required)

1. With Desk open, rename or add a `.md` file in the watched folder from Finder.
2. Confirm the change appears in **Desk without navigating to Workspace** (screen
   recording or before/after screenshots).

## 3. Performance trace + network waterfall (required)

Run against the authenticated app (web dev is fine for Desk; desktop for the full
Desk→Studio→Write flow):

```bash
# Terminal A
npm run dev            # or npm run desktop:dev for the desktop waterfall

# Terminal B — capture a HAR of the Desk → Studio → Write startup+navigation,
# then run the network gate (redact if the HAR carries tokens/private ids):
npm run ops:network:gate -- \
  --har artifacts/perf/ode-373-network.har \
  --report artifacts/perf/ode-373-network-report.json \
  --metrics artifacts/perf/ode-373-network-metrics.json --redact
```

Attach `ode-373-network-report.json` + `ode-373-network-metrics.json` and confirm
`required_failures: 0` (bodies excluded from list responses, one deduplicated
bootstrap, zero duplicate startup requests).

## What already ships in the PR (no action needed)

- `tests/desk-workspace-catalog-integration.test.tsx` — mounts the real Desk and
  Workspace consumers over a mocked catalog: membership + state from the catalog,
  same UUID/state in both, watcher-burst refresh, reactive fan-out = 1 reload,
  local-first render without cloud.
- `tests/document-state.test.ts` — single state derivation for every catalog state.
- `npm run typecheck`, `npm run lint`, `npm test`, `npm run ops:delivery:gate`.
