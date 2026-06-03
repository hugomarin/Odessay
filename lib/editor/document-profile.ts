import type { WritingStatus } from "@/lib/writings/status"
import { normalizeWritingStatus } from "@/lib/writings/status"

export const CANONICAL_DOCUMENT_FORMAT = "markdown"
export const CANONICAL_DOCUMENT_EXTENSION = ".md"
export const ODESSAY_MARKDOWN_PROFILE_ID = "odessay-markdown-v1"

export const SUPPORTED_MARKDOWN_BLOCKS = [
  "heading-1",
  "heading-2",
  "heading-3",
  "paragraph",
  "blockquote",
  "ordered-list",
  "bullet-list",
  "code-block",
  "table",
  "image",
  "footnote",
] as const

export const SUPPORTED_MARKDOWN_MARKS = [
  "bold",
  "italic",
  "strike",
  "highlight",
  "link",
  "inline-code",
] as const

export type BodyJsonPersistenceRole = "transitional"
export type CanonicalDocumentVisibility = "private" | "shared" | "public"

export type CanonicalDocumentMetadata = {
  id: string
  slug: string | null
  status: WritingStatus
  visibility: CanonicalDocumentVisibility
  version: number
  createdAt: string
  updatedAt: string
}

export const BODY_JSON_PERSISTENCE_ROLE: BodyJsonPersistenceRole = "transitional"
export const CANONICAL_FRONTMATTER_FIELDS = [
  "id",
  "slug",
  "status",
  "visibility",
  "version",
  "created_at",
  "updated_at",
] as const

export const CANONICAL_DOCUMENT_CONTRACT = {
  format: CANONICAL_DOCUMENT_FORMAT,
  extension: CANONICAL_DOCUMENT_EXTENSION,
  profileId: ODESSAY_MARKDOWN_PROFILE_ID,
  bodyJsonRole: BODY_JSON_PERSISTENCE_ROLE,
  summary:
    ".md is the product-level canonical document. body_json remains a rich transitional representation used by the current web/cloud runtime while the shared-core document engine converges on the Markdown contract.",
} as const

const CANONICAL_VISIBILITY_VALUES = new Set<CanonicalDocumentVisibility>(["private", "shared", "public"])

export const normalizeCanonicalDocumentVisibility = (
  value: string | null | undefined,
): CanonicalDocumentVisibility =>
  CANONICAL_VISIBILITY_VALUES.has(value as CanonicalDocumentVisibility)
    ? (value as CanonicalDocumentVisibility)
    : "private"

export const normalizeCanonicalDocumentMetadata = (
  metadata: {
    id: string
    slug?: string | null
    status?: string | null
    visibility?: string | null
    version?: number | null
    createdAt?: string | null
    updatedAt?: string | null
  },
): CanonicalDocumentMetadata => ({
  id: metadata.id,
  slug: metadata.slug ?? null,
  status: normalizeWritingStatus(metadata.status),
  visibility: normalizeCanonicalDocumentVisibility(metadata.visibility),
  version:
    typeof metadata.version === "number" && Number.isFinite(metadata.version) && metadata.version >= 1
      ? Math.trunc(metadata.version)
      : 1,
  createdAt: metadata.createdAt ?? new Date(0).toISOString(),
  updatedAt: metadata.updatedAt ?? metadata.createdAt ?? new Date(0).toISOString(),
})
