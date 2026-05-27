import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type ShareRecipient = {
  userId: string
  username: string
  displayName: string
  canRespond: boolean
  sharedAt: string
}

export type ShareWritingInput = {
  writingId: string
  sharedWithUserId: string
}

export type RevokeWritingShareInput = ShareWritingInput

export type PreviewLinkState = {
  active: boolean
  token: string | null
  link: string | null
  createdAt: string | null
  replacedPrevious?: boolean
}

export type SharedWritingListItem = {
  id: string
  title: string | null
  slug: string | null
  excerpt: string
  updatedAt: string
  author: {
    username: string
    displayName: string
  } | null
}

export interface SharingService {
  listRecipients(writingId: string): Promise<ServiceResponse<ShareRecipient[]>>
  shareWriting(input: ShareWritingInput): Promise<ServiceResponse<ShareRecipient>>
  revokeShare(input: RevokeWritingShareInput): Promise<ServiceResponse<{ writingId: string; sharedWithUserId: string }>>
  getPreviewLink(writingId: string): Promise<ServiceResponse<PreviewLinkState>>
  rotatePreviewLink(writingId: string): Promise<ServiceResponse<PreviewLinkState>>
  revokePreviewLink(writingId: string): Promise<ServiceResponse<{ writingId: string; revoked: boolean }>>
  listIncomingShares(): Promise<ServiceResponse<SharedWritingListItem[]>>
}

export const SHARING_SERVICE_CONTRACT = {
  name: "SharingService",
  summary:
    "Product boundary for direct sharing, preview links, and shared-writing listings so share semantics stop living inside web-only route shapes and invitation plumbing.",
  responsibilities: [
    "Expose share and preview-link capabilities as product operations rather than internal API endpoints.",
    "Normalize recipient and shared-writing payloads independently of Supabase joins or URL construction details.",
    "Keep invite token generation, absolute-link construction, and access persistence inside runtime adapters.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "cloud", "desktop"],
  owner: "architecture-first",
  invariants: [
    "SharingService owns the semantics of who can access a writing and how preview links behave.",
    "Adapters may store shares differently, but they cannot redefine recipient shape, preview-link lifecycle, or ServiceResponse semantics.",
    "Public/shared listing payloads must stay stable even if the underlying storage or transport changes.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "listRecipients",
      kind: "query",
      summary: "List recipients who currently have access to a writing.",
      input: ["writingId"],
      output: ["ShareRecipient[]"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "shareWriting",
      kind: "command",
      summary: "Grant access to a writing for a recipient.",
      input: ["writingId", "sharedWithUserId"],
      output: ["ShareRecipient"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "CONFLICT", "DB_ERROR"],
    },
    {
      name: "revokeShare",
      kind: "command",
      summary: "Revoke a recipient's access to a writing.",
      input: ["writingId", "sharedWithUserId"],
      output: ["writingId + sharedWithUserId"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "getPreviewLink",
      kind: "query",
      summary: "Read the current preview-link state for a writing.",
      input: ["writingId"],
      output: ["PreviewLinkState"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "rotatePreviewLink",
      kind: "command",
      summary: "Create or rotate the active preview link for a writing.",
      input: ["writingId"],
      output: ["PreviewLinkState"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "revokePreviewLink",
      kind: "command",
      summary: "Revoke any active preview link for a writing.",
      input: ["writingId"],
      output: ["writingId + revoked flag"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "DB_ERROR"],
    },
    {
      name: "listIncomingShares",
      kind: "query",
      summary: "List writings that were shared with the active user.",
      input: ["none"],
      output: ["SharedWritingListItem[]"],
      errorCodes: ["UNAUTHORIZED", "DB_ERROR", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "direct-sharing-routes",
      summary: "Direct writing shares are already modeled in product terms but still surfaced as web-only route handlers and DB joins.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/writings/[id]/shares/route.ts",
        "app/api/writings/shares/route.ts",
        "lib/sharing/writing-shares.ts",
      ],
    },
    {
      id: "preview-link-lifecycle",
      summary: "Preview links depend on invitation plumbing and absolute URL generation that should remain adapter concerns.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/writings/[id]/share-test-link/route.ts",
        "lib/sharing/test-link.ts",
      ],
    },
    {
      id: "shared-reading-surface",
      summary: "Incoming shared-writing payloads must remain stable across runtimes even if the web route or query layer changes.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core", "desktop"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/shared/writings/route.ts",
        "lib/sharing/shared-writings.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"SharingService", keyof SharingService>
