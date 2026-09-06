import type { CollectionSummary } from "@/lib/collections/collections"
import type { DocumentCatalogRecord, DocumentCatalogReference } from "@/lib/services/contracts/document-catalog"
import type { VocabularyItem } from "@/lib/vocabulary/types"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import type { WritingStatus } from "@/lib/writings/status"

const WORKFLOW_FILE = "workflow.md"
const ARCHIVE_STATUS_KEY = "archived"

export type WorkspaceAnnotationEvidence = {
  documentId: string
  count: number
  labels?: string[]
}

export type WorkspaceContext = {
  rootPath: string
  documents: DocumentCatalogRecord[]
  collections?: CollectionSummary[]
  annotations?: WorkspaceAnnotationEvidence[]
  existingWorkflow?: {
    documentId: string
    markdown: string
  } | null
}

export type WorkflowDraftProposal = {
  canonicalPath: string
  existingDocumentId: string | null
  markdown: string
  evidence: EvidenceCitation[]
}

export type EvidenceCitation = {
  kind: "document" | "collection" | "annotation" | "catalog" | "similarity" | "date"
  sourceId: string
  label: string
  detail: string
  quote?: string
  line?: number
}

export type ClassificationEvidenceSource = {
  documentId: string
  contentHash: string | null
  version: number | null
  modifiedAt: number | null
}

export type BrokenReferenceProposal = {
  sourceDocumentId: string
  sourceTitle: string
  reference: string
  referenceKind: "path" | "slug"
  candidateDocumentId: string | null
  candidateTitle: string | null
  suggestedReference: string | null
  evidence: EvidenceCitation[]
}

export type ClassificationProposal = {
  documentId: string
  documentTitle: string
  documentPath: string | null
  currentArtifactType: ArtifactType | null
  currentStatus: WritingStatus | null
  artifactType: ArtifactType | null
  status: WritingStatus | null
  decision: "change" | "keep" | "needs-review"
  change: string
  benefit: string
  uncertainty: string | null
  sourceContentHash: string | null
  sourceVersion: number | null
  sourceModifiedAt: number | null
  evidenceSources: ClassificationEvidenceSource[]
  evidence: EvidenceCitation[]
  reason: string
}

export type ArchiveCandidate = {
  documentId: string
  title: string
  suggestedStatus: WritingStatus | null
  duplicateOfDocumentId: string | null
  evidence: EvidenceCitation[]
  reason: string
}

export type WorkspaceAgentContentSnapshot = {
  documentId: string
  title: string
  markdown: string
  updatedAt: string
  canonicalPath: string
}

export type ContradictionFragment = {
  text: string
  start: number
  end: number
  line: number
}

export type ContradictionProposal = {
  id: string
  topic: string
  left: {
    documentId: string
    title: string
    updatedAt: string
    fragment: ContradictionFragment
  }
  right: {
    documentId: string
    title: string
    updatedAt: string
    fragment: ContradictionFragment
  }
  suggestedDocumentId: string | null
  evidence: EvidenceCitation[]
}

export type ContradictionResolution = "left" | "right" | "discard"

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
}

function hasUriScheme(value: string): boolean {
  return /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)
}

function normalizedInternalReference(value: string): string | null {
  const trimmed = value.trim()
  const unwrapped = trimmed.startsWith("<") && trimmed.endsWith(">")
    ? trimmed.slice(1, -1).trim()
    : trimmed
  const withoutFragment = (unwrapped.split("#", 1)[0] ?? "").trim()
  if (
    !withoutFragment
    || withoutFragment.startsWith("#")
    || withoutFragment.startsWith("//")
    || withoutFragment.toLocaleLowerCase().startsWith("www.")
    || hasUriScheme(withoutFragment)
  ) return null
  return withoutFragment
}

function normalizedCatalogPath(value: string): string {
  const normalized = normalizePath(value).replace(/^\/+/, "")
  const parts: string[] = []
  for (const part of normalized.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.join("/")
}

function basename(value: string): string {
  const normalized = normalizePath(value)
  return normalized.slice(normalized.lastIndexOf("/") + 1)
}

function documentPath(record: DocumentCatalogRecord): string | null {
  return record.binding?.relativePath ?? null
}

function documentLabel(record: DocumentCatalogRecord): string {
  return record.title?.trim() || basename(documentPath(record) ?? record.id)
}

function documentReference(
  source: DocumentCatalogRecord,
  target: DocumentCatalogRecord,
  kind: "path" | "slug",
): string | null {
  if (kind === "slug") return target.slug
  const sourcePath = documentPath(source)
  const targetPath = documentPath(target)
  if (!targetPath) return null
  if (!sourcePath) return normalizedCatalogPath(targetPath)

  const sourceParts = normalizedCatalogPath(sourcePath).split("/").filter(Boolean)
  const targetParts = normalizedCatalogPath(targetPath).split("/").filter(Boolean)
  const sourceDirectory = sourceParts.slice(0, -1)
  let commonLength = 0
  while (
    commonLength < sourceDirectory.length
    && commonLength < targetParts.length
    && sourceDirectory[commonLength]?.toLocaleLowerCase() === targetParts[commonLength]?.toLocaleLowerCase()
  ) {
    commonLength += 1
  }
  const relativeParts = [
    ...sourceDirectory.slice(commonLength).map(() => ".."),
    ...targetParts.slice(commonLength),
  ]
  return relativeParts.join("/") || basename(targetPath)
}

function tokenize(value: string | null | undefined): Set<string> {
  return new Set(
    (value ?? "")
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .map((token) => token.trim())
      .filter((token) => token.length > 2),
  )
}

function similarity(left: string, right: string): number {
  const a = tokenize(left)
  const b = tokenize(right)
  if (a.size === 0 || b.size === 0) return 0
  let intersection = 0
  for (const token of a) if (b.has(token)) intersection += 1
  return intersection / new Set([...a, ...b]).size
}

function hashEvidenceText(value: string): string {
  let hash = 2166136261
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index)
    hash = Math.imul(hash, 16777619)
  }
  return value.length.toString(16) + "-" + (hash >>> 0).toString(16)
}

function contradictionFragmentIdentity(fragment: ContradictionFragment): string {
  return String(fragment.start) + ":" + String(fragment.end) + ":" + hashEvidenceText(fragment.text)
}

function relativePathForRoot(rootPath: string): string {
  const normalizedRoot = normalizePath(rootPath)
  return normalizedRoot ? `${normalizedRoot}/${WORKFLOW_FILE}` : WORKFLOW_FILE
}

function isWorkflowRecord(record: DocumentCatalogRecord, rootPath: string): boolean {
  return normalizePath(record.binding?.canonicalPath ?? "") === relativePathForRoot(rootPath)
}

export function buildWorkflowDraft(context: WorkspaceContext): WorkflowDraftProposal {
  const documents = [...context.documents]
    .filter((record) => !record.deletedAt && !isWorkflowRecord(record, context.rootPath))
    .sort((left, right) => documentLabel(left).localeCompare(documentLabel(right)))
  const collections = [...(context.collections ?? [])]
    .filter((collection) => !collection.id.startsWith("uncategorized"))
    .sort((left, right) => left.name.localeCompare(right.name))
  const annotationsByDocument = new Map((context.annotations ?? []).map((item) => [item.documentId, item]))
  const evidence: EvidenceCitation[] = []

  for (const record of documents) {
    evidence.push({
      kind: "document",
      sourceId: record.id,
      label: documentLabel(record),
      detail: record.binding?.relativePath ?? "catalog document without a local path",
    })
  }
  for (const collection of collections) {
    evidence.push({
      kind: "collection",
      sourceId: collection.id,
      label: collection.name,
      detail: collection.description?.trim() || `${collection.writingsCount} document(s)`,
    })
  }
  for (const annotation of context.annotations ?? []) {
    if (annotation.count <= 0) continue
    evidence.push({
      kind: "annotation",
      sourceId: annotation.documentId,
      label: documentLabel(context.documents.find((record) => record.id === annotation.documentId) ?? {
        id: annotation.documentId,
        title: annotation.documentId,
        binding: null,
      } as DocumentCatalogRecord),
      detail: `${annotation.count} annotation(s)${annotation.labels?.length ? `: ${annotation.labels.join(", ")}` : ""}`,
    })
  }

  const lines = [
    "# Workspace workflow",
    "",
    "## Intent",
    `Coordinate the ${documents.length} document(s) currently present in this workspace.`,
    "",
    "## Scope",
    `- Workspace root: ${normalizePath(context.rootPath)}`,
    `- Documents in scope: ${documents.length}`,
    "",
    "## Objectives",
    ...(documents.length > 0
      ? documents.map((record) => `- Keep ${documentLabel(record)} discoverable at ${record.binding?.relativePath ?? "its catalog binding"}.`)
      : ["- No document objective was inferred because the catalog is empty."]),
    "",
    "## Context",
    ...(collections.length > 0
      ? collections.map((collection) => `- Collection ${collection.name}: ${collection.description?.trim() || `${collection.writingsCount} document(s)`}.`)
      : ["- No collection context was present in the catalog."]),
    ...(Array.from(annotationsByDocument.values()).filter((item) => item.count > 0).length > 0
      ? Array.from(annotationsByDocument.values())
        .filter((item) => item.count > 0)
        .map((item) => `- ${documentLabel(context.documents.find((record) => record.id === item.documentId) ?? ({ id: item.documentId, title: item.documentId, binding: null } as DocumentCatalogRecord))}: ${item.count} annotation(s).`)
      : ["- No annotation counts were available."]),
    "",
    "## Participants",
    "- Workspace owner and collaborators are not inferred from local document content.",
  ]

  return {
    canonicalPath: `${normalizePath(context.rootPath)}/${WORKFLOW_FILE}`,
    existingDocumentId: context.existingWorkflow?.documentId ?? null,
    markdown: `${lines.join("\n")}\n`,
    evidence,
  }
}

function referenceCandidates(text: string): DocumentCatalogReference[] {
  const candidates: DocumentCatalogReference[] = []
  const add = (raw: string, kind: DocumentCatalogReference["kind"]) => {
    const value = normalizedInternalReference(raw)
    if (!value || candidates.some((candidate) => candidate.kind === kind && candidate.value === value)) return
    candidates.push({ value, kind })
  }
  const markdownLinks = /\[[^\]]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g
  const wikiLinks = /\[\[([^\]]+)\]\]/g

  for (const match of text.matchAll(markdownLinks)) {
    if (match.index !== undefined && text[match.index - 1] === "!") continue
    add(match[1] ?? match[2] ?? "", "path")
  }
  for (const match of text.matchAll(wikiLinks)) add((match[1] ?? "").split("|", 1)[0] ?? "", "path")
  return candidates
}

function sourceReferenceCandidates(source: DocumentCatalogRecord): DocumentCatalogReference[] {
  // Desktop records expose this projection even when the preview is empty. An
  // empty array is authoritative: do not fall back to a truncated excerpt and
  // accidentally report stale or stripped links.
  if (source.referenceTargets !== undefined) return source.referenceTargets ?? []
  return referenceCandidates(source.excerpt ?? "")
}

function pathLookupCandidates(source: DocumentCatalogRecord, reference: string): string[] {
  const normalizedReference = normalizedInternalReference(reference)
  if (!normalizedReference) return []
  const rawPath = normalizePath(normalizedReference).replace(/^\/+/, "")
  const sourcePath = normalizedCatalogPath(documentPath(source) ?? "")
  const sourceDirectory = sourcePath.includes("/") ? sourcePath.slice(0, sourcePath.lastIndexOf("/")) : ""
  const relativeToSource = normalizedCatalogPath(sourceDirectory ? `${sourceDirectory}/${rawPath}` : rawPath)
  return relativeToSource ? [relativeToSource] : []
}

export function detectBrokenDocumentReferences(records: DocumentCatalogRecord[]): BrokenReferenceProposal[] {
  const activeRecords = records.filter((record) => !record.deletedAt)
  const byPath = new Map<string, DocumentCatalogRecord[]>()
  const bySlug = new Map<string, DocumentCatalogRecord>()
  const addPath = (value: string, record: DocumentCatalogRecord) => {
    const key = normalizedCatalogPath(value).toLocaleLowerCase()
    if (!key) return
    const current = byPath.get(key) ?? []
    if (!current.some((item) => item.id === record.id)) current.push(record)
    byPath.set(key, current)
  }
  for (const record of activeRecords) {
    const path = documentPath(record)
    if (path) addPath(path, record)
    if (record.slug) bySlug.set(record.slug.toLocaleLowerCase(), record)
  }

  const proposals: BrokenReferenceProposal[] = []
  for (const source of activeRecords) {
    for (const reference of sourceReferenceCandidates(source)) {
      const normalized = normalizedInternalReference(reference.value)?.toLocaleLowerCase()
      if (!normalized) continue
      const resolved = reference.kind === "slug"
        ? bySlug.get(normalized)
        : pathLookupCandidates(source, reference.value)
          .map((candidate) => byPath.get(candidate.toLocaleLowerCase()))
          .find((matches) => matches?.length === 1)?.[0]
      if (resolved) continue

      const nearest = activeRecords
        .filter((record) => record.id !== source.id)
        .map((record) => ({ record, score: similarity(reference.value, `${record.title ?? ""} ${record.slug ?? ""} ${documentPath(record) ?? ""}`) }))
        .sort((left, right) => right.score - left.score)[0]
      const candidate = nearest && nearest.score >= 0.25 ? nearest.record : null
      proposals.push({
        sourceDocumentId: source.id,
        sourceTitle: documentLabel(source),
        reference: reference.value,
        referenceKind: reference.kind,
        candidateDocumentId: candidate?.id ?? null,
        candidateTitle: candidate ? documentLabel(candidate) : null,
        suggestedReference: candidate ? documentReference(source, candidate, reference.kind) : null,
        evidence: [
          { kind: "document", sourceId: source.id, label: documentLabel(source), detail: "catalog reference projection contains this destination" },
          ...(candidate ? [{ kind: "similarity" as const, sourceId: candidate.id, label: documentLabel(candidate), detail: `nearest catalog match (${Math.round((nearest?.score ?? 0) * 100)}%)` }] : []),
        ],
      })
    }
  }
  return proposals
}

type ReferenceRange = { start: number; end: number }

function referenceRange(markdown: string, proposal: BrokenReferenceProposal): ReferenceRange | null {
  const expected = proposal.reference.toLocaleLowerCase()
  if (proposal.referenceKind === "slug") {
    const slugPattern = /(?:^|\s)#([a-z0-9][a-z0-9_-]{2,})\b/gi
    for (const match of markdown.matchAll(slugPattern)) {
      if (match[1]?.toLocaleLowerCase() !== expected) continue
      const hashIndex = match[0].lastIndexOf("#")
      if (hashIndex < 0 || match.index === undefined) continue
      const start = match.index + hashIndex + 1
      return { start, end: start + (match[1]?.length ?? 0) }
    }
    return null
  }

  const markdownLinks = /\[[^\]]+\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+[^)]*)?\)/g
  for (const match of markdown.matchAll(markdownLinks)) {
    if (match.index !== undefined && markdown[match.index - 1] === "!") continue
    const raw = match[1] ?? match[2]
    if (!raw || match.index === undefined) continue
    const trimmed = raw.trim()
    const target = normalizedInternalReference(trimmed)
    if (!target || target.toLocaleLowerCase() !== normalizedInternalReference(expected)?.toLocaleLowerCase()) continue
    const fragmentIndex = trimmed.indexOf("#")
    const targetText = fragmentIndex >= 0 ? trimmed.slice(0, fragmentIndex).trim() : trimmed
    const destinationMarker = match[0].indexOf("](")
    if (destinationMarker < 0) continue
    let destinationOffset = destinationMarker + 2
    while (/\s/.test(match[0][destinationOffset] ?? "")) destinationOffset += 1
    if (match[1] !== undefined) destinationOffset += 1
    const valueOffset = raw.indexOf(targetText)
    if (valueOffset < 0) continue
    const start = match.index + destinationOffset + valueOffset
    return { start, end: start + targetText.length }
  }

  const wikiLinks = /\[\[([^\]]+)\]\]/g
  for (const match of markdown.matchAll(wikiLinks)) {
    const raw = (match[1] ?? "").split("|", 1)[0] ?? ""
    const trimmed = raw.trim()
    const target = normalizedInternalReference(trimmed)
    if (!target || target.toLocaleLowerCase() !== normalizedInternalReference(expected)?.toLocaleLowerCase() || match.index === undefined) continue
    const fragmentIndex = trimmed.indexOf("#")
    const targetText = fragmentIndex >= 0 ? trimmed.slice(0, fragmentIndex).trim() : trimmed
    const rawOffset = match[0].indexOf(raw)
    const valueOffset = raw.indexOf(targetText)
    if (rawOffset < 0 || valueOffset < 0) continue
    const start = match.index + rawOffset + valueOffset
    return { start, end: start + targetText.length }
  }
  return null
}

export function replaceBrokenDocumentReference(
  markdown: string,
  proposal: BrokenReferenceProposal,
  replacement: string,
): string | null {
  const nextReference = replacement.trim()
  if (!nextReference || /[\r\n]/.test(nextReference)) return null
  const range = referenceRange(markdown, proposal)
  if (!range) return null
  return `${markdown.slice(0, range.start)}${nextReference}${markdown.slice(range.end)}`
}

function chooseVocabularyItem(
  vocabulary: readonly VocabularyItem[],
  kind: "type" | "status",
  key: string | null | undefined,
): VocabularyItem | null {
  if (!key) return null
  return vocabulary.find((item) => item.kind === kind && item.key === key && !item.hidden) ?? null
}

export function suggestArtifactClassification(
  document: DocumentCatalogRecord,
  records: DocumentCatalogRecord[],
  vocabulary: readonly VocabularyItem[],
): ClassificationProposal {
  const peers = records
    .filter((record) => record.id !== document.id && !record.deletedAt)
    .map((record) => ({ record, score: similarity(`${document.title ?? ""} ${document.excerpt ?? ""}`, `${record.title ?? ""} ${record.excerpt ?? ""}`) }))
    .filter(({ score }) => score >= 0.25)
    .sort((left, right) => right.score - left.score)
  const peer = peers[0]?.record
  const type = chooseVocabularyItem(vocabulary, "type", peer?.artifactType)
  const status = chooseVocabularyItem(vocabulary, "status", peer?.status)
  const evidence: EvidenceCitation[] = peer
    ? [{ kind: "similarity", sourceId: peer.id, label: documentLabel(peer), detail: `similar catalog document (${Math.round((peers[0]?.score ?? 0) * 100)}%)` }]
    : [{ kind: "catalog", sourceId: document.id, label: documentLabel(document), detail: "no sufficiently similar classified document was found" }]
  const proposedArtifactType = type?.key ?? null
  const proposedStatus = status?.key ?? null
  const changed = proposedArtifactType !== document.artifactType || proposedStatus !== document.status

  return {
    documentId: document.id,
    documentTitle: documentLabel(document),
    documentPath: document.binding?.relativePath ?? null,
    currentArtifactType: document.artifactType ?? null,
    currentStatus: document.status ?? null,
    artifactType: proposedArtifactType,
    status: proposedStatus,
    decision: peer && changed ? "needs-review" : "keep",
    change: changed
      ? "Heuristic baseline only; a semantic review is required before changing metadata."
      : "Keep the current type and status until document evidence supports a change.",
    benefit: "Provides a comparison baseline without treating similarity as a final decision.",
    uncertainty: peer
      ? "This is a similarity signal, not an interpretation of the document's purpose or progress."
      : "No comparable catalog signal was available.",
    sourceContentHash: document.binding?.contentHash ?? null,
    sourceVersion: document.version ?? null,
    sourceModifiedAt: document.modifiedAt ?? null,
    evidenceSources: peer
      ? [document, peer].map((source) => ({
          documentId: source.id,
          contentHash: source.binding?.contentHash ?? null,
          version: source.version ?? null,
          modifiedAt: source.modifiedAt ?? null,
        }))
      : [{
          documentId: document.id,
          contentHash: document.binding?.contentHash ?? null,
          version: document.version ?? null,
          modifiedAt: document.modifiedAt ?? null,
        }],
    evidence,
    reason: peer
      ? `Similarity baseline from ${documentLabel(peer)}; it is not a semantic classification.`
      : "No heuristic suggestion was made because the catalog did not provide a sufficiently similar classified document.",
  }
}

export function findArchiveCandidates(
  records: DocumentCatalogRecord[],
  vocabulary: readonly VocabularyItem[],
  options: {
    now?: number
    staleAfterDays?: number
    duplicateThreshold?: number
    classificationByDocument?: ReadonlyMap<string, ClassificationProposal>
  } = {},
): ArchiveCandidate[] {
  const now = options.now ?? Date.now()
  const staleAfterDays = options.staleAfterDays ?? 90
  const duplicateThreshold = options.duplicateThreshold ?? 0.7
  const active = records.filter((record) => !record.deletedAt)
  const candidates = new Map<string, ArchiveCandidate>()
  const archiveStatus = vocabulary.find((item) => item.kind === "status" && item.key === ARCHIVE_STATUS_KEY && !item.hidden)?.key ?? null

  const classificationEvidence = (documentId: string): EvidenceCitation[] => {
    const classification = options.classificationByDocument?.get(documentId)
    if (!classification || (classification.artifactType === null && classification.status === null)) return []
    return [{
      kind: "catalog",
      sourceId: documentId,
      label: "Vocabulary classification",
      detail: [classification.artifactType, classification.status].filter(Boolean).join(" / "),
    }]
  }

  for (const record of active) {
    const modifiedAt = record.modifiedAt ?? record.createdAt
    if (modifiedAt == null || now - modifiedAt < staleAfterDays * 24 * 60 * 60 * 1000) continue
    const ageDays = Math.floor((now - modifiedAt) / (24 * 60 * 60 * 1000))
    candidates.set(record.id, {
      documentId: record.id,
      title: documentLabel(record),
      suggestedStatus: archiveStatus,
      duplicateOfDocumentId: null,
      evidence: [
        { kind: "date", sourceId: record.id, label: documentLabel(record), detail: `not modified for ${ageDays} day(s)` },
        ...classificationEvidence(record.id),
      ],
      reason: `Stale: last modified ${ageDays} day(s) ago.`,
    })
  }

  for (let index = 0; index < active.length; index += 1) {
    for (let otherIndex = index + 1; otherIndex < active.length; otherIndex += 1) {
      const left = active[index]
      const right = active[otherIndex]
      const score = similarity(`${left.title ?? ""} ${left.excerpt ?? ""}`, `${right.title ?? ""} ${right.excerpt ?? ""}`)
      if (score < duplicateThreshold) continue
      const leftDate = left.modifiedAt ?? left.createdAt ?? Number.MAX_SAFE_INTEGER
      const rightDate = right.modifiedAt ?? right.createdAt ?? Number.MAX_SAFE_INTEGER
      const older = leftDate <= rightDate ? left : right
      const newer = older.id === left.id ? right : left
      const existing = candidates.get(older.id)
      const evidence: EvidenceCitation[] = [
        ...(existing?.evidence ?? []),
        { kind: "similarity", sourceId: newer.id, label: documentLabel(newer), detail: `${Math.round(score * 100)}% similar to this document` },
        ...classificationEvidence(older.id),
      ]
      candidates.set(older.id, {
        documentId: older.id,
        title: documentLabel(older),
        suggestedStatus: archiveStatus,
        duplicateOfDocumentId: newer.id,
        evidence,
        reason: `${existing ? `${existing.reason} ` : ""}Possible duplicate of ${documentLabel(newer)} (${Math.round(score * 100)}% similarity).`,
      })
    }
  }

  return [...candidates.values()].sort((left, right) => left.title.localeCompare(right.title))
}

type StatementSegment = ContradictionFragment

const CONTRADICTION_STOP_WORDS = new Set([
  "about", "after", "again", "also", "because", "before", "being", "between", "could", "document",
  "from", "have", "into", "more", "only", "other", "over", "should", "some", "than", "that", "their",
  "there", "these", "they", "this", "through", "under", "using", "where", "which", "with", "would",
])

const CONTRADICTION_NEGATIONS = new Set(["cannot", "cant", "disabled", "doesnt", "isnt", "never", "no", "not", "without", "wont"])

function statementSegments(markdown: string): StatementSegment[] {
  const segments: StatementSegment[] = []
  let lineStart = 0
  let inCodeFence = false

  for (const [lineIndex, line] of markdown.split("\n").entries()) {
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      inCodeFence = !inCodeFence
      lineStart += line.length + 1
      continue
    }
    if (!inCodeFence && trimmed.length > 0) {
      const sentencePattern = /[^.!?]+(?:[.!?]+|$)/g
      for (const match of line.matchAll(sentencePattern)) {
        const raw = match[0]
        const leadingWhitespace = raw.search(/\S/)
        if (leadingWhitespace < 0) continue
        const text = raw.slice(leadingWhitespace).trim()
        if (text.length < 12) continue
        const start = lineStart + (match.index ?? 0) + leadingWhitespace
        segments.push({ text, start, end: start + text.length, line: lineIndex + 1 })
      }
    }
    lineStart += line.length + 1
  }

  return segments
}

function statementWords(value: string): string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2)
}

function statementKey(value: string): string | null {
  const beforeColon = value.split(":", 1)[0]?.trim() ?? ""
  const words = statementWords(beforeColon || value)
    .filter((word) => !CONTRADICTION_STOP_WORDS.has(word) && !CONTRADICTION_NEGATIONS.has(word))
  return words.length > 0 ? words.join(" ") : null
}

function hasNegation(value: string): boolean {
  return statementWords(value).some((word) => CONTRADICTION_NEGATIONS.has(word))
}

function statementSimilarity(left: string, right: string): number {
  const leftWords = new Set(statementWords(left).filter((word) => !CONTRADICTION_STOP_WORDS.has(word)))
  const rightWords = new Set(statementWords(right).filter((word) => !CONTRADICTION_STOP_WORDS.has(word)))
  if (leftWords.size === 0 || rightWords.size === 0) return 0
  const intersection = [...leftWords].filter((word) => rightWords.has(word)).length
  return intersection / Math.max(leftWords.size, rightWords.size)
}

function contradictionScore(left: string, right: string): number {
  if (left.toLocaleLowerCase() === right.toLocaleLowerCase()) return 0
  const leftKey = statementKey(left)
  const rightKey = statementKey(right)
  if (leftKey && rightKey && leftKey === rightKey) return 1
  const similarity = statementSimilarity(left, right)
  return hasNegation(left) !== hasNegation(right) && similarity >= 0.45 ? similarity : 0
}

function suggestedDocumentId(left: WorkspaceAgentContentSnapshot, right: WorkspaceAgentContentSnapshot): string | null {
  const leftTime = Date.parse(left.updatedAt)
  const rightTime = Date.parse(right.updatedAt)
  if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime) || leftTime === rightTime) return null
  return leftTime > rightTime ? left.documentId : right.documentId
}

function contradictionTopic(left: string, right: string): string {
  const leftKey = statementKey(left)
  if (leftKey) return leftKey
  const sharedWords = statementWords(left).filter((word) => statementWords(right).includes(word))
  return sharedWords.slice(0, 4).join(" ") || "document claim"
}

export function detectDocumentContradictions(
  documents: WorkspaceAgentContentSnapshot[],
): ContradictionProposal[] {
  const proposals: ContradictionProposal[] = []

  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < documents.length; rightIndex += 1) {
      const leftDocument = documents[leftIndex]
      const rightDocument = documents[rightIndex]
      const leftSegments = statementSegments(leftDocument.markdown)
      const rightSegments = statementSegments(rightDocument.markdown)

      for (const leftFragment of leftSegments) {
        for (const rightFragment of rightSegments) {
          const score = contradictionScore(leftFragment.text, rightFragment.text)
          if (score === 0) continue
          const leftEvidence: EvidenceCitation = {
            kind: "document",
            sourceId: leftDocument.documentId,
            label: leftDocument.title,
            detail: `line ${leftFragment.line}: ${leftFragment.text}`,
          }
          const rightEvidence: EvidenceCitation = {
            kind: "document",
            sourceId: rightDocument.documentId,
            label: rightDocument.title,
            detail: `line ${rightFragment.line}: ${rightFragment.text}`,
          }
          proposals.push({
            id: [
              "contradiction",
              leftDocument.documentId,
              contradictionFragmentIdentity(leftFragment),
              rightDocument.documentId,
              contradictionFragmentIdentity(rightFragment),
            ].join(":"),
            topic: contradictionTopic(leftFragment.text, rightFragment.text),
            left: {
              documentId: leftDocument.documentId,
              title: leftDocument.title,
              updatedAt: leftDocument.updatedAt,
              fragment: leftFragment,
            },
            right: {
              documentId: rightDocument.documentId,
              title: rightDocument.title,
              updatedAt: rightDocument.updatedAt,
              fragment: rightFragment,
            },
            suggestedDocumentId: suggestedDocumentId(leftDocument, rightDocument),
            evidence: [leftEvidence, rightEvidence, {
              kind: "similarity",
              sourceId: `${leftDocument.documentId}:${rightDocument.documentId}`,
              label: "Contradiction matcher",
              detail: `matched claim structure (${Math.round(score * 100)}% overlap) with opposing values or polarity`,
            }],
          })
        }
      }
    }
  }

  return proposals.sort((left, right) => left.id.localeCompare(right.id))
}

export function replaceContradictionFragment(
  markdown: string,
  fragment: ContradictionFragment,
  replacement: string,
): string | null {
  if (fragment.start < 0 || fragment.end <= fragment.start || fragment.text.length === 0) return null

  let start = fragment.start
  const isAtExpectedPosition = fragment.end <= markdown.length
    && markdown.slice(start, fragment.end) === fragment.text
  if (!isAtExpectedPosition) {
    const matches: number[] = []
    let candidate = markdown.indexOf(fragment.text)
    while (candidate >= 0) {
      matches.push(candidate)
      candidate = markdown.indexOf(fragment.text, candidate + fragment.text.length)
    }
    if (matches.length === 0) return null

    const distances = matches.map((match) => Math.abs(match - fragment.start))
    const nearestDistance = Math.min(...distances)
    const nearest = matches.filter((_, index) => distances[index] === nearestDistance)
    if (nearest.length !== 1) return null
    start = nearest[0]
  }

  return `${markdown.slice(0, start)}${replacement}${markdown.slice(start + fragment.text.length)}`
}

export function isWorkflowFilePath(path: string): boolean {
  return basename(path).toLocaleLowerCase() === WORKFLOW_FILE
}
