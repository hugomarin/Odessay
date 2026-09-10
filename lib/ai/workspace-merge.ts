import { z } from "zod"

import {
  MERGE_SECTION_CLASSIFICATIONS,
  type MergeSectionClassification,
} from "@/lib/agent/workspace-agent-analysis"
import type {
  AiUsage,
  WorkspaceSemanticInputItem,
} from "@/lib/services/contracts/ai-service"
import type { WorkspaceAgentEvidence } from "@/lib/services/contracts/workspace-agent"
import type {
  WorkspaceSemanticCoverage,
  WorkspaceSemanticLoopError,
  WorkspaceSemanticLoopResult,
  WorkspaceSemanticLoopStatus,
} from "@/lib/ai/workspace-semantic-loop"
import type { WorkspaceExecutionReceipt } from "@/lib/ai/workspace-execution-receipt"

export const MAX_WORKSPACE_MERGE_DOCUMENTS = 4
export const MAX_WORKSPACE_MERGE_SECTIONS_PER_DOCUMENT = 12
export const MAX_WORKSPACE_MERGE_SECTION_CHARS = 720
export const MAX_WORKSPACE_MERGE_OUTPUT_SECTIONS = MAX_WORKSPACE_MERGE_DOCUMENTS * MAX_WORKSPACE_MERGE_SECTIONS_PER_DOCUMENT
export const MAX_WORKSPACE_MERGE_MARKDOWN_CHARS = 65_536

export type WorkspaceMergeSource = {
  documentId: string
  title: string
  documentVersion: string
  contentHash: string | null
  markdown: string
}

export type MergeAlignedSource = {
  documentId: string
  title: string
  documentVersion: string
  contentHash: string | null
  headingLevel: 1 | 2 | 3
  heading: string
  sectionId: string
  evidenceId: string
  lineStart: number
  lineEnd: number
  text: string
}

export type MergeAlignedSection = {
  sectionId: string
  heading: string
  headingLevel: 1 | 2 | 3
  sources: MergeAlignedSource[]
}

export type WorkspaceMergeRequest = {
  sources: WorkspaceMergeSource[]
  boundedSections: MergeAlignedSection[]
  initialEvidence: WorkspaceAgentEvidence[]
  initialInput: WorkspaceSemanticInputItem[]
}

export type WorkspaceMergeSectionResult = {
  sectionId: string
  heading: string
  headingLevel: 1 | 2 | 3
  classification: MergeSectionClassification
  unifiedText: string | null
  evidenceIds: string[]
  rationale: string
  confidence: "low" | "medium" | "high"
  suggestedSourceDocumentId: string | null
  suggestedSourceReason: string | null
}

export type WorkspaceMergeReviewResult = {
  status: WorkspaceSemanticLoopStatus
  coverage: WorkspaceSemanticCoverage
  rounds: number
  sections: WorkspaceMergeSectionResult[]
  invalidItemCount: number
  sectionCount: number
  evidence: WorkspaceAgentEvidence[]
  usage: AiUsage | null
  executionReceipt: WorkspaceExecutionReceipt | null
  error: WorkspaceSemanticLoopError | null
}

const mergeItemSchema = z.object({
  sectionId: z.string().trim().min(1).max(256),
  heading: z.string().trim().min(1).max(240),
  headingLevel: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  classification: z.enum(MERGE_SECTION_CLASSIFICATIONS),
  unifiedText: z.string().trim().max(6_000).nullable(),
  evidenceIds: z.array(z.string().trim().min(1).max(256)).min(1).max(12),
  rationale: z.string().trim().min(1).max(1_200),
  confidence: z.enum(["low", "medium", "high"]),
  suggestedSourceDocumentId: z.string().trim().min(1).max(128).nullable(),
  suggestedSourceReason: z.string().trim().min(1).max(1_000).nullable(),
}).strict()

const mergePayloadSchema = z.object({
  coverage: z.enum(["complete", "partial", "unknown"]),
  sections: z.array(z.unknown()).max(MAX_WORKSPACE_MERGE_OUTPUT_SECTIONS),
}).strict()

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function digest(value: string): string {
  let hash = 2_166_136_261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16_777_619)
  }
  return (hash >>> 0).toString(16).padStart(8, "0")
}

function normalizedHeading(heading: string): string {
  return heading.trim().toLocaleLowerCase().replace(/\s+/g, " ")
}

function lineRange(start: number, end: number): string {
  return start === end ? `line ${start}` : `lines ${start}-${end}`
}

type ParsedBlock = {
  heading: string
  headingLevel: 1 | 2 | 3
  lineStart: number
  lineEnd: number
  text: string
}

function parseBlocks(source: WorkspaceMergeSource): ParsedBlock[] {
  const lines = source.markdown.split("\n")
  const headings: Array<{ index: number; level: 1 | 2 | 3; heading: string }> = []
  lines.forEach((line, index) => {
    const match = /^(#{1,3})\s+(.+?)\s*$/.exec(line.trim())
    if (!match) return
    headings.push({
      index,
      level: match[1].length as 1 | 2 | 3,
      heading: match[2].trim(),
    })
  })

  if (headings.length === 0) {
    const first = lines.findIndex((line) => line.trim().length > 0)
    if (first < 0) return []
    const last = lines.length - 1
    const text = lines.slice(first, last + 1).join("\n").trim().slice(0, MAX_WORKSPACE_MERGE_SECTION_CHARS)
    const lineCount = Math.max(1, text.split("\n").length)
    return text
      ? [{
          heading: source.title.trim().slice(0, 240) || "Documento",
          headingLevel: 1,
          lineStart: first + 1,
          lineEnd: first + lineCount,
          text,
        }]
      : []
  }

  return headings.slice(0, MAX_WORKSPACE_MERGE_SECTIONS_PER_DOCUMENT).map((heading, index) => {
    const next = headings[index + 1]
    const bodyStart = heading.index + 1
    const bodyEnd = (next?.index ?? lines.length) - 1
    const body = lines.slice(bodyStart, bodyEnd + 1).join("\n").trim()
    const text = (body || heading.heading).slice(0, MAX_WORKSPACE_MERGE_SECTION_CHARS)
    const lineStart = body ? bodyStart + 1 : heading.index + 1
    const lineEnd = body
      ? lineStart + Math.max(1, text.split("\n").length) - 1
      : heading.index + 1
    return {
      heading: heading.heading.slice(0, 240),
      headingLevel: heading.level,
      lineStart,
      lineEnd,
      text,
    }
  })
}

function sourceEvidence(source: MergeAlignedSource): WorkspaceAgentEvidence {
  return {
    evidenceId: source.evidenceId,
    documentId: source.documentId,
    documentVersion: source.documentVersion,
    contentHash: source.contentHash,
    lineStart: source.lineStart,
    lineEnd: source.lineEnd,
    text: source.text,
  }
}

function alignmentFor(sources: readonly WorkspaceMergeSource[]): {
  boundedSources: WorkspaceMergeSource[]
  sections: MergeAlignedSection[]
  evidence: WorkspaceAgentEvidence[]
} {
  const boundedSources = sources.slice(0, MAX_WORKSPACE_MERGE_DOCUMENTS).map((source) => ({
    ...source,
    title: source.title.trim().slice(0, 240) || source.documentId,
    documentVersion: source.documentVersion.trim().slice(0, 256),
    contentHash: source.contentHash?.slice(0, 512) ?? null,
  }))
  const parsed = boundedSources.map((source) => ({ source, blocks: parseBlocks(source) }))
  const order: string[] = []
  const seenHeadings = new Set<string>()

  for (const document of parsed) {
    const seenInDocument = new Set<string>()
    for (const block of document.blocks) {
      const key = normalizedHeading(block.heading)
      if (seenInDocument.has(key)) continue
      seenInDocument.add(key)
      if (!seenHeadings.has(key)) {
        seenHeadings.add(key)
        order.push(key)
      }
    }
  }

  const sections = order.map((key) => {
    const contributions = parsed.flatMap((document) => {
      const block = document.blocks.find((candidate) => normalizedHeading(candidate.heading) === key)
      return block ? [{ source: document.source, block }] : []
    })
    const heading = contributions[0]?.block.heading ?? key
    const headingLevel = contributions[0]?.block.headingLevel ?? 1
    const sourceIdentity = contributions.map(({ source, block }) => `${source.documentId}:${source.documentVersion}:${block.lineStart}-${block.lineEnd}`).join("|")
    const sectionId = `merge-section:${digest(`${key}|${sourceIdentity}`)}`
    const alignedSources = contributions.map(({ source, block }) => {
      const evidenceId = `merge:${source.documentId}:${source.documentVersion}:${block.lineStart}-${block.lineEnd}:${digest(block.text)}`
      return {
        documentId: source.documentId,
        title: source.title,
        documentVersion: source.documentVersion,
        contentHash: source.contentHash,
        headingLevel: block.headingLevel,
        heading: block.heading,
        sectionId,
        evidenceId,
        lineStart: block.lineStart,
        lineEnd: block.lineEnd,
        text: block.text,
      } satisfies MergeAlignedSource
    })
    return { sectionId, heading, headingLevel, sources: alignedSources } satisfies MergeAlignedSection
  })

  return {
    boundedSources,
    sections,
    evidence: sections.flatMap((section) => section.sources.map(sourceEvidence)),
  }
}

function mergePrompt(
  sources: readonly WorkspaceMergeSource[],
  sections: readonly MergeAlignedSection[],
  evidence: readonly WorkspaceAgentEvidence[],
): string {
  return JSON.stringify({
    task: "Synthesize a bounded, reviewable document from explicitly selected artifacts.",
    policy: [
      "Alignment hints are deterministic recall aids only; they are not semantic truth.",
      "Never choose a semantic winner by overlap, similarity, body length, timestamp, or document order.",
      "Classify every aligned section as equivalent, style_only, complementary, contradictory, irrelevant, or insufficient_evidence.",
      "Equivalent and style_only sections need a safe unifiedText; complementary sections must integrate compatible information without repetition.",
      "Material contradictions must remain unresolved with no unifiedText and must cite exact evidence from each relevant document.",
      "Use insufficient_evidence when the bounded evidence cannot justify a safe synthesis.",
      "Use only supplied evidenceIds. Do not invent quotes, document ids, paths, versions, or timestamps.",
      "Suggest a source document only when an explicit evidence-grounded reason supports it; never infer a suggestion from recency.",
      "Write coherent prose with headings and transitions. Do not return a transcript, duplicate claims, or raw analysis.",
    ],
    sources: sources.map((source) => ({
      documentId: source.documentId,
      title: source.title,
      documentVersion: source.documentVersion,
      contentHash: source.contentHash,
    })),
    alignmentHints: sections.map((section) => ({
      sectionId: section.sectionId,
      heading: section.heading,
      headingLevel: section.headingLevel,
      sourceEvidenceIds: section.sources.map((source) => source.evidenceId),
    })),
    evidence,
    outputContract: {
      coverage: "complete|partial|unknown",
      sections: [{
        sectionId: "known alignment section id",
        heading: "known heading",
        headingLevel: "1|2|3",
        classification: MERGE_SECTION_CLASSIFICATIONS.join("|"),
        unifiedText: "safe synthesized section text or null when unresolved/omitted",
        evidenceIds: "exact supplied ids supporting this classification",
        rationale: "brief evidence-grounded rationale",
        confidence: "low|medium|high",
        suggestedSourceDocumentId: "explicit source id or null",
        suggestedSourceReason: "reason for explicit suggestion or null",
      }],
    },
  })
}

export function buildWorkspaceMergeRequest(
  sources: readonly WorkspaceMergeSource[],
): WorkspaceMergeRequest {
  const alignment = alignmentFor(sources)
  return {
    sources: alignment.boundedSources,
    boundedSections: alignment.sections,
    initialEvidence: alignment.evidence,
    initialInput: [{
      type: "message",
      role: "user",
      content: mergePrompt(alignment.boundedSources, alignment.sections, alignment.evidence),
    }],
  }
}

function parseJson(text: string): unknown | null {
  try {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
    const parsed = JSON.parse((fenced ?? text).trim()) as unknown
    if (isRecord(parsed) && typeof parsed.payload === "string") {
      return JSON.parse(parsed.payload) as unknown
    }
    return parsed
  } catch {
    return null
  }
}

function usageFromReceipt(receipt: WorkspaceExecutionReceipt | null): AiUsage | null {
  if (!receipt || receipt.responses.length === 0) return null
  const responses = receipt.responses
  const sum = (key: "promptTokens" | "completionTokens" | "totalTokens"): number | null => {
    const values = responses.map((response) => response.usage[key]).filter((value): value is number => typeof value === "number")
    return values.length > 0 ? values.reduce((total, value) => total + value, 0) : null
  }
  const latency = responses.map((response) => response.latencyMs).filter((value): value is number => typeof value === "number")
  return {
    model: responses.at(-1)?.model ?? "unknown",
    promptTokens: sum("promptTokens"),
    completionTokens: sum("completionTokens"),
    totalTokens: sum("totalTokens"),
    latencyMs: latency.length > 0 ? latency.reduce((total, value) => total + value, 0) : null,
  }
}

function invalidOutput(message: string): WorkspaceSemanticLoopError {
  return { code: "AI_RESPONSE_PARSE_FAILED", message, retryable: true }
}

function conservativeCoverage(
  loopCoverage: WorkspaceSemanticCoverage,
  payloadCoverage: WorkspaceSemanticCoverage,
  invalidItemCount: number,
): WorkspaceSemanticCoverage {
  if (loopCoverage === "unknown" || payloadCoverage === "unknown") return "unknown"
  if (loopCoverage === "partial" || payloadCoverage === "partial" || invalidItemCount > 0) return "partial"
  return "complete"
}

function statusAfterValidation(
  loopStatus: WorkspaceSemanticLoopStatus,
  coverage: WorkspaceSemanticCoverage,
  invalidItemCount: number,
): WorkspaceSemanticLoopStatus {
  if (loopStatus !== "complete") return loopStatus
  return coverage === "complete" && invalidItemCount === 0 ? "complete" : "insufficient_evidence"
}

function sourceIdsFor(section: MergeAlignedSection): Set<string> {
  return new Set(section.sources.map((source) => source.documentId))
}

export function parseWorkspaceMergeResult(
  loop: WorkspaceSemanticLoopResult,
  request: WorkspaceMergeRequest,
): WorkspaceMergeReviewResult {
  const evidenceById = new Map(loop.evidence.map((item) => [item.evidenceId, item]))
  const sectionsById = new Map(request.boundedSections.map((section) => [section.sectionId, section]))
  const parsedPayload = loop.finalText ? parseJson(loop.finalText) : null
  const payload = mergePayloadSchema.safeParse(parsedPayload)
  if (!payload.success) {
    return {
      status: loop.status === "complete" ? "unable" : loop.status,
      coverage: loop.status === "complete" ? "unknown" : loop.coverage,
      rounds: loop.rounds,
      sections: [],
      invalidItemCount: loop.status === "complete" ? 1 : 0,
      sectionCount: request.boundedSections.length,
      evidence: loop.evidence,
      usage: usageFromReceipt(loop.executionReceipt),
      executionReceipt: loop.executionReceipt,
      error: loop.status === "complete"
        ? invalidOutput("The semantic merge response did not match the merge contract.")
        : loop.error,
    }
  }

  const sections: WorkspaceMergeSectionResult[] = []
  let invalidItemCount = 0
  const seenSectionIds = new Set<string>()
  for (const rawItem of payload.data.sections) {
    const item = mergeItemSchema.safeParse(rawItem)
    if (!item.success) {
      invalidItemCount += 1
      continue
    }
    const aligned = sectionsById.get(item.data.sectionId)
    if (!aligned || seenSectionIds.has(item.data.sectionId)) {
      invalidItemCount += 1
      continue
    }
    if (item.data.heading !== aligned.heading || item.data.headingLevel !== aligned.headingLevel) {
      invalidItemCount += 1
      continue
    }

    const admittedEvidenceIds = new Set(aligned.sources.map((source) => source.evidenceId))
    const evidenceIds = [...new Set(item.data.evidenceIds)]
    if (evidenceIds.some((id) => !admittedEvidenceIds.has(id) || !evidenceById.has(id))) {
      invalidItemCount += 1
      continue
    }
    const cited = evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id)
      return evidence ? [evidence] : []
    })
    const citedDocumentIds = new Set(cited.map((item) => item.documentId))
    const availableDocumentIds = sourceIdsFor(aligned)
    if ([...citedDocumentIds].some((id) => !availableDocumentIds.has(id))) {
      invalidItemCount += 1
      continue
    }

    const safeSynthesis = item.data.classification === "equivalent"
      || item.data.classification === "style_only"
      || item.data.classification === "complementary"
    if (safeSynthesis && !item.data.unifiedText) {
      invalidItemCount += 1
      continue
    }
    if (!safeSynthesis && item.data.unifiedText) {
      invalidItemCount += 1
      continue
    }
    if (
      item.data.classification === "contradictory"
      && citedDocumentIds.size < 2
    ) {
      invalidItemCount += 1
      continue
    }

    let suggestedSourceDocumentId = item.data.suggestedSourceDocumentId
    let suggestedSourceReason = item.data.suggestedSourceReason
    if (suggestedSourceDocumentId === null) suggestedSourceReason = null
    if (
      suggestedSourceDocumentId !== null
      && (!availableDocumentIds.has(suggestedSourceDocumentId) || !suggestedSourceReason)
    ) {
      // Keep the semantic classification, but never turn an invalid source
      // hint into an implicit winner.
      invalidItemCount += 1
      suggestedSourceDocumentId = null
      suggestedSourceReason = null
    }

    seenSectionIds.add(item.data.sectionId)
    sections.push({
      sectionId: item.data.sectionId,
      heading: item.data.heading,
      headingLevel: item.data.headingLevel,
      classification: item.data.classification,
      unifiedText: item.data.unifiedText || null,
      evidenceIds,
      rationale: item.data.rationale,
      confidence: item.data.confidence,
      suggestedSourceDocumentId,
      suggestedSourceReason,
    })
  }

  if (payload.data.coverage === "complete") {
    invalidItemCount += request.boundedSections.filter((section) => !seenSectionIds.has(section.sectionId)).length
  }
  const coverage = conservativeCoverage(loop.coverage, payload.data.coverage, invalidItemCount)
  const status = statusAfterValidation(loop.status, coverage, invalidItemCount)
  return {
    status,
    coverage,
    rounds: loop.rounds,
    sections,
    invalidItemCount,
    sectionCount: request.boundedSections.length,
    evidence: loop.evidence,
    usage: usageFromReceipt(loop.executionReceipt),
    executionReceipt: loop.executionReceipt,
    error: status === "insufficient_evidence" && !loop.error
      ? invalidOutput("Some merge sections were incomplete or lacked valid provenance.")
      : loop.error,
  }
}

export function lineRangeForMergeSource(source: MergeAlignedSource): string {
  return lineRange(source.lineStart, source.lineEnd)
}
