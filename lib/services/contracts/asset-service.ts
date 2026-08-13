import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type UploadImageAssetInput = {
  writingId: string
  fileName: string
  contentType: string
  sizeBytes: number
  bytes: Uint8Array
  alt?: string | null
}

export type WritingAsset = {
  assetId: string
  writingId: string
  url: string
  alt: string | null
  mimeType: string
  sizeBytes: number
}

export type LocalImageAsset = {
  sourcePath: string
  fileName: string
  mimeType: string
  sizeBytes: number
  bytes: Uint8Array
}

export interface AssetService {
  readLocalImageAsset(input: {
    documentPath: string
    source: string
  }): Promise<ServiceResponse<LocalImageAsset>>
  uploadImageAsset(input: UploadImageAssetInput): Promise<ServiceResponse<WritingAsset>>
  resolveImageAssetUrl?(source: string): Promise<ServiceResponse<string>>
}

export const ASSET_SERVICE_CONTRACT = {
  name: "AssetService",
  summary:
    "Capability boundary for writing-linked assets so document flows can request uploads without depending on web FormData, Supabase Storage, or runtime-specific file APIs.",
  responsibilities: [
    "Expose asset upload as a product capability tied to a writing, not as a storage SDK call.",
    "Keep MIME validation, storage paths, and asset URL resolution inside adapters.",
    "Allow future desktop adapters to support local or synced assets behind the same contract.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "desktop", "cloud"],
  owner: "architecture-first",
  invariants: [
    "AssetService receives normalized bytes and metadata instead of DOM-specific FormData or File primitives.",
    "Storage location and access URL strategy are adapter concerns and must not leak into shared core.",
    "A writing-linked asset must always round-trip with an explicit assetId, mimeType, and sizeBytes payload.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "readLocalImageAsset",
      kind: "query",
      summary: "Resolve and read a validated image referenced by desktop Markdown.",
      input: ["documentPath", "source"],
      output: ["LocalImageAsset"],
      errorCodes: ["NOT_FOUND", "INVALID_INPUT", "UNSUPPORTED"],
    },
    {
      name: "uploadImageAsset",
      kind: "command",
      summary: "Upload an image asset and return the normalized asset descriptor.",
      input: ["writingId", "fileName", "contentType", "sizeBytes", "bytes", "optional alt"],
      output: ["WritingAsset"],
      errorCodes: ["UNAUTHORIZED", "FORBIDDEN", "INVALID_INPUT", "STORAGE_ERROR", "DB_ERROR"],
    },
    {
      name: "resolveImageAssetUrl",
      kind: "query",
      summary: "Resolve a durable writing-asset reference to a runtime render URL.",
      input: ["source"],
      output: ["renderUrl"],
      errorCodes: ["UNAUTHORIZED", "NOT_FOUND", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "writing-image-upload-route",
      summary: "Image upload currently bundles author checks, remote writing bootstrap, storage upload, and metadata persistence inside one web route.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/writings/[id]/images/route.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"AssetService", keyof AssetService>
