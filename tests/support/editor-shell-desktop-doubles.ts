/**
 * Modo desktop del harness de `EditorShell` (ODE-557).
 *
 * Todo lo que queda de ODE-556 corre por el camino desktop: los tres tests
 * legacy del shell declaran `isDesktop: true`, y la carrera "edición en vuelo
 * al cambiar de pestaña" (ODE-478 caso 2) **solo existe ahí** —
 * `scheduleQueuedRichModeUpdate` vacía la cola de forma síncrona cuando
 * `!isDesktopRuntime()`, así que en web no hay nada que falsificar.
 *
 * Este módulo no inventa dobles: delega en
 * `tests/integration/documents/support/real-desktop-doubles.ts`, que es el
 * canonical owner y hace escrituras de fs reales contra un directorio
 * temporal, con hashing real y un catálogo con las mismas reglas de
 * consistencia id/path/binding que aplica el lado Rust.
 *
 * Vive separado de `editor-shell-doubles.ts` por la misma razón que aquel
 * vive separado del harness: los factories de `vi.mock` no pueden cerrar un
 * ciclo con `EditorShell`. Este archivo solo lo importan los factories de los
 * módulos desktop, nunca el de `@tiptap/react`.
 *
 * EXAMPLE — cabecera de un test desktop, sobre la lista del harness web:
 *
 *   vi.mock("@tauri-apps/api/path", async () =>
 *     (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble())
 *   vi.mock("@/lib/services/desktop/tauri-commands", async () =>
 *     (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble())
 *   vi.mock("@/lib/sync/sync-service-factory", async () =>
 *     (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble())
 */
import { mkdtempSync, rmSync } from "node:fs"
import { readdir, readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"

import { vi } from "vitest"

import {
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetWriteFileFailureState,
  tauriCatalogDetachLocalFileDouble,
  tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogResolvePathDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriRelocateFileDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "../integration/documents/support/real-desktop-doubles"

/**
 * Comandos nativos fuera del alcance de este harness. Lanzan en vez de
 * devolver algo plausible: un doble que responde `undefined` a un comando que
 * nadie previó es justo cómo se cuela un falso verde (precedente ODE-554,
 * donde una call shape no soportada explotaba dentro del doble y producción
 * se tragaba el error).
 */
function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(
      `editor-shell-desktop-doubles: "${name}" no está cableado en el harness del shell. ` +
        "Si la cadena bajo prueba lo necesita, cablearlo en real-desktop-doubles.ts (su canonical owner), no aquí.",
    )
  })
}

/** Doble del módulo `@tauri-apps/api/path`, apuntando al workspace temporal. */
export function tauriPathDouble() {
  return tauriPathModuleDouble
}

/**
 * Doble del transporte nativo. Es el único boundary que este modo añade
 * respecto al modo web: no existe puente de Tauri dentro de Vitest.
 */
export function tauriCommandsDouble() {
  return {
    tauriCreateFile: tauriCreateFileDouble,
    tauriWriteFile: tauriWriteFileDouble,
    tauriOpenFile: tauriOpenFileDouble,
    tauriListRecentFiles: tauriListRecentFilesDouble,
    tauriRelocateFile: tauriRelocateFileDouble,
    tauriRenameFile: unimplemented("tauriRenameFile"),
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
    tauriCatalogApplyCloudSnapshots: tauriCatalogApplyCloudSnapshotsDouble,
    tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
    tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
    tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
    tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
    tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
    tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
  }
}

/**
 * El flush a la nube es boundary externo real (red). Mismo criterio que los
 * tests de integración de documentos: la propiedad bajo prueba es lo que pasa
 * en disco, no lo que viaja al servidor.
 */
export function syncServiceDouble() {
  return {
    getSyncService: () => ({
      scheduleFlush: async () => ({ data: undefined, error: null }),
      hydrateWriting: async () => ({ data: undefined, error: null }),
      enqueueMutation: async () => ({ data: undefined, error: null }),
    }),
  }
}

/* ------------------------------------------------------------------ *
 * Workspace temporal
 * ------------------------------------------------------------------ */

let workspaceRoot: string | null = null

/**
 * Crea el workspace temporal y apunta los dobles a él.
 *
 * Llamar UNA vez por archivo de test, antes del primer montaje:
 * `getDocumentService()` memoiza el runtime en su primera llamada a
 * `resolveDesktopRuntimeServices()`, así que el root no se puede cambiar
 * entre tests del mismo archivo. Es la misma restricción que documenta
 * `tests/integration/documents/materialize-save-reopen.test.ts`.
 */
export function createDesktopWorkspace(prefix = "odessay-shell-harness-"): string {
  workspaceRoot = mkdtempSync(join(tmpdir(), prefix))
  configureRealDesktopDoubles(workspaceRoot)
  return workspaceRoot
}

export function desktopWorkspaceRoot(): string {
  if (!workspaceRoot) {
    throw new Error("Llama a createDesktopWorkspace() antes de montar el shell en modo desktop")
  }
  return workspaceRoot
}

/**
 * Limpia contenido entre tests conservando el root.
 *
 * Deja el catálogo y el disco vacíos a la vez: dejar archivos de un test
 * anterior produciría exactamente la divergencia fs/catálogo que estas
 * pruebas existen para detectar, y la convertiría en ruido en lugar de señal.
 */
export function resetDesktopWorkspace() {
  resetCatalogDoubles()
  resetWriteFileFailureState()
  if (!workspaceRoot) return
  rmSync(join(workspaceRoot, "data"), { recursive: true, force: true })
  rmSync(join(workspaceRoot, "config"), { recursive: true, force: true })
}

export function destroyDesktopWorkspace() {
  if (!workspaceRoot) return
  rmSync(workspaceRoot, { recursive: true, force: true })
  workspaceRoot = null
}

/* ------------------------------------------------------------------ *
 * Lectura del estado canónico
 * ------------------------------------------------------------------ */

export type DesktopMarkdownFile = { path: string; contents: string }

/**
 * Lee del disco real todos los `.md` del workspace.
 *
 * Es el estado canónico del documento en desktop (ADR de identidad D1/D9):
 * las aserciones van contra esto, no contra "se llamó a tauriWriteFile".
 */
export async function readWorkspaceMarkdown(): Promise<DesktopMarkdownFile[]> {
  const root = desktopWorkspaceRoot()
  const found: DesktopMarkdownFile[] = []

  async function walk(dir: string) {
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
      } else if (entry.name.endsWith(".md")) {
        found.push({ path: full, contents: await readFile(full, "utf8") })
      }
    }
  }

  await walk(root)
  return found
}
