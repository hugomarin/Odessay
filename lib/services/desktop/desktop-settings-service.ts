import type {
  SettingsService,
  UpdateUserSettingsInput,
  UserSettings,
} from "@/lib/services/contracts/settings-service"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import {
  tauriSettingsDelete,
  tauriSettingsRead,
  tauriSettingsWrite,
} from "@/lib/services/desktop/tauri-commands"

function ok<T>(data: T): ServiceResponse<T> {
  return { data, error: null }
}

function err<T>(code: ServiceError["code"], message: string): ServiceResponse<T> {
  return { data: null, error: { code, message, retryable: false } }
}

export type DesktopSettings = {
  writingsDir?: string | null
  editorFontSize?: number
  editorLineHeight?: number
  sidebarOpen?: boolean
  lastActiveWritingId?: string | null
} & UserSettings

const SETTINGS_KEY = "desktop_settings_v1"

/**
 * Desktop adapter for SettingsService.
 *
 * Architecture Contract §ODE-210:
 *  - Persists settings in the OS config directory (via Tauri app_config_dir).
 *  - Does not touch document content or the index.
 *  - No dependency on Next.js, Supabase, cookies, or window.
 */
export class DesktopSettingsService implements SettingsService {
  readonly configDir: string

  constructor(configDir: string) {
    this.configDir = configDir
  }

  private async readStore(): Promise<DesktopSettings> {
    try {
      const raw = await tauriSettingsRead(this.configDir, SETTINGS_KEY)
      if (raw === null) return { disabledStatuses: [] }
      return (raw as DesktopSettings) ?? { disabledStatuses: [] }
    } catch {
      return { disabledStatuses: [] }
    }
  }

  private async writeStore(settings: DesktopSettings): Promise<void> {
    await tauriSettingsWrite(this.configDir, SETTINGS_KEY, settings)
  }

  // ─── SettingsService contract ──────────────────────────────────────────────

  async getUserSettings(): Promise<ServiceResponse<UserSettings>> {
    try {
      const store = await this.readStore()
      return ok({ disabledStatuses: store.disabledStatuses ?? [] })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to read settings")
    }
  }

  async updateUserSettings(
    input: UpdateUserSettingsInput,
  ): Promise<ServiceResponse<UserSettings>> {
    try {
      const store = await this.readStore()
      if (input.disabledStatuses !== undefined) {
        store.disabledStatuses = input.disabledStatuses
      }
      await this.writeStore(store)
      return ok({ disabledStatuses: store.disabledStatuses ?? [] })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to write settings")
    }
  }

  // ─── Desktop-specific settings ─────────────────────────────────────────────

  async getDesktopSettings(): Promise<ServiceResponse<DesktopSettings>> {
    try {
      const store = await this.readStore()
      return ok(store)
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to read desktop settings")
    }
  }

  async updateDesktopSettings(
    patch: Partial<DesktopSettings>,
  ): Promise<ServiceResponse<DesktopSettings>> {
    try {
      const store = await this.readStore()
      const merged = { ...store, ...patch }
      await this.writeStore(merged)
      return ok(merged)
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to write desktop settings")
    }
  }

  async clearAllSettings(): Promise<ServiceResponse<void>> {
    try {
      await tauriSettingsDelete(this.configDir, SETTINGS_KEY)
      return ok(undefined)
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to clear settings")
    }
  }
}
