import type {
  SettingsService,
  UpdateUserSettingsInput,
  UserSettings,
  VocabularyDeleteResult,
} from "@/lib/services/contracts/settings-service"
import type {
  CreateVocabularyItemInput,
  UpdateVocabularyItemInput,
  VocabularyItem,
} from "@/lib/vocabulary/types"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import {
  tauriSettingsDelete,
  tauriSettingsRead,
  tauriSettingsWrite,
} from "@/lib/services/desktop/tauri-commands"
import type { WorkspaceAssignmentMap } from "@/lib/workspace/assignment"
import type { WorkspaceLayout, WorkspaceRecord } from "@/lib/workspace/types"
import type { BindingRootKind } from "@/lib/services/desktop/workspace-reconciler"

/**
 * A registered BindingRoot (ODE-370). `managed` is Artifact Studio's private root
 * for drafts / cloud-only materialization: exactly one exists and it is never a
 * user Workspace. `external` roots are user folders registered with consent, and
 * they track `visibleAsWorkspace` and scope (`selectedPaths`) independently.
 */
export type BindingRootSettingRecord = {
  id: string
  rootPath: string
  kind: BindingRootKind
  visibleAsWorkspace: boolean
  selectedPaths: string[]
  /** ISO timestamp of explicit consent for external roots; null for managed. */
  consentedAt: string | null
  createdAt: string
}

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
  workspaces?: WorkspaceRecord[]
  workspaceLayout?: WorkspaceLayout
  /**
   * Contextual document↔workspace assignments (writing id → workspace slug).
   * Local, single-valued metadata — see `lib/workspace/assignment.ts`. Lives in
   * desktop settings because the workspace layer is desktop-first; it is not a
   * synced field on the writing record.
   */
  workspaceAssignments?: WorkspaceAssignmentMap
  /**
   * Registered BindingRoots for the desktop catalog (ODE-370). Distinct from
   * `workspaces` (a presentation grouping): a BindingRoot is filesystem
   * infrastructure and may exist without being a visible Workspace.
   */
  bindingRoots?: BindingRootSettingRecord[]
} & UserSettings

const MANAGED_ROOT_ID = "managed-root"

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
    const empty: DesktopSettings = { disabledStatuses: [], vocabulary: [] }
    try {
      const raw = await tauriSettingsRead(this.configDir, SETTINGS_KEY)
      if (raw === null) return empty
      return { ...empty, ...(raw as DesktopSettings) }
    } catch {
      return empty
    }
  }

  private async writeStore(settings: DesktopSettings): Promise<void> {
    await tauriSettingsWrite(this.configDir, SETTINGS_KEY, settings)
  }

  // ─── SettingsService contract ──────────────────────────────────────────────

  async getUserSettings(): Promise<ServiceResponse<UserSettings>> {
    try {
      const store = await this.readStore()
      // Vocabulary is not yet persisted on desktop — [ODE-473] implements it.
      // Empty here (not base items) is correct: this is the SettingsService
      // contract, and the client-side catalog ([ODE-474]) is what falls back
      // to base items on an UNAVAILABLE listVocabulary() below.
      return ok({ disabledStatuses: store.disabledStatuses ?? [], vocabulary: [] })
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
      return ok({ disabledStatuses: store.disabledStatuses ?? [], vocabulary: [] })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to write settings")
    }
  }

  // ─── Vocabulary (stub — implemented by [ODE-473]) ─────────────────────────
  // Deliberately UNAVAILABLE, not a silent empty-list success: a silent stub
  // would make [ODE-473] look unnecessary in web QA and would show desktop a
  // vocabulary it cannot actually save.

  async listVocabulary(): Promise<ServiceResponse<VocabularyItem[]>> {
    return err("UNAVAILABLE", "Desktop vocabulary persistence is not implemented yet (ODE-473).")
  }

  async createVocabularyItem(_input: CreateVocabularyItemInput): Promise<ServiceResponse<VocabularyItem>> {
    return err("UNAVAILABLE", "Desktop vocabulary persistence is not implemented yet (ODE-473).")
  }

  async updateVocabularyItem(
    _id: string,
    _input: UpdateVocabularyItemInput,
  ): Promise<ServiceResponse<VocabularyItem>> {
    return err("UNAVAILABLE", "Desktop vocabulary persistence is not implemented yet (ODE-473).")
  }

  async deleteVocabularyItem(_id: string): Promise<ServiceResponse<VocabularyDeleteResult>> {
    return err("UNAVAILABLE", "Desktop vocabulary persistence is not implemented yet (ODE-473).")
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

  // ─── BindingRoots (ODE-370) ────────────────────────────────────────────────

  async getBindingRoots(): Promise<BindingRootSettingRecord[]> {
    const store = await this.readStore()
    return Array.isArray(store.bindingRoots) ? store.bindingRoots : []
  }

  /**
   * Guarantees exactly one `managed` root exists (spec §BindingRoot: "siempre
   * existe y no aparece como Workspace"). Returns the managed record. The caller
   * supplies the resolved managed directory path since path resolution is a
   * Tauri concern kept out of this adapter.
   */
  async ensureManagedRoot(rootPath: string): Promise<BindingRootSettingRecord> {
    const roots = await this.getBindingRoots()
    const existing = roots.find((root) => root.kind === "managed")
    if (existing) return existing

    const managed: BindingRootSettingRecord = {
      id: MANAGED_ROOT_ID,
      rootPath,
      kind: "managed",
      visibleAsWorkspace: false,
      selectedPaths: [],
      consentedAt: null,
      createdAt: new Date().toISOString(),
    }
    const result = await this.updateDesktopSettings({ bindingRoots: [...roots, managed] })
    if (result.error) {
      throw new Error(`Failed to persist managed BindingRoot: ${result.error.message}`)
    }
    return managed
  }

  /**
   * Upserts a BindingRoot by durable manifest id, converging an older record for
   * the same path instead of leaving two identities for one filesystem root.
   */
  async upsertBindingRoot(record: BindingRootSettingRecord): Promise<void> {
    const roots = await this.getBindingRoots()
    const matches = (root: BindingRootSettingRecord) =>
      root.id === record.id || root.rootPath === record.rootPath
    const next = roots.some(matches)
      ? roots.map((root) => (matches(root) ? record : root))
      : [...roots, record]
    const result = await this.updateDesktopSettings({ bindingRoots: next })
    if (result.error) {
      throw new Error(`Failed to persist BindingRoot: ${result.error.message}`)
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
