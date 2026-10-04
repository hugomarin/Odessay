/**
 * @vitest-environment happy-dom
 *
 * ODE-619 — Open File adopts the selected `.md` in place.
 *
 * Proof Contract:
 * - Property: `menu:open-file` opens the selected path with a UUID identity,
 *   filename-derived title, unchanged source bytes (front matter included), and
 *   a catalog binding to that same path. Reopening after another document is
 *   active keeps the UUID. Empty files remain valid empty documents. An
 *   invalid-UTF-8 `open_file` rejection is visible without opening another tab.
 *   If the first catalog write rejects after the manifest records an id, retry
 *   uses that id. The "Open With"/Dock entry (`menu:os-open-path`, a wake-up
 *   signal whose path comes from the pending queue) holds the same properties
 *   in Write and, outside Write, hands the one-slot pending file off to Write.
 * - Real collaborators: native menu event bus/picker callback, EditorShell,
 *   useGlobalOpenFileMenu, drainPendingOsOpenPaths queue, openDocumentByPath,
 *   openDesktopDocument, createOpenDocumentUseCase, DesktopSettingsService,
 *   SqliteDocumentCatalog class, real temporary files, editor session and
 *   hydration.
 * - Allowed fakes: Tauri command/IPC boundary and OS dialogs, including the
 *   `take_pending_open_paths` queue drain; the existing desktop doubles use
 *   real filesystem reads and model manifest/catalog state in memory. Cloud
 *   auth/hash lookup returns no session. Rust/SQLite command execution and
 *   actual `.odessay/index.json` serialization remain outside this Vitest
 *   proof, and the simulated event is not macOS's real `RunEvent::Opened`.
 * - Production path: `menu:open-file` → picker → `invoke("open_file")` →
 *   handleMenuOpenFile → openDocumentByPath → resolvePath/root registration →
 *   workspace_sync/file evidence → manifest-id reconciliation →
 *   registerBinding → activate/hydrate by UUID. `menu:os-open-path` →
 *   `take_pending_open_paths` → the same read/preflight → opener in Write or
 *   pending-file handoff + `/write` navigation outside it.
 * - Completion: after the menu action settles, observe the active editor and
 *   query the catalog/path; read the original file bytes. Recovery completes
 *   when the retry opens with the exact id retained in the manifest model.
 *   Outside Write, the positive control confirms pending-file handoff and route
 *   navigation; invalid UTF-8 confirms the alert without either transition.
 * - Mutation: changing the production opener to use the canonical filesystem
 *   path as the document id must fail the UUID assertion; removing the
 *   invalid-UTF-8 alert from the shared read preflight must fail the OS-open
 *   rejection cases.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const catalogWriteFailure = vi.hoisted(() => ({ canonicalPath: null as string | null }))

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
)
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("./support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
)
vi.mock("@tauri-apps/api/event", async () =>
  (await import("./support/editor-shell-doubles")).tauriEventDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("./support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("./support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () => {
  const { tauriCommandsDouble } = await import("./support/editor-shell-desktop-doubles")
  const { world } = await import("./support/editor-shell-doubles")
  const commands = tauriCommandsDouble()
  const catalogDualWrite = commands.tauriCatalogDualWrite
  return {
    ...commands,
    // Production's `tauriOpenFile` is a thin wrapper over `invoke("open_file")`.
    // Routing the double through the world's IPC router keeps one injection
    // point for native rejections (invalid UTF-8) across both the menu
    // preflight and the catalog opener.
    tauriOpenFile: async (path: string) =>
      world.tauriInvoke("open_file", { path }) as Promise<string>,
    tauriCatalogDualWrite: async (...args: Parameters<typeof catalogDualWrite>) => {
      const [, input] = args
      if (catalogWriteFailure.canonicalPath && input.binding?.canonicalPath === catalogWriteFailure.canonicalPath) {
        catalogWriteFailure.canonicalPath = null
        throw new Error("ODE-619 injected catalog rejection")
      }
      return catalogDualWrite(...args)
    },
  }
})
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)
vi.mock("@/lib/supabase/desktop-client", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  return {
    ...actual,
    createDesktopClient: () => ({
      auth: { getSession: async () => ({ data: { session: null }, error: null }) },
    }),
  }
})

const {
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
  waitForHydrationReady,
} = await import("./support/editor-shell-harness")
const { useGlobalOpenFileMenu } = await import("@/hooks/useGlobalOpenFileMenu")
const { consumePendingOpenFile } = await import("@/lib/editor/pending-open-file")
const { world } = await import("./support/editor-shell-doubles")
const {
  createDesktopWorkspace,
  desktopWorkspaceRoot,
  destroyDesktopWorkspace,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")
const {
  tauriOpenFileDouble,
  tauriWorkspaceSyncDouble,
} = await import("./integration/documents/support/real-desktop-doubles")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000
const FRONT_MATTER_BODY = "ODE619 content after front matter"
const RETRY_BODY = "ODE619 catalog retry recovered the document"
const NON_UTF8_OPEN_MESSAGE = "This file can't be opened because it isn't UTF-8 text."
const NON_UTF8_OPEN_ERROR = "open_file: stream did not contain valid UTF-8"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let globalMenuRoot: Root | null = null
let globalMenuContainer: HTMLDivElement | null = null
const originalConfirm = window.confirm
const originalAlert = window.alert

/**
 * Cola que el doble de `take_pending_open_paths` entrega y vacía, como el
 * `PendingOpenPaths` de Rust: el path nunca viaja en el payload del evento.
 */
const pendingOsOpenPaths: string[] = []

/** Router nativo de la prueba: `open_file`, la cola OS y el rechazo UTF-8. */
function installNativeOpens(invalidPath?: string) {
  world.tauriInvoke = async (command, args) => {
    if (command === "open_file" && invalidPath && args?.path === invalidPath) {
      throw NON_UTF8_OPEN_ERROR
    }
    if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
    if (command === "take_pending_open_paths") return pendingOsOpenPaths.splice(0)
    throw new Error(`Comando nativo no previsto en esta prueba: ${command}`)
  }
}

/** Entrega el path por la cola y despierta el frontend, como macOS. */
async function queueOsOpenPath(path: string) {
  pendingOsOpenPaths.push(path)
  await emitTauriEvent("menu:os-open-path")
  await flush(5)
}

function GlobalOpenFileMenuHarness() {
  useGlobalOpenFileMenu()
  return null
}

beforeAll(() => {
  createDesktopWorkspace("odessay-open-file-adopts-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  catalogWriteFailure.canonicalPath = null
  pendingOsOpenPaths.length = 0
  installNativeOpens()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
})

afterEach(async () => {
  if (globalMenuRoot) {
    await act(async () => globalMenuRoot?.unmount())
    globalMenuRoot = null
  }
  globalMenuContainer?.remove()
  globalMenuContainer = null
  await mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  window.confirm = originalConfirm
  window.alert = originalAlert
  catalogWriteFailure.canonicalPath = null
  pendingOsOpenPaths.length = 0
})

function installAcceptingConfirm() {
  const confirm = vi.fn(() => true)
  window.confirm = confirm
  return confirm
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

function writeMarkdownFile(filename: string, source: string) {
  const folder = join(desktopWorkspaceRoot(), "Documentos")
  mkdirSync(folder, { recursive: true })
  const path = join(folder, filename)
  writeFileSync(path, source)
  return path
}

async function mountDesktopEditor() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
}

async function mountGlobalOpenFileMenu() {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  world.pathname = "/desk"
  globalMenuContainer = document.createElement("div")
  document.body.appendChild(globalMenuContainer)
  globalMenuRoot = createRoot(globalMenuContainer)
  await act(async () => globalMenuRoot?.render(<GlobalOpenFileMenuHarness />))
  await flush()
}

async function selectFileFromNativeMenu(path: string) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  await flush(5)
}

async function openFileAndWaitForText(path: string, text: string, label: string): Promise<string> {
  await selectFileFromNativeMenu(path)
  await waitFor(() => mounted!.editor().getText().includes(text), {
    label,
    timeoutMs: 15_000,
  })
  await waitForHydrationReady(`${label}: hidratación lista`)
  const writingId = activeTab()?.writing_id
  if (!writingId) throw new Error(`${label}: el tab activo no tiene identidad`)
  return writingId
}

async function openFileAndWaitForNewIdentity(path: string, previousId: string | null | undefined): Promise<string> {
  await selectFileFromNativeMenu(path)
  const writingId = await waitFor(() => {
    const candidate = activeTab()?.writing_id
    return candidate && candidate !== previousId ? candidate : null
  }, {
    label: `identidad nueva para ${basename(path)}`,
    timeoutMs: 15_000,
  })
  await waitForHydrationReady(`hidratación de ${basename(path)}`)
  return writingId
}

async function expectCatalogPath(path: string, expectedId: string) {
  const catalog = await getDocumentCatalog()
  const record = await catalog.getById(expectedId)
  expect(record, `fila de catálogo para ${path}`).not.toBeNull()
  expect(record?.id).toBe(expectedId)
  expect(record?.binding?.canonicalPath).toBe(path)

  const resolution = await catalog.resolvePath(path)
  expect(resolution.kind).toBe("resolved")
  if (resolution.kind !== "resolved") throw new Error(`La ruta no resolvió en el catálogo: ${path}`)
  expect(resolution.record.id).toBe(expectedId)
  return record!
}

function expectUuid(id: string) {
  expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
}

describe("ODE-619 — Open File adopta el archivo en su sitio", () => {
  it("avisa del UTF-8 inválido desde una ruta fuera de Write y no navega ni guarda un archivo pendiente", async () => {
    const controlPath = writeMarkdownFile("Global UTF-8 Control.md", "# Control\n\nODE619 global positive control\n")
    const invalidPath = join(dirname(controlPath), "Global Not UTF-8.md")
    const invalidBytes = Buffer.from([0xff, 0xfe, 0x80])
    writeFileSync(invalidPath, invalidBytes)
    const alerts: string[] = []
    window.alert = vi.fn((message?: string) => {
      alerts.push(String(message))
    })

    await mountGlobalOpenFileMenu()

    world.openDialogResult = controlPath
    await emitTauriEvent("menu:open-file")
    await waitFor(() => world.navigations.length === 1, { label: "control positivo navega a Write" })
    expect(world.navigations).toEqual([{ kind: "push", href: "/write" }])
    expect(consumePendingOpenFile()).toEqual({
      path: controlPath,
      content: "# Control\n\nODE619 global positive control\n",
    })

    installNativeOpens(invalidPath)
    world.openDialogResult = invalidPath
    await emitTauriEvent("menu:open-file")
    await waitFor(() => alerts.includes(NON_UTF8_OPEN_MESSAGE), {
      label: "aviso no UTF-8 visible fuera de Write",
      timeoutMs: 1_000,
    })

    expect(alerts).toEqual([NON_UTF8_OPEN_MESSAGE])
    expect(world.navigations).toHaveLength(1)
    expect(consumePendingOpenFile()).toBeNull()
    expect(readFileSync(invalidPath)).toEqual(invalidBytes)
  })

  it(
    "conserva el front matter como contenido, usa el título del filename y reabre con el mismo UUID",
    async () => {
      const source = [
        "---",
        "title: Metadata Title Must Stay Content",
        "status: published",
        "collections:",
        "  - Correspondence",
        "---",
        "",
        "# Carta",
        "",
        FRONT_MATTER_BODY,
        "",
      ].join("\n")
      const pathA = writeMarkdownFile("Filename Title.md", source)
      const confirm = installAcceptingConfirm()

      await mountDesktopEditor()
      const firstId = await openFileAndWaitForText(pathA, FRONT_MATTER_BODY, "archivo con front matter abierto")
      expectUuid(firstId)
      expect(firstId).not.toBe(pathA)
      expect(activeTab()?.title).toBe("Filename Title")

      const firstRecord = await expectCatalogPath(pathA, firstId)
      expect(firstRecord.title).toBe("Filename Title")
      expect(firstRecord.status).toBeNull()
      expect(firstRecord.slug).toBeNull()
      expect(mounted!.editor().getText()).toContain("title: Metadata Title Must Stay Content")
      expect(mounted!.editor().getText()).toContain("status: published")
      expect(mounted!.editor().getText()).toContain("Correspondence")
      expect(readFileSync(pathA, "utf8")).toBe(source)
      expect(readdirSync(dirname(pathA)).filter((name) => name.endsWith(".md"))).toEqual([basename(pathA)])

      const pathB = writeMarkdownFile("Other File.md", "# Other File\n\nODE619 other file control\n")
      const secondId = await openFileAndWaitForText(pathB, "ODE619 other file control", "segundo archivo abierto")
      expectUuid(secondId)
      expect(secondId).not.toBe(firstId)

      const reopenedId = await openFileAndWaitForText(pathA, FRONT_MATTER_BODY, "archivo original reabierto")
      expect(reopenedId).toBe(firstId)
      expect(activeTab()?.title).toBe("Filename Title")
      expect(readFileSync(pathA, "utf8")).toBe(source)
      const adoptedRows = (await (await getDocumentCatalog()).list({ limit: 5000 })).filter(
        (row) => row.binding?.canonicalPath === pathA || row.binding?.canonicalPath === pathB,
      )
      expect(adoptedRows).toHaveLength(2)
      expect(confirm).toHaveBeenCalledTimes(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "adopta un archivo vacío sin inventar contenido",
    async () => {
      const emptyPath = writeMarkdownFile("Empty File.md", "")
      installAcceptingConfirm()

      await mountDesktopEditor()
      const previousId = activeTab()?.writing_id
      const writingId = await openFileAndWaitForNewIdentity(emptyPath, previousId)

      expectUuid(writingId)
      expect(writingId).not.toBe(emptyPath)
      expect(activeTab()?.title).toBe("Empty File")
      expect(mounted!.editor().getText()).toBe("")
      expect(readFileSync(emptyPath, "utf8")).toBe("")
      await expectCatalogPath(emptyPath, writingId)
      expect(readdirSync(dirname(emptyPath)).filter((name) => name.endsWith(".md"))).toEqual([basename(emptyPath)])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "avisa cuando open_file rechaza un archivo que no es UTF-8 y no abre otra pestaña",
    async () => {
      const controlPath = writeMarkdownFile("UTF-8 Control.md", "# Control\n\nODE619 UTF-8 positive control\n")
      const invalidPath = join(dirname(controlPath), "Not UTF-8.md")
      const invalidBytes = Buffer.from([0xff, 0xfe, 0x80])
      writeFileSync(invalidPath, invalidBytes)
      installAcceptingConfirm()
      const alerts: string[] = []
      window.alert = vi.fn((message?: string) => {
        alerts.push(String(message))
      })

      await mountDesktopEditor()
      const controlId = await openFileAndWaitForText(
        controlPath,
        "ODE619 UTF-8 positive control",
        "control positivo abierto",
      )
      await expectCatalogPath(controlPath, controlId)
      const tabCountBeforeFailure = getEditorSessionState().session.tabs.length

      installNativeOpens(invalidPath)

      await selectFileFromNativeMenu(invalidPath)
      await waitFor(() => alerts.some((message) => message === NON_UTF8_OPEN_MESSAGE), {
        label: "aviso de archivo no UTF-8 visible",
        timeoutMs: 1_000,
      })

      expect(alerts).toEqual([NON_UTF8_OPEN_MESSAGE])
      expect(getEditorSessionState().session.tabs).toHaveLength(tabCountBeforeFailure)
      expect(activeTab()?.writing_id).toBe(controlId)
      expect(readFileSync(invalidPath)).toEqual(invalidBytes)
      const rows = await (await getDocumentCatalog()).list({ limit: 5000 })
      expect(rows.filter((row) => row.binding?.canonicalPath === invalidPath)).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "abre por Open With/Dock en Write y avisa del no UTF-8 sin pestaña, binding ni fila",
    async () => {
      const healthyPath = writeMarkdownFile(
        "OS Open Healthy.md",
        "# OS Open\n\nODE655 Write OS control\n",
      )
      const invalidPath = join(dirname(healthyPath), "OS Open Not UTF-8.md")
      const invalidBytes = Buffer.from([0xff, 0xfe, 0x80])
      writeFileSync(invalidPath, invalidBytes)
      installAcceptingConfirm()
      const alerts: string[] = []
      window.alert = vi.fn((message?: string) => {
        alerts.push(String(message))
      })

      await mountDesktopEditor()

      // Control positivo: el path viene de la cola (`take_pending_open_paths`),
      // no del payload del evento.
      await queueOsOpenPath(healthyPath)
      await waitFor(() => mounted!.editor().getText().includes("ODE655 Write OS control"), {
        label: "archivo válido abierto por Open With/Dock en Write",
        timeoutMs: 15_000,
      })
      await waitForHydrationReady("Open With/Dock en Write: hidratación lista")
      const healthyId = activeTab()?.writing_id
      if (!healthyId) throw new Error("Open With/Dock en Write: el tab activo no tiene identidad")
      expectUuid(healthyId)
      expect(activeTab()?.title).toBe("OS Open Healthy")
      await expectCatalogPath(healthyPath, healthyId)
      const tabsAfterOpen = getEditorSessionState().session.tabs.length
      const navigationsAfterOpen = [...world.navigations]

      // Señal duplicada con la cola ya drenada: una entrega por path, sin reabrir.
      await emitTauriEvent("menu:os-open-path")
      await flush(5)
      expect(getEditorSessionState().session.tabs).toHaveLength(tabsAfterOpen)
      expect(activeTab()?.writing_id).toBe(healthyId)

      installNativeOpens(invalidPath)
      await queueOsOpenPath(invalidPath)
      await waitFor(() => alerts.includes(NON_UTF8_OPEN_MESSAGE), {
        label: "aviso no UTF-8 desde Open With/Dock en Write",
        timeoutMs: 1_000,
      })

      expect(alerts).toEqual([NON_UTF8_OPEN_MESSAGE])
      expect(getEditorSessionState().session.tabs).toHaveLength(tabsAfterOpen)
      expect(activeTab()?.writing_id).toBe(healthyId)
      expect(world.navigations).toEqual(navigationsAfterOpen)
      expect(readFileSync(invalidPath)).toEqual(invalidBytes)
      const invalidRows = (
        await (await getDocumentCatalog()).list({ limit: 5000 })
      ).filter((row) => row.binding?.canonicalPath === invalidPath)
      expect(invalidRows).toHaveLength(0)
      const invalidSnapshot = await tauriWorkspaceSyncDouble(dirname(invalidPath), undefined)
      expect(invalidSnapshot.selectedPaths).not.toContain(basename(invalidPath))
      expect(
        invalidSnapshot.files.some((file) => file.relativePath === basename(invalidPath)),
      ).toBe(false)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "encola por Open With/Dock fuera de Write y avisa del no UTF-8 sin navegar",
    async () => {
      const healthyPath = writeMarkdownFile(
        "Global OS Open.md",
        "# Global OS\n\nODE655 Desk OS control\n",
      )
      const invalidPath = join(dirname(healthyPath), "Global OS Not UTF-8.md")
      const invalidBytes = Buffer.from([0xff, 0xfe, 0x80])
      writeFileSync(invalidPath, invalidBytes)
      const alerts: string[] = []
      window.alert = vi.fn((message?: string) => {
        alerts.push(String(message))
      })

      await mountGlobalOpenFileMenu()
      expect(world.navigations).toEqual([])
      expect(consumePendingOpenFile()).toBeNull()

      // Control positivo: handoff de un solo slot y navegación a Write.
      await queueOsOpenPath(healthyPath)
      await waitFor(() => world.navigations.length === 1, {
        label: "control positivo de Open With/Dock fuera de Write navega",
      })
      expect(world.navigations).toEqual([{ kind: "push", href: "/write" }])
      expect(consumePendingOpenFile()).toEqual({
        path: healthyPath,
        content: "# Global OS\n\nODE655 Desk OS control\n",
      })
      // El handoff se consume una sola vez; una señal duplicada no reencola.
      expect(consumePendingOpenFile()).toBeNull()
      await emitTauriEvent("menu:os-open-path")
      await flush(5)
      expect(consumePendingOpenFile()).toBeNull()
      expect(world.navigations).toHaveLength(1)

      installNativeOpens(invalidPath)
      await queueOsOpenPath(invalidPath)
      await waitFor(() => alerts.includes(NON_UTF8_OPEN_MESSAGE), {
        label: "aviso no UTF-8 desde Open With/Dock fuera de Write",
        timeoutMs: 1_000,
      })

      expect(alerts).toEqual([NON_UTF8_OPEN_MESSAGE])
      expect(world.navigations).toHaveLength(1)
      expect(consumePendingOpenFile()).toBeNull()
      expect(readFileSync(invalidPath)).toEqual(invalidBytes)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "recupera el UUID del manifest cuando falla el primer write del catálogo",
    async () => {
      const controlPath = writeMarkdownFile("Healthy Control.md", "# Control\n\nODE619 catalog positive control\n")
      const retryPath = writeMarkdownFile("Retry File.md", `# Retry\n\n${RETRY_BODY}\n`)
      const unselectedPath = writeMarkdownFile("Unselected Sibling.md", "No debe adoptarse\n")
      const confirm = installAcceptingConfirm()
      const alerts: string[] = []
      window.alert = vi.fn((message?: string) => {
        alerts.push(String(message))
      })

      await mountDesktopEditor()
      const controlId = await openFileAndWaitForText(controlPath, "ODE619 catalog positive control", "control positivo abierto")
      expectUuid(controlId)
      await expectCatalogPath(controlPath, controlId)
      const tabCountBeforeFailure = getEditorSessionState().session.tabs.length

      const catalog = await getDocumentCatalog()
      const positiveSnapshot = await tauriWorkspaceSyncDouble(dirname(controlPath), undefined)
      expect(positiveSnapshot.selectedPaths).toEqual([basename(controlPath)])
      expect(positiveSnapshot.files.map((file) => file.relativePath)).toEqual([basename(controlPath)])
      expect((await catalog.list({ limit: 5000 })).some((row) => row.binding?.canonicalPath === controlPath)).toBe(true)

      catalogWriteFailure.canonicalPath = retryPath
      await selectFileFromNativeMenu(retryPath)
      await waitFor(() => alerts.length > 0, { label: "rechazo del catálogo visible", timeoutMs: 15_000 })
      expect(catalogWriteFailure.canonicalPath).toBeNull()
      expect(alerts).toEqual(["ODE-619 injected catalog rejection"])
      expect(getEditorSessionState().session.tabs).toHaveLength(tabCountBeforeFailure)
      expect(activeTab()?.writing_id).toBe(controlId)

      const rowsAfterFailure = await catalog.list({ limit: 5000 })
      expect(rowsAfterFailure.filter((row) => row.binding?.canonicalPath === retryPath)).toHaveLength(0)

      const failedSnapshot = await tauriWorkspaceSyncDouble(dirname(retryPath), undefined)
      const manifestFile = failedSnapshot.files.find((file) => file.relativePath === basename(retryPath))
      expect(manifestFile, "el manifest conserva la adopción tras el rechazo del catálogo").toBeDefined()
      const manifestId = manifestFile!.id
      expectUuid(manifestId)
      expect(failedSnapshot.selectedPaths).toContain(basename(retryPath))
      expect(failedSnapshot.files.some((file) => file.relativePath === basename(unselectedPath))).toBe(false)

      const reopenedId = await openFileAndWaitForText(retryPath, RETRY_BODY, "archivo recuperado tras el rechazo")
      expect(reopenedId).toBe(manifestId)
      expect(activeTab()?.title).toBe("Retry File")
      expect(readFileSync(retryPath, "utf8")).toBe(`# Retry\n\n${RETRY_BODY}\n`)
      await expectCatalogPath(retryPath, manifestId)
      expect((await catalog.list({ limit: 5000 })).filter((row) => row.binding?.canonicalPath === retryPath)).toHaveLength(1)
      expect(confirm).toHaveBeenCalledTimes(1)
    },
    TEST_TIMEOUT_MS,
  )
})
