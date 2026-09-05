# Fase 11 — Artifact Studio: Agent evidence

PR: `https://github.com/hugomarin/Odessay/pull/423`

This document is the implementation evidence matrix for ODE-479 through ODE-486. It records the code path, the test path, and the remaining owner acceptance required before the phase gate is closed.

## DoD traceability

| DoD block | Evidence | Verification | State |
| --- | --- | --- | --- |
| Authorized tools | `lib/services/contracts/workspace-agent.ts`, `lib/services/desktop/workspace-agent-tools.ts`, `lib/services/workspace-agent-service.ts` | `tests/workspace-agent-tools.test.ts`; every read/write/move/edit/delete call requires an action/resource approval | Implemented |
| Workspace context | `lib/agent/workspace-agent-analysis.ts`, `loadContext` in `lib/services/workspace-agent-service.ts` | `tests/workspace-agent-analysis.test.ts`; catalog, collections and vocabulary remain the source of truth | Implemented |
| `workflow.md` | `buildWorkflowDraft`, `proposeWorkflow`, `applyWorkflow` | Existing workflow analysis tests plus `npm run ops:workflow:validate` | Implemented |
| Evidence-backed analysis | broken references, vocabulary classification, archive candidates and contradiction proposals in `lib/agent/workspace-agent-analysis.ts` | Exact fragments, line numbers, dates and similarity details are returned as `EvidenceCitation[]`; contradiction tests cover multiple findings and stale offsets | Implemented |
| Shared agent surface | `components/agent/workspace-agent-panel.tsx`, mounted by `components/editor/editor-shell.tsx` and `components/workspace/workspace-detail.tsx` | Shared scope prop, local ephemeral chat/context state, drag/drop payload, review queue and close/reopen rail | Implemented; desktop owner flow pending |
| Design-system translation | editor tabs/topbar and Workspace detail layout use existing tokens, typography, borders, panel width and Lucide icon treatment | `npm run typecheck`, `npm run lint`; manual visual acceptance still required in the desktop shell | Implemented; visual acceptance pending |
| Phase gate | This matrix, PR checks and the validation commands below | Owner acceptance of desktop flow plus final performance capture | In review |

## Interaction state matrix

| State | Expected behavior | Evidence |
| --- | --- | --- |
| Idle | Agent tab/button opens a 276px panel; no document or filesystem mutation occurs | Shared panel mount in Studio and Workspace |
| Context attached | Dropped file/folder becomes a removable chip; duplicate paths are ignored | `application/x-odessay-agent-context` payload and chip UI |
| Analysis result | Action returns a compact summary and cited evidence | `AgentResult` rendering and service response envelopes |
| Contradiction queue | Multiple findings are navigable one at a time; both exact fragments and line numbers remain visible | `workspace-agent-review-queue` |
| Resolve | Selecting left/right re-reads the target, verifies the exact fragment, then calls the approved edit tool; stale content returns `CONFLICT` | `replaceContradictionFragment` and `resolveContradiction` |
| Discard | Finding is removed from the active queue without a document mutation | `discard` resolution path |
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
- Playwright smoke on `/perf/editor-harness`: `New Artifact` → `Workspace agent` → panel scope `document` and Agent tab visible → close to rail → reopen from rail

The `studio-shell` performance harness still expects the old `New writing` label while the current surface uses `New Artifact`; that harness mismatch is recorded separately from the passing editor trace.

Remaining owner/evidence checks:

- desktop/Playwright smoke flow for opening the panel, dragging context, comparing two artifacts, resolving one finding and reopening the panel
- direct performance capture for panel open in the desktop shell; the new panel does not add a network request contract

The phase remains in review until the owner confirms the desktop visual states and the final interaction/performance evidence.
