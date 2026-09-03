import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, expectTypeOf, it } from "vitest"
import {
  AI_SERVICE_CONTRACT,
  type AIService,
  type MechanicalUncertainNote,
  type PersistCorrectionBlockInput,
  type PersistCorrectionBlockResult,
  type PublicationReviewRequest,
  type PublicationReviewResult,
  type TitleSuggestion,
  type TitleSuggestionRequest,
} from "@/lib/services/contracts/ai-service"
import {
  ASSET_SERVICE_CONTRACT,
  type AssetService,
  type UploadImageAssetInput,
  type WritingAsset,
} from "@/lib/services/contracts/asset-service"
import {
  AUTH_SERVICE_CONTRACT,
  type AccountIdentity,
  type AuthService,
  type AuthSession,
  type CheckUsernameAvailabilityInput,
  type RequestEmailChangeInput,
  type SignInInput,
  type SignUpInput,
  type SignUpResult,
  type UpdateDisplayNameInput,
  type UpdatePasswordInput,
  type UpdateUsernameInput,
  type UsernameAvailability,
} from "@/lib/services/contracts/auth-service"
import {
  DOCUMENT_SERVICE_CONTRACT,
  type DeleteWritingInput,
  type DocumentService,
  type ExportWritingInput,
  type ExportedDocumentArtifact,
  type ListWritingsInput,
  type RenameWritingInput,
  type SaveWritingInput,
  type UpdateWritingMetadataInput,
  type SetWritingCollectionsInput,
  type WritingCollectionMembership,
  type WritingRecord,
  type WritingSummary,
} from "@/lib/services/contracts/document-service"
import {
  SETTINGS_SERVICE_CONTRACT,
  type SettingsService,
  type UpdateUserSettingsInput,
  type UserSettings,
  type VocabularyDeleteResult,
} from "@/lib/services/contracts/settings-service"
import type {
  CreateVocabularyItemInput,
  UpdateVocabularyItemInput,
  VocabularyItem,
} from "@/lib/vocabulary/types"
import {
  SHARING_SERVICE_CONTRACT,
  type PreviewLinkState,
  type RevokeWritingShareInput,
  type ShareRecipient,
  type SharingService,
  type ShareWritingInput,
  type SharedWritingListItem,
} from "@/lib/services/contracts/sharing-service"
import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_CONTRACT_NAMES,
  SERVICE_ERROR_CODES,
  type ServiceResponse,
} from "@/lib/services/contracts/service-types"
import {
  SYNC_SERVICE_CONTRACT,
  type EnqueueSyncMutationInput,
  type FlushSyncResult,
  type HydrateWritingInput,
  type HydrateWritingResult,
  type HydrateWritingsResult,
  type QuerySyncStatusInput,
  type SyncQueueReceipt,
  type SyncRuntimeState,
  type SyncService,
} from "@/lib/services/contracts/sync-service"

const contractDescriptors = [
  DOCUMENT_SERVICE_CONTRACT,
  SYNC_SERVICE_CONTRACT,
  AI_SERVICE_CONTRACT,
  AUTH_SERVICE_CONTRACT,
  SHARING_SERVICE_CONTRACT,
  ASSET_SERVICE_CONTRACT,
  SETTINGS_SERVICE_CONTRACT,
]

const contractFiles = [
  "lib/services/contracts/service-types.ts",
  "lib/services/contracts/document-service.ts",
  "lib/services/contracts/sync-service.ts",
  "lib/services/contracts/ai-service.ts",
  "lib/services/contracts/auth-service.ts",
  "lib/services/contracts/sharing-service.ts",
  "lib/services/contracts/asset-service.ts",
  "lib/services/contracts/settings-service.ts",
]

const allowedImports = new Set(["./service-types", "@/lib/writings/status", "@/lib/vocabulary/types"])

describe("service contracts", () => {
  it("covers every phase-4 service boundary with descriptors, invariants, and hotspots", () => {
    expect(contractDescriptors.map((descriptor) => descriptor.name)).toEqual([...SERVICE_CONTRACT_NAMES])

    const validErrorCodes = new Set(SERVICE_ERROR_CODES)

    for (const descriptor of contractDescriptors) {
      expect(descriptor.summary.length).toBeGreaterThan(0)
      expect(descriptor.responsibilities.length).toBeGreaterThan(0)
      expect(descriptor.invariants.length).toBeGreaterThan(0)
      expect(descriptor.errorEnvelope).toContain("ServiceResponse")
      expect(descriptor.requiredDocs).toEqual([...PHASE_4_REQUIRED_DOCS])
      expect(descriptor.hotspots.length).toBeGreaterThan(0)

      const operationNames = descriptor.operations.map((operation) => operation.name)
      expect(new Set(operationNames).size).toBe(operationNames.length)

      for (const operation of descriptor.operations) {
        expect(operation.input.length).toBeGreaterThan(0)
        expect(operation.output.length).toBeGreaterThan(0)

        for (const errorCode of operation.errorCodes) {
          expect(validErrorCodes.has(errorCode)).toBe(true)
        }
      }

      for (const hotspot of descriptor.hotspots) {
        expect(hotspot.layer.length).toBeGreaterThan(0)
        expect(hotspot.runtimeScope.length).toBeGreaterThan(0)
        expect(hotspot.currentEntrypoints.length).toBeGreaterThan(0)
      }
    }
  })

  it("locks the verified-write semantics of SyncService flushes (ODE-404)", () => {
    // `synced` must mean the cloud write affected >= 1 verified row. A PostgREST
    // UPDATE matching 0 rows reports success, so without this invariant a
    // mutation can be marked synced while the cloud row never existed.
    expect(SYNC_SERVICE_CONTRACT.invariants).toContain(
      "A queued mutation reaches 'synced' only after the cloud write verifiably affected at least one row; a zero-row update falls back to insert or fails — it is never reported as synced.",
    )
  })

  it("keeps contract modules free of runtime-specific imports", () => {
    for (const file of contractFiles) {
      const source = readFileSync(resolve(process.cwd(), file), "utf8")
      const imports = Array.from(source.matchAll(/from\s+["']([^"']+)["']/g), (match) => match[1])

      for (const importPath of imports) {
        expect(allowedImports.has(importPath)).toBe(true)
      }

      expect(source.includes("@/lib/supabase/")).toBe(false)
      expect(source.includes("next/server")).toBe(false)
      expect(source.includes("fetch(")).toBe(false)
    }
  })

  it("exports strongly typed service interfaces", () => {
    expectTypeOf<DocumentService["listWritings"]>().toEqualTypeOf<
      (input?: ListWritingsInput) => Promise<ServiceResponse<WritingSummary[]>>
    >()
    expectTypeOf<DocumentService["openWriting"]>().toEqualTypeOf<
      (writingId: string) => Promise<ServiceResponse<WritingRecord>>
    >()
    expectTypeOf<DocumentService["saveWriting"]>().toEqualTypeOf<
      (input: SaveWritingInput) => Promise<ServiceResponse<WritingRecord>>
    >()
    expectTypeOf<DocumentService["updateWritingMetadata"]>().toEqualTypeOf<
      (input: UpdateWritingMetadataInput) => Promise<ServiceResponse<WritingRecord>>
    >()
    expectTypeOf<DocumentService["updateWritingsMetadata"]>().toBeFunction()
    expectTypeOf<DocumentService["renameWriting"]>().toEqualTypeOf<
      (input: RenameWritingInput) => Promise<ServiceResponse<WritingRecord>>
    >()
    expectTypeOf<DocumentService["deleteWriting"]>().toEqualTypeOf<
      (input: DeleteWritingInput) => Promise<ServiceResponse<WritingRecord>>
    >()
    expectTypeOf<DocumentService["setWritingCollections"]>().toEqualTypeOf<
      (input: SetWritingCollectionsInput) => Promise<ServiceResponse<WritingCollectionMembership[]>>
    >()
    expectTypeOf<DocumentService["exportWriting"]>().toEqualTypeOf<
      (input: ExportWritingInput) => Promise<ServiceResponse<ExportedDocumentArtifact>>
    >()

    expectTypeOf<SyncService["enqueueMutation"]>().toEqualTypeOf<
      (input: EnqueueSyncMutationInput) => Promise<ServiceResponse<SyncQueueReceipt>>
    >()
    expectTypeOf<SyncService["hydrateWritings"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<HydrateWritingsResult>>
    >()
    expectTypeOf<SyncService["hydrateWriting"]>().toEqualTypeOf<
      (input: HydrateWritingInput) => Promise<ServiceResponse<HydrateWritingResult>>
    >()
    expectTypeOf<SyncService["flushPending"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<FlushSyncResult>>
    >()
    expectTypeOf<SyncService["getRuntimeState"]>().toEqualTypeOf<
      (input?: QuerySyncStatusInput) => Promise<ServiceResponse<SyncRuntimeState>>
    >()

    expectTypeOf<AIService["suggestTitle"]>().toEqualTypeOf<
      (input: TitleSuggestionRequest) => Promise<ServiceResponse<TitleSuggestion>>
    >()
    expectTypeOf<AIService["reviewPublication"]>().toEqualTypeOf<
      (input: PublicationReviewRequest) => Promise<ServiceResponse<PublicationReviewResult>>
    >()
    expectTypeOf<PublicationReviewResult>().toMatchTypeOf<{
      summary: string
      language: string
      corrections: unknown[]
      uncertain: MechanicalUncertainNote[]
      usage: unknown
    }>()
    expectTypeOf<AIService["persistCorrectionBlock"]>().toEqualTypeOf<
      (input: PersistCorrectionBlockInput) => Promise<ServiceResponse<PersistCorrectionBlockResult>>
    >()

    expectTypeOf<AuthService["signIn"]>().toEqualTypeOf<
      (input: SignInInput) => Promise<ServiceResponse<AuthSession>>
    >()
    expectTypeOf<AuthService["signUp"]>().toEqualTypeOf<
      (input: SignUpInput) => Promise<ServiceResponse<SignUpResult>>
    >()
    expectTypeOf<AuthService["signOut"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<null>>
    >()
    expectTypeOf<AuthService["checkUsernameAvailability"]>().toEqualTypeOf<
      (input: CheckUsernameAvailabilityInput) => Promise<ServiceResponse<UsernameAvailability>>
    >()
    expectTypeOf<AuthService["getSession"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<AuthSession>>
    >()
    expectTypeOf<AuthService["updateDisplayName"]>().toEqualTypeOf<
      (input: UpdateDisplayNameInput) => Promise<ServiceResponse<AccountIdentity>>
    >()
    expectTypeOf<AuthService["updateUsername"]>().toEqualTypeOf<
      (input: UpdateUsernameInput) => Promise<ServiceResponse<AccountIdentity>>
    >()
    expectTypeOf<AuthService["requestEmailChange"]>().toEqualTypeOf<
      (input: RequestEmailChangeInput) => Promise<ServiceResponse<AccountIdentity>>
    >()
    expectTypeOf<AuthService["updatePassword"]>().toEqualTypeOf<
      (input: UpdatePasswordInput) => Promise<ServiceResponse<AccountIdentity>>
    >()

    expectTypeOf<SharingService["listRecipients"]>().toEqualTypeOf<
      (writingId: string) => Promise<ServiceResponse<ShareRecipient[]>>
    >()
    expectTypeOf<SharingService["shareWriting"]>().toEqualTypeOf<
      (input: ShareWritingInput) => Promise<ServiceResponse<ShareRecipient>>
    >()
    expectTypeOf<SharingService["revokeShare"]>().toEqualTypeOf<
      (input: RevokeWritingShareInput) => Promise<ServiceResponse<{ writingId: string; sharedWithUserId: string }>>
    >()
    expectTypeOf<SharingService["getPreviewLink"]>().toEqualTypeOf<
      (writingId: string) => Promise<ServiceResponse<PreviewLinkState>>
    >()
    expectTypeOf<SharingService["rotatePreviewLink"]>().toEqualTypeOf<
      (writingId: string) => Promise<ServiceResponse<PreviewLinkState>>
    >()
    expectTypeOf<SharingService["revokePreviewLink"]>().toEqualTypeOf<
      (writingId: string) => Promise<ServiceResponse<{ writingId: string; revoked: boolean }>>
    >()
    expectTypeOf<SharingService["listIncomingShares"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<SharedWritingListItem[]>>
    >()

    expectTypeOf<AssetService["uploadImageAsset"]>().toEqualTypeOf<
      (input: UploadImageAssetInput) => Promise<ServiceResponse<WritingAsset>>
    >()

    expectTypeOf<SettingsService["getUserSettings"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<UserSettings>>
    >()
    expectTypeOf<SettingsService["updateUserSettings"]>().toEqualTypeOf<
      (input: UpdateUserSettingsInput) => Promise<ServiceResponse<UserSettings>>
    >()
    expectTypeOf<SettingsService["listVocabulary"]>().toEqualTypeOf<
      () => Promise<ServiceResponse<VocabularyItem[]>>
    >()
    expectTypeOf<SettingsService["createVocabularyItem"]>().toEqualTypeOf<
      (input: CreateVocabularyItemInput) => Promise<ServiceResponse<VocabularyItem>>
    >()
    expectTypeOf<SettingsService["updateVocabularyItem"]>().toEqualTypeOf<
      (id: string, input: UpdateVocabularyItemInput) => Promise<ServiceResponse<VocabularyItem>>
    >()
    expectTypeOf<SettingsService["deleteVocabularyItem"]>().toEqualTypeOf<
      (id: string) => Promise<ServiceResponse<VocabularyDeleteResult>>
    >()
  })
})
