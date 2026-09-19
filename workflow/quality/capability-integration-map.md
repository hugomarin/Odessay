# Capability Integration Map

Canonical inventory of Odessay's integration-level capabilities, their real critical chains, and their **actual** test coverage — audited by reading test bodies, not inferring from filenames.

## Why this exists

Odessay has ~2000 unit tests. It still ships bugs at the seams between individually-tested pieces — a component, a service and a persistence layer can each be perfectly tested in isolation while the product breaks the moment they run together for real. This map tracks a third axis that unit-test count doesn't measure:

```text
Code coverage        = what code executes during tests
Contract coverage     = which important boundaries are protected
Capability coverage   = which user/system outcomes are proven across their critical chain
```

This document tracks the third. A capability with many unit tests but no integration proof is still only **partially** covered.

**Relationship to other canonical docs (no duplication — read there first):**
- `workflow/testing/critical-capabilities-testing.md` — canonical owner of the test-level taxonomy (Unit/Contract/Integration/E2E/Performance), the "test at the lowest-cost boundary" principle, and when Playwright is/isn't the right tool. This map does not restate those definitions.
- `architecture/boundaries.yml` + `tests/architecture/*` — Architecture Contracts (how pieces are *allowed* to relate). This map is the complementary layer: Capability Integration Contracts (what those pieces must *accomplish together*). Architecture tests catch "built the wrong way"; this map catches "every piece looks correct, but the product no longer works."

## Coverage status (assign exactly one per scenario)

```text
NONE                No meaningful automated or repeatable evidence exists.
UNIT_ONLY           Individual pieces are tested, but the integration is not.
CONTRACT            The primary boundary invariant is protected (often with the real
                    collaborator faked on at least one side).
PARTIAL_INTEGRATION A meaningful section of the critical chain is tested with real
                    collaborators; another section is mocked/faked internally.
INTEGRATION         The critical chain is exercised with real collaborators
                    sufficiently to prove the capability (E2E via Playwright counts
                    here when it drives the real app, not a packaged bundle).
RUNTIME             The integration also has evidence in the real Tauri runtime.
RELEASE             Validated as part of the distributed artifact/release process.
```

Coverage status is independent of test count — a scenario with five thorough unit tests and zero cross-boundary proof is still `UNIT_ONLY`.

## Priority model

```text
CRITICAL   Product/data integrity or common high-impact behavior.
HIGH       Important user-facing capability with meaningful integration risk.
NORMAL     Useful coverage but lower expected loss/risk.
```

This first pass follows the spec's own v1 suite plus scenarios this audit found sitting at `NONE`/`UNIT_ONLY` with a real data-integrity, security, or silent-failure risk (flagged `(upgraded)` below). Priority will need revisiting as work proceeds — it is not meant to be precise on the first pass, only directionally right.

---

# A. Document Lifecycle

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| DOC-01 | Create new document | Editor → identity → draft/session owner | PARTIAL_INTEGRATION | HIGH | `lib/editor/persistence-coordinator.ts` isBodyBlank guard; `tests/editor-persistence-coordinator.test.ts`; `tests/playwright/write-blank-lifecycle.e2e.ts` | Real coordinator runs E2E in-browser, but `createDesktopDraft` is a page-level fake counter — no real filesystem/catalog touched, so "no accidental durable file" is proven by call-count, not disk state. |
| DOC-02 | Materialize first content | first input → createDesktopDraft → DocumentService → filesystem → binding → catalog | PARTIAL_INTEGRATION | CRITICAL | `lib/services/document-service-factory.ts`; `tests/services/document-service-factory.test.ts`; `tests/playwright/write-new-first-paste.e2e.ts` | Ordering (save→manifest→catalog dual-write, exactly once) proven with every real collaborator mocked; E2E proves the same via a fake `createDesktopDraft`. No test runs real fs write + real SQLite commit together. |
| DOC-03 | Save document | Editor → PersistenceCoordinator → DocumentService → filesystem → catalog → sync queue | PARTIAL_INTEGRATION | CRITICAL | `tests/document-service.test.ts` (web, real fake-indexeddb store); `tests/services/document-service-factory.test.ts` (desktop, all collaborators mocked) | Web path is genuine integration against a real local store. Desktop path — the one with filesystem+manifest+catalog in the chain — only proves ordering with every real collaborator faked. |
| DOC-04 | Sequential saves | latest snapshot must win | CONTRACT | CRITICAL | `tests/editor-persistence-coordinator.test.ts` | Rigorously proven with deferred promises simulating real races, but `documentService.saveWriting` is a full fake — no real DocumentService/filesystem race exercised. |
| DOC-05 | Save while switching tabs | Editor A → pending persistence → tab switch → Editor B → return A | CONTRACT | CRITICAL | `tests/editor-persistence-coordinator.test.ts`; `tests/editor-session-store.test.ts` / `tests/editor-tabs.test.ts` | Well proven at coordinator-logic level with fakes; tab bookkeeping is separately unit-tested as pure state transitions with no I/O underneath. |
| DOC-06 | Close and reopen | save → close → catalog → binding/path → filesystem → hydrate | PARTIAL_INTEGRATION | CRITICAL | `tests/document-service.test.ts` (web, real round trip); `tests/services/document-service-factory.test.ts` (desktop, catalog+filesystem mocked) | Web path genuinely round-trips through a real store; desktop close/reopen (the chain the spec actually names) is contract-only. |
| DOC-07 | Rename document | UUID → DocumentService → catalog → filesystem → binding | PARTIAL_INTEGRATION | HIGH | `tests/filesystem-document-service.test.ts` (in-memory Map fake); `src-tauri/src/commands/workspace.rs` rename/inode tests (real fs+tempdir) | Rust layer genuinely proves identity survives rename on disk; the TS wrapper the app actually calls is Map/mock-tested only — never proven together. |
| DOC-08 | Move document between workspaces | UUID → catalog → filesystem move → workspace index → binding → sync/reconciliation | PARTIAL_INTEGRATION | HIGH | `lib/services/document-service-factory.ts` `relocateDesktopWriting`; `tests/services/document-service-factory.test.ts` ("ODE-402", all mocked) | Thoroughly contract-tested in TS; no Rust or TS test moves a file between two distinct real registered BindingRoots — weakest-evidenced scenario in the Document Lifecycle group. Same gap as WS-02/WATCH-04. |
| DOC-09 | Import document | file → parser → identity → binding → catalog → document model | **NONE** (desktop wiring) / UNIT_ONLY (parsing) | HIGH *(upgraded)* | `tests/import-writing.test.ts` (pure parser unit tests); `lib/services/document-service-factory.ts` `importDesktopWritingFile` — **zero test references anywhere** | The parser is tested in isolation; the actual desktop file→identity→binding→catalog wiring has no test at all. |
| DOC-10 | Archive/delete document | identity → canonical owner → storage/catalog → projections | PARTIAL_INTEGRATION | HIGH | `tests/services/document-service-factory.test.ts` (mocked); `tests/document-service.test.ts` (web, real localDB); `src-tauri/src/commands/index.rs` real-SQLite delete/restore/purge tests | Rust layer has strong real-SQLite proof; TS desktop orchestration and real filesystem trash-move never exercised together with real collaborators. |

# H. Identity, Catalog & Filesystem

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| SYS-01 | UUID resolves to correct document | UUID → DocumentCatalog → binding → canonical document | PARTIAL_INTEGRATION | CRITICAL | `tests/services/document-open.test.ts`; `tests/services/document-service-factory.test.ts`; `src-tauri` index.rs collision test (real SQLite) | Pure-logic contract coverage plus one genuine real-SQLite collision test in Rust; no full-stack proof. |
| SYS-02 | UUID resolves to canonical path (UUID ≠ path) | — | CONTRACT | CRITICAL | `tests/services/document-service-factory.test.ts` "filesystem boundary contract" — AST-walks source for every filesystem-delegating method, then runtime-asserts the raw UUID is never passed as identifier | Most rigorously guarded invariant in the whole audit (source-level + runtime), but catalog/filesystem underneath remain mocked — CONTRACT, not INTEGRATION. Flagged in the spec as the critical regression contract; currently well protected, keep watched. |
| SYS-03 | Binding survives rename | — | PARTIAL_INTEGRATION | HIGH | `src-tauri/src/commands/workspace.rs` (real fs); `tests/services/workspace-reconciler.test.ts` (fakes) | Real disk-level proof in Rust; the TS `SqliteDocumentCatalog` path the app calls in production is mock-only. |
| SYS-04 | Binding survives move | — | PARTIAL_INTEGRATION | HIGH | Same Rust rename tests as SYS-03; `tests/services/document-service-factory.test.ts` `relocateDesktopWriting` (mocked) | Weaker than SYS-03 — no test (Rust or TS) covers a move across two distinct registered roots, only same-root rename-as-move. |
| SYS-05 | Catalog/filesystem consistency | — | PARTIAL_INTEGRATION | CRITICAL | `src-tauri` index.rs dual-write/reconcile tests (real SQLite); `tests/contracts/document-catalog.test.ts` (mocked cross-adapter conformance) | Real-SQLite consistency rules are Rust-tested; the TS wrapper the app calls through Tauri IPC is validated only against mocks. |
| SYS-06 | Missing binding behavior (never guess a path) | — | CONTRACT | HIGH | `tests/services/open-document-desktop.test.ts`; `tests/services/document-open.test.ts` | Repeatedly and explicitly proven at the pure-logic/contract level with fake ports; no real catalog/filesystem exercised. |
| SYS-07 | Ambiguous candidate behavior | — | CONTRACT | HIGH | `tests/services/workspace-reconciler.test.ts`; `tests/services/document-open.test.ts` | Well-covered "never auto-choose" invariant, entirely with fakes; no equivalent test in the Rust layer (logic lives only in TS). |
| SYS-08 | Reconciliation | — | PARTIAL_INTEGRATION | HIGH | `tests/services/workspace-reconciler.test.ts` (orchestrator, scanRoot/commit faked); `src-tauri` index.rs convergence/idempotency tests (real SQLite, some across simulated restarts) | Real-SQLite convergence rules strongly proven in Rust; the TS reconciler driving real scanRoot/commit in production is never tested with real dependencies. |

**Structural finding for this group:** every TS-side test that touches the desktop stack mocks the Tauri IPC boundary wholesale, while `src-tauri/src/commands/index.rs` (35 tests) and `workspace.rs` (28 tests) run real SQLite/real filesystem tests for the same logic on the Rust side. Each side is well-tested against a *fake of the other* — the seam itself (TS → real Tauri IPC → real Rust/SQLite/fs) is never exercised together anywhere in the automated suite. This is consistent with the project's known constraint that Tauri IPC isn't measurable client-side (no CDP, no Resource Timing, can't intercept `invoke`) but means the actual production path has no automated proof — only manual DMG evidence, per `tests/fase9-document-catalog-invariants.test.ts`'s own closure matrix (which self-reports several rows as `PENDING`/manual and should not be read as independent automated evidence for any scenario above).

---

# B. Export

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| EXP-01 | Export Markdown | UUID → catalog → content/path → exporter → artifact | UNIT_ONLY | HIGH | `tests/export.test.ts` (real serializer); `tests/desk/desk-markdown-actions.test.ts` | Real serializer and filename-builder each tested with real content, but nothing threads UUID→lookup→serialize→download as one path. |
| EXP-02 | Export DOCX | UUID → catalog → content → DOCX serializer → binary artifact → filesystem | PARTIAL_INTEGRATION | HIGH | `tests/export.test.ts` (real `docx` lib + JSZip content assertions); `tests/filesystem-document-service.test.ts` (real markdown→real DOCX bytes, Tauri IPC faked) | Real binary generation with real content verification exists for the serializer and the desktop chain; the web API route test mocks the renderer itself, so web-side content fidelity is unproven, and nothing writes real bytes to a real OS file. |
| EXP-03 | Export PDF | document → render/serializer → PDF artifact → filesystem | PARTIAL_INTEGRATION | HIGH | `tests/export.test.ts` (real react-pdf buffer, `%PDF` magic bytes) | Same serializer-stage pattern as DOCX, but **no desktop-chain test exists for PDF at all** (`filesystem-document-service.test.ts` only exercises `"docx"`) — PDF's full desktop path is unverified. |
| EXP-04 | Export identity resolution (UUID never used as path) | writing UUID → DocumentCatalog.getById → canonicalPath → filesystem adapter | CONTRACT | CRITICAL | `tests/services/document-service-factory.test.ts` — AST scan + runtime assertion | Genuinely strong, real protection matching the spec's critical regression contract. Currently well protected, keep watched. |
| EXP-05 | Export failure behavior (never report success without an artifact) | — | **NONE** | CRITICAL *(upgraded)* | none found — `grep` for `exportBinary`/`exportWritingDocument`/`saveBinaryArtifact` across `tests/` returns zero hits | `lib/utils/download.ts` / `lib/services/desktop/export-delivery.ts` (dialog cancel, `tauriWriteBinaryFile` throwing) have zero coverage. The analogous invariant for rename has an explicit regression test; export doesn't. |

# F. AI Capabilities

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| AI-01 | Suggest document title | content/context → context builder → AI service → provider boundary → normalized suggestions → consumer | CONTRACT (server) / **NONE (client gate)** | CRITICAL *(upgraded — known broken)* | `tests/api/title-suggestions-route.test.ts` (real, provider faked); `lib/services/web-ai-service.ts:20-36` `checkWritingLifecycleForRemoteAI` — **zero test references** | **Root cause found by reading the code:** the client hard-blocks the request with `INVALID_INPUT` whenever the local writing's lifecycle is `local-only`/`syncing` — exactly the state of a freshly created or just-edited local-first draft, i.e. exactly when a user is most likely to want a title. This untested gate is the actual reason the feature is "currently broken" per the spec. The identical pattern recurs in `lib/corrections/persistence.ts:90`, suggesting a systemic, unverified chokepoint rather than a one-off. |
| AI-02 | Apply suggested title | suggestion → canonical rename owner → metadata/filesystem/catalog | PARTIAL_INTEGRATION | HIGH | `components/editor/modals/rename-writing-modal.tsx` (reuses manual-rename `onConfirm`); `tests/filesystem-document-service.test.ts` (real file move + collision suffixing) | Equivalence with manual rename is structurally guaranteed by the UI, and rename itself is solidly integration-tested — but `tests/rename-writing-modal.test.tsx` mocks the AI service and never exercises Suggest→Use→Save as one path. |
| AI-03 | Title suggestion error handling | — | **NONE (client)** / partial (server) | HIGH | Server: `tests/api/title-suggestions-route.test.ts`. Client: none. | The modal's catch block looks correct by inspection but nothing clicks Suggest and asserts error display, retry, or that the current title survives a failure. |
| AI-04 | Generate corrections | document → correction engine → proposals | INTEGRATION | NORMAL | `tests/api/publication-review-route.test.ts` (real prompt building, real token-boundary matching, real learned-word filtering, provider faked) | Strongest AI scenario in the audit — comprehensive error classification and real correction-validation logic against realistic fake provider payloads. |
| AI-05 | Apply correction | proposal → document mutation → persistence | PARTIAL_INTEGRATION | HIGH | `tests/publication-suggestion-engine.test.ts` (real markdown mutation); `tests/ai-correction-decorations.test.ts` (real ProseMirror schema/range mapping) | The two real collaborating pieces are each tested with real objects, but `handleAcceptCorrection` in `editor-shell.tsx` — the actual live-editor-transaction + persistence wiring — has no test at all. |
| AI-06 | Reject correction | — | UNIT_ONLY | NORMAL | `tests/corrections-admission.test.ts` | Only fingerprint-filtering logic is tested; no test asserts document content is unchanged in a real editor after rejection. |
| AI-07 | Correction persistence/reopen | — | CONTRACT | NORMAL | `tests/lib/corrections/persistence-lifecycle.test.ts`; `tests/api/corrections-persist.test.ts`; `tests/correction-block-invalidation.test.ts` | Reconciliation/staleness algorithm is real and well-tested, but `localDB`/`webAIService`/Supabase are fully mocked throughout — no real IndexedDB or Postgres round-trip anywhere in this chain. |

---

# C. Editor Session & State

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| STATE-01 | Text survives tab switch | A edited → B → A | INTEGRATION | CRITICAL | `tests/editor-shell-tab-switch-persistence.test.tsx` | Real EditorShell + real session store; only TipTap/DocumentService mocked (external boundaries). |
| STATE-02 | Text survives close/reopen | edit → save → close → reopen | INTEGRATION | HIGH | `tests/playwright/fase4-closure.e2e.ts` | Real browser types, reloads, asserts survival — genuine E2E against the real (unpackaged) app. |
| STATE-03 | Per-document viewport isolation | formalizes the known scroll-position bug | INTEGRATION *(indirect)* | CRITICAL | `tests/playwright/editor-tab-scroll-restore.e2e.ts` | Would fail under the classic shared-`EditorShell.viewState` bug, but never independently asserts a *sibling* tab's own scroll stays at 0/clean — the check is indirect, not a direct two-document isolation assertion. |
| STATE-04 | Restore document viewport | A@80% → B → A | INTEGRATION | HIGH | same file as STATE-03 | This is the literal scenario the spec describes; real editor, real store, real browser. |
| STATE-05 | New document starts with clean view state | — | **NONE** | CRITICAL | none found | `createEditorSessionTab` defaults `view_state: null` by code shape, but no test asserts a new tab stays clean while a sibling carries scroll/cursor state. |
| STATE-06 | Per-document cursor/selection isolation | — | UNIT_ONLY | HIGH *(upgraded)* | `tests/editor-session-store.test.ts` | Only a single tab is exercised — no second tab exists in the test, so cross-document leakage is never checked. Same bug class as the scroll-position issue this map is modeled on, but unlike scroll it has no E2E coverage at all. |
| STATE-07 | Restore cursor/selection | — | **NONE** | HIGH *(upgraded)* | none found (restore code is real, in `editor-shell.tsx` ~L2512-2520) | The restore code path exists but has zero test driving an actual switch-away/switch-back and checking the caret lands back correctly. |
| STATE-08 | Hydration never overwrites newer local edits | local edit ↔ async hydration | INTEGRATION | HIGH | `tests/editor-empty-draft-persistence.test.tsx` ("ODE-464"); `tests/editor-hydration-generation.test.ts`; `tests/editor-hydration-coordinator.test.ts` | Real EditorShell forces stale async continuations to resolve *after* switching tabs and asserts none of it touches the new tab — strongest-covered scenario in this whole cluster. |
| STATE-09 | Rapid tab switching (races) | A→B→C→A | PARTIAL_INTEGRATION | NORMAL | same files as STATE-08 | Real generation-ownership races are tested, but only ever one hop (A→B) — no 3+-hop or return-to-origin case exists. |
| ANN-01 | Add highlight | selection → document model → highlight owner → persistence → projection | INTEGRATION | NORMAL | `tests/playwright/highlight-roundtrip.e2e.ts`; `tests/highlight-annotation.test.ts` | Real browser selects, marks, confirms markdown output; unit file exercises the real TipTap command directly. |
| ANN-02 | Add annotation | selection → annotation owner → document model → persistence → sidebar | PARTIAL_INTEGRATION | HIGH | `tests/playwright/floating-overlays-viewport.e2e.ts`; `tests/annotation-bubble-session.test.tsx`; `tests/annotation-document.test.ts` | Each link of the chain has isolated coverage; no single test drives a live selection through confirm to a rendered sidebar entry. |
| ANN-03 | Annotation persistence | create → save → close/reopen | PARTIAL_INTEGRATION | HIGH | `tests/playwright/highlight-roundtrip.e2e.ts` (test 2) | Only proves the *absence* of a deleted highlight survives reload — no test proves a still-existing annotation round-trips intact. |
| ANN-04 | Delete annotation from text | editor action → canonical delete owner → document → persistence → sidebar projection | UNIT_ONLY | HIGH | `tests/highlight-annotation.test.ts` | Real TipTap commands, table-driven, but no persistence and no sidebar assertion, and no UI-driven trigger path at all. |
| ANN-05 | Delete annotation from sidebar | sidebar action → canonical delete owner → document → persistence → editor projection | INTEGRATION | HIGH | `tests/playwright/highlight-roundtrip.e2e.ts`; `tests/playwright/notes-annotation-pipeline.e2e.ts` | Best-covered annotation scenario — real click, real mark removal, real sidebar removal, survives reload. |
| ANN-06 | Edit annotation | — | INTEGRATION | NORMAL | `tests/playwright/notes-annotation-pipeline.e2e.ts`; `tests/highlight-annotation.test.ts` | Real app: editing text and type via sidebar both propagate into real markdown source in the same flow. |
| ANN-07 | Sidebar/text consistency | — | INTEGRATION | HIGH | `tests/playwright/notes-annotation-pipeline.e2e.ts` | Round-trips AI/Personal/Footnote/Highlight/Standalone annotations between Markdown/Rich and shows sidebar matching editor throughout. |
| ANN-08 | Highlight range integrity | — | PARTIAL_INTEGRATION | NORMAL | `tests/highlight-annotation.test.ts` | Real editor + real re-anchoring logic for one edit shape and one ambiguity case; not tested through persistence, never E2E. |
| ANN-09 | Annotation reopen integrity | — | PARTIAL_INTEGRATION | NORMAL | `tests/playwright/highlight-roundtrip.e2e.ts` (negative case only) | Only "stays deleted after reopen" is covered — no test confirms a *still-present* annotation keeps correct anchor/agreement after reload. |

**Confirmed gap called out by the audit:** ANN-04/ANN-05 convergence — "delete from text" and "delete from sidebar" reaching the *same final state* — is never tested together. ANN-05 alone is the strongest scenario in the cluster; ANN-04 is isolated-unit-only with no UI trigger at all. The interesting property (two entry points, one canonical result) is unverified.

---

# E. Document Metadata

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| META-01 | Change status | command/UI → metadata owner → persistence → catalog/query → views → sync | PARTIAL_INTEGRATION | HIGH | `tests/desk-workspace-catalog-integration.test.tsx` | Strongest test in the cluster: real Desk + real Workspace mounted over one shared fake catalog, both surfaces observably flip. DocumentService/sync queue still fully mocked. |
| META-02 | Change document type | — | UNIT_ONLY | HIGH | `tests/vocabulary/normalize-preserves-unknown.test.ts` (normalizer only) | `changeWritingArtifactType` has real call sites across the app but **zero test references anywhere**. |
| META-03 | Create status (applied) | Settings → status owner → persistence → selectors → product surfaces | PARTIAL_INTEGRATION | NORMAL | `tests/settings-vocabulary-editing.test.tsx`; `tests/vocabulary/server.test.ts`; `tests/vocabulary/consumers-repaint.test.tsx` | Each layer separately mocked; no single test spans Settings form → API → DB → selector. |
| META-04 | Edit status | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/end-to-end-contract.test.ts`; `tests/vocabulary/consumers-repaint.test.tsx` | Rename→real-consumer repaint genuinely proven; Settings-form-to-persistence leg is not. |
| META-05 | Remove/disable status | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/consumers-repaint.test.tsx`; `tests/desktop-settings-service.test.ts` | Hide vs delete distinction well tested at orchestration layer; no test proves a real DB/SQLite rewrite or that an already-open document observes the change live. |
| META-06 | Create document type | — | PARTIAL_INTEGRATION | NORMAL | same shape as META-03 (`kind="type"`) | Assignment UI never rendered against a live-changed catalog. |
| META-07 | Edit document type | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/end-to-end-contract.test.ts` | Unlike status, there is **no** real-component repaint test for a type rename — weaker than META-04. |
| META-08 | Remove document type | — | PARTIAL_INTEGRATION | NORMAL | `tests/desktop-settings-service.test.ts` ("Unused" type, 0-row case only) | The desktop rewrite-with-*matching rows* path is only tested for status; the type equivalent has no non-trivial-row test. |

# K. Status / Type Configuration

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| CONFIG-01 | Create status (schema) | Settings → configuration owner → persistence → selectors → editor/Desk/filters | PARTIAL_INTEGRATION | HIGH | `tests/settings-vocabulary-editing.test.tsx`; `tests/vocabulary/server.test.ts`; `tests/desktop-settings-service.test.ts` | Three independently-mocked layers each unit/contract-tested; never chained with real persistence. |
| CONFIG-02 | Rename status | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/consumers-repaint.test.tsx`; `tests/vocabulary/end-to-end-contract.test.ts` | Key-stability-by-design is good architecture; proven end-to-end only from catalog snapshot onward, not from the Settings form. |
| CONFIG-03 | Disable/delete status | — | PARTIAL_INTEGRATION | NORMAL | same as META-05 | — |
| CONFIG-04 | Create document type | — | PARTIAL_INTEGRATION | HIGH | same as META-06 | — |
| CONFIG-05 | Rename document type | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/end-to-end-contract.test.ts` | Weaker than CONFIG-02 — no repaint test exists for a type rename. |
| CONFIG-06 | Delete document type | — | PARTIAL_INTEGRATION | NORMAL | same as META-08 | Type-delete-with-matching-docs branch untested on desktop. |
| CONFIG-07 | **Existing documents survive schema change** | — | PARTIAL_INTEGRATION | CRITICAL *(upgraded — highest-leverage gap in this cluster)* | `supabase/migrations/20260903190000_create_vocabulary_items.sql` (`delete_vocabulary_item` RPC, real SQL); `lib/services/desktop/desktop-settings-service.ts:443` `rewriteCatalogToBaseValue` — **both real rewrite engines are mocked in every test that touches them** | The invariant is well-specified and its JS-side bookkeeping is well tested, but the two places that actually touch persisted documents — a Postgres function and a Rust/SQLite command — have **zero real-engine coverage**. Unlike other security-sensitive SQL in this repo, there is no pgTAP test for `delete_vocabulary_item`. A rename/delete race or wrong-kind branch would pass every current test while corrupting real user documents. Most concrete, highest-priority fix in the whole map. |
| CONFIG-08 | Selectors/filtering reflect new definitions | — | PARTIAL_INTEGRATION | NORMAL | `tests/vocabulary/consumers-repaint.test.tsx` | One consumer surface proven reactive; `filter-bar.tsx`, `artifact-type-selector.tsx`, `properties-panel.tsx` read the same catalog by architecture but have no equivalent test. |

---

# G. Voice

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| VOICE-01 | Start recording | permission → MediaRecorder → recording state | PARTIAL_INTEGRATION | NORMAL | `tests/use-voice-recorder.test.tsx`; `tests/playwright/notes-voice-recorder.e2e.ts` | Real hook/UI logic exercised including in a real browser, but `getUserMedia`/`MediaRecorder` are fully faked in every test. |
| VOICE-02 | Stop recording → Blob/MIME | — | UNIT_ONLY | NORMAL | `tests/voice-recorder-helpers.test.ts` | Every fake `MediaRecorder.stop()` manufactures a Blob using the same type it was told to use — no test proves a *real* recorder's output container matches the requested MIME type. |
| VOICE-03 | Preserve recording | — | PARTIAL_INTEGRATION | NORMAL | `tests/annotation-bubble-session.test.tsx`; e2e | Real component state-machine verified at unit+e2e level; recorder/transcription both mocked/faked in both. |
| VOICE-04 | Transcribe recording | Blob → multipart → transcription service → provider boundary → transcript | INTEGRATION *(server)* | HIGH | `tests/api/margins-transcribe-route.test.ts` (real route+admission, Deepgram `fetch` mocked — acceptable external boundary) | Matches the spec's "integration without browser" preference on the server. Client-side wiring (`tests/transcribe-voice-note.test.ts`) is unit-only and never stitched to the real route in one test. |
| VOICE-05 | Transcription failure | — | PARTIAL_INTEGRATION | HIGH | `tests/annotation-bubble-session.test.tsx`; e2e | Preserves-recording-on-failure genuinely exercised, transcription service faked. |
| VOICE-06 | Retry transcription | — | PARTIAL_INTEGRATION | NORMAL | same files | E2E test literally retries twice on one recording; explicit same-blob assertion at unit level. |
| VOICE-07 | Desktop runtime host resolution | — | CONTRACT | HIGH | `tests/transcribe-voice-note.test.ts`; `tests/desktop-runtime-host.test.ts` | Real resolution logic tested, but `fetch`/session mocked; no real Tauri runtime involved. |
| VOICE-08 | Production desktop never uses localhost | — | **RELEASE** | CRITICAL | `scripts/release-desktop.mjs` (scans the actual built `.app`/static-export assets for embedded localhost strings, refuses to publish); `.github/workflows/release-desktop.yml` (real macOS Tauri build on every `app-v*` tag) | **Strongest-covered scenario in the entire map.** A real DMG/.app is built and its shipped JS/HTML scanned before publishing, wired directly into release CI. Keep watched — this is the bar the rest of the map should aim toward. Note: `scripts/validate-desktop-bundle.mjs` does a deeper DMG/CSP check but is **not wired into any workflow** — manual-only. |

# L. Sharing

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| SHARE-01 | Enable sharing | document → sharing owner → API/cloud → authorization → consumer view | UNIT_ONLY | HIGH | `tests/api/sharing-cors.test.ts`; `tests/sharing-service.test.ts`; `tests/desktop-sharing-service.test.ts`; `tests/writing-shares.test.ts` | Every layer unit-tested with the adjacent layer mocked; no test performs a real Supabase write. |
| SHARE-02 | Disable sharing | — | UNIT_ONLY | HIGH | same as SHARE-01 | — |
| SHARE-03 | Generate/open preview link | — | UNIT_ONLY | HIGH | `tests/sharing-service.test.ts`; `tests/api/margins-preview-route.test.ts`; `tests/playwright/preview-shared-margins.e2e.ts` | Richest unit/contract set in the cluster, but the e2e test intercepts the preview API entirely rather than resolving a real token — generation and lookup are never connected. |
| SHARE-04 | **Permission enforcement** | — | **NONE** | CRITICAL *(upgraded — security)* | `tests/writing-shares.test.ts` — its own header states RLS enforcement is "verified manually via Supabase MCP ... requires live DB connection" | The code itself documents this gap. Only route-level "is there a session" (401) is automated — not cross-user ownership/RLS. |
| SHARE-05 | Visibility changes persist | — | **NONE** | HIGH *(upgraded)* | none found | — |
| SHARE-06 | Reopen preserves sharing state | — | **NONE** | NORMAL | none found | — |

# M. Collections

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| COL-01 | Add to collection | — | UNIT_ONLY | NORMAL | `tests/api/writings-collections-route.test.ts` (Supabase fully mocked) | `replace_writing_collections` (real, security-definer, ownership-checked SQL) is never exercised by a JS test. |
| COL-02 | Remove from collection | — | UNIT_ONLY | NORMAL | same file | — |
| COL-03 | Multiple collection membership | — | UNIT_ONLY | NORMAL | `tests/collections.test.ts`; confirmed real (non-vestigial) feature via schema + component read | Only pure-function/mocked-RPC coverage — no test proves two real collections and one real writing persist simultaneously through the DB. |
| COL-04 | Reopen preserves membership | — | INTEGRATION | NORMAL | `tests/collections-remote-bootstrap.test.ts` (real fake-indexeddb + real localDB + real hydration merge; only network mocked) | Genuinely tests two real collaborating pieces. |
| COL-05 | Collection queries reflect mutations | — | PARTIAL_INTEGRATION | NORMAL | `tests/collections.test.ts`; `tests/collections-remote-bootstrap.test.ts` | Local-store read-after-write is real; server-side equivalent is untested (GET route test mocks Supabase entirely). |
| COL-06 | Delete collection without corrupting documents | — | **NONE** | HIGH *(upgraded)* | `app/api/collections/[id]/route.ts`; schema `ON DELETE CASCADE` on the join table only | The invariant is schema-guaranteed by design but has zero test coverage — no test calls `DELETE` and asserts a writing survives. |

---

# I. Sync

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| SYNC-01 | Local save enqueues sync | save local → sync mutation | PARTIAL_INTEGRATION | HIGH | `tests/sync-service.test.ts` (web, real fake-indexeddb queue); `tests/desktop-catalog-sync-service.test.ts` (desktop, SQLite write mocked); `src-tauri` real-rusqlite tests | Web path has real local persistence; desktop's real-SQLite half (Rust) and JS-invocation half are each tested but never joined. |
| SYNC-02 | Successful sync acknowledgment | — | CONTRACT | NORMAL | `tests/desktop-catalog-sync-service.test.ts` | Both boundaries mocked — invariant asserted, never against real persisted rows. |
| SYNC-03 | **Sync failure preserves local content** | — | UNIT_ONLY | CRITICAL | `tests/desktop-catalog-sync-service.test.ts`; `tests/sync-worker.test.ts` | Failure-path tests confirm nothing is marked synced, but nothing actively re-reads a real local body/file to prove it survived — holds by omission, not by assertion. |
| SYNC-04 | Retry is idempotent | — | PARTIAL_INTEGRATION | HIGH | `tests/sync-worker.test.ts`; `desktop-catalog-sync-service.test.ts`; Rust real-SQLite retry-budget test | Real-DB retry bookkeeping and JS upsert-fallback logic each solid, tested in isolation from each other. |
| SYNC-05 | **Multiple local saves before sync** | — | PARTIAL_INTEGRATION | CRITICAL | `tests/sync-worker.test.ts`; Rust real-SQLite supersede test | Same split-chain pattern as SYNC-04 — real logic in Rust, mocked logic in JS, never combined. |
| SYNC-06 | Conflict handling | — | PARTIAL_INTEGRATION | HIGH | `tests/sync/hydrate-local-writings-from-remote.test.ts`; `tests/fase9-document-catalog-invariants.test.ts` (row B8.5 self-flagged `PENDING`/manual) | Version-based LWW over real IndexedDB + faked network is genuinely tested; the harder concurrent-edit/explicit-policy case is honestly flagged by the team itself as unautomated. |
| SYNC-07 | Offline → online recovery | — | UNIT_ONLY | HIGH | `tests/sync-worker.test.ts`; `tests/desktop-catalog-sync-service.test.ts`; closure row B8.4 self-flagged `PENDING`/manual | No real network layer or process restart; deferred to manual DMG evidence by the team's own DoD. |
| SYNC-08 | **Metadata-only mutation does not blank content** | — | CONTRACT | CRITICAL | `tests/desktop-catalog-sync-service.test.ts` — three targeted tests with explicit `not.toHaveProperty` assertions | Best-tested invariant in the sync cluster; Supabase/SQLite both mocked — no real-DB round trip. |

# J. Workspace / Filesystem

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| WS-01 | Mount workspace | — | PARTIAL_INTEGRATION | HIGH | `src-tauri/src/commands/workspace.rs` (real temp fs); `tests/services/workspace-reconciler.test.ts` (fakes); `tests/desk-workspace-catalog-integration.test.tsx` (real UI mount, faked catalog) | Real fs→manifest half and real UI→catalog half each tested; SQLite catalog itself is fake in both. |
| WS-02 | Move file between workspaces | same capability as DOC-08 | UNIT_ONLY | HIGH | `tests/services/workspace-service.test.ts` ("ODE-403") | `relocateDesktopWriting` and `tauriWorkspaceSync` both mocked — no real file move, no real catalog convergence check. |
| WS-03 | External rename | filesystem external change → watcher → reconciler → catalog → UI projection | PARTIAL_INTEGRATION | HIGH | Rust real-fs rename test; `workspace-reconciler.test.ts` (fake); closure row B8.2 self-flagged `PENDING`/manual | Overlaps with WATCH-03 — same evidence. |
| WS-04 | External create | — | PARTIAL_INTEGRATION | HIGH | `workspace-reconciler.test.ts` (fake); Rust manifest-layer real-disk discovery | Overlaps with WATCH-01. |
| WS-05 | External delete | — | PARTIAL_INTEGRATION | HIGH | `workspace-reconciler.test.ts`; Rust real-fs/real-SQLite delete tests | Overlaps with WATCH-05. |
| WS-06 | Workspace switch isolation | — | **NONE** | HIGH *(upgraded)* | none found — existing e2e switches sidebar *panels* ("Contents"/"Workspace"), not two Workspace *roots* | Largest structural blind spot in this cluster: no test anywhere drives two different BindingRoots/Workspaces through a real move or checks cross-workspace isolation. |
| WS-07 | Selected paths/watcher scope | — | PARTIAL_INTEGRATION | NORMAL | `tauri-fs-watch.test.ts`; `workspace-reconciler.test.ts` (pure); Rust real-fs scope tests | — |

# N. External Watcher Behavior

| ID | Capability | Chain | Status | Priority | Evidence | Note |
|---|---|---|---|---|---|---|
| WATCH-01 | External create | filesystem → watcher → reconciler → catalog → mounted state | PARTIAL_INTEGRATION | HIGH | same evidence as WS-04 | — |
| WATCH-02 | External edit | — | PARTIAL_INTEGRATION | HIGH | Rust real-fs+hash tests; reconciler fake | `tauri-fs-watch.test.ts`'s self-write-suppression tests are the *inverse* case (ignoring the app's own writes), not a genuine external edit reaching the UI. |
| WATCH-03 | External rename | — | PARTIAL_INTEGRATION | HIGH | same evidence as WS-03 | — |
| WATCH-04 | External move | — | UNIT_ONLY | HIGH | `workspace-reconciler.test.ts` inode-correlation (fake, within one root only) | No test at any level moves a file across two different BindingRoots — same gap as DOC-08/WS-02. |
| WATCH-05 | External delete | — | PARTIAL_INTEGRATION | HIGH | same evidence as WS-05 | — |
| WATCH-06 | Ambiguous reconciliation | — | UNIT_ONLY | NORMAL | `workspace-reconciler.test.ts` | Pure fakes, no real fs/DB. |
| WATCH-07 | **Active document changes externally** | — | **NONE** | CRITICAL *(upgraded)* | none found — only the inverse case (app's own write suppressed) is tested | No test simulates an external process editing a file the editor currently has open/dirty. Real data-loss/corruption risk if the editor silently overwrites an external change or vice versa. |

**Structural note (confirmed across WS/WATCH):** the overlap between WS-03/04/05 and WATCH-01/03/05 is real, not incidental — they're covered by the *exact same* tests. None of those tests exercise the full chain (real fs → real watcher event → real reconciler decision → real SQLite commit → real UI) in one place: `workspace_sync` in Rust never touches the SQLite catalog; `reconcileRoot` in TS never touches real fs or real SQLite; the Rust `catalog_apply_reconcile` test exercises real SQLite but with hand-built (not fs-derived) input. Several test names reference specific ODE incidents and do correctly test the general capability, not just the narrow historical repro (spot-checked: ODE-404, ODE-408, ODE-453, ODE-460) — this is a case where regression-test naming did *not* mean narrow-only coverage.

---

# Audit Summary (Phase 1 + Phase 2 complete)

**106 scenarios inventoried** across 14 capability categories (A–N, sections above). This is the full sweep from the specification, not a subset.

## Coverage breakdown

| Status | Count | % |
|---|---|---|
| NONE | 12 | 11% |
| UNIT_ONLY | 17 | 16% |
| CONTRACT | 10 | 9% |
| PARTIAL_INTEGRATION | 54 | 51% |
| INTEGRATION | 12 | 11% |
| RUNTIME | 0 | 0% |
| RELEASE | 1 | 1% |

**The headline finding matches the reported pain point exactly:** half of all scenarios (54/106) sit at `PARTIAL_INTEGRATION` — real collaborators tested on one side of a boundary, fakes on the other, never joined. This is precisely the shape of bug this initiative exists to catch: every piece passes its own tests, the seam between them doesn't. Zero scenarios have been validated against the real packaged Tauri runtime (`RUNTIME` = 0); only one (`VOICE-08`) reaches `RELEASE`.

## Critical gaps (NONE or UNIT_ONLY on a CRITICAL/HIGH-priority scenario)

1. **SHARE-04 — Permission enforcement (security).** The test file's own header admits RLS is verified manually only. `NONE`, `CRITICAL`.
2. **CONFIG-07 — Schema change safety for existing documents.** Both real rewrite engines (a Postgres function, a Rust/SQLite command) are mocked in every test that touches them. `PARTIAL_INTEGRATION` but functionally `NONE` at the layer that matters — highest-leverage single fix in the map. `CRITICAL`.
3. **WATCH-07 — Active document changes externally.** No test simulates an external edit to a currently-open document. `NONE`, `CRITICAL`.
4. **AI-01 — Suggest title.** Root cause identified: an untested client-side lifecycle gate blocks the feature exactly when local-first drafts most need it. `NONE` at the client layer, `CRITICAL`.
5. **EXP-05 — Export failure behavior.** Zero coverage for dialog-cancel/write-failure; the product could report a successful export when nothing was written. `NONE`, `CRITICAL`.
6. **STATE-05 / STATE-07 — Clean view state / cursor restore.** Same bug class as the already-partially-addressed scroll-position issue (STATE-03/04), but with no test at all. `NONE`, `HIGH`.
7. **WS-06 — Workspace switch isolation.** No test drives two real Workspace roots at once. `NONE`, `HIGH`.
8. **COL-06 — Delete collection without corrupting documents.** Schema-guaranteed, never tested. `NONE`, `HIGH`.
9. **DOC-09 — Import document (desktop).** The actual wiring function has zero test references anywhere in the repo. `NONE`, `HIGH`.
10. **SHARE-05 / SHARE-06 — Visibility persistence / reopen.** `NONE`, `HIGH`/`NORMAL`.

## Existing strong coverage (hold the line here)

- **VOICE-08 — Production desktop never localhost.** `RELEASE`. A real DMG is built and scanned before every publish, wired into CI. The model to imitate elsewhere.
- **EXP-04 / SYS-02 — UUID never used as a path.** `CONTRACT`, protected by an AST scan *and* a runtime assertion. The single most rigorously guarded invariant in the codebase.
- **STATE-08 — Hydration never overwrites newer local edits.** `INTEGRATION`, real EditorShell forcing real stale-async races.
- **ANN-05/06/07 — Sidebar/editor annotation convergence.** `INTEGRATION` via real E2E flows spanning Markdown/Rich modes.
- **AI-04 — Generate corrections.** `INTEGRATION` up to a deterministic provider fake — the correct shape for AI capabilities generally.
- **SYNC-08 — Metadata-only mutation safety.** `CONTRACT`, three explicit negative-shape assertions.
- **COL-04 — Reopen preserves collection membership.** `INTEGRATION`, real IndexedDB + real hydration merge.

## V1 Implementation Plan (ordered — ties to the spec's own §10 plus the upgrades above)

1. CONFIG-07 real-engine test (pgTAP for `delete_vocabulary_item`; a real-SQLite test for `rewriteCatalogToBaseValue`'s matching-rows branch).
2. SHARE-04 real RLS/ownership test (cross-user access attempt against a real or test-scoped Supabase instance, not just route-level 401).
3. AI-01 fix + regression test for the `local-only`/`syncing` lifecycle gate (this is a real, currently-shipping bug, not just a coverage gap).
4. WATCH-07 — external edit to an open/dirty document.
5. EXP-05 — export failure paths (dialog cancel, write failure).
6. DOC-02/DOC-03/DOC-06 desktop path — one real integration test with a temp filesystem + real DocumentService + real SQLite catalog (currently the biggest "each side tested against a fake of the other" gap).
7. STATE-05/06/07 — clean-slate and cursor/selection isolation, mirroring the STATE-03/04 E2E pattern already proven to work for scroll.
8. SYS-05/SYS-08 — one TS-side integration test with real SqliteDocumentCatalog + real fs, replacing at least one of the fully-mocked contract tests.
9. WS-06 / DOC-08 / WS-02 / WATCH-04 — the shared "move across two real Workspace roots" gap; one test here likely closes four scenarios at once.
10. ANN-04/ANN-05 convergence test (both entry points, one assertion on final state).

## CI candidates (cheap, deterministic, high-value — matches the spec's §19 criteria)

- EXP-04 / SYS-02 (already CI-suitable in shape; formalize as an architecture/contract test if not already blocking).
- SYNC-08 metadata-only safety.
- STATE-03/04 view-state isolation (already E2E against the real dev server, not a packaged bundle — fits the existing `scoped-ci.yml` cost tier from the CI restructuring work, not universal blocking).
- CONFIG-07 once implemented (real-engine test, fast against a local test DB).
- ANN-04/ANN-05 convergence test once implemented.

## Non-CI proofs (correctly excluded from universal blocking)

- VOICE-08's real DMG build/scan (already release-only, correct).
- Anything requiring a real microphone, a real packaged desktop smoke test, or hardware-specific behavior.
- The manually-flagged `PENDING` rows in `tests/fase9-document-catalog-invariants.test.ts` (offline/restart convergence, Finder-driven rename/move, conflict/ambiguity resolution) — these are honest team-acknowledged DMG-only gaps, not silent ones.

---

*This map is a durable artifact, not a one-time audit — update `coverage_status` and `Evidence` in place as tests are added, rather than re-auditing from scratch. Planning/BUILD/Review integration (declaring affected capabilities in the Issue Brief, a BUILD capability-proof step, Review evaluating capability preservation) and CI promotion are follow-up phases, deliberately not done in this pass.*
