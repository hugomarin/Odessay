import type { CollectionSummary } from "@/lib/collections/collections"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"
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
}

export type BrokenReferenceProposal = {
  sourceDocumentId: string
  sourceTitle: string
  reference: string
  referenceKind: "path" | "slug"
  candidateDocumentId: string | null
  candidateTitle: string | null
  evidence: EvidenceCitation[]
}

export type ClassificationProposal = {
  documentId: string
  artifactType: ArtifactType | null
  status: WritingStatus | null
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

function normalizePath(value: string): string {
  return value.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\/$/, "")
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

function referenceCandidates(text: string): Array<{ value: string; kind: "path" | "slug" }> {
  const candidates: Array<{ value: string; kind: "path" | "slug" }> = []
  const markdownLinks = /\[[^\]]+\]\(([^)#]+)(?:#[^)]*)?\)/g
  const wikiLinks = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g
  const slugTokens = /(?:^|\s)#([a-z0-9][a-z0-9_-]{2,})\b/gi

  for (const match of text.matchAll(markdownLinks)) candidates.push({ value: match[1].trim(), kind: "path" })
  for (const match of text.matchAll(wikiLinks)) candidates.push({ value: match[1].trim(), kind: "path" })
  for (const match of text.matchAll(slugTokens)) candidates.push({ value: match[1].trim(), kind: "slug" })
  return candidates
}

export function detectBrokenDocumentReferences(records: DocumentCatalogRecord[]): BrokenReferenceProposal[] {
  const activeRecords = records.filter((record) => !record.deletedAt)
  const byPath = new Map<string, DocumentCatalogRecord>()
  const bySlug = new Map<string, DocumentCatalogRecord>()
  for (const record of activeRecords) {
    const path = documentPath(record)
    if (path) {
      byPath.set(normalizePath(path).toLocaleLowerCase(), record)
      byPath.set(basename(path).toLocaleLowerCase(), record)
    }
    if (record.slug) bySlug.set(record.slug.toLocaleLowerCase(), record)
  }

  const proposals: BrokenReferenceProposal[] = []
  for (const source of activeRecords) {
    for (const reference of referenceCandidates(source.excerpt ?? "")) {
      const normalized = normalizePath(reference.value).toLocaleLowerCase()
      const resolved = reference.kind === "slug" ? bySlug.get(normalized) : byPath.get(normalized)
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
        evidence: [
          { kind: "document", sourceId: source.id, label: documentLabel(source), detail: "catalog excerpt contains this reference" },
          ...(candidate ? [{ kind: "similarity" as const, sourceId: candidate.id, label: documentLabel(candidate), detail: `nearest catalog match (${Math.round((nearest?.score ?? 0) * 100)}%)` }] : []),
        ],
      })
    }
  }
  return proposals
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

  return {
    documentId: document.id,
    artifactType: type?.key ?? null,
    status: status?.key ?? null,
    evidence,
    reason: peer
      ? `Suggested from ${documentLabel(peer)}; both values were verified against the active vocabulary catalog.`
      : "No suggestion was made because the catalog did not provide a sufficiently similar classified document.",
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

export function isWorkflowFilePath(path: string): boolean {
  return basename(path).toLocaleLowerCase() === WORKFLOW_FILE
}
