# Fase 9 — ODE-372 closure report

## Gate result

**FAIL — technical evidence is being assembled, but the phase cannot be marked
closed from this branch yet.** The blocking evidence that is not available in a
headless source/test run is kept as `PENDING`; no product-owner acceptance is
claimed before those rows pass.

This report is the closure artifact for ODE-372. It deliberately distinguishes
automated source/unit evidence from proof that requires the exact packaged DMG:
`tauri dev` or an older DMG is not accepted as production evidence.

| Field | Value |
| --- | --- |
| Issue | ODE-372 |
| Branch | `codex/ode-372-document-catalog-dod` |
| Build version | `0.7.1` (`package.json` / `tauri.conf.json`); exact release build pending |
| Commits | `2e956bb8`, `dcd97712` (ODE-372 implementation/evidence commits) |
| Pull request | Pending until technical gates and evidence packaging complete |
| Artifact | [`dist/releases/ArtifactStudio-0.7.1-aarch64.dmg`](/Users/hugomarin/Documents/App/Odessay/dist/releases/ArtifactStudio-0.7.1-aarch64.dmg), generated 2026-08-27 10:25:12 -0600 from these commits; SHA-256 `583a2742d1d517f9d5ca3cc6874c87a7f91400653164bd870b1544963f116865` |
| Product owner | Acceptance pending; no acceptance comment has been emitted |

## Traceability matrix

Every row includes the issue, PR state, build version and artifact required for
the final review. `PASS` means the repository evidence is automatable and
covered by the named test/source asset. `PENDING` means the evidence is a
blocking DMG/manual or owner action and is not inferred from source coverage.

| ID | DoD criterion | Evidence / proof method | Trace (issue · PR · build · artifact) | Status |
| --- | --- | --- | --- | --- |
| B1.1 | `.md` materializado is local content authority | ADR; `tests/desktop-bundle/document-catalog.spec.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Vitest output | PASS |
| B1.2 | Manifest v2 is durable binding ledger without content/product metadata | `tests/contracts/document-catalog.test.ts`; `tests/services/workspace-reconciler.test.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B1.3 | SQLite is operational desktop catalog and durable sync queue | `tests/contracts/document-catalog.test.ts`; Rust catalog tests in `src-tauri/src/commands/index.rs` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Cargo/Vitest output | PASS |
| B1.4 | Supabase owns cloud metadata/existence, not local content | `tests/desktop-catalog-sync-service.test.ts`; catalog contract test | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B1.5 | IndexedDB is web adapter, not desktop catalog after retirement | `tests/migrations/desktop-compatibility-retirement.test.ts`; `tests/migrations/indexeddb-to-sqlite.test.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B1.6 | Desktop catalog is not user-partitioned; local visibility survives auth failure | catalog contract and desktop sync tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B2.1 | Managed/external BindingRoots are distinct; registration does not imply Workspace visibility | `tests/services/workspace-service.test.ts`; reconciler tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B2.2 | Manifest v2 stores root/scope/bindings and commits atomically before SQLite | reconciler, recovery and save-order tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B2.3 | Global reconciler mounts at `DesktopAppShell` lifetime | `components/navigation/desktop-app-shell.tsx`; bundle invariant test | ODE-372 · PR pending · 0.7.1 exact HEAD pending · source/Vitest output | PASS |
| B2.4 | Resolution priority is manifest/path → inode → unique local hash → unique cloud hash → mint | `tests/services/workspace-reconciler.test.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B2.5 | Rename/move/save and out-of-scope/unobservable roots preserve identity | reconciler and workspace service tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B2.6 | Outside-root open confirms and initially scopes only selected file | `tests/services/open-document-desktop.test.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B3.1 | ID/path opening converges to UUID before editor hydration | `tests/services/open-document-desktop.test.ts`; retry tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B3.2 | Desk, Workspace, Search, Recent, sidebar and Open Document share catalog/application ports | integration test; `tests/fase9-document-catalog-invariants.test.ts`; Search now uses `loadSearchWritings` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · source/Vitest output | PASS |
| B3.3 | Same file through different entries is UUID-stable and idempotent | opener and catalog contract tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B3.4 | cloud-only materializes before edit; listing/hydration alone does not materialize | opener tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B3.5 | Conflict/ambiguous/orphaned/NOT_FOUND outcomes never create drafts | opener and retry tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B4.1 | Desk and Workspace query the same catalog with presentation-only differences | catalog integration and contract tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B4.2 | Same UUID/state/metadata render in Desk and Workspace | `tests/desk-workspace-catalog-integration.test.tsx` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · integration output | PASS |
| B4.3 | Watcher discovery updates mounted views without visiting Workspace | integration and reconciler tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · integration output | PASS |
| B4.4 | Local/cloud/conflict/ambiguous/stale/rebuilding states have accessible copy | `tests/document-state.test.ts`; `tests/playwright/document-catalog.e2e.ts`; state badge source | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Vitest/Playwright output | PASS |
| B4.5 | Web explains the filesystem/desktop boundary | `WorkspaceDesktopRequired`; `/perf/workspace-boundary-harness`; Playwright boundary test | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Playwright output | PASS |
| B5.1 | Save order is `.md` atomic → manifest atomic → SQLite/enqueue → saved-local → background sync | `tests/services/document-service-factory.test.ts`; desktop sync tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B5.2 | Confirmed Markdown writes remain recoverable after downstream failure | document-service and desktop sync failure tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B5.3 | Canonical Markdown hash has Rust/TypeScript/manifest/cloud parity | `tests/content-hash.test.ts`; `tests/sync/content-hash-payload.test.ts`; Rust tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Cargo/Vitest output | PASS |
| B5.4 | Cloud hash/index and unique-candidate rebinding are validated | desktop sync and Rust catalog tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Cargo/Vitest output | PASS |
| B5.5 | Local absence detaches only local presence; cloud deletion is explicit | catalog contract and document-state tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B6.1 | SQLite v2 is additive, dual-write flagged and rollback-capable | migration and desktop sync tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B6.2 | All IndexedDB scopes are harvested/deduplicated and queue preserved | `tests/migrations/indexeddb-to-sqlite.test.ts` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B6.3 | Desktop IndexedDB remains read-only for compatibility release | migration/retirement tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B6.4 | Historical `.odyssey`/frontmatter/path-as-id/`writings_index` are isolated | compatibility retirement test | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B6.5 | Legacy stores are not removed while unharvested state can remain | migration interruption/idempotency tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · migration output | PASS |
| B7.1 | SQLite rebuild preserves local-only UUIDs without network | recovery, migration and reconciler tests; DMG restart proof still required for full acceptance | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output; DMG pending | PASS |
| B7.2 | Corrupt/unobservable watcher inputs become stale/retryable, not mass minting | reconciler/recovery tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B7.3 | Bulk scan/migration/hydration/watcher emit one logical update | integration, reconciler and migration tests | ODE-372 · PR pending · 0.7.1 exact HEAD pending · unit output | PASS |
| B7.4 | Structured events exclude content/tokens/full paths from remote telemetry | No automated structured-telemetry artifact exists in this branch; source/release observability review is required | ODE-372 · PR pending · 0.7.1 exact HEAD pending · telemetry evidence pending | PENDING |
| B7.5 | Startup, fan-out and catalog-query budgets pass on packaged release | Exact-current DMG trace, sanitized HAR/report/metrics and release validation | ODE-372 · PR pending · 0.7.1 exact HEAD pending · exact DMG/perf artifacts pending | PENDING |
| B8.1 | Every DoD bullet maps to automated/manual/owner evidence | This report plus executable `FASE9_CLOSURE_MATRIX` | ODE-372 · PR pending · 0.7.1 exact HEAD pending · closure report/Vitest output | PASS |
| B8.2 | DMG Finder rename/move preserves UUID without duplicates | Reproducible recording on exact DMG with Desk open | ODE-372 · PR pending · 0.7.1 exact HEAD pending · DMG recording pending | PENDING |
| B8.3 | DMG outside-root open confirmation yields same UUID/state in Desk/Workspace | Reproducible recording/screenshots on exact DMG | ODE-372 · PR pending · 0.7.1 exact HEAD pending · DMG screenshots/recording pending | PENDING |
| B8.4 | DMG offline open/save/restart preserves content/binding and later syncs | Reproducible offline/restart recording plus later sync evidence | ODE-372 · PR pending · 0.7.1 exact HEAD pending · DMG recording/HAR pending | PENDING |
| B8.5 | DMG cloud-only materializes before edit; conflict/hash ambiguity is visible | Reproducible recording on exact DMG | ODE-372 · PR pending · 0.7.1 exact HEAD pending · DMG recording pending | PENDING |
| B8.6 | Typecheck/lint/tests/Cargo/workflow/perf/network/delivery gates pass | Serial technical gates are green; exact-current perf/network outputs and delivery gate remain to be attached with the release artifact | ODE-372 · PR pending · 0.7.1 exact HEAD pending · exact gate outputs pending | PENDING |
| B8.7 | Product owner accepts complete outcome after blockers pass | Explicit Linear acceptance comment, not agent-inferred | ODE-372 · PR pending · 0.7.1 exact HEAD pending · Linear acceptance pending | PENDING |

## Validation commands

The final PR must replace this section’s pending markers with the exact
sanitized outputs and artifact paths from this branch:

| Command | Result / evidence |
| --- | --- |
| `npm run env:check --if-present` | PASS — `.env.local` check |
| `npm run ops:status:drift --if-present` | WARN mode — pre-existing missing `ODE-455`, `ODE-468` and stale `last_updated`; no workflow ledger changed on this branch |
| `npm run typecheck` | PASS |
| `npm run lint` | PASS with existing warnings in `editor-shell.tsx`, `image-presentation-viewer.tsx` and `sidebar.tsx` |
| `npm test -- --no-file-parallelism` | PASS — 217 files, 1,678 tests |
| `npm test` | FAIL in parallel — 9 existing isolation/race failures; the same suite passes serially. See Manual handoff / gate note below. |
| `cargo test --manifest-path src-tauri/Cargo.toml` | PASS — 65 passed, 2 ignored (keychain/benchmark requiring live app context) |
| `npm run test:desktop:draft-lifecycle` | PASS — 81 Vitest tests + 2 Playwright tests |
| `npx playwright test tests/playwright/document-catalog.e2e.ts` | PASS — 3/3 |
| `npm run ops:workflow:validate` | PASS — all workflow JSON/JSONL files valid |
| `npm run ops:network:gate` | PASS on historical `artifacts/perf/ode-373-network.har` (10/10, `required_failures: 0`); exact ODE-372 DMG HAR pending |
| `npm run ops:perf:gate` | PASS on historical editor production trace (14 pass, 1 optional skip); exact catalog/DMG trace pending |
| `npm run validate:desktop -- --dmg dist/releases/ArtifactStudio-0.7.1-aarch64.dmg` | PASS — exact-current DMG structure, CSP, version, embedded host and ad-hoc signature |
| `npm run ops:delivery:gate` | Pending final branch push/PR range; must run after this report commit |

The release script also created an unsigned updater archive because no
`TAURI_SIGNING_PRIVATE_KEY` was configured. The DMG itself was built and passed
the automated bundle validator; updater signing remains a distribution action.

No `workflow/status.json`, `workflow/built.jsonl` or
`workflow/review-history.jsonl` mutation belongs on this BUILD branch.

## Manual handoff required

The following remain blocking until a human with the authenticated packaged app
can attach evidence to the PR:

1. Finder rename/move while Desk is open, proving one UUID and one reactive
   update.
2. Outside-root Open Document confirmation, followed by Desk/Workspace parity.
3. Offline open/save/restart, then online convergence.
4. cloud-only materialization and conflict/ambiguous handling.
5. Exact-current DMG startup/TTI, interaction latency, waterfall and sanitized
   network/performance artifacts.
6. Review of structured remote telemetry fields (B7.4).
7. Product-owner acceptance after every blocking row is `PASS`.

### Parallel test gate note

The prescribed `npm test` invocation currently runs files in parallel. Existing
tests that create temporary Git branches and happy-dom integration fixtures race
under that mode, producing 9 failures; the same 217-file suite is green with
`--no-file-parallelism`. This is reported as a delivery risk rather than hidden
by changing the global Vitest configuration in ODE-372.
