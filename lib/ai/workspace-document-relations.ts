import { z } from "zod"

import {
  extractDocumentStatementFragments,
  type ContradictionFragment,
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

export const WORKSPACE_RELATION_VERDICTS = [
  "style_only",
  "equivalent",
  "complementary",
  "contradictory",
  "context_dependent",
  "unrelated",
  "insufficient_evidence",
] as const

export type WorkspaceRelationVerdict = (typeof WORKSPACE_RELATION_VERDICTS)[number]

export const WORKSPACE_RELATION_CONFIDENCES = ["low", "medium", "high"] as const
export type WorkspaceRelationConfidence = (typeof WORKSPACE_RELATION_CONFIDENCES)[number]

/** Conservative policy: only a high-confidence, evidence-backed conflict enters a resolvable queue. */
export const WORKSPACE_RELATION_CONTRADICTION_MIN_CONFIDENCE: WorkspaceRelationConfidence = "high"

export const MAX_WORKSPACE_RELATION_DOCUMENTS = 4
export const MAX_WORKSPACE_RELATION_FRAGMENTS_PER_DOCUMENT = 12
export const MAX_WORKSPACE_RELATION_FRAGMENT_CHARS = 720
export const MAX_WORKSPACE_RELATION_CANDIDATES = 96
export const MAX_WORKSPACE_RELATION_CANDIDATES_PER_DOCUMENT_PAIR = 24

export type WorkspaceDocumentRelationSource = {
  documentId: string
  title: string
  documentVersion: string
  contentHash: string | null
  markdown: string
}

export type WorkspaceDocumentRelationCandidate = {
  candidateId: string
  leftDocumentId: string
  rightDocumentId: string
  leftEvidenceId: string
  rightEvidenceId: string
  /** Recall signal only; it is never a semantic verdict. */
  deterministicSignal: "lexical-candidate" | "coverage-sample"
}

export type WorkspaceDocumentRelationsRequest = {
  sources: WorkspaceDocumentRelationSource[]
  initialEvidence: WorkspaceAgentEvidence[]
  candidates: WorkspaceDocumentRelationCandidate[]
  initialInput: WorkspaceSemanticInputItem[]
}

export type WorkspaceDocumentRelationEvidenceRef = {
  evidenceId: string
  documentId: string
  documentVersion: string
  contentHash: string | null
  lineStart: number
  lineEnd: number
  text: string
}

export type WorkspaceDocumentRelation = {
  relationId: string
  candidateId: string | null
  leftDocumentId: string
  rightDocumentId: string
  verdict: WorkspaceRelationVerdict
  confidence: WorkspaceRelationConfidence
  rationale: string
  evidenceIds: string[]
  provenance: WorkspaceDocumentRelationEvidenceRef[]
  /** Only an explicit model suggestion survives; recency never fills this field. */
  suggestedDocumentId: string | null
  suggestedReason: string | null
}

export type WorkspaceDocumentRelationsResult = {
  status: WorkspaceSemanticLoopStatus
  coverage: WorkspaceSemanticCoverage
  relations: WorkspaceDocumentRelation[]
  invalidItemCount: number
  candidateCount: number
  evidence: WorkspaceAgentEvidence[]
  usage: AiUsage | null
  executionReceipt: WorkspaceExecutionReceipt | null
  error: WorkspaceSemanticLoopError | null
}

const relationItemSchema = z.object({
  candidateId: z.string().trim().min(1).max(256).nullable(),
  leftDocumentId: z.string().trim().min(1).max(128),
  rightDocumentId: z.string().trim().min(1).max(128),
  verdict: z.enum(WORKSPACE_RELATION_VERDICTS),
  confidence: z.enum(WORKSPACE_RELATION_CONFIDENCES),
  rationale: z.string().trim().min(1).max(1_200),
  evidenceIds: z.array(z.string().trim().min(1).max(256)).min(2).max(8),
  suggestedDocumentId: z.string().trim().min(1).max(128).nullable(),
  suggestedReason: z.string().trim().min(1).max(1_000).nullable(),
}).strict()

const relationPayloadSchema = z.object({
  coverage: z.enum(["complete", "partial", "unknown"]),
  relations: z.array(z.unknown()).max(MAX_WORKSPACE_RELATION_CANDIDATES),
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

function fallbackFragment(markdown: string): ContradictionFragment | null {
  const lines = markdown.split("\n")
  const firstLine = lines.findIndex((line) => line.trim().length > 0)
  if (firstLine < 0) return null
  const start = lines.slice(0, firstLine).reduce((total, line) => total + line.length + 1, 0)
  const text = lines.slice(firstLine, firstLine + 3).join("\n").trim().slice(0, MAX_WORKSPACE_RELATION_FRAGMENT_CHARS)
  if (!text) return null
  return {
    text,
    start,
    end: start + text.length,
    line: firstLine + 1,
  }
}

function evidenceId(source: WorkspaceDocumentRelationSource, fragment: ContradictionFragment): string {
  return [
    "relation",
    source.documentId,
    source.documentVersion,
    `${fragment.line}-${digest(fragment.text)}`,
  ].join(":")
}

function sourceEvidence(
  source: WorkspaceDocumentRelationSource,
  fragment: ContradictionFragment,
): WorkspaceAgentEvidence {
  const text = fragment.text.slice(0, MAX_WORKSPACE_RELATION_FRAGMENT_CHARS)
  return {
    evidenceId: evidenceId(source, fragment),
    documentId: source.documentId,
    documentVersion: source.documentVersion,
    contentHash: source.contentHash,
    lineStart: fragment.line,
    lineEnd: fragment.line + Math.max(0, text.split("\n").length - 1),
    text,
  }
}

function words(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((word) => word.length >= 3),
  )
}

function pairScore(left: string, right: string): number {
  const leftWords = words(left)
  const rightWords = words(right)
  if (leftWords.size === 0 || rightWords.size === 0) return 0
  const shared = [...leftWords].filter((word) => rightWords.has(word)).length
  return shared / Math.max(leftWords.size, rightWords.size)
}

function candidateId(leftEvidenceId: string, rightEvidenceId: string): string {
  return `relation-candidate:${digest(`${leftEvidenceId}|${rightEvidenceId}`)}`
}

function buildCandidates(
  sources: readonly WorkspaceDocumentRelationSource[],
  evidence: readonly WorkspaceAgentEvidence[],
): WorkspaceDocumentRelationCandidate[] {
  const evidenceByDocument = new Map<string, WorkspaceAgentEvidence[]>()
  for (const item of evidence) {
    const existing = evidenceByDocument.get(item.documentId) ?? []
    existing.push(item)
    evidenceByDocument.set(item.documentId, existing)
  }

  const result: WorkspaceDocumentRelationCandidate[] = []
  const seen = new Set<string>()
  for (let leftIndex = 0; leftIndex < sources.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < sources.length; rightIndex += 1) {
      const left = evidenceByDocument.get(sources[leftIndex]?.documentId ?? "") ?? []
      const right = evidenceByDocument.get(sources[rightIndex]?.documentId ?? "") ?? []
      const pairs = left.flatMap((leftEvidence) => right.map((rightEvidence) => ({
        leftEvidence,
        rightEvidence,
        score: pairScore(leftEvidence.text, rightEvidence.text),
      }))).sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score
        return `${a.leftEvidence.evidenceId}|${a.rightEvidence.evidenceId}`.localeCompare(
          `${b.leftEvidence.evidenceId}|${b.rightEvidence.evidenceId}`,
        )
      })
      const selected = new Set<string>()

      // Keep every statement's best counterpart in the bounded sample. This
      // lets semantic review see a matcher-missed pair even when it has no
      // shared words, while lexical matches remain useful recall hints.
      for (const leftEvidence of left) {
        const best = pairs.find((pair) => pair.leftEvidence.evidenceId === leftEvidence.evidenceId)
        if (best) selected.add(`${best.leftEvidence.evidenceId}|${best.rightEvidence.evidenceId}`)
      }
      for (const rightEvidence of right) {
        const best = pairs.find((pair) => pair.rightEvidence.evidenceId === rightEvidence.evidenceId)
        if (best) selected.add(`${best.leftEvidence.evidenceId}|${best.rightEvidence.evidenceId}`)
      }
      for (const pair of pairs) {
        if (selected.size >= MAX_WORKSPACE_RELATION_CANDIDATES_PER_DOCUMENT_PAIR) break
        selected.add(`${pair.leftEvidence.evidenceId}|${pair.rightEvidence.evidenceId}`)
      }

      for (const pair of pairs) {
        const key = `${pair.leftEvidence.evidenceId}|${pair.rightEvidence.evidenceId}`
        if (!selected.has(key) || seen.has(key)) continue
        seen.add(key)
        result.push({
          candidateId: candidateId(pair.leftEvidence.evidenceId, pair.rightEvidence.evidenceId),
          leftDocumentId: pair.leftEvidence.documentId,
          rightDocumentId: pair.rightEvidence.documentId,
          leftEvidenceId: pair.leftEvidence.evidenceId,
          rightEvidenceId: pair.rightEvidence.evidenceId,
          deterministicSignal: pair.score > 0 ? "lexical-candidate" : "coverage-sample",
        })
        if (result.length >= MAX_WORKSPACE_RELATION_CANDIDATES) return result
      }
    }
  }
  return result
}

function relationPrompt(
  sources: readonly WorkspaceDocumentRelationSource[],
  evidence: readonly WorkspaceAgentEvidence[],
  candidates: readonly WorkspaceDocumentRelationCandidate[],
): string {
  return JSON.stringify({
    task: "Review semantic relations between bounded document claims.",
    policy: [
      "The deterministic candidates are recall hints only, never truth or completeness.",
      "Use the supplied evidence ids exactly; do not invent ids or quotes.",
      "A relation must cite evidence from both documents.",
      "Use insufficient_evidence when the supplied evidence cannot justify a distinction.",
      "Only suggest a source document when the suggestion is explicit, evidence-backed and not based on recency alone.",
    ],
    sources: sources.map((source) => ({
      documentId: source.documentId,
      title: source.title.slice(0, 240),
      documentVersion: source.documentVersion.slice(0, 256),
      contentHash: source.contentHash,
    })),
    evidence,
    candidates,
    outputContract: {
      coverage: "complete|partial|unknown",
      relations: [{
        candidateId: "known candidate id or null",
        leftDocumentId: "known document id",
        rightDocumentId: "known document id",
        verdict: WORKSPACE_RELATION_VERDICTS.join("|"),
        confidence: WORKSPACE_RELATION_CONFIDENCES.join("|"),
        rationale: "brief evidence-grounded explanation",
        evidenceIds: "at least one evidence id from each document",
        suggestedDocumentId: "explicit id or null; never infer from updatedAt",
        suggestedReason: "reason when an explicit suggestion is made, otherwise null",
      }],
    },
  })
}

export function buildWorkspaceDocumentRelationsRequest(
  sources: readonly WorkspaceDocumentRelationSource[],
): WorkspaceDocumentRelationsRequest {
  const boundedSources = sources.slice(0, MAX_WORKSPACE_RELATION_DOCUMENTS).map((source) => ({
    ...source,
    title: source.title.trim().slice(0, 240),
    documentVersion: source.documentVersion.trim().slice(0, 256),
    contentHash: source.contentHash?.slice(0, 512) ?? null,
  }))
  const initialEvidence = boundedSources.flatMap((source) => {
    const fragments = extractDocumentStatementFragments(
      source.markdown,
      MAX_WORKSPACE_RELATION_FRAGMENTS_PER_DOCUMENT,
    )
    const usable = fragments.length > 0 ? fragments : [fallbackFragment(source.markdown)].filter(
      (fragment): fragment is ContradictionFragment => Boolean(fragment),
    )
    return usable.map((fragment) => sourceEvidence(source, fragment))
  })
  const candidates = buildCandidates(boundedSources, initialEvidence)
  const initialInput: WorkspaceSemanticInputItem[] = [{
    type: "message",
    role: "user",
    content: relationPrompt(boundedSources, initialEvidence, candidates),
  }]
  return {
    sources: boundedSources,
    initialEvidence,
    candidates,
    initialInput,
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

function relationId(
  item: z.infer<typeof relationItemSchema>,
  evidenceIds: readonly string[],
): string {
  return `semantic-relation:${digest([
    item.leftDocumentId,
    item.rightDocumentId,
    item.verdict,
    ...[...evidenceIds].sort(),
  ].join("|"))}`
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

export function parseWorkspaceDocumentRelationsResult(
  loop: WorkspaceSemanticLoopResult,
  request: WorkspaceDocumentRelationsRequest,
): WorkspaceDocumentRelationsResult {
  const evidenceById = new Map(loop.evidence.map((item) => [item.evidenceId, item]))
  const sourceIds = new Set(request.sources.map((source) => source.documentId))
  const candidatesById = new Map(request.candidates.map((candidate) => [candidate.candidateId, candidate]))
  const parsedPayload = loop.finalText ? parseJson(loop.finalText) : null
  const payload = relationPayloadSchema.safeParse(parsedPayload)
  if (!payload.success) {
    return {
      status: loop.status === "complete" ? "unable" : loop.status,
      coverage: loop.status === "complete" ? "unknown" : loop.coverage,
      relations: [],
      invalidItemCount: loop.status === "complete" ? 1 : 0,
      candidateCount: request.candidates.length,
      evidence: loop.evidence,
      usage: usageFromReceipt(loop.executionReceipt),
      executionReceipt: loop.executionReceipt,
      error: loop.status === "complete"
        ? invalidOutput("The semantic relation response did not match the relation contract.")
        : loop.error,
    }
  }

  const relations: WorkspaceDocumentRelation[] = []
  let invalidItemCount = 0
  const seenRelationIds = new Set<string>()
  for (const rawItem of payload.data.relations) {
    const item = relationItemSchema.safeParse(rawItem)
    if (!item.success) {
      invalidItemCount += 1
      continue
    }
    if (
      !sourceIds.has(item.data.leftDocumentId)
      || !sourceIds.has(item.data.rightDocumentId)
      || item.data.leftDocumentId === item.data.rightDocumentId
      || (item.data.candidateId !== null && !candidatesById.has(item.data.candidateId))
    ) {
      invalidItemCount += 1
      continue
    }

    const evidenceIds = [...new Set(item.data.evidenceIds)]
    const provenance = evidenceIds.flatMap((id) => {
      const evidence = evidenceById.get(id)
      if (!evidence) return []
      return [{
        evidenceId: evidence.evidenceId,
        documentId: evidence.documentId,
        documentVersion: evidence.documentVersion,
        contentHash: evidence.contentHash,
        lineStart: evidence.lineStart,
        lineEnd: evidence.lineEnd,
        text: evidence.text,
      }]
    })
    const provenanceDocumentIds = new Set(provenance.map((entry) => entry.documentId))
    const candidate = item.data.candidateId === null ? null : candidatesById.get(item.data.candidateId)
    if (
      provenance.length !== evidenceIds.length
      || provenanceDocumentIds.size < 2
      || !provenanceDocumentIds.has(item.data.leftDocumentId)
      || !provenanceDocumentIds.has(item.data.rightDocumentId)
      || (candidate !== null && (
        candidate === undefined
        || candidate.leftDocumentId !== item.data.leftDocumentId
        || candidate.rightDocumentId !== item.data.rightDocumentId
        || !evidenceIds.includes(candidate.leftEvidenceId)
        || !evidenceIds.includes(candidate.rightEvidenceId)
      ))
    ) {
      invalidItemCount += 1
      continue
    }

    let suggestedDocumentId = item.data.suggestedDocumentId
    let suggestedReason = item.data.suggestedReason
    if (suggestedDocumentId === null) suggestedReason = null
    if (
      suggestedDocumentId !== null
      && (!sourceIds.has(suggestedDocumentId) || !suggestedReason)
    ) {
      // The semantic classification remains useful, but the invalid source
      // hint is discarded rather than becoming a hidden recency fallback.
      invalidItemCount += 1
      suggestedDocumentId = null
      suggestedReason = null
    }

    const id = relationId(item.data, evidenceIds)
    if (seenRelationIds.has(id)) {
      invalidItemCount += 1
      continue
    }
    seenRelationIds.add(id)
    relations.push({
      relationId: id,
      candidateId: item.data.candidateId,
      leftDocumentId: item.data.leftDocumentId,
      rightDocumentId: item.data.rightDocumentId,
      verdict: item.data.verdict,
      confidence: item.data.confidence,
      rationale: item.data.rationale,
      evidenceIds,
      provenance,
      suggestedDocumentId,
      suggestedReason,
    })
  }

  if (payload.data.coverage === "complete") {
    const returnedCandidateIds = new Set(
      relations
        .map((relation) => relation.candidateId)
        .filter((id): id is string => Boolean(id)),
    )
    // A complete response must account for every deterministic recall hint.
    // A null candidate id is allowed for a newly discovered pair, but it
    // cannot silently make an omitted supplied candidate look unrelated.
    invalidItemCount += request.candidates.filter((candidate) => !returnedCandidateIds.has(candidate.candidateId)).length
  }

  const coverage = conservativeCoverage(loop.coverage, payload.data.coverage, invalidItemCount)
  const status = statusAfterValidation(loop.status, coverage, invalidItemCount)
  return {
    status,
    coverage,
    relations,
    invalidItemCount,
    candidateCount: request.candidates.length,
    evidence: loop.evidence,
    usage: usageFromReceipt(loop.executionReceipt),
    executionReceipt: loop.executionReceipt,
    error: status === "insufficient_evidence" && !loop.error
      ? invalidOutput("Some semantic relation items were incomplete or lacked valid provenance.")
      : loop.error,
  }
}

export function isResolvableSemanticContradiction(
  relation: WorkspaceDocumentRelation,
): boolean {
  return relation.verdict === "contradictory"
    && relation.confidence === WORKSPACE_RELATION_CONTRADICTION_MIN_CONFIDENCE
    && relation.provenance.length >= 2
    && new Set(relation.provenance.map((item) => item.documentId)).size >= 2
}
