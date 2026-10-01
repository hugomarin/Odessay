/**
 * @vitest-environment happy-dom
 *
 * ODE-637 P1 — exercises self-write suppression through the real
 * `tauri-commands` wrappers, watcher filter, reconciler, catalog doubles and
 * mounted editor shell. Only the native invoke transport, watcher event source,
 * filesystem/catalog boundary, network and native dialogs are doubled.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
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
// Intentionally no mock for `@/lib/services/desktop/tauri-commands`.

const {
  advance,
  assertNoUnhandledErrors,
  emitFsWatchEvent,
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
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
const {
  holdWriteFile,
  holdWriteFileAfterDiskWrite,
  tauriWorkspaceSyncInvokeDouble,
  writeFileCalls,
} = await import("./support/real-desktop-doubles")
const { getDesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
const { clearOdessaySelfWritePathsForTests } = await import("@/lib/services/desktop/tauri-fs-watch")
const { disposeWorkspaceReconciler, ensureWorkspaceReconciler } = await import(
  "@/lib/services/desktop/desktop-workspace-reconciler"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { computeMarkdownContentHash } = await import("@/lib/content-hash")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000
const CONFLICT_BANNER = "This file changed outside Artifact Studio while you had unsaved edits here"
const RELOADED_NOTICE = "Updated externally"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let alerts: string[] = []

beforeAll(() => {
  createDesktopWorkspace("odessay-watch07-self-write-")
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

function documentsFolder() {
  const folder = join(desktopWorkspaceRoot(), "Documentos")
  mkdirSync(folder, { recursive: true })
  return folder
}

function writeMarkdownFile(title: string, body: string) {
  const path = join(documentsFolder(), `${title}.md`)
  writeFileSync(path, `${body}\n`)
  return path
}

function editorText() {
  return mounted!.editor().getText()
}

function bannerText() {
  return mounted!.container.textContent ?? ""
}

function workspaceSyncCount(rootPath: string) {
  return world.tauriCalls.filter(
    (call) => call.command === "workspace_sync" && call.args?.rootPath === rootPath,
  ).length
}

async function registerWholeWorkspace() {
  const rootPath = documentsFolder()
  world.openDialogResult = rootPath
  const service = await getDesktopWorkspaceService()
  const workspace = await service.addExistingWorkspace()
  if (!workspace) throw new Error("No se registró el workspace de prueba")
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
  await waitFor(() => editorText().includes(body), { label: `documento abierto: ${body}`, timeoutMs: 15_000 })
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await advance(50)
}

async function waitForWatcherOnDocuments() {
  const folder = documentsFolder()
  await waitFor(
    () =>
      world.fsWatchers.some(
        (watcher) =>
          !watcher.closed && watcher.paths.some((path) => folder.startsWith(path) || path.startsWith(folder)),
      ),
    { label: "watcher nativo sobre el workspace", timeoutMs: 10_000 },
  )
  await advance(100)
}

async function waitForDiskContaining(path: string, needle: string) {
  return waitFor(
    () => {
      try {
        const contents = readFileSync(path, "utf8")
        return contents.includes(needle) ? contents : false
      } catch {
        return false
      }
    },
    { label: `disco contiene ${needle}`, timeoutMs: 15_000 },
  )
}

async function waitForCatalogHashToMatchDisk(path: string) {
  const expectedHash = await computeMarkdownContentHash(await readFile(path, "utf8"))
  const catalog = await getDocumentCatalog()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const resolution = await catalog.resolvePath(path)
    if (resolution.kind === "resolved" && resolution.record.binding?.contentHash === expectedHash) {
      return resolution.record
    }
    await advance(100)
  }
  throw new Error(`El catálogo no confirmó el hash durable del archivo ${path}`)
}

async function waitForResolvedCatalogRecord(path: string) {
  const catalog = await getDocumentCatalog()
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    const resolution = await catalog.resolvePath(path)
    if (resolution.kind === "resolved") return resolution.record
    await advance(100)
  }
  throw new Error(`El catálogo no resolvió ${path}`)
}

async function openWorkspaceDocument(path: string, body: string) {
  const rootPath = await registerWholeWorkspace()
  await startReconciler()
  await mountLoaded()
  await openFromNativeMenu(path, body)
  await waitForWatcherOnDocuments()
  return rootPath
}

describe("ODE-637 P1 — supresión de auto-escritura en la cadena desktop real", () => {
  it(
    "entrega al reconciliador una edición externa de la misma ruta después de la ventana de 2 s",
    async () => {
      const path = writeMarkdownFile("Carta control positivo", "ODE637 control base.")
      const rootPath = await openWorkspaceDocument(path, "ODE637 control base.")
      const held = holdWriteFile((candidate) => candidate === path)
      const localEdit = " ODE637 edición local pendiente."
      const externalContent = "ODE637 edición externa después de la ventana.\n"

      try {
        await typeInEditor(localEdit)
        await held.started
        const syncsBeforeExternalEvent = workspaceSyncCount(rootPath)
        await advance(2_100)
        writeFileSync(path, externalContent)
        await emitFsWatchEvent([path])
        await advance(400)

        await waitFor(() => bannerText().includes(CONFLICT_BANNER), {
          label: "control positivo: el cambio externo levanta el banner",
          timeoutMs: 10_000,
        })
        expect(workspaceSyncCount(rootPath)).toBeGreaterThan(syncsBeforeExternalEvent)
        expect(await readFile(path, "utf8")).toBe(externalContent)
        expect(editorText()).toContain(localEdit.trim())
      } finally {
        held.release()
      }

      await advance(400)
      expect(await readFile(path, "utf8")).toBe(externalContent)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ignora el evento propio tardío mientras el segundo guardado ya escribió el .md",
    async () => {
      const path = writeMarkdownFile("Carta de dos guardados", "ODE637 base.")
      const rootPath = await openWorkspaceDocument(path, "ODE637 base.")

      await typeInEditor(" ODE637 primer guardado.")
      await advance(800)
      await waitForDiskContaining(path, "ODE637 primer guardado.")
      await waitForCatalogHashToMatchDisk(path)

      const held = holdWriteFileAfterDiskWrite((candidate) => candidate === path)
      try {
        await typeInEditor(" ODE637 segundo guardado.")
        expect(editorText()).toContain("ODE637 segundo guardado.")
        await held.started
        const diskWhileHeld = await readFile(path, "utf8")
        expect(diskWhileHeld, JSON.stringify(writeFileCalls().filter((call) => call.path === path))).toContain(
          "ODE637 segundo guardado.",
        )

        const syncsBeforeOwnEvent = workspaceSyncCount(rootPath)
        await emitFsWatchEvent([path, `${path}.tmp`])
        await advance(400)

        expect(bannerText(), "un guardado propio no levanta el banner de conflicto").not.toContain(CONFLICT_BANNER)
        expect(bannerText(), "un guardado propio no levanta el aviso de recarga").not.toContain(RELOADED_NOTICE)
        expect(editorText()).toContain("ODE637 segundo guardado.")
        expect(workspaceSyncCount(rootPath), "el evento propio no programa otro workspace_sync para la raíz").toBe(
          syncsBeforeOwnEvent,
        )
      } finally {
        held.release()
      }

      await advance(800)
      expect(await readFile(path, "utf8")).toContain("ODE637 segundo guardado.")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "no suprime un evento mixto: la ruta externa llega como fila nueva al catálogo",
    async () => {
      const path = writeMarkdownFile("Carta evento mixto", "ODE637 evento propio.")
      const rootPath = await openWorkspaceDocument(path, "ODE637 evento propio.")
      await typeInEditor(" ODE637 guardado antes del evento mixto.")
      await advance(800)
      await waitForDiskContaining(path, "ODE637 guardado antes del evento mixto.")
      await waitForCatalogHashToMatchDisk(path)

      const held = holdWriteFileAfterDiskWrite((candidate) => candidate === path)
      try {
        await typeInEditor(" ODE637 guardado en vuelo.")
        await held.started

        const externalPath = writeMarkdownFile("Carta archivo externo mixto", "ODE637 archivo externo.")
        const catalog = await getDocumentCatalog()
        expect((await catalog.resolvePath(externalPath)).kind).toBe("unbound")
        await emitFsWatchEvent([path, externalPath])

        const record = await waitForResolvedCatalogRecord(externalPath)
        expect(record.localPresent).toBe(true)
        expect(record.binding?.canonicalPath).toBe(externalPath)
        expect(await readFile(externalPath, "utf8")).toBe("ODE637 archivo externo.\n")
        expect(workspaceSyncCount(rootPath)).toBeGreaterThan(0)
      } finally {
        held.release()
      }

      await advance(800)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
