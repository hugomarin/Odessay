/**
 * Catalog seam recorder — ODE-613 (vía a), ampliado por ODE-644 PR2.
 *
 * Records, from the REAL TS side, the exact sequence of Tauri `invoke` calls a
 * desktop flow produces, so `src-tauri/tests/catalog_seam.rs` can replay that
 * same sequence against the real Rust commands and SQLite. The sequence is
 * never written twice:
 *
 *   production wrapper (SqliteDocumentCatalog / tauri-commands)
 *     + real reconciler (createWorkspaceReconciler over the same injectable
 *       port factory production consumes, createWorkspaceReconcilerPorts:
 *       workspace_sync → listByBindingRoot → applyReconcileTransaction)
 *     +, para SYNC-05, las entradas de producción reales
 *       (DesktopDocumentService.saveWriting vía getDocumentService y
 *       desktopCatalogSyncService.flushPending)
 *     → mocked `@tauri-apps/api/core` invoke that RECORDS {cmd, args} and
 *       answers with the per-command semantics of the Rust layer
 *     → tests/fixtures/catalog-seam/catalog-seam-v4.json
 *
 * Only the IPC boundary is doubled (external boundary, capability-proof
 * contract rule 3), plus the Supabase network in the SYNC-05 scenarios
 * (`fake-supabase-server.ts`, retención/fallo del próximo write). The
 * double's responses are NOT throwaway: they decide what the TS side does
 * next (which ids it re-sends, which upserts it commits). So every recorded
 * invoke also stores a projection of the response — the fields that determine
 * identity and presence — and the Rust replay asserts the REAL command's
 * response matches that projection step by step, on top of the canonical
 * outcome (SQLite rows vs. files on disk). See `projectInvokeResponse` for
 * the exact fields and the documented exclusions (`folderCount`, and the
 * machine-dependent fields of `workspace_touch_file`).
 *
 * SYNC-05 (ODE-644 PR2) no escribe una tercera copia del SQL de la cola: el
 * dispatch delega `catalog_*` en los dobles de comportamiento de
 * `real-desktop-doubles.ts` (el mismo espejo que consumen ODE-611/612), y el
 * grabador afirma en cada paso de control que el estado del doble es el
 * correcto. El replay Rust contrasta ese mismo estado en SQLite real.
 *
 * Paths are placeholders ($DB, $ROOT_A, $ROOT_B) so the fixture is machine
 * independent; the Rust runner rewrites them to its own temp dirs.
 */

import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { computeMarkdownContentHash } from "@/lib/content-hash"
import {
  type DesktopCatalogDualWriteInput,
  type DesktopCatalogMetadataMutation,
  type DesktopCatalogMutationRow,
  type DesktopCatalogReconcileInput,
  type DesktopCatalogRow,
  type DesktopWorkspaceTouchResult,
} from "@/lib/services/desktop/tauri-commands"
import {
  createWorkspaceReconciler,
  type ReconcilerRoot,
  type WorkspaceReconciler,
} from "@/lib/services/desktop/workspace-reconciler"
import { createWorkspaceReconcilerPorts } from "@/lib/services/desktop/workspace-reconciler-ports"
import { createDesktopDraft, getDocumentService } from "@/lib/services/document-service-factory"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { desktopCatalogSyncService } from "@/lib/sync/desktop-catalog-sync-service"
import { fakeSupabase, fakeSupabaseClient } from "../integration/documents/support/fake-supabase-server"
import {
  catalogMutationsDouble,
  resetCatalogDoubles,
  tauriCatalogActivateBindingRootDouble,
  tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogApplyReconcileDouble,
  tauriCatalogApplyWorkspaceRemovalDouble,
  tauriCatalogBulkDualWriteDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListBindingRootDocumentsDouble,
  tauriCatalogListPendingMetadataMutationsDouble,
  tauriCatalogListPendingMutationsDouble,
  tauriCatalogListQueryDouble,
  tauriCatalogResolvePathDouble,
  tauriCatalogUpdateMutationStatusDouble,
} from "../integration/documents/support/real-desktop-doubles"

export const CATALOG_SEAM_FIXTURE_VERSION = 4 as const
export const FIXTURE_DB_PATH = "$DB"
/**
 * Prefijo del alias estable con el que el recorder normaliza SOLO los ids que
 * el runtime nativo acuña dentro de un comando (ODE-663): el UUID del delete de
 * `catalog_apply_workspace_removal` (`uuid::Uuid::new_v4()`, index.rs:957).
 * Ningún otro campo se normaliza.
 */
export const GENERATED_ID_ALIAS_PREFIX = "$MUTATION_"
export const FIXTURE_ROOT_PATHS = { rootA: "$ROOT_A", rootB: "$ROOT_B" } as const
// Synthetic volume for every fixture file, like the synthetic inode: the
// double cannot know the replay machine's `st_dev`, so the projection excludes
// it and the recording only needs one shared volume (ODE-657 review P1).
const FIXTURE_DEVICE = 1
export type FixtureRootKey = keyof typeof FIXTURE_ROOT_PATHS

/** The read fields that determine identity/presence/content for SYS-01/SYS-05/WATCH-07. */
export type CatalogSeamRowProjection = {
  id: string
  relativePath: string | null
  localPresent: boolean
  bindingRootId: string | null
  contentHash: string | null
}

/**
 * Proyección de una fila de `catalog_list` para el camino de metadata de
 * Settings (ODE-670): los campos que el productor lee para construir el
 * `catalog_bulk_dual_write` y los que la cola debe conservar. Incluye las
 * cachés de metadata porque la ruta de vocabulario decide con `status`/
 * `artifactType`/`version` y el control posterior afirma que no se pisaron.
 * `inode`/`size`/`lastSeenAt`/`excerpt` quedan fuera: nadie los lee aquí y son
 * dependientes de la máquina.
 */
export type CatalogSeamMetadataRowProjection = {
  id: string
  localPresent: boolean
  cloudPresent: boolean
  cloudAccountId: string | null
  syncStatus: string
  title: string | null
  slug: string | null
  status: string | null
  artifactType: string | null
  visibility: string | null
  version: number | null
  deletedAt: string | null
  createdAt: number | null
  modifiedAt: number | null
  bindingRootId: string | null
  relativePath: string | null
  canonicalPath: string | null
  contentHash: string | null
}

/**
 * Proyección de `workspace_touch_file`. `file.path` queda fuera: el comando
 * real canonicaliza la raíz (`/var` → `/private/var` en macOS) y el
 * `canonicalPath` del binding ya viaja en los args grabados de
 * `catalog_dual_write`. Inode, modifiedAt y device también quedan fuera: son
 * del fs real en el replay y sintéticos en la grabación (misma razón que
 * `unboundFiles.inode`).
 */
export type CatalogSeamTouchProjection =
  | {
      status: "updated"
      rootPath: string
      bindingRootId: string
      file: {
        id: string
        relativePath: string
        name: string
        size: number
        contentHash: string
      }
    }
  | { status: "needsReconcile"; reason: string }

/**
 * Proyección de una fila de `catalog_list_pending_mutations`. `payloadJson`
 * queda fuera a propósito: es eco byte a byte del argumento de
 * `catalog_dual_write`, que ya está grabado en la secuencia.
 */
export type CatalogSeamMutationProjection = {
  id: string
  documentId: string
  operation: string
  status: string
  attemptCount: number
  nextRetryAt: number | null
  createdAt: number
  lastError: string | null
}

/** Proyección de una fila de la cola de metadata (misma exclusión de `payloadJson`). */
export type CatalogSeamMetadataMutationProjection = {
  id: string
  entityKind: string
  entityId: string
  operation: string
  status: string
  attemptCount: number
  nextRetryAt: number | null
  createdAt: number
  lastError: string | null
}

export type CatalogSeamInvokeResponse =
  | {
      files: { relativePath: string; id: string; contentHash: string }[]
      unboundPaths: string[]
      unboundFiles: { relativePath: string; contentHash: string; size: number }[]
    }
  | { applied: boolean; changed: string[] }
  | CatalogSeamTouchProjection
  | CatalogSeamMutationProjection[]
  | CatalogSeamMetadataMutationProjection[]
  | CatalogSeamMetadataRowProjection[]
  | CatalogSeamRowProjection
  | CatalogSeamRowProjection[]
  | string[]
  | Record<string, unknown>
  | string
  | null

/**
 * Proyección del payload de una mutación de la cola. `payloadJson` no se
 * compara entero (es eco del argumento ya grabado); estos campos son los que
 * distinguen una mutación de metadata real (`mutationKind:"metadata"`) de la
 * de un guardado de cuerpo (`mutationKind` ausente) sin volver opaca la
 * comparación (Recon Pack: "la proyección de mutaciones omite payloadJson").
 */
export type CatalogSeamMutationPayloadProjection = {
  mutationKind: string | null
  version: number | null
  updatedAt: string | null
  status: string | null
  artifactType: string | null
}

/**
 * Paso de control (Req 5): el estado canónico que el doble cree del documento y
 * de su cola. El grabador lo afirma contra el doble antes de grabarlo, y el
 * replay Rust lo contrasta en una conexión SQLite nueva sobre `documents` y
 * `sync_mutations`.
 *
 * `document.metadata` y `mutations[].payload` son opcionales: solo los
 * escenarios SYNC-08 los usan, y solo se contrastan cuando el escenario los
 * declara (los controles de SYNC-05 conservan su forma).
 */
export type CatalogSeamControlStep = {
  kind: "control"
  name: string
  documentId: string
  document: {
    syncStatus: string
    cloudPresent: boolean
    metadata?: {
      status: string | null
      artifactType: string | null
      version: number | null
      title: string | null
      slug: string | null
      visibility: string | null
      cloudAccountId: string | null
      contentHash: string | null
    }
  }
  mutations: {
    id: string
    status: string
    attemptCount: number
    nextRetryAt: number | null
    lastError: string | null
    payload?: CatalogSeamMutationPayloadProjection
  }[]
}

export type CatalogSeamFixtureStep =
  | CatalogSeamControlStep
  | { kind: "fs"; op: "seed-manifest"; root: FixtureRootKey; bindingRootId: string }
  | {
      kind: "fs"
      op: "write"
      root: FixtureRootKey
      relativePath: string
      content: string
      inode: number
      modifiedAt: number
    }
  | { kind: "fs"; op: "rename"; root: FixtureRootKey; relativePath: string; newRelativePath: string }
  | { kind: "fs"; op: "delete"; root: FixtureRootKey; relativePath: string }
  | {
      kind: "invoke"
      cmd: string
      args: Record<string, unknown>
      response: CatalogSeamInvokeResponse
    }

/**
 * `filesystem`: el escenario registra documentos por el reconciliador real, así
 * que el replay contrasta el estado final canónico del disco y del catálogo
 * (`assert_scenario`). `queue`: el escenario entra por productores que no
 * pasan por `catalog_apply_reconcile` (borrador de primera subida), y su estado
 * canónico se afirma en los pasos de control contra SQLite real.
 */
export type CatalogSeamScenarioProfile = "filesystem" | "queue"

export type CatalogSeamScenario = {
  name: string
  description: string
  profile: CatalogSeamScenarioProfile
  steps: CatalogSeamFixtureStep[]
}

export type CatalogSeamFixture = {
  version: typeof CATALOG_SEAM_FIXTURE_VERSION
  generator: string
  scenarios: CatalogSeamScenario[]
}

export function serializeCatalogSeamFixture(fixture: CatalogSeamFixture): string {
  return `${JSON.stringify(fixture, null, 2)}\n`
}

// ─── The invoke double: per-command semantics ────────────────────────────────

type ModelFile = { content: string; inode: number; modifiedAt: number }
type ModelEntry = { id: string; inode: number; contentHash: string; lastSeen: number; size: number }
type ModelDocument = { id: string; localPresent: boolean; title: string; createdAt: number; modifiedAt: number }
type ModelBinding = {
  documentId: string
  bindingRootId: string
  rootPath: string
  relativePath: string
  canonicalPath: string
  inode: number
  contentHash: string
  size: number
  lastSeenAt: number
}

type ModelRoot = {
  key: FixtureRootKey
  rootPath: string
  bindingRootId: string
  files: Map<string, ModelFile>
  manifest: Map<string, ModelEntry>
}

type ReconcileUpsert = {
  bindingRootId: string
  rootPath: string
  documentId: string
  relativePath: string
  canonicalPath: string
  inode: number | null
  contentHash: string | null
  size: number | null
  lastSeenAt: number | null
  title: string
  createdAt: number | null
  modifiedAt: number | null
}

function normalizeFixtureJson(value: unknown): unknown {
  if (value === undefined) return null
  if (Array.isArray(value)) return value.map(normalizeFixtureJson)
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, normalizeFixtureJson(entry)]),
    )
  }
  return value
}

function byRelativePath<T extends { relativePath: string }>(left: T, right: T): number {
  return left.relativePath < right.relativePath ? -1 : left.relativePath > right.relativePath ? 1 : 0
}

function projectCatalogRow(row: DesktopCatalogRow): CatalogSeamRowProjection {
  return {
    id: row.id,
    relativePath: row.relativePath,
    localPresent: row.localPresent,
    bindingRootId: row.bindingRootId,
    contentHash: row.contentHash,
  }
}

function projectCatalogRowOrNull(row: DesktopCatalogRow | null): CatalogSeamRowProjection | null {
  return row ? projectCatalogRow(row) : null
}

/** Mirrors the Rust `project_metadata_row` used by `catalog_list` and the SYNC-08 controls. */
function projectMetadataRow(row: DesktopCatalogRow): CatalogSeamMetadataRowProjection {
  return {
    id: row.id,
    localPresent: row.localPresent,
    cloudPresent: row.cloudPresent,
    cloudAccountId: row.cloudAccountId,
    syncStatus: row.syncStatus,
    title: row.title,
    slug: row.slug,
    status: row.status,
    artifactType: row.artifactType,
    visibility: row.visibility,
    version: row.version,
    deletedAt: row.deletedAt,
    createdAt: row.createdAt,
    modifiedAt: row.modifiedAt,
    bindingRootId: row.bindingRootId,
    relativePath: row.relativePath,
    canonicalPath: row.canonicalPath,
    contentHash: row.contentHash,
  }
}

function projectMutationPayload(payloadJson: string): CatalogSeamMutationPayloadProjection {
  const payload = JSON.parse(payloadJson) as Record<string, unknown>
  const text = (key: string): string | null =>
    typeof payload[key] === "string" ? (payload[key] as string) : null
  const number = (key: string): number | null =>
    typeof payload[key] === "number" ? (payload[key] as number) : null
  return {
    mutationKind: text("mutationKind"),
    version: number("version"),
    updatedAt: text("updatedAt"),
    status: text("status"),
    artifactType: text("artifactType"),
  }
}

function stringArg(args: Record<string, unknown>, key: string): string {
  const value = args[key]
  if (typeof value !== "string") {
    throw new Error(`catalog-seam recorder: invoke args ${key} is not a string`)
  }
  return value
}

function numberArg(args: Record<string, unknown>, key: string): number {
  const value = args[key]
  if (typeof value !== "number") {
    throw new Error(`catalog-seam recorder: invoke args ${key} is not a number`)
  }
  return value
}

function boolArg(args: Record<string, unknown>, key: string): boolean {
  const value = args[key]
  if (typeof value !== "boolean") {
    throw new Error(`catalog-seam recorder: invoke args ${key} is not a boolean`)
  }
  return value
}

function nullableNumberArg(args: Record<string, unknown>, key: string): number | null {
  const value = args[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "number") {
    throw new Error(`catalog-seam recorder: invoke args ${key} is not a number or null`)
  }
  return value
}

function nullableStringArg(args: Record<string, unknown>, key: string): string | null {
  const value = args[key]
  if (value === null || value === undefined) return null
  if (typeof value !== "string") {
    throw new Error(`catalog-seam recorder: invoke args ${key} is not a string or null`)
  }
  return value
}

function requireQueueBackend(backend: "session" | "queue", cmd: string): void {
  if (backend !== "queue") {
    throw new Error(
      `catalog-seam recorder: command "${cmd}" sin backend de cola — el escenario debe grabarse con backend "queue"`,
    )
  }
}

/**
 * The response projection the Rust replay must reproduce exactly. It keeps only
 * the fields that determine identity, presence, and content along the recorded
 * sequence (P2-1, ODE-613 review; ODE-637): the id/path mapping and
 * unboundPaths of `workspace_sync` decide which document ids the TS wrapper
 * re-sends and which it mints; contentHash proves edits flow through the hash
 * projections; `changed` and read rows are what subscribers consume.
 *
 * `folderCount` is deliberately excluded. No consumer of this sequence reads
 * it, and the double counts the folders of the bound manifest while Rust counts
 * the scanned scope — they diverge exactly on passes that still have unbound
 * paths, with no SYS-01/SYS-05/WATCH-07 signal. Including it would only encode
 * double-only semantics into the recording.
 */
export function projectInvokeResponse(cmd: string, response: unknown): CatalogSeamInvokeResponse {
  switch (cmd) {
    case "workspace_sync": {
      const snapshot = response as {
        files: { relativePath: string; id: string; contentHash: string }[]
        unboundPaths: string[]
        unboundFiles?: { relativePath: string; contentHash: string; size: number }[]
      }
      return {
        files: snapshot.files
          .map((file) => ({
            relativePath: file.relativePath,
            id: file.id,
            contentHash: file.contentHash,
          }))
          .sort(byRelativePath),
        unboundPaths: [...snapshot.unboundPaths].sort(),
        // Inode is deliberately excluded: it is synthetic in the double and
        // real in the replay, so it can never be compared across the seam. The
        // identity signal the wrapper reads is path + hash + size (ODE-657).
        unboundFiles: [...(snapshot.unboundFiles ?? [])]
          .map((file) => ({
            relativePath: file.relativePath,
            contentHash: file.contentHash,
            size: file.size,
          }))
          .sort(byRelativePath),
      }
    }
    case "catalog_apply_reconcile": {
      const result = response as { applied: boolean; changed: string[] }
      return { applied: result.applied, changed: [...result.changed] }
    }
    case "catalog_list_binding_root_documents":
      return (response as DesktopCatalogRow[]).map(projectCatalogRow)
    // ── Camino de metadata de Settings (ODE-670) ────────────────────────────
    case "catalog_list":
      return (response as DesktopCatalogRow[]).map(projectMetadataRow)
    case "catalog_bulk_dual_write":
      // El contrato del comando es "ids escritos, en orden de entrada"; se
      // compara tal cual para que invertir el orden ponga el replay rojo.
      return [...(response as string[])]
    case "settings_read":
      // El store real es un JSON plano: se compara el valor parseado, no el
      // orden de claves.
      return JSON.parse(response as string) as Record<string, unknown>
    // ── Cadena de SYNC-05 (ODE-644 PR2) ─────────────────────────────────────
    case "write_file":
      // Void command: el write real lo verifica el replay con open_file y con
      // el hash del binding en SQLite.
      return null
    case "open_file":
      // El .md es la autoridad del cuerpo: se compara el contenido completo
      // que el flush releyó, no solo un hash.
      return response as string
    case "workspace_touch_file": {
      const result = response as DesktopWorkspaceTouchResult
      if (result.status !== "updated") {
        return { status: "needsReconcile", reason: result.reason }
      }
      return {
        status: "updated",
        rootPath: result.rootPath,
        bindingRootId: result.bindingRootId,
        file: {
          id: result.file.id,
          relativePath: result.file.relativePath,
          name: result.file.name,
          size: result.file.size,
          contentHash: result.file.contentHash,
        },
      }
    }
    case "catalog_apply_workspace_removal":
      // Devuelve los ids afectados (la señal con la que el wrapper emite un
      // CatalogChange); el UUID del delete no viaja en la respuesta.
      return [...(response as string[])]
    case "catalog_activate_binding_root":
    case "catalog_dual_write":
    case "catalog_update_mutation_status":
    case "catalog_update_metadata_mutation_status":
    case "catalog_apply_cloud_snapshots":
    case "settings_write":
    case "settings_delete":
      // Void commands: su efecto se afirma en los pasos de control.
      return null
    case "catalog_list_pending_mutations":
      return (response as DesktopCatalogMutationRow[]).map((mutation) => ({
        id: mutation.id,
        documentId: mutation.documentId,
        operation: mutation.operation,
        status: mutation.status,
        attemptCount: mutation.attemptCount,
        nextRetryAt: mutation.nextRetryAt,
        createdAt: mutation.createdAt,
        lastError: mutation.lastError,
      }))
    case "catalog_list_pending_metadata_mutations":
      return (response as DesktopCatalogMetadataMutation[]).map((mutation) => ({
        id: mutation.id,
        entityKind: mutation.entityKind,
        entityId: mutation.entityId,
        operation: mutation.operation,
        status: mutation.status,
        attemptCount: mutation.attemptCount,
        nextRetryAt: mutation.nextRetryAt,
        createdAt: mutation.createdAt,
        lastError: mutation.lastError,
      }))
    default:
      // The remaining commands are reads: catalog_get_by_id / catalog_resolve_path.
      return projectCatalogRowOrNull(response as DesktopCatalogRow | null)
  }
}

/**
 * Records one scenario session. Everything the scenario does goes through
 * `session` helpers, so the fixture only ever contains calls the real TS code
 * emitted plus the fs setup steps the Rust runner must materialize.
 */
export class CatalogSeamSession {
  readonly steps: CatalogSeamFixtureStep[] = []
  private readonly roots = new Map<FixtureRootKey, ModelRoot>()
  private readonly documents = new Map<string, ModelDocument>()
  private readonly bindings = new Map<string, ModelBinding>()
  /** Store de settings de la escena (espejo de `commands/settings.rs`), aislado por sesión. */
  private readonly settingsStore = new Map<string, unknown>()
  /**
   * Ids que el runtime nativo acuña dentro de un comando → alias estable. Solo
   * se normaliza en la copia grabada (args, respuestas, controles); el flujo TS
   * sigue viendo el id real que devuelve el doble.
   */
  private readonly generatedIdAliases = new Map<string, string>()

  constructor(
    readonly name: string,
    readonly description: string,
    /**
     * `session`: los `catalog_*` los responde el modelo sintético de esta
     * clase (escenarios SYS-01/SYS-05/WATCH-04/WATCH-07).
     * `queue`: los `catalog_*` se delegan en `real-desktop-doubles.ts`, la
     * única copia TS de la semántica de la cola, y el registro/lecturas van al
     * mismo modelo (SYNC-05, ODE-644 PR2).
     */
    private readonly backend: "session" | "queue" = "session",
  ) {}

  defineRoot(key: FixtureRootKey, bindingRootId: string): ReconcilerRoot {
    const rootPath = FIXTURE_ROOT_PATHS[key]
    this.roots.set(key, {
      key,
      rootPath,
      bindingRootId,
      files: new Map(),
      manifest: new Map(),
    })
    this.steps.push({ kind: "fs", op: "seed-manifest", root: key, bindingRootId })
    return { id: bindingRootId, rootPath, kind: "managed", visibleAsWorkspace: true, selectedPaths: [] }
  }

  private requireRoot(key: FixtureRootKey): ModelRoot {
    const root = this.roots.get(key)
    if (!root) throw new Error(`catalog-seam recorder: root ${key} was not defined`)
    return root
  }

  fsWrite(
    key: FixtureRootKey,
    relativePath: string,
    content: string,
    options: { inode: number; modifiedAt: number },
  ): void {
    this.requireRoot(key).files.set(relativePath, { ...options, content })
    this.steps.push({
      kind: "fs",
      op: "write",
      root: key,
      relativePath,
      content,
      inode: options.inode,
      modifiedAt: options.modifiedAt,
    })
  }

  fsRename(key: FixtureRootKey, relativePath: string, newRelativePath: string): void {
    const root = this.requireRoot(key)
    const file = root.files.get(relativePath)
    if (!file) throw new Error(`catalog-seam recorder: no file ${relativePath} to rename`)
    root.files.delete(relativePath)
    root.files.set(newRelativePath, { ...file, modifiedAt: file.modifiedAt + 1 })
    this.steps.push({ kind: "fs", op: "rename", root: key, relativePath, newRelativePath })
  }

  fsDelete(key: FixtureRootKey, relativePath: string): void {
    this.requireRoot(key).files.delete(relativePath)
    this.steps.push({ kind: "fs", op: "delete", root: key, relativePath })
  }

  /** The real wrapper the app calls; its invokes are recorded. */
  createCatalog(): SqliteDocumentCatalog {
    return new SqliteDocumentCatalog(FIXTURE_DB_PATH)
  }

  /**
   * The production reconciler ports (`scanRoot` / `bindUnbound` / `commit`)
   * are not copied here: they come from the same injectable desktop factory
   * production consumes (ODE-645), so the recorded sequence tracks that glue.
   * `loadRoots` is in-memory — settings/DirectoryScope is an organizational
   * projection with no catalog semantics, deliberately out of the seam.
   */
  createReconciler(catalog: SqliteDocumentCatalog): WorkspaceReconciler {
    return createWorkspaceReconciler({
      loadRoots: async () => [...this.roots.values()].map((root) => ({
        id: root.bindingRootId,
        rootPath: root.rootPath,
        kind: "managed" as const,
        visibleAsWorkspace: true,
        selectedPaths: [],
      })),
      ...createWorkspaceReconcilerPorts({ catalog }),
    })
  }

  /** Reads the id the wrapper minted for a bound path (for production reads). */
  documentIdForPath(rootKey: FixtureRootKey, relativePath: string): string {
    const canonicalPath = `${FIXTURE_ROOT_PATHS[rootKey]}/${relativePath}`
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return binding.documentId
    }
    throw new Error(`catalog-seam recorder: no document bound at ${canonicalPath}`)
  }

  /** True when the model still holds a binding at that canonical path. */
  hasBindingAtPath(rootKey: FixtureRootKey, relativePath: string): boolean {
    const canonicalPath = `${FIXTURE_ROOT_PATHS[rootKey]}/${relativePath}`
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return true
    }
    return false
  }

  toScenario(profile: CatalogSeamScenarioProfile = "filesystem"): CatalogSeamScenario {
    return { name: this.name, description: this.description, profile, steps: this.steps }
  }

  // ── command semantics (the doubled IPC boundary) ──────────────────────────

  /**
   * Registra un id que el runtime nativo acuña dentro de un comando y que, por
   * tanto, no puede compararse literalmente entre la grabación TS (UUID del
   * stub) y el replay Rust (`uuid::Uuid::new_v4()`). El alias debe ser estable
   * por evento/documento y con forma `$MUTATION_…`; el replay valida que el id
   * real tenga forma UUID y que el alias no se ligue dos veces a valores
   * distintos.
   */
  aliasGeneratedId(realId: string, alias: string): void {
    if (!alias.startsWith(GENERATED_ID_ALIAS_PREFIX)) {
      throw new Error(
        `catalog-seam recorder: alias ${alias} no empieza por ${GENERATED_ID_ALIAS_PREFIX}`,
      )
    }
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(realId)) {
      throw new Error(`catalog-seam recorder: id generado ${realId} no tiene forma de UUID`)
    }
    if (this.generatedIdAliases.has(realId)) {
      throw new Error(`catalog-seam recorder: el id ${realId} ya tiene un alias`)
    }
    if ([...this.generatedIdAliases.values()].includes(alias)) {
      throw new Error(`catalog-seam recorder: el alias ${alias} ya está en uso`)
    }
    this.generatedIdAliases.set(realId, alias)
  }

  /** Sustituye los ids generados ya registrados por su alias, en la copia grabada. */
  private withGeneratedIdAliases(value: unknown): unknown {
    if (value === undefined) return null
    if (Array.isArray(value)) return value.map((entry) => this.withGeneratedIdAliases(entry))
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value).map(([key, entry]) => [key, this.withGeneratedIdAliases(entry)]),
      )
    }
    if (typeof value === "string") return this.generatedIdAliases.get(value) ?? value
    return value
  }

  async invoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const response = await this.dispatch(cmd, args)
    this.steps.push({
      kind: "invoke",
      cmd,
      args: this.withGeneratedIdAliases(normalizeFixtureJson(args)) as Record<string, unknown>,
      response: this.withGeneratedIdAliases(
        projectInvokeResponse(cmd, response),
      ) as CatalogSeamInvokeResponse,
    })
    return response
  }

  private async dispatch(cmd: string, args: Record<string, unknown>): Promise<unknown> {
    const dbPath = this.backend === "queue" ? FIXTURE_DB_PATH : null
    switch (cmd) {
      case "workspace_sync":
        return this.workspaceSync(args)
      // ── Cadena de fs/workspace (modelo sintético también en SYNC-05) ──────
      case "write_file":
        return this.writeFile(args)
      case "open_file":
        return this.openFile(args)
      case "workspace_touch_file":
        return this.touchFile(args)
      // ── Catálogo ──────────────────────────────────────────────────────────
      case "catalog_list_binding_root_documents":
        return dbPath
          ? tauriCatalogListBindingRootDocumentsDouble(dbPath, stringArg(args, "bindingRootId"))
          : this.listBindingRootDocuments(args)
      case "catalog_get_by_id":
        return dbPath
          ? tauriCatalogGetByIdDouble(dbPath, stringArg(args, "id"))
          : this.getById(args)
      case "catalog_resolve_path":
        return dbPath
          ? tauriCatalogResolvePathDouble(dbPath, stringArg(args, "path"))
          : this.resolvePath(args)
      case "catalog_apply_reconcile":
        return dbPath
          ? tauriCatalogApplyReconcileDouble(dbPath, args.input as DesktopCatalogReconcileInput)
          : this.applyReconcile(args)
      // ── Cola de sync: delegada entera en real-desktop-doubles ─────────────
      case "catalog_dual_write":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogDualWriteDouble(FIXTURE_DB_PATH, args.input as DesktopCatalogDualWriteInput).then(() => null)
      case "catalog_list_pending_mutations":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogListPendingMutationsDouble(
          FIXTURE_DB_PATH,
          numberArg(args, "now"),
          numberArg(args, "limit"),
          boolArg(args, "includeFailed"),
        )
      case "catalog_update_mutation_status":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogUpdateMutationStatusDouble(
          FIXTURE_DB_PATH,
          stringArg(args, "mutationId"),
          stringArg(args, "status") as "pending" | "synced" | "failed",
          numberArg(args, "attemptCount"),
          nullableNumberArg(args, "nextRetryAt"),
          nullableStringArg(args, "lastError"),
        ).then(() => null)
      case "catalog_list_pending_metadata_mutations":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogListPendingMetadataMutationsDouble(
          FIXTURE_DB_PATH,
          numberArg(args, "now"),
          numberArg(args, "limit"),
          boolArg(args, "includeFailed"),
        )
      case "catalog_apply_cloud_snapshots":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogApplyCloudSnapshotsDouble(
          FIXTURE_DB_PATH,
          args.snapshots as Parameters<typeof tauriCatalogApplyCloudSnapshotsDouble>[1],
        ).then(() => null)
      // ── Ciclo de vida de la raíz (ODE-663) ─────────────────────────────────
      case "catalog_apply_workspace_removal":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogApplyWorkspaceRemovalDouble(
          FIXTURE_DB_PATH,
          stringArg(args, "bindingRootId"),
          stringArg(args, "rootPath"),
          stringArg(args, "deletedAt"),
          stringArg(args, "updatedAt"),
          numberArg(args, "nowMillis"),
        )
      case "catalog_activate_binding_root":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogActivateBindingRootDouble(
          FIXTURE_DB_PATH,
          stringArg(args, "bindingRootId"),
          stringArg(args, "rootPath"),
        )
      // ── Camino de metadata de Settings (ODE-670) ────────────────────────────
      case "catalog_list":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogListQueryDouble(FIXTURE_DB_PATH, {
          cloudAccountId: nullableStringArg(args, "cloudAccountId"),
          includeDeleted: boolArg(args, "includeDeleted"),
          localOnly: boolArg(args, "localOnly"),
          limit: numberArg(args, "limit"),
        })
      case "catalog_bulk_dual_write":
        requireQueueBackend(this.backend, cmd)
        return tauriCatalogBulkDualWriteDouble(
          FIXTURE_DB_PATH,
          args.inputs as DesktopCatalogDualWriteInput[],
        )
      // ── Store de settings (espejo de commands/settings.rs) ──────────────────
      case "settings_read": {
        const stored = this.settingsStore.get(
          `${stringArg(args, "configDir")}::${stringArg(args, "key")}`,
        )
        return stored === undefined ? "null" : JSON.stringify(stored)
      }
      case "settings_write": {
        this.settingsStore.set(
          `${stringArg(args, "configDir")}::${stringArg(args, "key")}`,
          JSON.parse(stringArg(args, "valueJson")),
        )
        return null
      }
      case "settings_delete": {
        this.settingsStore.delete(`${stringArg(args, "configDir")}::${stringArg(args, "key")}`)
        return null
      }
      default:
        throw new Error(
          `catalog-seam recorder: unhandled command "${cmd}" — a production call shape changed; ` +
            "extend the double with its semantics or fix the wrapper",
        )
    }
  }

  private async workspaceSync(args: Record<string, unknown>): Promise<unknown> {
    const rootPath = String(args.rootPath)
    const root = [...this.roots.values()].find((entry) => entry.rootPath === rootPath)
    if (!root) throw new Error(`catalog-seam recorder: workspace_sync for unknown root ${rootPath}`)

    const requested = args.selectedPaths as string[] | null
    if (requested !== null && requested !== undefined) {
      throw new Error("catalog-seam recorder: scenarios only exercise whole-root scopes")
    }
    const documentIds = (args.documentIds ?? null) as Record<string, string> | null

    const entryByInode = new Map<number, ModelEntry>()
    const hashCounts = new Map<string, number>()
    const entryByHash = new Map<string, ModelEntry>()
    for (const [path, entry] of root.manifest) {
      if (entry.inode > 0) entryByInode.set(entry.inode, entry)
      hashCounts.set(entry.contentHash, (hashCounts.get(entry.contentHash) ?? 0) + 1)
      entryByHash.set(entry.contentHash, entry)
    }

    const files: {
      id: string
      path: string
      relativePath: string
      name: string
      modifiedAt: number
      size: number
      inode: number
      device: number
      contentHash: string
    }[] = []
    const unboundPaths: string[] = []
    const unboundFiles: {
      relativePath: string
      inode: number
      device: number
      contentHash: string
      size: number
      modifiedAt: number
    }[] = []
    const nextManifest = new Map<string, ModelEntry>()

    const observedPaths = [...root.files.keys()].sort((left, right) => left.localeCompare(right))
    for (const relativePath of observedPaths) {
      const file = root.files.get(relativePath)!
      const contentHash = await computeMarkdownContentHash(file.content)
      const existing =
        root.manifest.get(relativePath) ??
        entryByInode.get(file.inode) ??
        (hashCounts.get(contentHash) === 1 ? entryByHash.get(contentHash) : undefined)
      const id = existing?.id ?? documentIds?.[relativePath]
      if (!id) {
        unboundPaths.push(relativePath)
        unboundFiles.push({
          relativePath,
          inode: file.inode,
          device: FIXTURE_DEVICE,
          contentHash,
          size: Buffer.byteLength(file.content),
          modifiedAt: file.modifiedAt,
        })
        continue
      }
      const entry: ModelEntry = {
        id,
        inode: file.inode,
        contentHash,
        lastSeen: file.modifiedAt,
        size: Buffer.byteLength(file.content),
      }
      nextManifest.set(relativePath, entry)
      files.push({
        id,
        path: `${rootPath}/${relativePath}`,
        relativePath,
        name: relativePath.split("/").pop()!,
        modifiedAt: file.modifiedAt,
        size: entry.size,
        inode: file.inode,
        device: FIXTURE_DEVICE,
        contentHash,
      })
    }

    // Rust rebuilds the manifest from the bound files only: an unobserved (or
    // still unbound) path drops out of the durable ledger on this write.
    root.manifest = nextManifest
    files.sort((left, right) => right.modifiedAt - left.modifiedAt)

    return {
      rootPath,
      bindingRootId: root.bindingRootId,
      name: rootPath.split("/").pop() ?? "root",
      fileCount: files.length,
      folderCount: countFolders([...nextManifest.keys()]),
      updatedAt: files[0]?.modifiedAt ?? null,
      selectedPaths: [],
      files,
      unboundPaths,
      unboundFiles,
    }
  }

  private listBindingRootDocuments(args: Record<string, unknown>): DesktopCatalogRow[] {
    const bindingRootId = String(args.bindingRootId)
    return [...this.bindings.values()]
      .filter((binding) => binding.bindingRootId === bindingRootId)
      .sort((left, right) => left.relativePath.localeCompare(right.relativePath))
      .map((binding) => this.rowFor(binding.documentId))
      .filter((row): row is DesktopCatalogRow => row !== null)
  }

  private getById(args: Record<string, unknown>): DesktopCatalogRow | null {
    return this.rowFor(String(args.id))
  }

  private resolvePath(args: Record<string, unknown>): DesktopCatalogRow | null {
    const canonicalPath = String(args.path)
    for (const binding of this.bindings.values()) {
      if (binding.canonicalPath === canonicalPath) return this.rowFor(binding.documentId)
    }
    return null
  }

  private applyReconcile(args: Record<string, unknown>): { applied: boolean; changed: string[] } {
    const input = args.input as { upserts: ReconcileUpsert[]; detached: string[] }
    const changed: string[] = []

    for (const upsert of input.upserts) {
      const previous = this.bindings.get(upsert.documentId)
      const unchanged =
        previous !== undefined &&
        previous.relativePath === upsert.relativePath &&
        previous.canonicalPath === upsert.canonicalPath &&
        previous.inode === upsert.inode &&
        previous.contentHash === upsert.contentHash
      if (!unchanged) changed.push(upsert.documentId)

      const existingDocument = this.documents.get(upsert.documentId)
      if (existingDocument) {
        existingDocument.localPresent = true
        existingDocument.modifiedAt = upsert.modifiedAt ?? existingDocument.modifiedAt
      } else {
        this.documents.set(upsert.documentId, {
          id: upsert.documentId,
          localPresent: true,
          title: upsert.title,
          createdAt: upsert.createdAt ?? 0,
          modifiedAt: upsert.modifiedAt ?? 0,
        })
      }
      this.bindings.set(upsert.documentId, {
        documentId: upsert.documentId,
        bindingRootId: upsert.bindingRootId,
        rootPath: upsert.rootPath,
        relativePath: upsert.relativePath,
        canonicalPath: upsert.canonicalPath,
        inode: upsert.inode ?? 0,
        contentHash: upsert.contentHash ?? "",
        size: upsert.size ?? 0,
        lastSeenAt: upsert.lastSeenAt ?? 0,
      })
    }

    for (const id of input.detached) {
      const document = this.documents.get(id)
      if (document?.localPresent) changed.push(id)
      this.bindings.delete(id)
      if (document) document.localPresent = false
    }

    return { applied: true, changed }
  }

  // ── fs sintético de la cadena de guardado (SYNC-05) ───────────────────────

  private rootForPath(path: string): { root: ModelRoot; relativePath: string } {
    for (const root of this.roots.values()) {
      if (path === root.rootPath) return { root, relativePath: "" }
      if (path.startsWith(`${root.rootPath}/`)) {
        return { root, relativePath: path.slice(root.rootPath.length + 1) }
      }
    }
    throw new Error(`catalog-seam recorder: no fixture root owns path ${path}`)
  }

  /**
   * Espejo de `write_file` (regla 7 del contrato): el archivo real lo escribe
   * el replay; la grabación solo actualiza su modelo y, si el caller mandó
   * `expectedContentHash`, responde CONFLICT cuando no coincide (el mismo
   * contrato que Rust).
   */
  private async writeFile(args: Record<string, unknown>): Promise<null> {
    const path = stringArg(args, "path")
    const { root, relativePath } = this.rootForPath(path)
    const file = root.files.get(relativePath)
    if (!file) throw new Error(`catalog-seam recorder: write_file for unmodeled path ${path}`)
    const expected = nullableStringArg(args, "expectedContentHash")
    if (expected !== null) {
      const actual = await computeMarkdownContentHash(file.content)
      if (actual !== expected) {
        throw new Error(`CONFLICT: ${path} changed on disk (expected ${expected}, found ${actual})`)
      }
    }
    root.files.set(relativePath, { ...file, content: stringArg(args, "content") })
    return null
  }

  private openFile(args: Record<string, unknown>): string {
    const path = stringArg(args, "path")
    const { root, relativePath } = this.rootForPath(path)
    const file = root.files.get(relativePath)
    if (!file) throw new Error(`catalog-seam recorder: open_file for unmodeled path ${path}`)
    return file.content
  }

  /**
   * Espejo de `workspace_touch_file`: solo responde `updated` si el path sigue
   * en el manifiesto sintético con el mismo id (el comando real lo exige).
   */
  private async touchFile(args: Record<string, unknown>): Promise<DesktopWorkspaceTouchResult> {
    const rootPath = stringArg(args, "rootPath")
    const relativePath = stringArg(args, "relativePath")
    const documentId = stringArg(args, "documentId")
    const { root } = this.rootForPath(`${rootPath}/${relativePath}`)
    const entry = root.manifest.get(relativePath)
    const file = root.files.get(relativePath)
    if (!entry || entry.id !== documentId || !file) {
      return { status: "needsReconcile", reason: "path is not bound in the manifest" }
    }
    return {
      status: "updated",
      rootPath,
      bindingRootId: root.bindingRootId,
      file: {
        id: documentId,
        path: `${rootPath}/${relativePath}`,
        relativePath,
        name: relativePath.split("/").pop() ?? relativePath,
        modifiedAt: file.modifiedAt,
        size: Buffer.byteLength(file.content),
        inode: file.inode,
        device: FIXTURE_DEVICE,
        contentHash: await computeMarkdownContentHash(file.content),
      },
    }
  }

  // ── Estado de la cola (delegado en real-desktop-doubles) ──────────────────

  /** Id que el reconciliador acuñó para un path ya registrado (manifiesto sintético). */
  registeredDocumentId(rootKey: FixtureRootKey, relativePath: string): string {
    const entry = this.requireRoot(rootKey).manifest.get(relativePath)
    if (!entry) {
      throw new Error(`catalog-seam recorder: ${relativePath} is not registered in ${rootKey}`)
    }
    return entry.id
  }

  /** Filas de la cola del documento, ordenadas como el listado real. */
  queueMutations(documentId: string) {
    return catalogMutationsDouble(FIXTURE_DB_PATH)
      .filter((mutation) => mutation.documentId === documentId)
      .sort((left, right) => left.createdAt - right.createdAt || left.id.localeCompare(right.id))
  }

  /**
   * Req 5: afirma en TS que el doble cree el estado correcto y lo graba como
   * paso de control para que el replay lo contraste en SQLite real.
   *
   * `document.metadata` y `mutations[].payload` solo se proyectan y contrastan
   * cuando el escenario los declara (así los controles SYNC-05 conservan su
   * forma exacta).
   */
  async control(
    documentId: string,
    name: string,
    expected: {
      document: CatalogSeamControlStep["document"]
      mutations: CatalogSeamControlStep["mutations"]
    },
  ): Promise<void> {
    const row = await tauriCatalogGetByIdDouble(FIXTURE_DB_PATH, documentId)
    if (!row) throw new Error(`catalog-seam recorder: control ${name} has no catalog row for ${documentId}`)
    const wantsMetadata = expected.document.metadata !== undefined
    const wantsPayload = expected.mutations.some((mutation) => mutation.payload !== undefined)
    const actual = {
      document: {
        syncStatus: row.syncStatus,
        cloudPresent: row.cloudPresent,
        ...(wantsMetadata
          ? {
              metadata: {
                status: row.status,
                artifactType: row.artifactType,
                version: row.version,
                title: row.title,
                slug: row.slug,
                visibility: row.visibility,
                cloudAccountId: row.cloudAccountId,
                contentHash: row.contentHash,
              },
            }
          : {}),
      },
      mutations: this.queueMutations(documentId).map((mutation) => ({
        id: mutation.id,
        status: mutation.status,
        attemptCount: mutation.attemptCount,
        nextRetryAt: mutation.nextRetryAt,
        lastError: mutation.lastError,
        ...(wantsPayload ? { payload: projectMutationPayload(mutation.payloadJson) } : {}),
      })),
    }
    if (JSON.stringify(actual) !== JSON.stringify(expected)) {
      throw new Error(
        `catalog-seam recorder: control ${name} diverged from the expected canonical state — ` +
          `actual ${JSON.stringify(actual)} expected ${JSON.stringify(expected)}`,
      )
    }
    // La copia grabada lleva el alias del id generado por el runtime nativo
    // (el doble conserva el UUID del stub para el flujo TS).
    this.steps.push({
      kind: "control",
      name,
      documentId,
      ...(this.withGeneratedIdAliases(expected) as {
        document: CatalogSeamControlStep["document"]
        mutations: CatalogSeamControlStep["mutations"]
      }),
    })
  }

  /**
   * Lee el contenido del archivo sintético (la autoridad del cuerpo en la
   * grabación): permite afirmar el hash que el binding debe conservar.
   */
  fileContent(rootKey: FixtureRootKey, relativePath: string): string {
    const file = this.requireRoot(rootKey).files.get(relativePath)
    if (!file) {
      throw new Error(
        `catalog-seam recorder: ${relativePath} is not present in ${rootKey}`,
      )
    }
    return file.content
  }

  /** Reloj sintético de la escena (stub de `Date.now`, Req 8). */
  now(): number {
    return fixtureClock
  }

  advanceClock(ms: number): void {
    fixtureClock += ms
  }

  private rowFor(id: string): DesktopCatalogRow | null {
    const document = this.documents.get(id)
    if (!document) return null
    const binding = this.bindings.get(id)
    return {
      id: document.id,
      localPresent: document.localPresent,
      cloudPresent: false,
      cloudAccountId: null,
      syncStatus: "local-only",
      title: document.title,
      slug: null,
      status: null,
      artifactType: null,
      visibility: null,
      version: null,
      deletedAt: null,
      createdAt: document.createdAt,
      modifiedAt: document.modifiedAt,
      bindingRootId: binding?.bindingRootId ?? null,
      relativePath: binding?.relativePath ?? null,
      canonicalPath: binding?.canonicalPath ?? null,
      inode: binding?.inode ?? null,
      contentHash: binding?.contentHash ?? null,
      size: binding?.size ?? null,
      lastSeenAt: binding?.lastSeenAt ?? null,
      excerpt: null,
      excerptContentHash: null,
    }
  }
}

function countFolders(relativePaths: string[]): number {
  const folders = new Set<string>()
  for (const path of relativePaths) {
    const segments = path.split("/")
    segments.pop()
    let current = ""
    for (const segment of segments) {
      current = current ? `${current}/${segment}` : segment
      folders.add(current)
    }
  }
  return folders.size
}

// ─── Fixture generation ──────────────────────────────────────────────────────

let activeSession: CatalogSeamSession | null = null
let uuidCounter = 0

/** Reloj del fixture: determinista y por escena (Req 8); afecta createdAt, el `now` del listado y el backoff. */
const FIXTURE_CLOCK_START = 1_700_100_000_000
let fixtureClock = FIXTURE_CLOCK_START

/** Installed as the mocked `invoke` of `@tauri-apps/api/core`. */
export async function catalogSeamInvoke(cmd: string, args: Record<string, unknown>): Promise<unknown> {
  if (!activeSession) {
    throw new Error("catalog-seam recorder: invoke called with no active recording session")
  }
  return activeSession.invoke(cmd, args)
}

async function recordScenario(
  name: string,
  description: string,
  build: (session: CatalogSeamSession) => Promise<void>,
  backend: "session" | "queue" = "session",
  profile: CatalogSeamScenarioProfile = "filesystem",
): Promise<CatalogSeamScenario> {
  const session = new CatalogSeamSession(name, description, backend)
  activeSession = session
  uuidCounter = 0
  fixtureClock = FIXTURE_CLOCK_START
  const originalRandomUuid = globalThis.crypto.randomUUID
  const originalDate = globalThis.Date
  const randomUuidStub = () => {
    uuidCounter += 1
    return `00000000-0000-4000-8000-${uuidCounter.toString(16).padStart(12, "0")}`
  }
  // El reloj de la escena también cubre el constructor sin argumentos: los
  // productores reales (p. ej. `createDraft`) sellan `new Date().toISOString()`
  // y una grabación no puede depender del reloj de pared.
  const fixtureDate = new Proxy(originalDate, {
    construct(target, args) {
      return Reflect.construct(target, args.length === 0 ? [fixtureClock] : args)
    },
  })
  fixtureDate.now = () => fixtureClock
  try {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: randomUuidStub,
      configurable: true,
      writable: true,
    })
    globalThis.Date = fixtureDate
    await build(session)
    return session.toScenario(profile)
  } finally {
    Object.defineProperty(globalThis.crypto, "randomUUID", {
      value: originalRandomUuid,
      configurable: true,
      writable: true,
    })
    globalThis.Date = originalDate
    activeSession = null
  }
}

const LETTER_V1 = "# Letter\n\nversion one\n"
const LETTER_V2 = "# Letter\n\nversion two — renamed on disk\n"
const NEIGHBOUR = "# Neighbour\n\ncreated outside the app\n"
const WATCH07_EXTERNAL_V1 = "# External edit\n\noriginal content\n"
const WATCH07_EXTERNAL_V2 = "# External edit\n\nchanged outside the app\n"
const WATCH04_KEEPER = "# Keeper\n\nresident in root A\n"

async function buildSys01RegisterMoveReopen(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/letter.md", LETTER_V1, { inode: 101, modifiedAt: 1_700_000_001_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentId = session.documentIdForPath("rootA", "notes/letter.md")
  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/letter.md`)

  // Renamed outside the app: identity must survive the path change through the
  // reconcile path (inode correlation in workspace_sync + known bindings).
  session.fsRename("rootA", "notes/letter.md", "archive/letter-final.md")
  await reconciler.rescanAll()
  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/archive/letter-final.md`)

  // Restart the catalog: every command reopens the DB (open_db per command) and
  // a fresh reconciler instance rescans the root.
  reconciler.dispose()
  const restarted = session.createReconciler(catalog)
  await restarted.start()
  restarted.dispose()

  await catalog.getById(documentId)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/archive/letter-final.md`)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/letter.md`)
}

async function buildSys01Homonyms(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.defineRoot("rootB", "fixture-root-b")
  session.fsWrite("rootA", "letter.md", LETTER_V1, { inode: 201, modifiedAt: 1_700_000_002_000 })
  session.fsWrite("rootB", "letter.md", LETTER_V2, { inode: 301, modifiedAt: 1_700_000_003_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentA = session.documentIdForPath("rootA", "letter.md")
  const documentB = session.documentIdForPath("rootB", "letter.md")
  await catalog.getById(documentA)
  await catalog.getById(documentB)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/letter.md`)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootB}/letter.md`)

  // A second pass over both roots must keep the two homonyms apart.
  await reconciler.rescanAll()
  reconciler.dispose()
}

async function buildSys05ReconcileTracksDisk(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/a.md", LETTER_V1, { inode: 401, modifiedAt: 1_700_000_004_000 })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()

  // Created outside the app.
  session.fsWrite("rootA", "notes/b.md", NEIGHBOUR, { inode: 402, modifiedAt: 1_700_000_005_000 })
  await reconciler.rescanAll()

  // Moved outside the app.
  session.fsRename("rootA", "notes/a.md", "notes/a-moved.md")
  await reconciler.rescanAll()

  // Deleted outside the app.
  session.fsDelete("rootA", "notes/b.md")
  await reconciler.rescanAll()
  reconciler.dispose()

  const documentA = session.documentIdForPath("rootA", "notes/a-moved.md")
  await catalog.getById(documentA)
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootA}/notes/a-moved.md`)
}

async function buildWatch07ExternalEditSamePath(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/watched.md", WATCH07_EXTERNAL_V1, {
    inode: 501,
    modifiedAt: 1_700_000_006_000,
  })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()

  const documentId = session.documentIdForPath("rootA", "notes/watched.md")
  const beforeEdit = await catalog.getById(documentId)
  if (beforeEdit?.binding?.contentHash !== await computeMarkdownContentHash(WATCH07_EXTERNAL_V1)) {
    throw new Error("catalog-seam recorder: initial WATCH-07 hash does not match the file")
  }

  // An external editor changes bytes in place: the path and inode stay stable.
  session.fsWrite("rootA", "notes/watched.md", WATCH07_EXTERNAL_V2, {
    inode: 501,
    modifiedAt: 1_700_000_007_000,
  })
  await reconciler.rescanAll()

  const afterEdit = await catalog.getById(documentId)
  if (afterEdit?.binding?.contentHash !== await computeMarkdownContentHash(WATCH07_EXTERNAL_V2)) {
    throw new Error("catalog-seam recorder: reconciled WATCH-07 hash does not match the external edit")
  }
  reconciler.dispose()
}

async function buildWatch04ExternalMoveAcrossRoots(session: CatalogSeamSession): Promise<void> {
  session.defineRoot("rootA", "fixture-root-a")
  session.defineRoot("rootB", "fixture-root-b")
  session.fsWrite("rootA", "notes/letter.md", LETTER_V1, {
    inode: 601,
    modifiedAt: 1_700_000_008_000,
  })
  // A resident sibling keeps root A's volume knowable after the move: the
  // correlation only trusts an inode match when both roots report the same
  // device, and a root with no file evidence is "volume unknown" (ODE-657
  // review P1). It also proves the move does not disturb the files it leaves.
  session.fsWrite("rootA", "notes/keeper.md", WATCH04_KEEPER, {
    inode: 602,
    modifiedAt: 1_700_000_007_500,
  })

  const catalog = session.createCatalog()
  const reconciler = session.createReconciler(catalog)
  await reconciler.start()
  const documentId = session.documentIdForPath("rootA", "notes/letter.md")
  const keeperId = session.documentIdForPath("rootA", "notes/keeper.md")

  // Moved outside the app from root A to root B: the origin disappears in the
  // same pass the destination appears unbound. Identity must survive through
  // device + inode + content_hash correlation across roots, not a fresh UUID.
  session.fsDelete("rootA", "notes/letter.md")
  session.fsWrite("rootB", "notes/letter.md", LETTER_V1, {
    inode: 601,
    modifiedAt: 1_700_000_009_000,
  })
  await reconciler.rescanAll()
  reconciler.dispose()

  const movedId = session.documentIdForPath("rootB", "notes/letter.md")
  if (movedId !== documentId) {
    throw new Error(
      `catalog-seam recorder: cross-root move minted ${movedId} instead of ${documentId}`,
    )
  }
  if (session.hasBindingAtPath("rootA", "notes/letter.md")) {
    throw new Error("catalog-seam recorder: the moved document kept a stale binding in root A")
  }
  if (session.documentIdForPath("rootA", "notes/keeper.md") !== keeperId) {
    throw new Error("catalog-seam recorder: the resident sibling lost its identity in the move")
  }
  const row = await catalog.getById(documentId)
  if (row?.binding?.bindingRootId !== "fixture-root-b" || row.localPresent !== true) {
    throw new Error("catalog-seam recorder: the moved document is not bound to root B")
  }
  await catalog.resolvePath(`${FIXTURE_ROOT_PATHS.rootB}/notes/letter.md`)
}

// ─── SYNC-05: guardado durante un flush en vuelo (ODE-644 PR2) ───────────────

const SYNC05_V1 = "# Letter\n\nversion one\n"

const sync05Doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})
const sync05Timestamp = (version: number) =>
  `2026-09-30T12:00:${String(version).padStart(2, "0")}.000Z`

/**
 * Estado limpio por escena: la cola de `real-desktop-doubles` y el fake de
 * Supabase son procesos en memoria compartidos por escena, y el servicio de
 * sync guarda flags de flush. Sin esto, una escena vería las mutaciones de la
 * anterior.
 */
async function resetQueueHarness(): Promise<void> {
  resetCatalogDoubles()
  fakeSupabase.reset()
  await desktopCatalogSyncService.stop()
}

/**
 * Registro del documento por el reconciliador real (premisa de
 * `assert_scenario`): el archivo nace en el fs sintético y la identidad sale
 * del descubrimiento, no de un input armado a mano.
 */
async function registerSync05Document(session: CatalogSeamSession): Promise<string> {
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "notes/letter.md", SYNC05_V1, {
    inode: 701,
    modifiedAt: 1_700_090_000_000,
  })
  const reconciler = session.createReconciler(session.createCatalog())
  await reconciler.start()
  reconciler.dispose()
  return session.registeredDocumentId("rootA", "notes/letter.md")
}

/** Guardado real del editor: relee el documento abierto y manda el cuerpo nuevo (misma entrada que ODE-611). */
async function saveFromEditor(
  documentId: string,
  text: string,
  version: number,
  status?: string,
): Promise<void> {
  const service = await getDocumentService()
  const opened = await service.openWriting(documentId)
  if (opened.error || !opened.data) {
    throw new Error(`catalog-seam recorder: openWriting(${documentId}) failed: ${opened.error?.message}`)
  }
  const current = opened.data
  const saved = await service.saveWriting({
    writing: {
      ...current,
      content: { ...current.content, richText: sync05Doc(text), plainText: text },
      status: (status ?? current.status) as typeof current.status,
      version,
      updatedAt: sync05Timestamp(version),
    },
  })
  if (saved.error) {
    throw new Error(`catalog-seam recorder: saveWriting(${documentId}) failed: ${saved.error.message}`)
  }
}

function mutationByVersion(session: CatalogSeamSession, documentId: string, version: number) {
  const mutation = session
    .queueMutations(documentId)
    .find((candidate) => JSON.parse(candidate.payloadJson).version === version)
  if (!mutation) {
    throw new Error(`catalog-seam recorder: no mutation for version ${version} of ${documentId}`)
  }
  return mutation
}

/**
 * Éxito en vuelo (Req 2): la v3 sale con el write retenido, la v4 la supersede,
 * la respuesta de la v3 llega después y el segundo flush sube la v4.
 */
async function buildSync05SuccessDuringFlush(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  const documentId = await registerSync05Document(session)

  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 3.", 3)

  session.advanceClock(1_000)
  const hold = fakeSupabase.holdNextWrite()
  const flushing = desktopCatalogSyncService.flushPending()
  await hold.started

  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 4.", 4)

  hold.release()
  await flushing

  const v3 = mutationByVersion(session, documentId, 3)
  const v4 = mutationByVersion(session, documentId, 4)
  await session.control(documentId, "success-after-v3-response", {
    document: { syncStatus: "pending", cloudPresent: true },
    mutations: [
      { id: v3.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: "superseded by later snapshot mutation" },
      { id: v4.id, status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null },
    ],
  })

  session.advanceClock(1_000)
  const second = await desktopCatalogSyncService.flushPending()
  if (second.error) {
    throw new Error(`catalog-seam recorder: second flush failed: ${second.error.message}`)
  }
  await session.control(documentId, "success-after-second-flush", {
    document: { syncStatus: "synced", cloudPresent: true },
    mutations: [
      { id: v3.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: "superseded by later snapshot mutation" },
      { id: v4.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: null },
    ],
  })
}

/**
 * Fallo en vuelo (Req 3): el write de la v3 falla después de que la v4 lo
 * superó; la v3 no revive y, con el reloj por delante del backoff de 2 s, el
 * segundo flush lista solo la v4.
 */
async function buildSync05FailureDuringFlush(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  const documentId = await registerSync05Document(session)

  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 3.", 3, "draft")

  fakeSupabase.failNextWrite({ message: "network down", code: "503" })
  session.advanceClock(1_000)
  const hold = fakeSupabase.holdNextWrite()
  const flushing = desktopCatalogSyncService.flushPending()
  await hold.started

  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 4.", 4, "review")

  hold.release()
  await flushing

  const v3 = mutationByVersion(session, documentId, 3)
  const v4 = mutationByVersion(session, documentId, 4)
  await session.control(documentId, "failure-after-v3-response", {
    document: { syncStatus: "pending", cloudPresent: false },
    mutations: [
      { id: v3.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: "superseded by later snapshot mutation" },
      { id: v4.id, status: "pending", attemptCount: 0, nextRetryAt: null, lastError: null },
    ],
  })

  // El backoff de attempts=1 es 2 s: pasado ese umbral, la v3 superada sigue
  // sin listarse y el segundo flush manda solo la v4.
  session.advanceClock(2_000)
  const second = await desktopCatalogSyncService.flushPending()
  if (second.error) {
    throw new Error(`catalog-seam recorder: second flush failed: ${second.error.message}`)
  }
  await session.control(documentId, "failure-after-second-flush", {
    document: { syncStatus: "synced", cloudPresent: true },
    mutations: [
      { id: v3.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: "superseded by later snapshot mutation" },
      { id: v4.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: null },
    ],
  })
}

// ─── SYNC-05: retiro de workspace durante un flush (ODE-663) ─────────────────

/**
 * SYNC-05 (retiro durante un flush, ODE-663): un guardado viaja retenido
 * mientras el usuario retira el workspace. El retiro archiva el documento
 * cloud-owned y encola su `delete` — la segunda mutación accionable del mismo
 * UUID, que solo `catalog_apply_workspace_removal` produce en producción—.
 * Cuando la respuesta del guardado en vuelo llega, `catalog_update_mutation_status`
 * NO debe proyectar el documento: `NOT EXISTS` deja mandar a la mutación de
 * retiro pendiente. El segundo flush resuelve el delete (ahí sí proyecta) y el
 * cierre vuelve a registrar la carpeta, porque retirar un root no borra su
 * directorio ni su `.md`.
 */
async function buildSync05WorkspaceRemovalNotExists(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  session.defineRoot("rootA", "fixture-root-a")
  const fileTime = 1_700_150_000_000
  session.fsWrite("rootA", "notes/letter.md", SYNC05_V1, { inode: 901, modifiedAt: fileTime })
  const reconciler = session.createReconciler(session.createCatalog())
  await reconciler.start()
  reconciler.dispose()
  const documentId = session.registeredDocumentId("rootA", "notes/letter.md")
  const rootPath = FIXTURE_ROOT_PATHS.rootA
  const rootId = "fixture-root-a"

  // "Otro dispositivo": la fila cloud ya existe y la hidratación real la trae
  // conservando el binding local → el documento es cloud-owned, así que el
  // retiro toma la rama que encola el delete (index.rs:950-976).
  await fakeSupabaseClient.from("writings").insert(
    fakeCloudWriting({
      id: documentId,
      status: "draft",
      version: 1,
      updatedAt: new Date(fileTime).toISOString(),
      title: "Letter",
      slug: "carta-ode-663",
    }),
    { count: "exact" },
  )
  await hydrateFromFakeCloud()

  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 2.", 2)
  const body = mutationByVersion(session, documentId, 2)

  // El guardado v2 viaja retenido; con el flush en vuelo se retira la raíz.
  session.advanceClock(1_000)
  const hold = fakeSupabase.holdNextWrite()
  const flushing = desktopCatalogSyncService.flushPending()
  await hold.started

  session.advanceClock(1_000)
  const nowIso = new Date().toISOString()
  const catalog = session.createCatalog()
  const removalChange = await catalog.applyWorkspaceRemoval(rootId, rootPath, nowIso, nowIso)
  if (removalChange.documentIds.length !== 1 || removalChange.documentIds[0] !== documentId) {
    throw new Error(
      `catalog-seam recorder: workspace removal affected ${JSON.stringify(removalChange.documentIds)} instead of the bound document`,
    )
  }
  const removalDelete = session
    .queueMutations(documentId)
    .find((mutation) => mutation.operation === "delete")
  if (!removalDelete) {
    throw new Error("catalog-seam recorder: workspace removal enqueued no delete mutation")
  }
  // El UUID del delete se acuña en el runtime nativo (index.rs:957): alias
  // estable por documento; el resto de la fila se compara literal.
  session.aliasGeneratedId(removalDelete.id, `$MUTATION_REMOVAL_${documentId}`)

  hold.release()
  await flushing

  // La respuesta del guardado en vuelo llega con el delete aún accionable: la
  // proyección del documento no corre y el documento sigue `pending`.
  await session.control(documentId, "sync05-removal-not-exists-guard", {
    document: { syncStatus: "pending", cloudPresent: true },
    mutations: [
      {
        id: body.id,
        status: "synced",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: null,
          version: 2,
          updatedAt: sync05Timestamp(2),
          status: "draft",
          artifactType: "general",
        },
      },
      {
        id: removalDelete.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: null,
          version: 2,
          updatedAt: nowIso,
          status: null,
          artifactType: null,
        },
      },
    ],
  })

  // Segundo flush explícito: resuelve el delete y recién ahí la proyección
  // aplica el estado de retiro (control positivo: sin otra accionable sí corre).
  session.advanceClock(2_000)
  const removalFlush = await desktopCatalogSyncService.flushPending()
  if (removalFlush.error) {
    throw new Error(`catalog-seam recorder: removal flush failed: ${removalFlush.error.message}`)
  }
  const bodyPayload = {
    mutationKind: null,
    version: 2,
    updatedAt: sync05Timestamp(2),
    status: "draft",
    artifactType: "general",
  } as const
  const deletePayload = {
    mutationKind: null,
    version: 2,
    updatedAt: nowIso,
    status: null,
    artifactType: null,
  } as const
  await session.control(documentId, "sync05-removal-delete-resolved", {
    document: { syncStatus: "deleted", cloudPresent: false },
    mutations: [
      { id: body.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: null, payload: bodyPayload },
      { id: removalDelete.id, status: "synced", attemptCount: 0, nextRetryAt: null, lastError: null, payload: deletePayload },
    ],
  })

  // Cierre canónico: el retiro no borró el `.md`; el consentimiento explícito
  // levanta la valla y el reconciliador real vuelve a atar el mismo UUID.
  await catalog.activateBindingRoot(rootId, rootPath)
  const restarted = session.createReconciler(session.createCatalog())
  await restarted.start()
  restarted.dispose()
  const rebound = await catalog.getById(documentId)
  if (
    !rebound?.localPresent ||
    rebound.binding?.canonicalPath !== `${rootPath}/notes/letter.md`
  ) {
    throw new Error(
      "catalog-seam recorder: re-registering the root did not re-bind the surviving .md",
    )
  }
}

// ─── SYNC-08: metadata encolada por los productores reales (ODE-670) ─────────

const SYNC08_CLOUD_ONLY_V1 = "# Cloud only\n\nremote body stays in the cloud\n"
const SYNC08_CLOUD_OWNED_V1 = "# Cloud owned\n\nlocal body survives metadata\n"
const SYNC08_LOCAL_ONLY_V1 = "# Local only\n\nstays local after the vocabulary rewrite\n"

/** Fila de `writings` en el fake de Supabase con la forma que lee `hydrateWritings`. */
function fakeCloudWriting(options: {
  id: string
  status: string
  version: number
  updatedAt: string
  title: string
  slug?: string | null
  artifactType?: string
  visibility?: string
}): Record<string, unknown> {
  return {
    id: options.id,
    author_id: "user-1",
    title: options.title,
    slug: options.slug ?? null,
    status: options.status,
    artifact_type: options.artifactType ?? "general",
    visibility: options.visibility ?? "private",
    version: options.version,
    created_at: options.updatedAt,
    updated_at: options.updatedAt,
    content_hash: "cloud-hash",
    deleted_at: null,
  }
}

/** Hidrata por el productor real (`hydrateWritings`) y falla si el fake no responde. */
async function hydrateFromFakeCloud(): Promise<void> {
  const hydrated = await desktopCatalogSyncService.hydrateWritings()
  if (hydrated.error || !hydrated.data) {
    throw new Error(`catalog-seam recorder: hydrateWritings failed: ${hydrated.error?.message}`)
  }
}

/**
 * SYNC-08, documento ligado: un guardado pendiente (mutación de cuerpo) seguido
 * de metadata antes del flush. El supersede deja una sola mutación accionable
 * y el binding conserva el hash del `.md`.
 */
async function buildSync08BoundMetadataBeforeFlush(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  session.defineRoot("rootA", "fixture-root-a")
  const fileTime = 1_700_120_000_000
  session.fsWrite("rootA", "notes/letter.md", SYNC05_V1, { inode: 801, modifiedAt: fileTime })
  const reconciler = session.createReconciler(session.createCatalog())
  await reconciler.start()
  reconciler.dispose()
  const documentId = session.registeredDocumentId("rootA", "notes/letter.md")

  // "Otro dispositivo": la fila ya existe en la nube; la hidratación real la
  // trae y conserva el binding local. La firma temporal de la fila cloud
  // coincide con el mtime del archivo para no depender de un timestamp que el
  // doble de hidratación no proyecta.
  await fakeSupabaseClient.from("writings").insert(
    fakeCloudWriting({
      id: documentId,
      status: "draft",
      version: 1,
      updatedAt: new Date(fileTime).toISOString(),
      title: "Letter",
      slug: "carta-ode-670",
      visibility: "public",
    }),
    { count: "exact" },
  )
  await hydrateFromFakeCloud()

  // Guardado real del editor: mutación de cuerpo pendiente.
  session.advanceClock(1_000)
  await saveFromEditor(documentId, "Versión 2.", 2)
  const bodyHash = await computeMarkdownContentHash(
    session.fileContent("rootA", "notes/letter.md"),
  )
  const body = mutationByVersion(session, documentId, 2)
  await session.control(documentId, "sync08-bound-body-save-pending", {
    document: {
      syncStatus: "pending",
      cloudPresent: true,
      metadata: {
        status: "draft",
        artifactType: "general",
        version: 2,
        title: "letter",
        slug: "carta-ode-670",
        visibility: "public",
        cloudAccountId: "user-1",
        contentHash: bodyHash,
      },
    },
    mutations: [
      {
        id: body.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: null,
          version: 2,
          updatedAt: sync05Timestamp(2),
          status: "draft",
          artifactType: "general",
        },
      },
    ],
  })

  // Metadata real del documento ligado: el supersede reemplaza al guardado y
  // el binding (cuerpo/hash) queda intacto.
  session.advanceClock(1_000)
  const service = await getDocumentService()
  const metadata = await service.updateWritingMetadata({
    writingId: documentId,
    status: "review",
    version: 3,
    updatedAt: sync05Timestamp(3),
  })
  if (metadata.error) {
    throw new Error(`catalog-seam recorder: updateWritingMetadata failed: ${metadata.error.message}`)
  }
  const supersededBody = mutationByVersion(session, documentId, 2)
  const metadataMutation = mutationByVersion(session, documentId, 3)
  await session.control(documentId, "sync08-metadata-supersedes-body", {
    document: {
      syncStatus: "pending",
      cloudPresent: true,
      metadata: {
        status: "review",
        artifactType: "general",
        version: 3,
        title: "letter",
        slug: "carta-ode-670",
        visibility: "public",
        cloudAccountId: "user-1",
        contentHash: bodyHash,
      },
    },
    mutations: [
      {
        id: supersededBody.id,
        status: "synced",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: "superseded by later snapshot mutation",
        payload: {
          mutationKind: null,
          version: 2,
          updatedAt: sync05Timestamp(2),
          status: "draft",
          artifactType: "general",
        },
      },
      {
        id: metadataMutation.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: "metadata",
          version: 3,
          updatedAt: sync05Timestamp(3),
          status: "review",
          artifactType: "general",
        },
      },
    ],
  })
}

/**
 * SYNC-08, borrador de primera subida: el create pendiente (id conocido, como
 * la materialización de un borrador cloud) queda superseded por la metadata
 * antes de su primer flush.
 */
async function buildSync08FirstUploadMetadataBeforeFlush(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  session.defineRoot("rootA", "fixture-root-a")
  session.fsWrite("rootA", "letter.md", SYNC05_V1, { inode: 802, modifiedAt: 1_700_130_000_000 })
  session.advanceClock(1_000)
  const draftId = "0de67000-0000-4000-8000-000000067000"
  const created = await createDesktopDraft({
    writingId: draftId,
    title: "Carta ODE-670",
    authorId: "user-1",
    preferredPath: `${FIXTURE_ROOT_PATHS.rootA}/letter.md`,
    initialBodyJson: sync05Doc("Versión 1."),
    initialBodyText: "Versión 1.",
  })
  if (created.error || !created.data) {
    throw new Error(`catalog-seam recorder: createDesktopDraft failed: ${created.error?.message}`)
  }
  const createdUpdatedAt = new Date(session.now()).toISOString()
  const bodyHash = await computeMarkdownContentHash(session.fileContent("rootA", "letter.md"))
  const createMutation = mutationByVersion(session, draftId, 1)
  await session.control(draftId, "sync08-first-upload-create-pending", {
    document: {
      syncStatus: "pending",
      cloudPresent: false,
      metadata: {
        status: "draft",
        artifactType: "general",
        version: 1,
        title: "letter",
        slug: null,
        visibility: "private",
        cloudAccountId: "user-1",
        contentHash: bodyHash,
      },
    },
    mutations: [
      {
        id: createMutation.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: null,
          version: 1,
          updatedAt: createdUpdatedAt,
          status: "draft",
          artifactType: "general",
        },
      },
    ],
  })

  session.advanceClock(1_000)
  const service = await getDocumentService()
  const metadata = await service.updateWritingMetadata({
    writingId: draftId,
    status: "review",
    version: 2,
    updatedAt: sync05Timestamp(2),
  })
  if (metadata.error) {
    throw new Error(`catalog-seam recorder: updateWritingMetadata failed: ${metadata.error.message}`)
  }
  const supersededCreate = mutationByVersion(session, draftId, 1)
  const metadataMutation = mutationByVersion(session, draftId, 2)
  await session.control(draftId, "sync08-first-upload-metadata-supersedes-create", {
    document: {
      syncStatus: "pending",
      cloudPresent: false,
      metadata: {
        status: "review",
        artifactType: "general",
        version: 2,
        title: "letter",
        slug: null,
        visibility: "private",
        cloudAccountId: "user-1",
        contentHash: bodyHash,
      },
    },
    mutations: [
      {
        id: supersededCreate.id,
        status: "synced",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: "superseded by later snapshot mutation",
        payload: {
          mutationKind: null,
          version: 1,
          updatedAt: createdUpdatedAt,
          status: "draft",
          artifactType: "general",
        },
      },
      {
        id: metadataMutation.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: "metadata",
          version: 2,
          updatedAt: sync05Timestamp(2),
          status: "review",
          artifactType: "general",
        },
      },
    ],
  })
}

/**
 * SYNC-08, ruta de Settings: borrar un ítem de vocabulario reescribe el
 * catálogo por lotes. El documento cloud-owned ligado recibe su mutación de
 * metadata; el control local-only se reescribe sin mutación; la fila
 * solo-nube (hydration con cuenta, sin binding) queda fuera del `catalog_list`
 * real —el filtro de cuenta del SQL—, así que no se reescribe.
 */
async function buildSync08SettingsBatchMetadata(session: CatalogSeamSession): Promise<void> {
  await resetQueueHarness()
  session.defineRoot("rootA", "fixture-root-a")
  const cloudOnlyTime = 1_700_140_000_000
  const cloudOwnedTime = 1_700_140_001_000
  session.fsWrite("rootA", "notes/cloud-only.md", SYNC08_CLOUD_ONLY_V1, {
    inode: 803,
    modifiedAt: cloudOnlyTime,
  })
  session.fsWrite("rootA", "notes/cloud-owned.md", SYNC08_CLOUD_OWNED_V1, {
    inode: 804,
    modifiedAt: cloudOwnedTime,
  })
  session.fsWrite("rootA", "notes/local-only.md", SYNC08_LOCAL_ONLY_V1, {
    inode: 805,
    modifiedAt: 1_700_140_002_000,
  })
  const reconciler = session.createReconciler(session.createCatalog())
  await reconciler.start()
  const cloudOnlyId = session.registeredDocumentId("rootA", "notes/cloud-only.md")
  const cloudOwnedId = session.registeredDocumentId("rootA", "notes/cloud-owned.md")
  const localOnlyId = session.registeredDocumentId("rootA", "notes/local-only.md")

  // El disparador real es el ítem de vocabulario: su key debe estar en las filas.
  session.advanceClock(1_000)
  const settings = new DesktopSettingsService("$CONFIG")
  const created = await settings.createVocabularyItem({
    kind: "status",
    name: "In review",
    icon: "eye",
    color: "#5B5BD6",
  })
  if (created.error || !created.data) {
    throw new Error(`catalog-seam recorder: createVocabularyItem failed: ${created.error?.message}`)
  }
  const item = created.data

  // Control local-only: el mismo key sin ownership cloud, escrito por el
  // productor real de metadata de un documento local (mutación nula).
  session.advanceClock(1_000)
  const service = await getDocumentService()
  const seeded = await service.updateWritingMetadata({
    writingId: localOnlyId,
    status: item.key,
    version: 2,
    updatedAt: new Date(session.now()).toISOString(),
  })
  if (seeded.error) {
    throw new Error(`catalog-seam recorder: local metadata seed failed: ${seeded.error.message}`)
  }

  // Solo-nube: el archivo local se retira y la fila sigue en la nube. La
  // hidratación la trae con cuenta y sin binding.
  session.fsDelete("rootA", "notes/cloud-only.md")
  await reconciler.rescanAll()
  reconciler.dispose()
  await fakeSupabaseClient.from("writings").insert(
    [
      fakeCloudWriting({
        id: cloudOwnedId,
        status: item.key,
        version: 2,
        updatedAt: new Date(cloudOwnedTime).toISOString(),
        title: "Carta cloud-owned",
        slug: "carta-cloud",
        visibility: "public",
      }),
      fakeCloudWriting({
        id: cloudOnlyId,
        status: item.key,
        version: 4,
        updatedAt: new Date(cloudOnlyTime).toISOString(),
        title: "Carta solo-nube",
      }),
    ],
    { count: "exact" },
  )
  await hydrateFromFakeCloud()

  const cloudOwnedHash = await computeMarkdownContentHash(SYNC08_CLOUD_OWNED_V1)
  const localOnlyHash = await computeMarkdownContentHash(SYNC08_LOCAL_ONLY_V1)
  session.advanceClock(1_000)
  const rewriteNow = new Date(session.now()).toISOString()
  const deleted = await settings.deleteVocabularyItem(item.id)
  if (deleted.error || !deleted.data) {
    throw new Error(`catalog-seam recorder: deleteVocabularyItem failed: ${deleted.error?.message}`)
  }
  if (deleted.data.rewrittenCount !== 2) {
    throw new Error(
      `catalog-seam recorder: Settings rewrite touched ${deleted.data.rewrittenCount} rows; ` +
        "the cloud-only account row must be excluded by the real catalog_list filter",
    )
  }

  const ownedMutation = mutationByVersion(session, cloudOwnedId, 3)
  await session.control(cloudOwnedId, "sync08-settings-cloud-owned-rewritten", {
    document: {
      syncStatus: "pending",
      cloudPresent: true,
      metadata: {
        status: "draft",
        artifactType: "general",
        version: 3,
        title: "Carta cloud-owned",
        slug: "carta-cloud",
        visibility: "public",
        cloudAccountId: "user-1",
        contentHash: cloudOwnedHash,
      },
    },
    mutations: [
      {
        id: ownedMutation.id,
        status: "pending",
        attemptCount: 0,
        nextRetryAt: null,
        lastError: null,
        payload: {
          mutationKind: "metadata",
          version: 3,
          updatedAt: rewriteNow,
          status: "draft",
          artifactType: "general",
        },
      },
    ],
  })

  await session.control(localOnlyId, "sync08-settings-local-only-control", {
    document: {
      syncStatus: "local-only",
      cloudPresent: false,
      metadata: {
        status: "draft",
        artifactType: null,
        version: 3,
        title: "local-only",
        slug: null,
        visibility: null,
        cloudAccountId: null,
        contentHash: localOnlyHash,
      },
    },
    mutations: [],
  })

  await session.control(cloudOnlyId, "sync08-settings-cloud-only-excluded", {
    document: {
      syncStatus: "synced",
      cloudPresent: true,
      metadata: {
        status: item.key,
        artifactType: "general",
        version: 4,
        title: "Carta solo-nube",
        slug: null,
        visibility: "private",
        cloudAccountId: "user-1",
        contentHash: null,
      },
    },
    mutations: [],
  })
}

export async function buildCatalogSeamFixture(): Promise<CatalogSeamFixture> {
  const scenarios = [
    await recordScenario(
      "sys01-homonyms-distinct-roots",
      "SYS-01: two documents with the same name in two BindingRoots never collide — each canonical " +
        "path resolves to its own UUID and each UUID keeps its own binding across a rescan.",
      buildSys01Homonyms,
    ),
    await recordScenario(
      "sys01-register-move-reopen",
      "SYS-01: reconcile registers notes/letter.md, the file is renamed on disk and reconciled " +
        "(same UUID via inode correlation), the catalog is reopened and the UUID still resolves " +
        "to the moved path; the old path resolves to nothing.",
      buildSys01RegisterMoveReopen,
    ),
    await recordScenario(
      "sys05-reconcile-tracks-disk",
      "SYS-05: after an external create, move and delete each followed by a reconcile, the catalog " +
        "matches the durable disk state: the moved file keeps its UUID at the new path, the created " +
        "file got its own row and the deleted file is detached (local_present=false, no binding).",
      buildSys05ReconcileTracksDisk,
    ),
    await recordScenario(
      "watch07-external-edit-same-path",
      "WATCH-07: an external edit changes markdown at the same path and inode; after rescan, getById " +
        "returns the updated BLAKE3 content hash for the same document identity.",
      buildWatch07ExternalEditSamePath,
    ),
    await recordScenario(
      "watch04-external-move-across-roots",
      "WATCH-04: a file moved outside the app from root A to root B keeps its UUID — the " +
        "destination scan reports it unbound with inode + content hash, the pass correlates it " +
        "against A's confirmed detach, and the binding moves to B with no detach in A.",
      buildWatch04ExternalMoveAcrossRoots,
    ),
    await recordScenario(
      "sync05-save-during-flush-failure",
      "SYNC-05 (failure in flight): the in-flight write fails after a newer save superseded it; " +
        "the superseded mutation does not come back as failed, and past its backoff a second " +
        "flush lists only the newer mutation.",
      buildSync05FailureDuringFlush,
      "queue",
    ),
    await recordScenario(
      "sync05-save-during-flush-success",
      "SYNC-05 (success in flight): a save made while a flush is in flight supersedes the " +
        "mutation being written; when the older response arrives it stays synced and the " +
        "document stays pending until the next flush uploads the newer mutation and resolves it.",
      buildSync05SuccessDuringFlush,
      "queue",
    ),
    await recordScenario(
      "sync05-workspace-removal-not-exists",
      "SYNC-05 (workspace removal in flight): a held save is in flight when the real " +
        "`catalog_apply_workspace_removal` retires the root and enqueues the delete of the " +
        "cloud-owned document — the second actionable mutation the `NOT EXISTS` projection " +
        "guards against. The in-flight response does not project the document; resolving the " +
        "delete does; re-registering the root re-binds the surviving .md.",
      buildSync05WorkspaceRemovalNotExists,
      "queue",
    ),
    await recordScenario(
      "sync08-bound-pending-save-metadata",
      "SYNC-08: on a bound, cloud-owned document (hydrated from the fake cloud) a real body " +
        "save enqueues a pending mutation and a real metadata update before the flush supersedes " +
        "it — one actionable metadata mutation remains and the binding keeps the body hash.",
      buildSync08BoundMetadataBeforeFlush,
      "queue",
    ),
    await recordScenario(
      "sync08-first-upload-metadata-before-flush",
      "SYNC-08 (first upload): a draft with a known id and author is materialized with a real " +
        "create (pending upsert), then metadata arrives before its first flush and supersedes " +
        "the create — the single actionable mutation is the metadata one.",
      buildSync08FirstUploadMetadataBeforeFlush,
      "queue",
      "queue",
    ),
    await recordScenario(
      "sync08-settings-metadata-batch",
      "SYNC-08 (Settings): deleting a vocabulary item lists the catalog through the real " +
        "`catalog_list` and bulk-writes the matching rows with `binding:null`. The bound " +
        "cloud-owned row gets one metadata mutation, the bound local-only control is rewritten " +
        "with no mutation, and the account-owned cloud-only row is excluded by the real " +
        "catalog_list account filter.",
      buildSync08SettingsBatchMetadata,
      "queue",
    ),
  ]
  return {
    version: CATALOG_SEAM_FIXTURE_VERSION,
    generator: "tests/support/catalog-seam-recorder.ts",
    scenarios,
  }
}
