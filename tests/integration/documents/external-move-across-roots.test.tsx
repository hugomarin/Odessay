/**
 * @vitest-environment happy-dom
 *
 * ODE-657 — WATCH-04: un archivo movido **fuera de la app** (Finder) desde una
 * raíz vigilada A a otra raíz vigilada B conserva su UUID, su binding apunta a
 * B y la shell avisa "moved", no "removed".
 *
 * Proof Contract (workflow/quality/capability-proof-contract.md):
 *
 * - **Entry point (regla 1).** La cadena real del watcher: `renameSync` sobre
 *   disco real → evento nativo `plugin:fs|watch` (`emitFsWatchEvent`, dobla el
 *   transporte del SO) → supresión de auto-escrituras real →
 *   `WorkspaceReconciler` real (singleton de `desktop-workspace-reconciler.ts`)
 *   → `workspace_sync` real (el doble opera sobre el fs temporal) →
 *   `correlateAcrossRoots` → `catalog_apply_reconcile` (doble espejo del SQL) →
 *   `CatalogChange` → shell montada.
 * - **Transición real (regla 2).** Las dos raíces se registran con la forma de
 *   producción (`DesktopWorkspaceService.addExistingWorkspace`, no ids
 *   sintéticos ni modo api) y el documento se abre por el menú nativo con el
 *   opener unificado real; el movimiento es un `renameSync` real, no un estado
 *   sembrado.
 * - **Seams internos reales (regla 3).** `tauri-commands` NO está mockeado: el
 *   `invoke` del router dobla solo el transporte Tauri. Catálogo, manifest,
 *   settings y watcher corren sobre los dobles reales de fs.
 * - **Completion event (regla 4).** El binding durable en el catálogo (y el
 *   aviso de la shell), nunca "se llamó a workspace_sync".
 * - **Resultado canónico (regla 6).** Disco real + filas del catálogo + DOM de
 *   la shell.
 * - **Control positivo (regla 8).** Un movimiento dentro de una sola raíz
 *   (donde la correlación por inode ya existe) prueba que el montaje detecta
 *   "moved" y conserva el UUID; sin él, el rojo de los dos órdenes de raíz
 *   podría ser un fallo del harness.
 * - **Dos órdenes (Req. 1).** A→B notificando A primero y B primero, cada uno
 *   con dos eventos separados dentro de la misma ráfaga (<250 ms): el coalesce
 *   del reconciler junta las dos raíces en una sola pasada.
 * - **Mutación del modo de fallo (BUILD).** Con el código previo al fix, los
 *   dos casos A→B quedan rojos por la razón declarada (UUID nuevo en B +
 *   aviso "deleted" en A) y el control sigue verde.
 *
 * Fuera de alcance declarado (brief): movimiento repartido en dos ráfagas
 * (>250 ms) y entre volúmenes.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("../../support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("../../support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("../../support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("../../support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/api/window", async () =>
  (await import("../../support/editor-shell-doubles")).tauriWindowDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("../../support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }))
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("../../support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("../../support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("../../support/editor-shell-desktop-doubles")).syncServiceDouble(),
)
// Intentionally no mock for `@/lib/services/desktop/tauri-commands`: the real
// wrapper (mintUnbound, bindUnbound, id mapping) is part of the chain under test.

const {
  advance,
  assertNoUnhandledErrors,
  emitFsWatchEvent,
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
} = await import("../../support/editor-shell-harness")
const { tauriInvokeRouterDouble, world } = await import("../../support/editor-shell-doubles")
const {
  createDesktopWorkspace,
  desktopWorkspaceRoot,
  destroyDesktopWorkspace,
  resetDesktopWorkspace,
  tauriCommandsDouble,
} = await import("../../support/editor-shell-desktop-doubles")
const { tauriWorkspaceSyncInvokeDouble } = await import("./support/real-desktop-doubles")
const { getDesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
const { clearOdessaySelfWritePathsForTests } = await import("@/lib/services/desktop/tauri-fs-watch")
const { disposeWorkspaceReconciler, ensureWorkspaceReconciler } = await import(
  "@/lib/services/desktop/desktop-workspace-reconciler"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000
const MOVED_NOTICE = "This file moved outside Artifact Studio"
const DELETED_NOTICE = "This file was removed outside Artifact Studio"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let alerts: string[] = []

beforeAll(() => {
  createDesktopWorkspace("odessay-watch04-cross-root-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  clearOdessaySelfWritePathsForTests()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
  world.tauriInvoke = tauriInvokeRouterDouble({
    ...tauriCommandsDouble({ withReconciler: true }),
    tauriWorkspaceSync: tauriWorkspaceSyncInvokeDouble,
  })
  vi.spyOn(window, "confirm").mockReturnValue(true)
  alerts = []
  window.alert = (message?: unknown) => {
    alerts.push(String(message))
  }
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  await disposeWorkspaceReconciler()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function makeRoot(name: string) {
  const folder = join(desktopWorkspaceRoot(), name)
  mkdirSync(folder, { recursive: true })
  return folder
}

function writeMarkdownIn(root: string, title: string, body: string) {
  const path = join(root, `${title}.md`)
  writeFileSync(path, `${body}\n`)
  return path
}

function editorText() {
  return mounted!.editor().getText()
}

function bannerText() {
  return mounted!.container.textContent ?? ""
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

async function registerWorkspace(rootPath: string) {
  world.openDialogResult = rootPath
  const service = await getDesktopWorkspaceService()
  const workspace = await service.addExistingWorkspace()
  if (!workspace) throw new Error(`No se registró la raíz ${rootPath}`)
  return workspace.rootPath
}

async function startReconciler() {
  await ensureWorkspaceReconciler()
  await advance(100)
}

async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
}

async function openFromNativeMenu(path: string, body: string) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  await flush(5)
  await waitFor(() => editorText().includes(body), {
    label: `documento abierto: ${body}`,
    timeoutMs: 15_000,
  })
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await advance(50)
  const writingId = activeTab()?.writing_id
  if (!writingId) throw new Error(`${path} abrió sin identidad`)
  return writingId
}

async function waitForWatcherOn(rootPath: string) {
  await waitFor(
    () =>
      world.fsWatchers.some(
        (watcher) =>
          !watcher.closed &&
          watcher.paths.some((path) => rootPath.startsWith(path) || path.startsWith(rootPath)),
      ),
    { label: `watcher nativo sobre ${rootPath}`, timeoutMs: 10_000 },
  )
  await advance(100)
}

async function waitForCatalogBindingAt(path: string) {
  const catalog = await getDocumentCatalog()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const resolution = await catalog.resolvePath(path)
    if (resolution.kind === "resolved") return resolution.record
    await advance(100)
  }
  throw new Error(`El catálogo no resolvió ${path}`)
}

describe("ODE-657 — movimiento externo entre dos raíces vigiladas (WATCH-04)", () => {
  it.fails(
    "conserva el UUID de A en B cuando el watcher notifica A primero",
    async () => {
      const rootA = makeRoot("Raiz A")
      const rootB = makeRoot("Raiz B")
      const pathA = writeMarkdownIn(rootA, "Carta cruzada", "ODE657 cuerpo cruzado.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo cruzado.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta cruzada.md")
      renameSync(pathA, pathB)
      // Dos eventos separados dentro de la ráfaga (<250 ms): fijan el orden de
      // notificación A→B, que un solo evento con ambas rutas no controla.
      await emitFsWatchEvent([pathA])
      await emitFsWatchEvent([pathB])
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa 'moved' tras el movimiento entre raíces",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(bannerText()).toContain(pathB)
      expect(activeTab()?.writing_id, "misma identidad en la pestaña").toBe(writingId)

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect(record.binding?.canonicalPath).toBe(pathB)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      const byId = await catalog.getById(writingId)
      expect(byId?.binding?.canonicalPath).toBe(pathB)
      const boundToB = (await catalog.listByBindingRoot(record.binding!.bindingRootId!)).filter(
        (row) => row.binding?.canonicalPath === pathB,
      )
      expect(boundToB.map((row) => row.id), "sin fila duplicada en B").toEqual([writingId])
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "conserva el UUID de A en B cuando el watcher notifica B primero",
    async () => {
      const rootA = makeRoot("Raiz A")
      const rootB = makeRoot("Raiz B")
      const pathA = writeMarkdownIn(rootA, "Carta cruzada", "ODE657 cuerpo cruzado inverso.")
      await registerWorkspace(rootA)
      await registerWorkspace(rootB)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo cruzado inverso.")
      await waitForWatcherOn(rootA)
      await waitForWatcherOn(rootB)

      const pathB = join(rootB, "Carta cruzada.md")
      renameSync(pathA, pathB)
      await emitFsWatchEvent([pathB])
      await emitFsWatchEvent([pathA])
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "la shell avisa 'moved' con el orden B→A",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id, "misma identidad en la pestaña").toBe(writingId)

      const catalog = await getDocumentCatalog()
      const record = await waitForCatalogBindingAt(pathB)
      expect(record.id, "el UUID de A sobrevive en B").toBe(writingId)
      expect(record.localPresent).toBe(true)
      expect((await catalog.resolvePath(pathA)).kind, "la ruta vieja ya no resuelve").toBe("unbound")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "control positivo: un movimiento dentro de una sola raíz conserva el UUID",
    async () => {
      const rootA = makeRoot("Raiz control")
      const pathA = writeMarkdownIn(rootA, "Carta interna", "ODE657 cuerpo interno.")
      await registerWorkspace(rootA)
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(pathA, "ODE657 cuerpo interno.")
      await waitForWatcherOn(rootA)

      const movedPath = join(rootA, "Carta interna renombrada.md")
      renameSync(pathA, movedPath)
      await emitFsWatchEvent([pathA, movedPath], { modify: { kind: "rename", mode: "both" } })
      await advance(500)

      await waitFor(() => bannerText().includes(MOVED_NOTICE), {
        label: "control positivo: la shell avisa 'moved' dentro de una raíz",
        timeoutMs: 15_000,
      })
      expect(bannerText()).not.toContain(DELETED_NOTICE)
      expect(activeTab()?.writing_id).toBe(writingId)
      const record = await waitForCatalogBindingAt(movedPath)
      expect(record.id).toBe(writingId)
      expect(record.binding?.canonicalPath).toBe(movedPath)
      expect((await (await getDocumentCatalog()).resolvePath(pathA)).kind).toBe("unbound")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
