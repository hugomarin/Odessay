import type {
  SettingsService,
  UpdateUserSettingsInput,
  UserSettings,
  VocabularyDeleteResult,
} from "@/lib/services/contracts/settings-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import type {
  CreateVocabularyItemInput,
  UpdateVocabularyItemInput,
  VocabularyItem,
} from "@/lib/vocabulary/types"

function err<T>(code: ServiceError["code"], message: string, retryable = false): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable } }
}

async function readEnvelope<T>(response: Response): Promise<ServiceResponse<T>> {
  let payload: { data: T | null; error: ServiceError | null } | null = null
  try {
    payload = await response.json()
  } catch {
    return err("UNKNOWN", `Failed to parse response (status ${response.status}).`, true)
  }

  if (!response.ok || !payload || payload.data === null) {
    return {
      data: null,
      error: payload?.error ?? { code: "UNKNOWN", message: `Request failed (status ${response.status}).`, retryable: response.status >= 500 },
    }
  }

  return { data: payload.data, error: null }
}

/**
 * Web adapter for `SettingsService` — thin fetch wrapper around
 * `/api/user/settings` and `/api/user/vocabulary`. The route handlers own the
 * Supabase access; this adapter only knows the HTTP envelope.
 */
export class WebSettingsService implements SettingsService {
  async getUserSettings(): Promise<ServiceResponse<UserSettings>> {
    const response = await fetch("/api/user/settings", { method: "GET" })
    return readEnvelope<UserSettings>(response)
  }

  async updateUserSettings(input: UpdateUserSettingsInput): Promise<ServiceResponse<UserSettings>> {
    const response = await fetch("/api/user/settings", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ disabled_statuses: input.disabledStatuses }),
    })
    return readEnvelope<UserSettings>(response)
  }

  async listVocabulary(): Promise<ServiceResponse<VocabularyItem[]>> {
    const response = await fetch("/api/user/vocabulary", { method: "GET" })
    const result = await readEnvelope<{ items: VocabularyItem[] }>(response)
    if (result.error) return { data: null, error: result.error }
    return { data: result.data.items, error: null }
  }

  async createVocabularyItem(input: CreateVocabularyItemInput): Promise<ServiceResponse<VocabularyItem>> {
    const response = await fetch("/api/user/vocabulary", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    return readEnvelope<VocabularyItem>(response)
  }

  async updateVocabularyItem(
    id: string,
    input: UpdateVocabularyItemInput,
  ): Promise<ServiceResponse<VocabularyItem>> {
    const response = await fetch(`/api/user/vocabulary/${encodeURIComponent(id)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    })
    return readEnvelope<VocabularyItem>(response)
  }

  async deleteVocabularyItem(id: string): Promise<ServiceResponse<VocabularyDeleteResult>> {
    const response = await fetch(`/api/user/vocabulary/${encodeURIComponent(id)}`, {
      method: "DELETE",
    })
    return readEnvelope<VocabularyDeleteResult>(response)
  }
}
