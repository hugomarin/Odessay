# Fase 11 — Artifact Studio: Agent evidence

PR: `https://github.com/hugomarin/Odessay/pull/423`

This document is the implementation evidence matrix for ODE-479 through ODE-486. It records the code path, the test path, and the remaining owner acceptance required before the phase gate is closed.

## DoD traceability

| DoD block | Evidence | Verification | State |
| --- | --- | --- | --- |
| Authorized tools | `lib/services/contracts/workspace-agent.ts`, `lib/services/desktop/workspace-agent-tools.ts`, `lib/services/workspace-agent-tools-factory.ts` | `tests/workspace-agent-tools.test.ts`; every read/write/move/edit/delete call requires an action/resource approval, and native path preflight canonicalizes the BindingRoot boundary before approval consumption | Implemented |
| Workspace context | `lib/agent/workspace-agent-analysis.ts`, `loadContext`/`getContextWithWorkflow` in `lib/services/workspace-agent-service.ts` | `tests/workspace-agent-analysis.test.ts`; catalog, collections and vocabulary remain the source of truth, while agent analysis actions load existing workflow context through a separate workflow approval | Implemented |
| `workflow.md` | `buildWorkflowDraft`, `proposeWorkflow`, `applyWorkflow` | Existing workflow analysis tests plus `npm run ops:workflow:validate`; every existing-workflow body read uses a workflow-specific approval and missing approval fails closed | Implemented |
| Evidence-backed analysis | deterministic link/contradiction/archive mechanics remain in `lib/agent/workspace-agent-analysis.ts`; semantic type/status classification is owned by `AIService.classifyWorkspace` | Desktop catalog hydrates a hash-validated outbound-reference projection without exposing document bodies to analysis; semantic classification sends selected document bodies, active vocabulary definitions, workflow, collections and annotations through the server AI adapter, then verifies quotes, vocabulary keys and freshness before any approved metadata edit | Implemented; contradiction/archive semantics remain the next vertical |
| Shared agent surface | `components/agent/workspace-agent-panel.tsx`, mounted by `components/editor/editor-shell.tsx` and `components/workspace/workspace-detail.tsx` | Shared scope prop, independent full-height rail, scope-keyed session reset on document change, drag/drop payload, attachment message records, review queue and close/reopen rail | Implemented; desktop owner flow pending |
| Design-system translation | editor tabs/topbar and Workspace detail layout use existing tokens, typography, borders, panel width and Lucide icon treatment | `npm run typecheck`, `npm run lint`; manual visual acceptance still required in the desktop shell | Implemented; visual acceptance pending |
| Phase gate | This matrix, PR checks and the validation commands below | Owner acceptance of desktop flow plus final performance capture | In review |

## Semantic classification vertical

The first value slice is the user task “review these documents and propose type and status with evidence”. `workspace-agent-service.ts` resolves explicit files/folders through `DocumentCatalog`, reads selected `.md` bodies through the approved desktop tool, and sends bounded context to `AIService.classifyWorkspace`. The server route owns OpenAI Responses API transport and structured-output validation; `gpt-5.6-luna` is the default model and only `OPENAI_API_KEY` is required for this vertical. Fireworks remains isolated for the existing corrections/title flows. The model owns the semantic decision. Similarity and neighboring metadata remain a comparison baseline for the later archive flow and are never promoted to a classification proposal.

Every returned target receives a proposal or an explicit `needs-review` placeholder. The application verifies each cited quote against the current body, rejects inactive vocabulary keys, preserves uncertainty, and requires a fresh content/metadata snapshot plus an exact target quote before an approved edit. The service also returns bounded catalog metadata for any additional document ids requested by the model so the user can attach the missing evidence.

## Interaction state matrix

| State | Expected behavior | Evidence |
| --- | --- | --- |
| Idle | Agent opens as an independent 276px full-height rail; Properties, Grammar and Notes remain separate; no document or filesystem mutation occurs | Shared panel mount in Studio and Workspace; `output/playwright/ode-486/agent-independent-panel.png` |
| Context attached | Dropped file/folder becomes a removable chip; duplicate paths are ignored | `application/x-odessay-agent-context` payload and chip UI |
| Chat context record | A sent message keeps an immutable snapshot of the attachments that were active at send time; chat owns its scroll | `workspace-agent-message-context`; `output/playwright/ode-486/agent-context-chat.png` |
| Analysis result | Action returns a compact summary and cited evidence | `AgentResult` rendering and service response envelopes |
| Broken-reference fix | Candidate path/slug is editable; approval performs a fresh source read, exact reference replacement and an approved edit; changed evidence returns `CONFLICT` | `replaceBrokenDocumentReference`, `applyBrokenReference`, service regression |
| Contradiction queue | Multiple findings are navigable one at a time; both exact fragments and line numbers remain visible | `workspace-agent-review-queue` |
| Resolve | Selecting left/right re-reads the target, rebases the exact fragment when an earlier resolution changed document length, then calls the approved edit tool; ambiguous or missing evidence returns `CONFLICT` | `replaceContradictionFragment` and `resolveContradiction`; two-finding length-change regression |
| Discard | Finding is removed from the active queue without a document mutation | `discard` resolution path |
| Queue complete | Resolving the last finding collapses the review width and returns the panel to the normal chat width | `setIsReviewExpanded(remainingCount > 0)` |
| Closed/reopened | Panel closes to a rail and resolved finding ids survive through local UI memory only | `localStorage` key scoped by workspace/document; `output/playwright/ode-486/agent-reopened.png` |
| Document switch | A new document receives a fresh session: chat, attachments, results and review proposals do not cross the document boundary | Scope-keyed remount; `output/playwright/ode-486/agent-document-switch-reset.png` |
| Focus mode | Focus mode hides the agent host without unmounting its session; Escape restores the same chat and attachment snapshot | `workspace-agent-focus-host`; Playwright assertion plus `output/playwright/ode-486/agent-focus-mode.png` |
| Unavailable runtime | Web/unbound contexts explain that desktop Workspace actions need a local root; the panel does not create a draft fallback | `WorkspaceAgentPanel` service availability state |

## Wireframe-to-build comparison

The approved interactive wireframe is referenced by `workflow/define/dod-fase-11.md` §6 but is not versioned as a repository asset. The comparison below therefore records the interaction states required by that DoD against the built surface and names every intentional visual divergence.

| Interaction state | Wireframe intent | Built surface / evidence | Intentional visual translation |
| --- | --- | --- | --- |
| Independent agent | Open the agent beside the current surface without covering the editor | Shared Studio/Workspace mount; `agent-independent-panel.png` | 276px rail, `h-full min-h-0`, muted Artifact Studio tokens and Lucide `strokeWidth={1.5}` instead of the wireframe palette and Material Symbols |
| Context and chat | Drop artifacts anywhere in the panel, show removable chips, preserve the sent context | `agent-context-chat.png` | Compact tokenized chips, local `bg-muted`/`bg-bg` surfaces and chat-owned scroll capped inside the body |
| Evidence / approval | Show cited findings and make mutations explicit before applying them | `workspace-agent-review-queue`, action review sections and approval-gated service tests | Inline review cards and buttons inside the rail; no modal, backdrop or separate sheet |
| Queue completion | Resolve/discard findings one at a time and collapse the review state when complete | `resolveContradiction`, `setIsReviewExpanded(remainingCount > 0)` | Review width changes from 276px to 344px in place and returns to 276px when the queue is empty |
| Focus mode | Keep the agent session available when the editor temporarily takes the full viewport | `workspace-agent-focus-host`, focus-mode Playwright smoke | The host is hidden with the existing `hidden` utility while React state stays mounted; no new surface or background is introduced |
| Scope reset | Do not reuse one document's working context for another | `agent-document-switch-reset.png` | Session state is keyed by `workspace:{rootId}` / `document:{id}` and remains local React state, with no new global store |

The remaining packaged-desktop screenshots are called out below rather than represented by web-only evidence.

## Validation record

Current local validation:

- `npm run typecheck`
- `npm run lint` (existing warnings only)
- `npm test` — 243 files / 1,879 tests (the review baseline was 1,847; this pass adds the semantic-provider regression coverage listed below)
- `npm run ops:workflow:validate`
- `npm run ops:delivery:gate` — passed for the committed ODE-479 through ODE-483 scope; rerun after the new commit for ODE-484 through ODE-486 traceability
- `npm run ops:perf:capture -- --scenario editor`
- `npm run ops:perf:gate -- --trace artifacts/perf/editor-trace.json.gz` — 14 pass, 0 warn, 1 optional skip, 0 required failures
- `cargo test --manifest-path src-tauri/Cargo.toml` — 68 passed, 2 ignored; catalog reference projection, traversal, `.odessay`, legacy internal state and symlink escape regressions pass
- Real OpenAI provider smoke — `gpt-5.6-luna` returned HTTP 200 / `completed` through `v1/responses`; the Workspace schema validated, and a synthetic decision artifact produced a `change` proposal with `decision` + `active`, concrete benefit and 3 evidence citations. The key value was not logged or committed.
- `npx playwright test tests/playwright/workspace-agent-panel.e2e.ts` — independent panel beside Properties, drop context, immutable message attachment record + chat scroll, focus-mode preservation, close/reopen and document-scope reset; screenshots in `output/playwright/ode-486/`
- `npx vitest run tests/workspace-agent-service.test.ts tests/api/workspace-classification-route.test.ts tests/ai-auth-services.test.ts tests/openai-workspace-provider-config.test.ts` — semantic model ownership, folder expansion, full-body context, bounded additional reads, exact evidence/vocabulary validation, stale approval rejection, OpenAI Responses payload/configuration and web adapter envelope mapping; no Fireworks fallback
- Browser performance evidence from the same smoke: `output/playwright/ode-486/agent-performance.json` — panel open `429.1ms`, reopen `65.1ms`, document reset `83.8ms` in the local Chromium harness. These are direct browser measurements, not a packaged-desktop claim.
- `npm run desktop:release:local` — desktop draft lifecycle (92 tests), static export, optimized Tauri release build and local DMG generation passed; the artifact intentionally embeds `http://localhost:3000` and is not distributable.
- `npm run validate:desktop -- --dmg dist/releases/ArtifactStudio-0.7.1-aarch64.dmg --allow-localhost` — bundle discovery, app structure, CSP, version alignment, static export and ad-hoc signature checks passed (0 failures, 1 expected localhost warning).

The `studio-shell` performance harness still expects the old `New writing` label while the current surface uses `New Artifact`; that harness mismatch is recorded separately from the passing editor trace.

Remaining owner/evidence checks (intentionally not claimed by automated web tests):

- authenticated app/desktop smoke through the Workspace UI with the live OpenAI key, including rendering the returned semantic proposal and approval action (the provider contract itself has passed the real smoke above)
- packaged/Tauri desktop interactive smoke flow for opening the panel, dragging context, comparing two artifacts, applying a broken-reference fix, resolving one contradiction and reopening the panel (bundle validation is still required separately)
- packaged-desktop screenshots for the action/evidence/approval states; the interaction-level wireframe comparison is recorded above
- direct performance capture for panel open and review expansion in the packaged desktop shell; the browser measurements above are a lower-level smoke signal only
- explicit owner acceptance of the final desktop visual and interaction evidence

The phase remains in review until the owner confirms the desktop visual states and the final interaction/performance evidence. The web smoke screenshots above are implementation evidence, not the pending packaged-desktop acceptance.
