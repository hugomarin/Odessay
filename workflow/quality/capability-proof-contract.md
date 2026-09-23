# Capability Proof Construction Contract

**Normative.** Every rule here is a BUILD constraint, not an architectural direction. It applies to any work that adds or changes a test used as evidence for a row in `workflow/quality/capability-integration-map.md`, and to any REVIEW of such work.

This document is deliberately short. The *why* of capability coverage, the coverage-status scale, the Proof Contract template and the formal `INTEGRATION` bar live in `capability-integration-map.md` (§ "Phase 3 — Critical Proofs: methodology") — read that first; this contract does not restate it. What this contract adds is the set of construction rules that the Phase 3 PRs (#445–#449) showed are not obvious from the methodology alone.

## The question to ask before writing a proof

```text
Not:   "How do I show that this fix works?"

But:   "How does production actually reach this failure mode,
        which states can be altered on the way there,
        and what is the last event that makes the invariant true?"
```

If you cannot answer all three from the real code (call sites, not intuition), you are not ready to write the proof.

## Rules — a proof MUST

1. **Enter through a production-reachable entry point**, or state in the Proof Contract why a lower boundary is sufficient and what is lost by not entering higher.

2. **Reproduce the production state-transition sequence.** Do not seed an internal or terminal state directly when earlier transitions can modify the property under test. If production reaches state `S` only after `A → B → S`, and `A` or `B` touch the property, the proof goes through `A` and `B`.

3. **Keep every internal product seam real.** Fake only genuinely external/runtime boundaries (network, third-party provider, native OS dialog, Tauri IPC decode). An internal seam — a service and its own API route, a caller and the owner it delegates to — is connected for real in the same test.

4. **Distinguish scheduling from completion.** Assert the invariant only after the event that actually establishes it, never after the event that schedules it (see *Scheduling is not completion* below).

5. **Scope deferred work to its owning identity/generation.** A deferred callback that can outlive an identity change (tab switch, document reload, root rebind) must carry the owner identity or generation, revalidate it when it executes, and discard itself if stale. The proof must include the identity-change race when it is reachable.

6. **Assert canonical outcome, not successful control flow.** The file on disk, the catalog row, the manifest, the rendered DOM — not "the workflow returned", not `toHaveBeenCalled()`.

7. **Exercise every production call shape the proof traverses.** A behavioral double must accept every argument shape production actually passes (optional arguments included) and preserve failure semantics. **An exception swallowed by production is not successful execution**: if production intentionally catches an error inside the critical chain, the proof must independently assert the effect of the caught operation — it may never infer it from the outer workflow completing.

8. **Mutation-test the plausible failure mode** — the historical bug, or the most likely one — and confirm the proof goes red *for that reason*, live, before claiming it.

   **A proof that asserts an absence needs a positive control first.** Before asserting that something does *not* happen (no stale write, no leaked suggestion, no wrong-document save), prove in the same test — or in a sibling test on the same setup — that the thing *does* happen when it should. Otherwise the assertion holds for a reason that has nothing to do with the invariant, and the mutation test comes back green because the effect was never reachable to begin with.

   *Grounding:* ODE-556 paid this twice. A corrections-isolation proof asserted "document B shows no suggestions from A" and stayed green through two separate mutations — because the test double's payload did not match the canonical contract, so the analysis failed silently and *no* suggestions were ever produced, for any document. The positive control is what exposed it.

9. **Derive coverage status after the proof.** Status is an output of the evidence, never a delivery target (see *Status-closing bias* below).

10. **When the real critical chain cannot be proven in scope, declare `PARTIAL_INTEGRATION` and name the exact unproven seam** in the map row's `Note`. A named gap is a valid deliverable; an overstated status is not.

## Scheduling is not completion

```text
start                           ≠ complete
enqueue                         ≠ persisted
persist() called                ≠ durability established
requestAnimationFrame scheduled ≠ DOM restored
request sent                    ≠ remote state confirmed
catalog event emitted           ≠ consumer applied it
save snapshot created           ≠ baseline valid when the write executes
```

For any async or deferred step in the chain, the Proof Contract names the **completion event**: the exact point after which the invariant is true. Both the production code (e.g. "mark hydration finished") and the test's assertion must hang off that event, not off the call that schedules it.

For deferred work that can survive an identity change:

```text
deferred callback
  → carries owner identity / generation
  → revalidates ownership when it executes
  → discards itself if stale
```

*Grounding:* ODE-555 (#449) marked hydration finished right after *scheduling* the scroll-restore rAF; the resulting state change cancelled the generation before the rAF ran, and the restore silently no-op'd. WATCH-07 had the same shape twice (`persist()` called ≠ durable; snapshot taken ≠ baseline still valid at write time).

## Doubles

A behavioral double represents the **whole contract** of the boundary it replaces for the paths the proof traverses — not the happy semantics the proof happens to need.

- Mirror the real signature, including optional parameters and every call shape production uses.
- Mirror the real failure behavior (what throws, what returns an error value, what is idempotent).
- When a double is extended for a new proof, re-check every existing caller of the real function in the traversed chain.

*Grounding:* ODE-554 (#448) — the real `tauriWorkspaceSync(root, selected?, ids?)` was doubled with `ids` required. The destination resync passed ids and worked; the source resync used production's "reconcile this root" shape without ids, threw inside the double, and was swallowed by production's recoverable `catch {}`. The test stayed green while the source-manifest step never ran.

## Status-closing bias

**Coverage status is an output of the proof, never an acceptance criterion of the task.**

```text
Forbidden goal (issue brief, plan, or self-set):
  "move DOC-03 to INTEGRATION"

Valid goal:
  "strengthen DOC-03 evidence for failure mode X"

Afterwards:
  classify the strongest status actually demonstrated,
  against the formal bar in capability-integration-map.md.
```

A proof that lands at `PARTIAL_INTEGRATION` with an honestly named gap is a complete, successful delivery. A brief that lists a target status as acceptance criterion must be rewritten in terms of failure modes before BUILD starts.

## Escape taxonomy

When REVIEW finds that a proof did not demonstrate what it claimed, classify the escape with exactly one of these. Keep the list small; add a category only after it has recurred.

```text
MOCKED_SEAM          An internal seam of the declared chain is faked, so the
                     halves are proven separately but never together.
                     (AI-01 first version: service ↔ its own API route.)

WRONG_ASSERTION      The proof reaches the right path but asserts something
                     other than the invariant — control flow instead of
                     canonical state, or state read before the completion event.

NON_PRODUCTION_PATH  The proof reaches the intended branch or state, but not
                     through a sequence or entry point the real product can
                     produce: seeded internal state, synthetic ids, a call
                     shape production never uses, a selector that matches
                     no real UI element.

STALE_PROOF          The proof was valid once, but the product path moved
                     and the proof no longer represents it.

ARCHITECTURE_GAP     The invariant cannot be proven in the current design
                     (no seam to observe it, no owner to hold it); the fix is
                     structural, not a better test.
```

`NON_PRODUCTION_PATH` is distinct from `STALE_PROOF` (the test can be brand new) and from `WRONG_ASSERTION` (it can assert exactly the right property). Recurrences so far:

```text
SYNC-03   (#447) proof: local-only → jump straight to terminal failure
                 prod:  local-only → retryable failure → lifecycle left
                        on "syncing" → next retry → … → terminal
STATE-05  (#445) first draft covered, real reused-draft slot branch not
WS-02     (#448) destination resync call shape covered, source shape not
STATE-03/04 (#449) synthetic writingId + a tab selector matching no real tab
```

Record the category in the map row's `Note` and in `ProcessInsights` when a review finds one, so recurrences stay countable.

## Pre-upgrade checklist

Answer every item before changing a row's `coverage_status` upward. Any "no" or "unknown" caps the row at `PARTIAL_INTEGRATION` (or lower) and goes in `Note`.

```text
□ Is the starting state reachable through the real preceding transitions?
□ Is the entry point one production actually uses?
□ Are all internal seams of the declared chain real?
□ Does every double accept every call shape the chain passes it?
□ Did any error get swallowed inside the critical chain during the run?
□ Is the assertion made after the completion event, not the scheduling event?
□ Can deferred work execute after an identity change — and is that covered?
□ Would the plausible (or historical) bug turn this proof red? Verified live?
□ If the assertion is an absence: is there a positive control proving the effect is reachable at all?
□ Am I measuring canonical state, or only that control flow finished?
□ Is the status a conclusion drawn from the above, rather than the goal I started with?
```
