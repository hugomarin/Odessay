/**
 * Montaje compartido de dos Workspaces reales (dos BindingRoots registradas
 * a la vez), extraído de `cross-workspace-move.test.ts` (ODE-554) sin cambiar
 * lo que aquel prueba. Lo consumen:
 *
 *   - `cross-workspace-move.test.ts` (DOC-08 / WS-02 / SYS-04);
 *   - `workspace-switch-isolation.test.ts` (WS-06).
 *
 * WATCH-04 (movimiento externo entre raíces) reutilizará este montaje.
 *
 * Quién es real y quién no (regla 3 de `capability-proof-contract.md`): las
 * dos raíces son directorios temporales reales, cada una registrada como
 * `WorkspaceRecord` y `BindingRoot` (la forma real de producción); el catálogo
 * y el settings store corren sobre los doubles de `real-desktop-doubles.ts`,
 * que solo sustituyen el transporte Tauri/SQLite — no los seams internos.
 *
 * IMPORTANTE: este módulo NO importa módulos de la app a nivel de módulo. Las
 * fábricas de `vi.mock` lo importan desde dentro de su propio factory; un
 * import estático de la app cerraría un ciclo (mock de tauri-commands →
 * montaje → workspace-service → tauri-commands) y colgaría la carga del test.
 * `registerTwoWorkspaces` importa sus colaboradores de producción en tiempo de
 * llamada.
 */
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { vi } from "vitest"

import {
  configureRealDesktopDoubles,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogListRetiredBindingRootsDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriRelocateFileDouble,
  tauriSettingsDeleteDouble,
  tauriSettingsReadDouble,
  tauriSettingsWriteDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "./real-desktop-doubles"

/** Body JSON mínimo con forma de documento TipTap, para `createDesktopDraft`. */
export function bodyJson(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
}

/**
 * Stub ruidoso para funciones de `tauri-commands` que el escenario no espera
 * llamar: falla en vez de devolver un valor silencioso que oculte un camino
 * no previsto (misma convención que `materialize-save-reopen.test.ts`).
 */
export function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for this proof and was not expected to be called`)
  })
}

/**
 * Tabla completa de `@/lib/services/desktop/tauri-commands` doblada por
 * transporte (29 entradas base; verificado 2026-09-30). Cada función real que
 * producción importa debe estar presente aunque el escenario no la use.
 *
 * `overrides` reemplaza entradas y añade comandos nuevos; obligatorio cuando
 * un proof nuevo travesía otra función real (regla "Doubles" del contrato:
 * revalidar cada caller del doble extendido).
 */
export function tauriCommandsModuleDouble(overrides: Record<string, unknown> = {}) {
  return {
    tauriCreateFile: tauriCreateFileDouble,
    tauriWriteFile: tauriWriteFileDouble,
    tauriOpenFile: tauriOpenFileDouble,
    tauriListRecentFiles: tauriListRecentFilesDouble,
    tauriRenameFile: unimplemented("tauriRenameFile"),
    tauriRelocateFile: tauriRelocateFileDouble,
    tauriWorkspaceCreate: unimplemented("tauriWorkspaceCreate"),
    tauriWorkspaceInspect: unimplemented("tauriWorkspaceInspect"),
    tauriWorkspaceRepairManifestBindings: unimplemented("tauriWorkspaceRepairManifestBindings"),
    tauriWorkspaceSync: tauriWorkspaceSyncDouble,
    tauriWorkspaceTouchFile: tauriWorkspaceTouchFileDouble,
    tauriCatalogDualWrite: tauriCatalogDualWriteDouble,
    tauriCatalogBulkDualWrite: unimplemented("tauriCatalogBulkDualWrite"),
    tauriCatalogGetById: tauriCatalogGetByIdDouble,
    tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
    tauriCatalogList: tauriCatalogListDouble,
    tauriCatalogDetachLocalFile: tauriCatalogDetachLocalFileDouble,
    tauriCatalogHydrateExcerpts: vi.fn(async () => []),
    tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
    tauriCatalogApplyCloudSnapshots: unimplemented("tauriCatalogApplyCloudSnapshots"),
    tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
    tauriCatalogActivateBindingRoot: vi.fn(async () => undefined),
    tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
    tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
    tauriCatalogListRetiredBindingRoots: tauriCatalogListRetiredBindingRootsDouble,
    tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
    tauriSettingsRead: tauriSettingsReadDouble,
    tauriSettingsWrite: tauriSettingsWriteDouble,
    tauriSettingsDelete: tauriSettingsDeleteDouble,
    ...overrides,
  }
}

export type TwoWorkspaceBase = {
  baseDir: string
  configDir: string
  /** Borra el directorio temporal real. No toca el estado en memoria de los dobles. */
  dispose: () => void
}

/**
 * Directorio temporal real del montaje + `configureRealDesktopDoubles` sobre
 * él. Llamar una vez por archivo de test (en `beforeAll`); el estado en
 * memoria de los dobles se resetea por test con `resetCatalogDoubles` /
 * `resetSettingsStoreDouble`.
 */
export function configureTwoWorkspaceBase(prefix = "odessay-two-workspaces-"): TwoWorkspaceBase {
  const baseDir = mkdtempSync(join(tmpdir(), prefix))
  configureRealDesktopDoubles(baseDir)
  const configDir = join(baseDir, "config")
  return {
    baseDir,
    configDir,
    dispose: () => rmSync(baseDir, { recursive: true, force: true }),
  }
}

/**
 * Registra dos Workspaces reales (A y B) sobre el `configDir` del montaje.
 * Cada uno queda como `WorkspaceRecord` (UI) y `BindingRoot` (catálogo) a la
 * vez, que es lo que hace `registerWorkspace` en producción.
 */
export async function registerTwoWorkspaces(baseDir: string, configDir: string) {
  const { DesktopSettingsService } = await import("@/lib/services/desktop/desktop-settings-service")
  const { DesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")

  const rootA = mkdtempSync(join(baseDir, "workspace-a-"))
  const rootB = mkdtempSync(join(baseDir, "workspace-b-"))
  const settings = new DesktopSettingsService(configDir)
  const nowIso = new Date().toISOString()

  // A real Workspace is always both a WorkspaceRecord (UI-facing) and a
  // registered BindingRoot (catalog-facing) at once — that's what
  // `registerWorkspace` itself does in production. Registering only the
  // WorkspaceRecord half would leave `relocateDesktopWriting`'s destRootPath
  // resolution (document-service-factory.ts:738-753) always taking the
  // "no settingsRecord" branch, never exercising the real risk the
  // investigation flagged: comparing two independently-sourced root lists.
  await settings.upsertBindingRoot({
    id: `binding-root-a-${randomUUID()}`, rootPath: rootA, kind: "external",
    visibleAsWorkspace: true, selectedPaths: [], consentedAt: nowIso, createdAt: nowIso,
  })
  await settings.upsertBindingRoot({
    id: `binding-root-b-${randomUUID()}`, rootPath: rootB, kind: "external",
    visibleAsWorkspace: true, selectedPaths: [], consentedAt: nowIso, createdAt: nowIso,
  })
  await settings.updateDesktopSettings({
    workspaces: [
      { slug: "workspace-a", name: "Workspace A", rootPath: rootA, source: "scratch", addedAt: nowIso, lastOpenedAt: null },
      { slug: "workspace-b", name: "Workspace B", rootPath: rootB, source: "scratch", addedAt: nowIso, lastOpenedAt: null },
    ],
  })

  return { rootA, rootB, workspaceService: new DesktopWorkspaceService(settings) }
}

/** Fila del catálogo en memoria para un id, en la DB del montaje. */
export async function catalogRow(configDir: string, id: string) {
  const dbPath = join(configDir, "desktop-index.sqlite3")
  return tauriCatalogGetByIdDouble(dbPath, id)
}
