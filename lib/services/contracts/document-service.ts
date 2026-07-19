import type { WritingStatus } from "@/lib/writings/status"
import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type WritingVisibility = "private" | "shared" | "public"
export type WritingLifecycle = "local-only" | "syncing" | "server-confirmed"
export type CollectionVisibility = "private" | "public"
export type ArtifactType = "general" | "agent" | "skill" | "prompt" | "template" | "status"
export type DocumentCanonicalSource = "pending-document-contract" | "markdown" | "rich-text"
export type RichDocumentState = Record<string, unknown>

export type WritingContentSnapshot = {
  markdown: string | null
  richText: RichDocumentState | null
  plainText: string
  canonicalSource: DocumentCanonicalSource
}

export type WritingRecord = {
  id: string
  authorId: string | null
  title: string | null
  content: WritingContentSnapshot
  slug: string | null
  status: WritingStatus
  artifactType: ArtifactType
  visibility: WritingVisibility
  parentId: string | null
  correspondenceId: string | null
  version: number
  deletedAt: string | null
  createdAt: string
  updatedAt: string
  contentUpdatedAt?: string | null
  metadataUpdatedAt?: string | null
  /** Runtime-neutral sync capability used by consumers such as Preview. */
  lifecycle?: WritingLifecycle
}

export type WritingSummary = Omit<WritingRecord, "content"> & {
  excerpt: string | null
}

export type ListWritingsInput = {
  includeDeleted?: boolean
}

export type SaveWritingInput = {
  writing: WritingRecord
}

export type RenameWritingInput = {
  writingId: string
  title: string | null
  updatedAt: string
}

export type DeleteWritingInput = {
  writingId: string
  version: number
  updatedAt: string
  deletedAt: string
}

export type WritingCollectionMembership = {
  collectionId: string
  addedAt: string
}

export type SetWritingCollectionsInput = {
  writingId: string
  collectionIds: string[]
  updatedAt?: string
}

export type DocumentExportFormat = "pdf" | "docx"

export type ExportWritingInput = {
  writingId: string
  format: DocumentExportFormat
}

export type ExportedDocumentArtifact = {
  writingId: string
  format: DocumentExportFormat
  fileName: string
  mimeType: string
  bytes: Uint8Array
}

export interface DocumentService {
  listWritings(input?: ListWritingsInput): Promise<ServiceResponse<WritingSummary[]>>
  openWriting(writingId: string): Promise<ServiceResponse<WritingRecord>>
  saveWriting(input: SaveWritingInput): Promise<ServiceResponse<WritingRecord>>
  renameWriting(input: RenameWritingInput): Promise<ServiceResponse<WritingRecord>>
  deleteWriting(input: DeleteWritingInput): Promise<ServiceResponse<WritingRecord>>
  listWritingCollections(writingId: string): Promise<ServiceResponse<WritingCollectionMembership[]>>
  setWritingCollections(input: SetWritingCollectionsInput): Promise<ServiceResponse<WritingCollectionMembership[]>>
  exportWriting(input: ExportWritingInput): Promise<ServiceResponse<ExportedDocumentArtifact>>
  /**
   * Materialize a cloud-only record into a local `.md` before editing (ODE-375
   * M3, spec §Drafts nuevos y cloud-only). Optional: ODE-371 owns the cloud
   * adapter/backfill that implements it. Named here so no opener may reinterpret
   * a cloud-only document as missing or spawn an empty draft.
   */
  materializeCloudOnly?(input: { writingId: string }): Promise<ServiceResponse<WritingRecord>>
}

// Catalog identity/presence is intentionally a separate application contract.
// DocumentService owns content operations; DocumentCatalog owns discovery and
// operational projection so neither adapter can turn storage into content authority.

export const DOCUMENT_SERVICE_CONTRACT = {
  name: "DocumentService",
  summary:
    "Shared application boundary for listing, opening, saving, renaming, exporting, and classifying writings without coupling the product flow to Next routes, Supabase, or filesystem APIs.",
  responsibilities: [
    "Expose the current write-path as product operations instead of transport-specific fetch calls.",
    "Keep the document payload explicit in shared core while leaving the canonical serializer decision to the document-contract issue.",
    "Cover writing collection membership and export as part of the same authoring capability boundary.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "desktop"],
  owner: "architecture-first",
  invariants: [
    "DocumentService names writing operations in product terms and never in route or storage terms.",
    "The contract may carry richText and markdown side by side, but it cannot declare either runtime transport as the source of truth.",
    "Adapters can implement save/list/export differently per runtime, but they must preserve the same WritingRecord shape and ServiceResponse envelope.",
    "A newly created writing starts at version 1 so the first remote persistence is valid under the server adapter contract (version >= 1).",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "listWritings",
      kind: "query",
      summary: "Return document summaries for desk/sidebar surfaces without loading rich body payloads.",
      input: ["optional includeDeleted flag"],
      output: ["WritingSummary[] ordered by adapter policy"],
      errorCodes: ["UNAUTHORIZED", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "openWriting",
      kind: "query",
      summary: "Load a full writing snapshot for editing, reading, or reconciliation flows.",
      input: ["writingId"],
      output: ["WritingRecord with explicit content snapshot"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "saveWriting",
      kind: "command",
      summary: "Persist the latest writing snapshot without exposing route shape or storage implementation details.",
      input: ["WritingRecord including version and timestamps"],
      output: ["saved WritingRecord"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "CONFLICT", "DB_ERROR"],
    },
    {
      name: "renameWriting",
      kind: "command",
      summary: "Rename a writing as a first-class operation so title edits do not depend on generic PATCH semantics.",
      input: ["writingId", "title", "updatedAt"],
      output: ["updated WritingRecord"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "deleteWriting",
      kind: "command",
      summary: "Mark a writing deleted while preserving versioned write-path semantics.",
      input: ["writingId", "version", "updatedAt", "deletedAt"],
      output: ["deleted WritingRecord"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "DB_ERROR"],
    },
    {
      name: "listWritingCollections",
      kind: "query",
      summary: "Read collection memberships for a writing without coupling the caller to RPC details.",
      input: ["writingId"],
      output: ["WritingCollectionMembership[]"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "setWritingCollections",
      kind: "command",
      summary: "Replace collection memberships for a writing through a contract instead of direct RPC or fetch calls.",
      input: ["writingId", "collectionIds[]", "optional updatedAt"],
      output: ["WritingCollectionMembership[]"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "exportWriting",
      kind: "command",
      summary: "Produce an export artifact for the requested format without leaking Response or route-handler details into the core.",
      input: ["writingId", "format=pdf|docx"],
      output: ["ExportedDocumentArtifact"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "INVALID_INPUT", "UNAVAILABLE"],
    },
    {
      // ODE-375 (Fase 9 M3): cloud-only is a named operation so no opener may ever
      // reinterpret a cloud-only record as missing or spawn an empty draft. The
      // desktop opener (`lib/services/open-document`) consumes this through the
      // `materializeCloudOnly` port; ODE-371 owns the final cloud adapter/backfill.
      name: "materializeCloudOnly",
      kind: "command",
      summary: "Materialize a cloud-only record into a local `.md` inside a BindingRoot before editing, so cloud-only opens converge to the same UUID as any other open.",
      input: ["writingId"],
      output: ["WritingRecord with a materialized local canonical file"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "CONFLICT", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "editor-write-path",
      summary: "Write-path currently spans editor UI orchestration, local-first state, and /api/writings transport details.",
      layer: ["application", "adapter"],
      runtimeScope: ["shared-core", "web"],
      owner: "architecture-first",
      currentEntrypoints: [
        "components/editor/editor-shell.tsx",
        "app/api/writings/route.ts",
        "app/api/writings/[id]/route.ts",
      ],
    },
    {
      id: "writing-collections-membership",
      summary: "Collection assignment already behaves like a document use case but still depends on a web RPC boundary.",
      layer: ["application", "adapter"],
      runtimeScope: ["shared-core", "web"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/writings/[id]/collections/route.ts",
        "lib/local-db/collections.ts",
      ],
    },
    {
      id: "document-export-pipeline",
      summary: "Export transformations are portable, but the entrypoint is still exposed as a web-only route.",
      layer: ["application", "adapter"],
      runtimeScope: ["shared-core", "web", "desktop"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/writings/[id]/export/route.ts",
        "lib/export/writing-export.ts",
        "lib/export/to-docx.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"DocumentService", keyof DocumentService>
