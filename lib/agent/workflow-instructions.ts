/**
 * Hybrid workflow.md instructions model (ODE-504, decision 2026-09-09).
 *
 * `workflow.md` is the Workspace agent's operating manual — the analogue of a
 * CLAUDE.md. Its initial instructions section (how the agent should operate
 * plus the intent of the workspace) is ambient invocation context: it rides
 * every agent invocation, hash-validated by the descriptor and bounded by the
 * ODE-501 context budget. The remaining executable workflow definitions stay
 * evidence-on-demand: the descriptor reports their size and scope, and the
 * model fetches the full document through `requestedDocumentIds` only when
 * the intent requires it (e.g. explicitly running a workflow).
 *
 * Split rules, conservative for backward compatibility:
 *
 * - `<!-- workflow-definitions -->` marker present → the boundary is
 *   author-declared: everything before is instructions, everything after is
 *   definitions.
 * - No marker → the document is instructions up to
 *   `MAX_WORKFLOW_INSTRUCTIONS_CHARS`; anything beyond the cap becomes
 *   on-demand definitions (truncated flag set). A legacy file therefore never
 *   rides ambient context unbounded, and a small generated draft
 *   (`buildWorkflowDraft` — intent/scope content) still rides in full.
 *
 * The `scopeSummary` names the headings of the not-loaded side so the model
 * can decide, per question, whether the definitions are worth a bounded
 * second round — a descriptor size alone does not describe scope.
 */

export const WORKFLOW_DEFINITIONS_MARKER = "<!-- workflow-definitions -->"

export const MAX_WORKFLOW_INSTRUCTIONS_CHARS = 8_000

export const MAX_WORKFLOW_SCOPE_HEADINGS = 8

export const MAX_WORKFLOW_SCOPE_HEADING_CHARS = 120

export type WorkflowInstructionsSplit = {
  instructions: string
  definitions: string | null
  instructionsTruncated: boolean
  scopeSummary: string[]
}

function headingsOf(markdown: string): string[] {
  const headings: string[] = []
  for (const line of markdown.split("\n")) {
    const match = /^(#{2,3})\s+(.+)$/.exec(line.trim())
    if (!match) continue
    headings.push(match[2].trim().slice(0, MAX_WORKFLOW_SCOPE_HEADING_CHARS))
    if (headings.length >= MAX_WORKFLOW_SCOPE_HEADINGS) break
  }
  return headings
}

export function splitWorkflowMarkdown(markdown: string): WorkflowInstructionsSplit {
  const markerIndex = markdown.indexOf(WORKFLOW_DEFINITIONS_MARKER)

  if (markerIndex !== -1) {
    const instructions = markdown.slice(0, markerIndex).trimEnd()
    const definitions = markdown.slice(markerIndex + WORKFLOW_DEFINITIONS_MARKER.length)
    const instructionsTruncated = instructions.length > MAX_WORKFLOW_INSTRUCTIONS_CHARS
    return {
      instructions: instructionsTruncated ? instructions.slice(0, MAX_WORKFLOW_INSTRUCTIONS_CHARS) : instructions,
      definitions,
      instructionsTruncated,
      scopeSummary: headingsOf(definitions),
    }
  }

  const trimmed = markdown.trimEnd()
  if (trimmed.length <= MAX_WORKFLOW_INSTRUCTIONS_CHARS) {
    return { instructions: trimmed, definitions: null, instructionsTruncated: false, scopeSummary: [] }
  }

  // No marker and oversized: only the leading section is trusted ambient
  // context; the overflow is disclosed as on-demand definitions, never
  // silently trusted.
  const instructions = trimmed.slice(0, MAX_WORKFLOW_INSTRUCTIONS_CHARS)
  const remainder = trimmed.slice(MAX_WORKFLOW_INSTRUCTIONS_CHARS)
  return {
    instructions,
    definitions: remainder,
    instructionsTruncated: true,
    scopeSummary: headingsOf(remainder),
  }
}
