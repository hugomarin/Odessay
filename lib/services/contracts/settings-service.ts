import type { WritingStatus } from "@/lib/writings/status"
import type {
  CreateVocabularyItemInput,
  UpdateVocabularyItemInput,
  VocabularyItem,
} from "@/lib/vocabulary/types"
import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type UserSettings = {
  /** @deprecated derived from `vocabulary` (hidden status items) — ODE-472. Kept so existing consumers keep compiling while [ODE-474]/[ODE-475] migrate off it. */
  disabledStatuses: WritingStatus[]
  vocabulary: VocabularyItem[]
}

export type UpdateUserSettingsInput = {
  disabledStatuses?: WritingStatus[]
}

export type VocabularyDeleteResult = {
  /** Number of writings rewritten to the base value (`general` / `draft`). */
  rewrittenCount: number
}

/** vocabulary item id -> number of writings currently carrying its key. */
export type VocabularyUsage = Record<string, number>

export interface SettingsService {
  getUserSettings(): Promise<ServiceResponse<UserSettings>>
  updateUserSettings(input: UpdateUserSettingsInput): Promise<ServiceResponse<UserSettings>>
  listVocabulary(): Promise<ServiceResponse<VocabularyItem[]>>
  createVocabularyItem(input: CreateVocabularyItemInput): Promise<ServiceResponse<VocabularyItem>>
  updateVocabularyItem(
    id: string,
    input: UpdateVocabularyItemInput,
  ): Promise<ServiceResponse<VocabularyItem>>
  deleteVocabularyItem(id: string): Promise<ServiceResponse<VocabularyDeleteResult>>
  /**
   * How many writings currently carry each vocabulary item's key — what the
   * delete confirmation names before the user commits (ODE-475 requirement 6).
   * A failure here must be surfaced as unavailable, never silently as zero
   * (requirement 7): showing "0 artifacts" when the count could not be taken
   * would induce exactly the careless delete the confirmation exists to stop.
   */
  getVocabularyUsage(): Promise<ServiceResponse<VocabularyUsage>>
}

export const SETTINGS_SERVICE_CONTRACT = {
  name: "SettingsService",
  summary:
    "Capability boundary for user-level settings so preference flows stop depending on web-only profile routes and Supabase table details.",
  responsibilities: [
    "Expose account settings as product preferences rather than route payload shapes.",
    "Keep schema quirks and profile-table migration details inside adapters.",
    "Let future runtimes provide local, synced, or partially available settings through the same contract.",
  ],
  layer: ["application", "adapter"],
  runtimeScope: ["shared-core", "web", "desktop", "cloud"],
  owner: "architecture-first",
  invariants: [
    "SettingsService returns normalized product settings even when the underlying profile schema evolves.",
    "Mandatory statuses or equivalent invariants remain product concerns, not route-handler side effects.",
    "Settings reads and writes must use ServiceResponse rather than leaking HTTP or Postgrest error shapes upward.",
  ],
  errorEnvelope: SERVICE_RESPONSE_ENVELOPE,
  operations: [
    {
      name: "getUserSettings",
      kind: "query",
      summary: "Read normalized user settings for the active account.",
      input: ["none"],
      output: ["UserSettings"],
      errorCodes: ["UNAUTHORIZED", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "updateUserSettings",
      kind: "command",
      summary: "Update normalized user settings for the active account.",
      input: ["optional disabledStatuses"],
      output: ["UserSettings"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "listVocabulary",
      kind: "query",
      summary: "List the user's artifact type and status vocabulary, base items included, seeded lazily.",
      input: ["none"],
      output: ["VocabularyItem[]"],
      errorCodes: ["UNAUTHORIZED", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "createVocabularyItem",
      kind: "command",
      summary: "Create a custom type or status item.",
      input: ["CreateVocabularyItemInput"],
      output: ["VocabularyItem"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "updateVocabularyItem",
      kind: "command",
      summary: "Update name/description/icon/color/hidden of a vocabulary item. Base items may be renamed and restyled but never deleted; draft cannot be hidden.",
      input: ["id", "UpdateVocabularyItemInput"],
      output: ["VocabularyItem"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "deleteVocabularyItem",
      kind: "command",
      summary: "Delete a custom vocabulary item, rewriting affected writings to the base value in the same transaction.",
      input: ["id"],
      output: ["VocabularyDeleteResult"],
      errorCodes: ["UNAUTHORIZED", "INVALID_INPUT", "DB_ERROR", "UNAVAILABLE"],
    },
    {
      name: "getVocabularyUsage",
      kind: "query",
      summary: "Count of writings currently carrying each vocabulary item's key — feeds the delete confirmation.",
      input: ["none"],
      output: ["VocabularyUsage"],
      errorCodes: ["UNAUTHORIZED", "DB_ERROR", "UNAVAILABLE"],
    },
  ],
  hotspots: [
    {
      id: "profile-settings-route",
      summary: "User settings still depend on a web profile route and Supabase column availability checks.",
      layer: ["application", "adapter"],
      runtimeScope: ["web", "cloud", "shared-core"],
      owner: "architecture-first",
      currentEntrypoints: [
        "app/api/user/settings/route.ts",
        "lib/user/settings.ts",
      ],
    },
  ],
  requiredDocs: [...PHASE_4_REQUIRED_DOCS],
} satisfies ServiceContractDescriptor<"SettingsService", keyof SettingsService>
