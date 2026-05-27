import type { WritingStatus } from "@/lib/writings/status"
import {
  PHASE_4_REQUIRED_DOCS,
  SERVICE_RESPONSE_ENVELOPE,
  type ServiceContractDescriptor,
  type ServiceResponse,
} from "./service-types"

export type UserSettings = {
  disabledStatuses: WritingStatus[]
}

export type UpdateUserSettingsInput = {
  disabledStatuses?: WritingStatus[]
}

export interface SettingsService {
  getUserSettings(): Promise<ServiceResponse<UserSettings>>
  updateUserSettings(input: UpdateUserSettingsInput): Promise<ServiceResponse<UserSettings>>
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
