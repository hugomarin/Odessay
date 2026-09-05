# Fase 11 — Artifact Studio: Agent evidence

PR: `https://github.com/hugomarin/Odessay/pull/423`

This document is the implementation evidence matrix for ODE-479 through ODE-486. It records the code path, the test path, and the remaining owner acceptance required before the phase gate is closed.

## DoD traceability

| DoD block | Evidence | Verification | State |
| --- | --- | --- | --- |
| Authorized tools | `lib/services/contracts/workspace-agent.ts`, `lib/services/desktop/workspace-agent-tools.ts`, `lib/services/workspace-agent-tools-factory.ts` | `tests/workspace-agent-tools.test.ts`; every read/write/move/edit/delete call requires an action/resource approval, and native path preflight canonicalizes the BindingRoot boundary before approval consumption | Implemented |
| Workspace context | `lib/agent/workspace-agent-analysis.ts`, `loadContext`/`getContextWithWorkflow` in `lib/services/workspace-agent-service.ts` | `tests/workspace-agent-analysis.test.ts`; catalog, collections and vocabulary remain the source of truth, while agent analysis actions load existing workflow context through a separate workflow approval | Implemented |
| `workflow.md` | `buildWorkflowDraft`, `proposeWorkflow`, `applyWorkflow` | Existing workflow analysis tests plus `npm run ops:workflow:validate`; every existing-workflow body read uses a workflow-specific approval and missing approval fails closed | Implemented |
| Evidence-backed analysis | broken references, vocabulary classification, archive candidates and contradiction proposals in `lib/agent/workspace-agent-analysis.ts` | Exact fragments, line numbers, dates and similarity details are returned as `EvidenceCitation[]`; broken-reference fixes have an editable proposal plus read/edit approvals, and contradiction tests cover length-changing queue rebases | Implemented |
| Shared agent surface | `components/agent/workspace-agent-panel.tsx`, mounted by `components/editor/editor-shell.tsx` and `components/workspace/workspace-detail.tsx` | Shared scope prop, independent full-height rail, local ephemeral chat/context state, drag/drop payload, attachment message records, review queue and close/reopen rail | Implemented; desktop owner flow pending |
| Design-system translation | editor tabs/topbar and Workspace detail layout use existing tokens, typography, borders, panel width and Lucide icon treatment | `npm run typecheck`, `npm run lint`; manual visual acceptance still required in the desktop shell | Implemented; visual acceptance pending |
| Phase gate | This matrix, PR checks and the validation commands below | Owner acceptance of desktop flow plus final performance capture | In review |

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
| Closed/reopened | Panel closes to a rail and resolved finding ids survive through local UI memory only | `localStorage` key scoped by workspace/document |
| Unavailable runtime | Web/unbound contexts explain that desktop Workspace actions need a local root; the panel does not create a draft fallback | `WorkspaceAgentPanel` service availability state |

## Validation record

Current local validation:

- `npm run typecheck`
- `npm run lint` (existing warnings only)
- `npm test` — 240 files / 1,836 tests
- `npm run ops:workflow:validate`
- `npm run ops:delivery:gate` — passed for the committed ODE-479 through ODE-483 scope; rerun after the new commit for ODE-484 through ODE-486 traceability
- `npm run ops:perf:capture -- --scenario editor`
- `npm run ops:perf:gate -- --trace artifacts/perf/editor-trace.json.gz` — 14 pass, 0 warn, 1 optional skip, 0 required failures
- `cargo test workspace_agent_validate_path --manifest-path src-tauri/Cargo.toml` — traversal, `.odessay` and symlink escape regressions pass
- `npx playwright test tests/playwright/workspace-agent-panel.e2e.ts` — independent panel beside Properties, drop context, message attachment record + chat scroll, close/reopen; screenshots in `output/playwright/ode-486/`

The `studio-shell` performance harness still expects the old `New writing` label while the current surface uses `New Artifact`; that harness mismatch is recorded separately from the passing editor trace.

Remaining owner/evidence checks (intentionally not claimed by automated web tests):

- packaged/Tauri desktop smoke flow for opening the panel, dragging context, comparing two artifacts, applying a broken-reference fix, resolving one contradiction and reopening the panel
- screenshots for the desktop action/evidence/approval states and a wireframe-vs-built comparison
- direct performance capture for panel open and review expansion in the desktop shell; the new panel does not add a network request contract
- explicit owner acceptance of the final desktop visual and interaction evidence

The phase remains in review until the owner confirms the desktop visual states and the final interaction/performance evidence. The web smoke screenshots above are implementation evidence, not the pending packaged-desktop acceptance.
