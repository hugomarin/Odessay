# View — Settings › Workflows  *(specified, not yet designed)*

**Status:** requested in the handoff brief, no approved design exists. This document defines the requirements and the pattern it must follow, so whoever designs it does not invent a new one. Do not implement from this document alone — it needs a design pass first.

**No prototype backs this view.** Every other document in `docs/design/views/` is subordinate to a `.dc.html` in `docs/design/reference/`; this one is not, because Workflows was never designed. Until the design pass closes, the anatomy has to be derived from surfaces that *are* rendered — the card and the editor modal in `docs/design/reference/Artifact Studio Settings.dc.html` — read from the prototype, not from prose.

## What a workflow is

An ordered set of statuses that an artifact type moves through, plus the rules attached to the transitions. Today statuses are a flat list (see `docs/design/views/settings.md`): every artifact can be in any status. A workflow makes the order explicit — "Exploring → Draft → In review → Done" — so the Desk can show what is stuck and the editor can offer the next step.

## Why it is a separate section

Types answer *what is this*. Statuses answer *where is it*. A workflow answers *where does it go next*, and that is a relationship between statuses — it cannot live inside the status list without turning that list into a graph editor.

## Requirements

1. **List of workflows.** Same card pattern as types and statuses: 38px chip, name, description, "Edit", and a "Default" marker instead of "Required".
2. **Add workflow** — dashed 44px row, opens the editor immediately with an empty name.
3. **Editor** — reuses the 520px modal shell, with these fields:
   - Name, "When to use it" (with the same *Improve with AI* affordance),
   - **Steps**: a reorderable list of existing statuses (drag handle 24px, status chip, remove). Statuses are picked from the ones already configured — the workflow editor never creates a status.
   - **Applies to**: multi-select of artifact types. A type has at most one workflow.
   - Optional per-step note ("what has to be true to leave this step").
4. **Empty state**: "No workflows yet. Statuses work on their own — a workflow only adds order."

## Constraints

- A workflow is metadata: it must serialize into the artifact frontmatter as a single field (`workflow: name`), with the current step being the existing `status` field. No new durable store.
- Reordering steps never rewrites existing artifacts.
- Deleting a workflow leaves artifacts with their current status.
- If a type has a workflow, the status dropdown in the editor and the preview shows the next step first, then "all statuses" under a divider. That is the only behavioral change outside this view.

## Open questions for the owner

1. One workflow per type, or per workspace?
2. Are backward transitions allowed freely, or do they need a reason note?
3. Should the Desk gain a "board" view grouped by workflow step, or does group-by-status cover it?
