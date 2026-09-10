/**
 * Hybrid workflow.md instructions model (ODE-504, decision 2026-09-09).
 *
 * `workflow.md` is the Workspace agent's operating manual — the analogue of a
 * CLAUDE.md. Its instructions (how the agent should operate plus the intent
 * of the workspace) are ambient invocation context: they ride every agent
 * invocation, hash-validated by the descriptor and bounded by the ODE-501
 * context budget. Executable workflow definitions stay evidence-on-demand:
 * the descriptor reports their size and scope, and the model fetches the
 * full document through `requestedDocumentIds` only when the intent
 * requires it (e.g. explicitly running a workflow).
 *
 * Split rules, conservative for backward compatibility:
 *
 * - `<!-- workflow-definitions -->` marker present → the boundary is
 *   author-declared: everything before is instructions, everything after is
 *   definitions.
 * - No marker → known-sections parsing. Only the document title line (leading
 *   H1), preamble prose when a heading structure follows, and blocks under
 *   the intent/scope headings the generated draft uses (`Intent`, `Scope`,
 *   `Objectives`, `Context`, `Participants`) are trusted instructions;
 *   every other block — a legacy file's executable definitions included —
 *   becomes on-demand definitions with its headings surfaced in the
 *   descriptor's scope summary. A legacy file therefore never rides trusted
 *   ambient context unbounded, and a small generated draft still rides in
 *   full because every one of its blocks is a known intent/scope section.
 *   A fully unheaded file is ambiguous and remains on demand.
 *   Oversized trusted content is capped at `MAX_WORKFLOW_INSTRUCTIONS_CHARS`
 *   with the truncation flagged.
 *
 * The `scopeSummary` names the headings of the not-loaded side (any heading
 * level, H1–H6), or a bounded first-line fallback when no heading exists, so
 * the model can decide whether the definitions are worth a bounded second
 * round — a descriptor size alone does not describe scope.
 */

export const WORKFLOW_DEFINITIONS_MARKER = "<!-- workflow-definitions -->"

export const MAX_WORKFLOW_INSTRUCTIONS_CHARS = 8_000

export const MAX_WORKFLOW_SCOPE_HEADINGS = 8

export const MAX_WORKFLOW_SCOPE_HEADING_CHARS = 120

/**
 * First-word headings the generated draft uses for the workspace's intent
 * and scope (`buildWorkflowDraft`). They are the only heading-led blocks a
 * marker-less file may contribute to the trusted instructions; anything
 * else in a marker-less file stays untrusted, on-demand evidence.
 */
const KNOWN_INTENT_HEADING_WORDS = new Set(["intent", "scope", "objectives", "context", "participants"])

export type WorkflowInstructionsSplit = {
  instructions: string
  definitions: string | null
  instructionsTruncated: boolean
  scopeSummary: string[]
}

type MarkdownBlock = {
  /** null = prose before the first heading (the document's own intro). */
  headingWord: string | null
  headingLevel: number
  text: string
}

function blocksOf(markdown: string): MarkdownBlock[] {
  const blocks: MarkdownBlock[] = []
  let headingWord: string | null = null
  let headingLevel = 0
  let lines: string[] = []
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(\S.*)$/.exec(line.trim())
    if (match) {
      blocks.push({ headingWord, headingLevel, text: lines.join("\n") })
      headingWord = match[2].trim()
      headingLevel = match[1].length
      lines = [line]
      continue
    }
    lines.push(line)
  }
  blocks.push({ headingWord, headingLevel, text: lines.join("\n") })
  return blocks
}

function scopeSummaryOf(markdown: string): string[] {
  const scope: string[] = []
  let firstUnheadedLine: string | null = null
  let sawHeading = false
  for (const line of markdown.split("\n")) {
    const match = /^(#{1,6})\s+(.+)$/.exec(line.trim())
    if (match) {
      sawHeading = true
      scope.push(match[2].trim().slice(0, MAX_WORKFLOW_SCOPE_HEADING_CHARS))
      if (scope.length >= MAX_WORKFLOW_SCOPE_HEADINGS) break
      continue
    }
    if (!sawHeading && firstUnheadedLine === null && line.trim().length > 0) {
      firstUnheadedLine = line
        .trim()
        .replace(/^(?:[-*+]\s+|\d+[.)]\s+)/, "")
        .trim()
    }
  }
  if (firstUnheadedLine !== null) {
    scope.unshift(
      `Definitions without heading: ${firstUnheadedLine || "workflow steps"}`
        .slice(0, MAX_WORKFLOW_SCOPE_HEADING_CHARS),
    )
  }
  return scope.slice(0, MAX_WORKFLOW_SCOPE_HEADINGS)
}

function isKnownIntentBlock(block: MarkdownBlock): boolean {
  if (block.headingWord === null) return true
  const firstWord = block.headingWord.split(/\s+/)[0]?.replace(/:$/, "").toLowerCase() ?? ""
  return KNOWN_INTENT_HEADING_WORDS.has(firstWord)
}

export function splitWorkflowMarkdown(markdown: string): WorkflowInstructionsSplit {
  const markerIndex = markdown.indexOf(WORKFLOW_DEFINITIONS_MARKER)

  if (markerIndex !== -1) {
    const instructions = markdown.slice(0, markerIndex).trimEnd()
    const definitions = markdown.slice(markerIndex + WORKFLOW_DEFINITIONS_MARKER.length)
    const instructionsTruncated = instructions.length > MAX_WORKFLOW_INSTRUCTIONS_CHARS
    return {
      instructions: instructionsTruncated ? instructions.slice(0, MAX_WORKFLOW_INSTRUCTIONS_CHARS) : instructions,
      definitions: definitions.trim().length > 0 ? definitions : null,
      instructionsTruncated,
      scopeSummary: scopeSummaryOf(definitions),
    }
  }

  // No marker → conservative known-sections parsing: the document title,
  // intro prose and known intent/scope blocks are the only trusted part. A
  // title contributes only its heading line: its body remains unclassified
  // evidence and must not become trusted merely because it follows the H1.
  // A document with no headings at all is likewise ambiguous and therefore
  // stays on demand rather than being promoted wholesale to instructions.
  const instructionLines: string[] = []
  const definitionLines: string[] = []
  const blocks = blocksOf(markdown)
  const hasHeading = blocks.some((block) => block.headingWord !== null)
  let titleConsumed = false
  blocks.forEach((block) => {
    // The document title (the first heading the file opens with, at any
    // position after intro prose) and the prose before any heading are the
    // manual's cover page; only the first heading gets that treatment — a
    // later H1 is just another section the parser does not recognize.
    const isTitle = !titleConsumed && block.headingLevel === 1
    if (block.headingWord !== null && !titleConsumed) titleConsumed = true
    const knownIntent = isKnownIntentBlock(block)
    if (block.headingWord === null) {
      if (hasHeading) instructionLines.push(block.text)
      else definitionLines.push(block.text)
    } else if (isTitle && !knownIntent) {
      const [headingLine = "", ...bodyLines] = block.text.split("\n")
      instructionLines.push(headingLine)
      const body = bodyLines.join("\n").trim()
      if (body.length > 0) definitionLines.push(body)
    } else if (knownIntent) {
      instructionLines.push(block.text)
    } else {
      definitionLines.push(block.text)
    }
  })
  const instructions = instructionLines
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n")
  const definitionsRaw = definitionLines
    .map((block) => block.trim())
    .filter((block) => block.length > 0)
    .join("\n\n")
  const definitions = definitionsRaw.length > 0 ? definitionsRaw : null
  const instructionsTruncated = instructions.length > MAX_WORKFLOW_INSTRUCTIONS_CHARS
  return {
    instructions: instructionsTruncated ? instructions.slice(0, MAX_WORKFLOW_INSTRUCTIONS_CHARS) : instructions,
    definitions,
    instructionsTruncated,
    scopeSummary: definitions ? scopeSummaryOf(definitions) : [],
  }
}
