/**
 * Hybrid workflow.md instructions model (ODE-504, decision 2026-09-09).
 *
 * `workflow.md` is the Workspace agent's operating manual — the analogue of a
 * CLAUDE.md. Its initial instructions section (how the agent should operate
 * plus the intent of the workspace) is ambient invocation context: it rides
 * every agent invocation, hash-validated by the descriptor and bounded by the
 * ODE-501 context budget. The remaining executable workflow definitions stay
 * evidence-on-demand: the descriptor reports their size and the model fetches
 * the full document through `requestedDocumentIds` only when the intent
 * requires it (e.g. explicitly running a workflow).
 *
 * The split convention is an HTML comment marker so the boundary is explicit,
 * invisible in rendered preview, and owned by the workspace author. A file
 * without the marker is entirely instructions — the generated draft
 * (`buildWorkflowDraft`) is intent/scope content, which is exactly the
 * instructions side of the contract.
 */

export const WORKFLOW_DEFINITIONS_MARKER = "<!-- workflow-definitions -->"

export const MAX_WORKFLOW_INSTRUCTIONS_CHARS = 8_000

export type WorkflowInstructionsSplit = {
  instructions: string
  definitions: string | null
  instructionsTruncated: boolean
}

export function splitWorkflowMarkdown(markdown: string): WorkflowInstructionsSplit {
  const markerIndex = markdown.indexOf(WORKFLOW_DEFINITIONS_MARKER)
  const hasDefinitions = markerIndex !== -1
  const rawInstructions = hasDefinitions ? markdown.slice(0, markerIndex) : markdown
  const trimmedInstructions = rawInstructions.trimEnd()

  const instructionsTruncated = trimmedInstructions.length > MAX_WORKFLOW_INSTRUCTIONS_CHARS
  const instructions = instructionsTruncated
    ? trimmedInstructions.slice(0, MAX_WORKFLOW_INSTRUCTIONS_CHARS)
    : trimmedInstructions

  const definitions = hasDefinitions ? markdown.slice(markerIndex + WORKFLOW_DEFINITIONS_MARKER.length) : null

  return { instructions, definitions, instructionsTruncated }
}
