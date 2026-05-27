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

export const BODY_JSON_PERSISTENCE_ROLE: BodyJsonPersistenceRole = "transitional"

export const CANONICAL_DOCUMENT_CONTRACT = {
  format: CANONICAL_DOCUMENT_FORMAT,
  extension: CANONICAL_DOCUMENT_EXTENSION,
  profileId: ODESSAY_MARKDOWN_PROFILE_ID,
  bodyJsonRole: BODY_JSON_PERSISTENCE_ROLE,
  summary:
    ".md is the product-level canonical document. body_json remains a rich transitional representation used by the current web/cloud runtime while the shared-core document engine converges on the Markdown contract.",
} as const
