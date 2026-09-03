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
  VocabularyKind,
} from "@/lib/vocabulary/types"
import { BASE_VOCABULARY_ITEMS, getBaseVocabularyDefinition } from "@/lib/vocabulary/base-items"
import { slugifyVocabularyName } from "@/lib/vocabulary/key"
import { validateVocabularyItemFields } from "@/lib/vocabulary/validate"
import type { ServiceError, ServiceResponse } from "@/lib/services/contracts/service-types"
import {
  tauriCatalogBulkDualWrite,
  tauriCatalogList,
  tauriSettingsDelete,
  tauriSettingsRead,
  tauriSettingsWrite,
  type DesktopCatalogDualWriteInput,
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
  /**
   * Custom + edited-base vocabulary rows (ODE-473). Optional and additive: an
   * install that never wrote this key has none, which means "use the base
   * items" — no migration needed. `UserSettings.vocabulary` (the
   * SettingsService-shape field) is always derived from this at read time,
   * merged with the base defaults; this field alone can be a partial list.
   */
  vocabularyItems?: VocabularyItem[]
} & Omit<UserSettings, "vocabulary">

const MANAGED_ROOT_ID = "managed-root"

const SETTINGS_KEY = "desktop_settings_v1"

const CATALOG_DB_FILE = "desktop-index.sqlite3"

function syntheticBaseId(kind: VocabularyKind, key: string): string {
  return `base:${kind}:${key}`
}

function parseSyntheticBaseId(id: string): { kind: VocabularyKind; key: string } | null {
  const match = /^base:(type|status):(.+)$/.exec(id)
  if (!match) return null
  return { kind: match[1] as VocabularyKind, key: match[2] }
}

function baseValueFor(kind: VocabularyKind): string {
  return kind === "type" ? "general" : "draft"
}

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
    const empty: DesktopSettings = { disabledStatuses: [] }
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

  /** Merges stored rows over base defaults — the same lazy-materialization shape as the web adapter (ODE-472), minus any database round trip. */
  private mergeWithBaseItems(stored: VocabularyItem[]): VocabularyItem[] {
    const byKindKey = new Map(stored.map((item) => [`${item.kind}:${item.key}`, item]))
    const items: VocabularyItem[] = []
    for (const def of BASE_VOCABULARY_ITEMS) {
      const existing = byKindKey.get(`${def.kind}:${def.key}`)
      items.push(
        existing ?? {
          id: syntheticBaseId(def.kind, def.key),
          kind: def.kind,
          key: def.key,
          name: def.name,
          description: def.description,
          icon: def.icon,
          color: def.color,
          hidden: false,
          isBase: true,
          isRequired: def.isRequired,
          position: def.position,
          createdAt: new Date(0).toISOString(),
          updatedAt: new Date(0).toISOString(),
        },
      )
    }
    for (const item of stored) {
      if (!item.isBase) items.push(item)
    }
    return items
  }

  // ─── SettingsService contract ──────────────────────────────────────────────

  async getUserSettings(): Promise<ServiceResponse<UserSettings>> {
    try {
      const store = await this.readStore()
      const vocabulary = this.mergeWithBaseItems(store.vocabularyItems ?? [])
      const disabledStatuses = vocabulary
        .filter((item) => item.kind === "status" && item.hidden)
        .map((item) => item.key) as UserSettings["disabledStatuses"]
      return ok({ disabledStatuses, vocabulary })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to read settings")
    }
  }

  /**
   * Legacy write path, mirrored from `lib/vocabulary/server.ts`'s
   * `setDisabledStatuses`: applies a `disabledStatuses` array as `hidden` on
   * the matching base status items only — never touches custom status items.
   */
  async updateUserSettings(
    input: UpdateUserSettingsInput,
  ): Promise<ServiceResponse<UserSettings>> {
    try {
      if (input.disabledStatuses?.includes("draft")) {
        return err("INVALID_INPUT", "draft cannot be disabled")
      }

      const store = await this.readStore()
      if (input.disabledStatuses !== undefined) {
        store.disabledStatuses = input.disabledStatuses
        const disabled = new Set<string>(input.disabledStatuses)
        const merged = this.mergeWithBaseItems(store.vocabularyItems ?? [])
        const now = new Date().toISOString()
        store.vocabularyItems = merged.map((item) => {
          if (item.kind !== "status" || !item.isBase) return item
          const nextHidden = disabled.has(item.key)
          return nextHidden === item.hidden ? item : { ...item, hidden: nextHidden, updatedAt: now }
        })
      }
      await this.writeStore(store)
      const vocabulary = this.mergeWithBaseItems(store.vocabularyItems ?? [])
      return ok({ disabledStatuses: store.disabledStatuses ?? [], vocabulary })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to write settings")
    }
  }

  // ─── Vocabulary (ODE-473) ──────────────────────────────────────────────────
  // Local-first: works without a signed-in session. Persisted in
  // desktop_settings_v1 alongside workspaces/bindingRoots — no new durable
  // store (DoD Fase 10 §1). Reconciliation with the cloud on sign-in is
  // `lib/services/desktop/vocabulary-reconciler.ts`, not this adapter.

  async listVocabulary(): Promise<ServiceResponse<VocabularyItem[]>> {
    try {
      const store = await this.readStore()
      return ok(this.mergeWithBaseItems(store.vocabularyItems ?? []))
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to read vocabulary")
    }
  }

  async createVocabularyItem(input: CreateVocabularyItemInput): Promise<ServiceResponse<VocabularyItem>> {
    try {
      const fieldErrors = validateVocabularyItemFields(input.kind, {
        name: input.name,
        description: input.description ?? "",
        icon: input.icon,
        color: input.color,
      })
      if (fieldErrors.length > 0) {
        return err("INVALID_INPUT", fieldErrors.map((e) => e.message).join(" "))
      }

      const store = await this.readStore()
      const stored = store.vocabularyItems ?? []
      const base = slugifyVocabularyName(input.name)
      let key = base
      let attempt = 1
      const taken = new Set(stored.filter((i) => i.kind === input.kind).map((i) => i.key))
      while (taken.has(key)) {
        attempt += 1
        key = `${base}_${attempt}`
      }

      const now = new Date().toISOString()
      const position = stored.filter((i) => i.kind === input.kind).length + BASE_VOCABULARY_ITEMS.filter((d) => d.kind === input.kind).length
      const item: VocabularyItem = {
        id: crypto.randomUUID(),
        kind: input.kind,
        key,
        name: input.name.trim(),
        description: (input.description ?? "").slice(0, 180),
        icon: input.icon,
        color: input.color,
        hidden: false,
        isBase: false,
        isRequired: false,
        position,
        createdAt: now,
        updatedAt: now,
      }

      store.vocabularyItems = [...stored, item]
      await this.writeStore(store)
      return ok(item)
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to create vocabulary item")
    }
  }

  async updateVocabularyItem(
    id: string,
    input: UpdateVocabularyItemInput,
  ): Promise<ServiceResponse<VocabularyItem>> {
    try {
      const store = await this.readStore()
      const stored = store.vocabularyItems ?? []

      let current = stored.find((i) => i.id === id)
      if (!current) {
        const synthetic = parseSyntheticBaseId(id)
        if (synthetic) {
          const def = getBaseVocabularyDefinition(synthetic.kind, synthetic.key)
          if (def) {
            current = {
              id,
              kind: def.kind,
              key: def.key,
              name: def.name,
              description: def.description,
              icon: def.icon,
              color: def.color,
              hidden: false,
              isBase: true,
              isRequired: def.isRequired,
              position: def.position,
              createdAt: new Date(0).toISOString(),
              updatedAt: new Date(0).toISOString(),
            }
          }
        }
      }
      if (!current) {
        return err("INVALID_INPUT", `Vocabulary item "${id}" was not found.`)
      }

      const fieldErrors = validateVocabularyItemFields(current.kind, {
        name: input.name,
        description: input.description,
        icon: input.icon,
        color: input.color,
      })
      if (fieldErrors.length > 0) {
        return err("INVALID_INPUT", fieldErrors.map((e) => e.message).join(" "))
      }
      if (input.hidden === true && current.isRequired) {
        return err("INVALID_INPUT", `"${current.name}" is required and cannot be hidden.`)
      }

      const updated: VocabularyItem = {
        ...current,
        name: input.name !== undefined ? input.name.trim() : current.name,
        description: input.description !== undefined ? input.description.slice(0, 180) : current.description,
        icon: input.icon ?? current.icon,
        color: input.color ?? current.color,
        hidden: input.hidden ?? current.hidden,
        updatedAt: new Date().toISOString(),
      }

      const withoutCurrent = stored.filter((i) => i.id !== id)
      store.vocabularyItems = [...withoutCurrent, updated]
      await this.writeStore(store)
      return ok(updated)
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to update vocabulary item")
    }
  }

  async deleteVocabularyItem(id: string): Promise<ServiceResponse<VocabularyDeleteResult>> {
    try {
      const synthetic = parseSyntheticBaseId(id)
      if (synthetic) {
        const def = getBaseVocabularyDefinition(synthetic.kind, synthetic.key)
        return err("INVALID_INPUT", `"${def?.name ?? synthetic.key}" is a base item and cannot be deleted.`)
      }

      const store = await this.readStore()
      const stored = store.vocabularyItems ?? []
      const item = stored.find((i) => i.id === id)
      if (!item) {
        return err("INVALID_INPUT", `Vocabulary item "${id}" was not found.`)
      }
      if (item.isBase) {
        return err("INVALID_INPUT", `"${item.name}" is a base item and cannot be deleted.`)
      }

      const rewrittenCount = await this.rewriteCatalogToBaseValue(item.kind, item.key)

      store.vocabularyItems = stored.filter((i) => i.id !== id)
      await this.writeStore(store)
      return ok({ rewrittenCount })
    } catch (e) {
      return err("UNAVAILABLE", e instanceof Error ? e.message : "Failed to delete vocabulary item")
    }
  }

  /**
   * Overwrites the stored rows for exactly the given items, matched by
   * (kind, key) — not by id, since a merge winner from the cloud carries the
   * cloud's id/updatedAt verbatim. Used only by
   * `lib/services/desktop/vocabulary-reconciler.ts`; not part of the public
   * `SettingsService` contract. One read + one write for the whole batch, so
   * a merge touching N items produces a single store write, not N.
   */
  async applyVocabularyMergeLocally(items: VocabularyItem[]): Promise<void> {
    if (items.length === 0) return
    const store = await this.readStore()
    const stored = store.vocabularyItems ?? []
    const byMatch = new Map(items.map((item) => [`${item.kind}:${item.key}`, item]))
    const kept = stored.filter((existing) => !byMatch.has(`${existing.kind}:${existing.key}`))
    store.vocabularyItems = [...kept, ...items]
    await this.writeStore(store)
  }

  /**
   * Requirement 4: rewrites every SQLite-cataloged document that carried the
   * deleted item's key to the base value, and enqueues its cloud sync
   * mutation — both in the SAME transaction (`catalog_bulk_dual_write`
   * inserts the document row and its `sync_mutations` row together), so the
   * catalog write and its enqueue can't drift apart. The actual cloud PATCH
   * happens later, in the existing background flush (`desktopCatalogSyncService`).
   * Never touches the `.md`: the key lives only in the catalog cache and the
   * cloud row.
   */
  private async rewriteCatalogToBaseValue(kind: VocabularyKind, key: string): Promise<number> {
    const { join } = await import("@tauri-apps/api/path")
    const dbPath = await join(this.configDir, CATALOG_DB_FILE)
    const rows = await tauriCatalogList(dbPath, { includeDeleted: false, localOnly: false, cloudAccountId: null, limit: 100000 })
    const baseValue = baseValueFor(kind)
    const matches = rows.filter((row) => (kind === "type" ? row.artifactType : row.status) === key)
    if (matches.length === 0) return 0

    const now = Date.now()
    const nowIso = new Date(now).toISOString()
    const inputs: DesktopCatalogDualWriteInput[] = matches.map((row) => {
      const nextVersion = (row.version ?? 1) + 1
      return {
        document: {
          id: row.id,
          localPresent: row.localPresent,
          cloudPresent: row.cloudPresent,
          cloudAccountId: row.cloudAccountId,
          syncStatus: "pending",
          title: row.title,
          slug: row.slug,
          status: kind === "status" ? baseValue : row.status,
          artifactType: kind === "type" ? baseValue : row.artifactType,
          visibility: row.visibility,
          version: nextVersion,
          deletedAt: row.deletedAt,
          createdAt: row.createdAt,
          modifiedAt: now,
        },
        binding: null,
        mutation: {
          id: crypto.randomUUID(),
          operation: "upsert",
          payloadJson: JSON.stringify({
            mutationKind: "metadata",
            status: kind === "status" ? baseValue : row.status,
            artifactType: kind === "type" ? baseValue : row.artifactType,
            version: nextVersion,
            updatedAt: nowIso,
          }),
          status: "pending",
          attemptCount: 0,
          nextRetryAt: null,
          createdAt: now,
          lastError: null,
        },
      }
    })

    await tauriCatalogBulkDualWrite(dbPath, inputs)
    return matches.length
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
