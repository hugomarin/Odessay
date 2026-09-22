# ODE-512 — Semantic evaluation evidence matrix

Status captured: 2026-09-13. This matrix records evidence available on
`codex/ode-479-480-481-482-483-workspace-agent`; it is not a release or owner
acceptance record.

| Acceptance area | Automated evidence | State |
|---|---|---|
| Semantic policy: identical, punctuation-only, paraphrase, complementary, polarity, numeric/date, temporal scope, unrelated, reordered headings and recency control | `tests/workspace-agent-semantic-fixtures.test.ts` over canonical Markdown fixtures in `tests/workspace-agent-semantic-fixtures.ts` | Verified locally |
| Full selected bodies and selections larger than six | `tests/workspace-agent-relations.test.ts`, `tests/workspace-agent-merge.test.ts`, and `tests/workspace-agent-service.test.ts` (“processes more than six…”) | Verified locally |
| Intra-document contradictions require two distinct ranges | `tests/workspace-agent-relations.test.ts` distinct-range success and duplicate-range rejection | Verified locally |
| Partial/malformed output cannot claim complete coverage or enable mutation | relations/merge parser tests plus admission checks in `tests/workspace-agent-service.test.ts` | Verified locally |
| Unknown model capacity and budget exhaustion stop before provider/mutation | `tests/openai-workspace-provider-config.test.ts`, `tests/workspace-context-capacity.test.ts`, `tests/workspace-agent-semantic-loop.test.ts`, and `tests/api/workspace-agent-observability-route.test.ts` | Verified locally |
| Contradiction resolution requires an admitted, current semantic verdict | `tests/workspace-agent-service.test.ts`: forged/partial/stale rejection and retry after unverified write | Verified locally |
| Desktop resolution advances only after a durable content outcome | `tests/workspace-agent-tools.test.ts`: successful commit, verified `.md` with pending projection, unverified failure, and mixed-edit rejection | Verified locally |
| Merge uses one approved new-artifact write, preserves source hashes, rejects stale/soft-deleted sources and remains retryable after write failure | `tests/workspace-agent-service.test.ts` merge workflow | Verified locally |
| Provider unavailable remains explicit and never becomes “no conflicts” | relation/merge parser tests and service failure tests | Verified locally |
| Ask continuity invalidates on unsaved body changes | `tests/workspace-agent-service.test.ts` and `tests/api/workspace-agent-observability-route.test.ts` | Verified locally |
| Web panel preserves context/history across close, focus mode and document switch; new conversation resets it | `tests/playwright/workspace-agent-panel.e2e.ts` | Verified local E2E |
| Web boundary does not pretend to execute desktop Merge | `tests/playwright/workspace-agent-merge.e2e.ts` | Verified local E2E |
| Production-host desktop bundle builds and passes static DMG validation | `npm run desktop:release:prod`; `npm run validate:desktop -- --dmg dist/releases/ArtifactStudio-0.7.1-aarch64.dmg`; machine-readable report in `artifacts/ode-512/desktop-bundle-validation.json` | Verified locally; ad-hoc signed, not notarized or published |
| Full desktop selection → semantic review → resolution/creation → return to chat | Must run on the packaged desktop runtime with isolated DocumentCatalog fixtures. The packaged app currently resolves the real `com.z9ne.odessay` profile, so an agent-driven run would risk reading the owner's catalog instead of an isolated fixture | Pending / isolated-profile harness required |
| Real OpenAI Ask: short continuity chain and 300+ word selected body | `tests/live/workspace-agent-openai.live.test.ts`; sanitized model/usage/latency/schema traces in `artifacts/ode-512/openai-live-smoke.json` | Verified locally with `gpt-5.6-luna` (12 and 344 words) |
| Real OpenAI long-session continuity across at least two native compactations | Eight chained Responses produced five compaction Items; every `previous_response_id` matched the prior Response | Verified locally |
| Real OpenAI explicit whole-Workspace scope larger than six documents | Eight-document fixture returned the first and last grounded markers with `scopeStatus: ready` | Verified locally |
| Real OpenAI `incomplete` remains observable | Deliberately bounded live Response returned `status: incomplete`, reason `max_output_tokens`, preserved in the receipt | Verified locally |
| Production DMG provider routes | Read-only checks on 2026-09-14 returned HTTP 404 for `workspace-ask`, `workspace-classification`, `workspace-semantic-round`, and `workspace-tool-presentation`; tracked by ODE-517 | Confirmed deployment blocker |
| Observable outcome and wording accepted by owner | Owner review after the desktop evidence run | Pending |

## Interpretation

The deterministic suite is evidence for contract enforcement, not for model
quality. The production-host DMG builds and passes automated bundle checks, and
the local adapter has current real-provider evidence for Ask continuity,
compaction, long input, explicit eight-document scope and incomplete output.
Neither substitutes for the interactive Workspace Agent flow in the packaged
runtime. ODE-512 must remain open until that packaged flow, the ODE-517
production route dependency, and owner acceptance are recorded. ODE-508 is not
part of this gate.
