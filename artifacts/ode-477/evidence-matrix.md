# ODE-477 — vocabulary contract evidence matrix

Package: ODE-472–477, PR [#418](https://github.com/hugomarin/Odessay/pull/418).
Produced 2026-09-04 by `claude-sonnet-5` in a sandboxed CLI environment — no
authenticated browser session and no Tauri release build were reachable (see
"Not produced" below, and the same disclosure repeated in ODE-474/475/476's
Context Reports). This file states plainly what is proven and what is not;
it does not round up.

## Owner contract, claim by claim

| # | Claim | Evidence |
|---|---|---|
| 1 | No vocabulary operation writes frontmatter or touches `.md` content | `tests/vocabulary/no-frontmatter-writes.test.ts` (web + desktop adapters, hash-identical) + `tests/vocabulary/end-to-end-contract.test.ts`'s first case (full create→rename→recolor→hide→delete cycle, hash-identical, frontmatter key set unchanged) |
| 2 | The change survives a full reload/rehydration, not just the session that made it | **Not produced.** Requires a real browser reload against a signed-in session (web) and a release-build quit/reopen (desktop) — see "Not produced" |
| 3 | Web/desktop parity matrix per operation | **Not produced live.** Static parity argued instead: `lib/services/web/web-settings-service.ts` and `lib/services/desktop/desktop-settings-service.ts` both implement the same `SettingsService` contract (`lib/services/contracts/settings-service.ts`) and are exercised by matching test suites (`tests/vocabulary/server.test.ts` for web, `tests/services/desktop-vocabulary-reconciler.test.ts` + the desktop half of `no-frontmatter-writes.test.ts` for desktop) against the same input/output shapes. No live side-by-side session run. |
| 4 | Zero local catalog versions left | `artifacts/ode-477/requirement-4-grep.md` — clean |
| 5 | Hide vs. delete: hide leaves carrying artifacts untouched, delete rewrites exactly the usage count | `tests/vocabulary/end-to-end-contract.test.ts`'s second case: `getVocabularyUsage` and `deleteVocabularyItem`'s rewrite count independently agree on 3; hiding never calls the delete rpc |
| 6 | An unrecognized value survives open/edit/save | `tests/vocabulary/normalize-preserves-unknown.test.ts` (ODE-474) + restated in `end-to-end-contract.test.ts`'s third case as part of the same narrative |
| 7 | Acceptance screenshots per surface at 1440/1100/768, plus an untouched route before/after | **Not produced.** See "Not produced" |
| 8 | Feature doc is an exact description of what shipped, with the three owner decisions dated | Done — see `workflow/context/features/odessay-artifact-vocabulary.md`'s "Decisiones del dueño" section added by this issue |
| 9 | Phase-10 DoD §6/§9/§10 traceable to this block | Done — see `workflow/define/dod-fase-10.md`, vocabulary block row added by this issue |
| 10 | Any regression found is fixed in-issue or filed | ODE-476 already found and fixed one (vocabulary items resolved by key instead of id, breaking Save/Delete for base items) — no new regression found while producing this matrix |

## Not produced, and why

- **Persistence through restart/rehydration (claim 2)** and **live web/desktop
  parity (claim 3)**: this environment's Browser pane redirects every route,
  including the auth-free `/evidence/*` pages, to `/login` — confirmed again
  in this session (screenshot: sign-in gate, "Continue without an account"
  produces no navigation, matching the desktop-only no-op already documented
  in ODE-474). Creating a real test account would write to the single
  production Supabase project (`odessay-staging` — there is no separate
  staging environment). No Tauri runtime is available to build or run a
  release desktop binary in this environment either.
- **Screenshots (claim 7)**: same auth gap — Desk, Studio, the preview
  overlay and the public writing list all need real signed-in data to show
  a custom vocabulary item, which requires the session above.
- **Performance Contract** (interaction latency, TTI, payload weight,
  waterfall shape, reactive fan-out) and **`ops:network:gate` HAR captures**:
  need the same live session plus `capture-editor-trace.mjs`, which drives a
  real browser against a real backend. Not run.

## What a human needs to do before this issue can honestly close

1. Sign in on web, create a custom type and status, and walk claim 2
   (reload) and claim 7 (screenshots at 1440/1100/768 across Desk, Studio,
   Workspace, the preview overlay, Collections, and one public profile) —
   `docs/design/views/desk.md`/`workspace.md`/`studio.md` checklists.
2. Run a signed `tauri build` release, repeat the same vocabulary edits, quit
   and reopen the app, confirm they held — claim 2's desktop half, and fills
   claim 3's parity row for `updateVocabularyItem`/hide/delete against the
   already-proven web behavior.
3. Run `node scripts/capture-editor-trace.mjs` + `check-performance-gate.mjs`
   with `OPS_PERF_TRACE_PATH` set, and `ops:network:gate --redact` against a
   captured startup HAR, per the Performance Contract above.
4. Accept (or reject, with findings) this matrix — the issue's own
   Definition of Done requires the owner's explicit acceptance, not just
   green checks.

## Automated validation (this session)

```
npm run typecheck                                                            # clean
npm run lint                                                                  # clean (pre-existing warnings only)
npx vitest run                                                                 # 1798/1798 passing
cargo test --manifest-path src-tauri/Cargo.toml                                # 65 passed, 2 ignored (require a running Tauri app — verify via the DMG)
node scripts/validate-workflow-json.mjs                                        # OK
GITHUB_BASE_REF=origin/codex/ode-472-artifact-vocabulary-durable TRACEABILITY_ISSUE_IDS=ODE-477 npm run ops:delivery:gate   # OK
```
