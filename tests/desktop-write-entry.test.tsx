/**
 * @vitest-environment happy-dom
 *
 * ODE-541 — el bridge de History del entry desktop no interrumpe el commit de
 * React ni pierde la identidad de una pestaña al abrir por id o por path.
 *
 * Camino probado: `DesktopWriteEntry` real → `EditorShell` real → creación de
 * dos documentos desde "New Artifact" → navegación de History durante un
 * insertion effect → sesión/editor restaurados → menú nativo Open File por
 * path. Dobles: TipTap capture wrapper, Next navigation, Tauri core/event/dialog,
 * detección de runtime (dos módulos), AI y sync service, Tauri path y commands
 * (incluidos `tauriCatalog*`). El workspace temporal, la entry, la shell y la
 * sesión se recorren en el harness real. La llamada IPC `tauriCatalogResolvePath`
 * es doblada, por lo que el resolver Rust no forma parte de esta prueba.
 *
 * Completion event: el id esperado está activo, el editor real muestra su
 * contenido y `data-hydration-phase="ready"` después de la notificación.
 * Un control de creación materializa documentos reales en el catálogo y el
 * filesystem; una ruta a un UUID inexistente termina en unavailable sin añadir
 * draft/tab ni una fila o archivo de fallback.
 * Mutaciones discriminantes: diferir el URL, notificar dentro del insertion
 * effect, quitar la coalescencia, observar `replaceState` o dejar una key
 * constante cuando cambia el id de la ruta.
 */
import { act, useInsertionEffect, type ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import { DesktopWriteEntry } from "@/components/editor/desktop-write-entry"

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

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
vi.mock("@/lib/runtime/detect", async () =>
  (await import("./support/editor-shell-doubles")).tauriRuntimeDetectDouble(),
)
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  clickNewArtifact,
  emitTauriEvent,
  flush,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { world } = await import("./support/editor-shell-doubles")
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { closeTab, getEditorSessionState, openWritingTab } = await import(
  "@/lib/stores/editor-session-store"
)
const { readEditorSession, writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } = await import(
  "@/lib/local-db/editor-sessions"
)
const { localDB } = await import("@/lib/local-db")
const { getSyncWorker } = await import("@/lib/sync/worker")

const LOCATION_CHANGE_EVENT = "odessay:locationchange"
const TEST_TIMEOUT_MS = 60_000
const TEXT_A = "ODE541 documento A creado desde la pestaña real."
const TEXT_B = "ODE541 documento B abierto por id y después por path."

type PushObservation = {
  href: string
  search: string
}

type MountedEntry = {
  container: HTMLDivElement
  render: (children: ReactNode) => Promise<void>
  unmount: () => Promise<void>
}

let mounted: MountedEntry | null = null
let locationChangeListener: (() => void) | null = null

function PushStateDuringInsertion({
  hrefs,
  onPushReturn,
}: {
  hrefs: string[]
  onPushReturn: (observation: PushObservation) => void
}) {
  useInsertionEffect(() => {
    for (const href of hrefs) {
      window.history.pushState(null, "", href)
      onPushReturn({ href, search: window.location.search })
    }
  }, [hrefs, onPushReturn])

  return null
}

async function mountDesktopWriteEntry(): Promise<MountedEntry> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  const render = async (children: ReactNode) => {
    await act(async () => {
      root.render(children)
      await Promise.resolve()
    })
    await flush(2)
  }

  const unmount = async () => {
    await act(async () => root.unmount())
    container.remove()

    const worker = getSyncWorker()
    worker.stop()
    const internals = worker as unknown as { isRunning: boolean }
    const deadline = Date.now() + 5_000
    while (internals.isRunning && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  const entry = { container, render, unmount }
  await render(<DesktopWriteEntry />)
  return entry
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function sessionWritingIds() {
  return getEditorSessionState().session.tabs.map((tab) => tab.writing_id)
}

async function catalogRows() {
  return (await getDocumentCatalog()).list()
}

function expectOnlyDocuments(documentIds: string[]) {
  const ids = sessionWritingIds()
  expect(ids, "no se creó una pestaña extra de fallback").toHaveLength(documentIds.length)
  expect(ids.filter((id): id is string => typeof id === "string").sort()).toEqual(
    [...documentIds].sort(),
  )
  expect(ids).not.toContain(EDITOR_DRAFT_TAB_ID)
  expect(ids).not.toContain(null)
}

async function createDocument(container: HTMLElement, text: string) {
  await clickNewArtifact(container)
  await typeInEditor(text)
  await advance(6_000)
  const file = await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => {
      const writing = activeTab()?.writing_id
      return writing && writing !== EDITOR_DRAFT_TAB_ID ? writing : null
    },
    { label: `documento materializado: ${text}`, timeoutMs: 15_000 },
  )
  return { writingId, file }
}

async function clickTab(container: HTMLElement, writingId: string) {
  const tab = container.querySelector<HTMLElement>(`[data-editor-tab-id="${writingId}"]`)
  if (!tab) throw new Error(`No existe la pestaña real de ${writingId}`)
  await pointerClick(tab)
  await waitFor(() => activeTab()?.writing_id === writingId, {
    label: `pestaña activa ${writingId}`,
    timeoutMs: 15_000,
  })
}

beforeAll(() => {
  createDesktopWorkspace("odessay-ode541-entry-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  window.history.replaceState(null, "", "/write")
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  if (locationChangeListener) {
    window.removeEventListener(LOCATION_CHANGE_EVENT, locationChangeListener)
    locationChangeListener = null
  }
  await mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
})

describe("ODE-541 — desktop tab history entry", () => {
  it(
    "creates multiple tabs, opens by id and path, and defers one location notification",
    async () => {
      const consoleError = vi.spyOn(console, "error").mockImplementation(() => {})
      const consoleWarn = vi.spyOn(console, "warn").mockImplementation(() => {})
      const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => {})
      mounted = await mountDesktopWriteEntry()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión inicial cargada" })

      let locationChangeCount = 0
      locationChangeListener = () => {
        locationChangeCount += 1
      }
      window.addEventListener(LOCATION_CHANGE_EVENT, locationChangeListener)
      const notificationsBeforeTabCreation = locationChangeCount

      const documentA = await createDocument(mounted.container, TEXT_A)
      const documentB = await createDocument(mounted.container, TEXT_B)
      const expectedDocumentIds = [documentA.writingId, documentB.writingId].sort()
      expect(locationChangeCount, "crear pestañas no publica replaceState al entry").toBe(
        notificationsBeforeTabCreation,
      )
      expectOnlyDocuments(expectedDocumentIds)

      const positiveControlRows = await catalogRows()
      expect(
        positiveControlRows.map((row) => row.id).sort(),
        "control positivo: crear documentos reales sí registra ambos writings en el catálogo desktop",
      ).toEqual(expectedDocumentIds)
      const positiveControlFiles = await readWorkspaceMarkdown()
      expect(
        positiveControlFiles.map((file) => file.path).sort(),
        "control positivo: las dos creaciones reales materializan sus .md",
      ).toEqual([documentA.file.path, documentB.file.path].sort())
      expect(positiveControlFiles.find((file) => file.path === documentA.file.path)?.contents).toContain(TEXT_A)
      expect(positiveControlFiles.find((file) => file.path === documentB.file.path)?.contents).toContain(TEXT_B)

      const routeNotificationsBeforeTabSwitch = locationChangeCount
      await clickTab(mounted.container, documentA.writingId)
      await waitForHydrationReady()
      expect(locationChangeCount, "replaceState interno sigue siendo de EditorShell").toBe(
        routeNotificationsBeforeTabSwitch,
      )

      const shellBeforeIdOpen = mounted.container.querySelector('[data-page="editor"]')
      expect(shellBeforeIdOpen, "la shell real está montada").toBeTruthy()
      const idNavigationInfoStart = consoleInfo.mock.calls.length
      // Desktop static export uses the query form; Vitest otherwise selects
      // the web-only `/write/<slug>` branch of buildWritingRouteHref.
      const hrefA = `/write?id=${encodeURIComponent(documentA.writingId)}`
      const hrefB = `/write?id=${encodeURIComponent(documentB.writingId)}`
      const pushObservations: Array<PushObservation & { notificationsAtReturn: number }> = []
      const onPushReturn = (observation: PushObservation) => {
        pushObservations.push({ ...observation, notificationsAtReturn: locationChangeCount })
      }
      const notificationBaseline = locationChangeCount

      await mounted.render(
        <>
          <DesktopWriteEntry />
          <PushStateDuringInsertion hrefs={[hrefA, hrefB]} onPushReturn={onPushReturn} />
        </>,
      )

      expect(pushObservations).toEqual([
        {
          href: hrefA,
          search: new URL(hrefA, window.location.origin).search,
          notificationsAtReturn: notificationBaseline,
        },
        {
          href: hrefB,
          search: new URL(hrefB, window.location.origin).search,
          notificationsAtReturn: notificationBaseline,
        },
      ])
      expect(window.location.search, "pushState ya cambió el URL al retornar").toBe(
        new URL(hrefB, window.location.origin).search,
      )
      expect(locationChangeCount, "los pushes del mismo commit se coalescen en una notificación").toBe(
        notificationBaseline + 1,
      )

      try {
        await waitFor(() => activeTab()?.writing_id === documentB.writingId, {
          label: "apertura por id completada en la pestaña de B",
          timeoutMs: 15_000,
        })
      } catch (error) {
        const state = getEditorSessionState()
        throw new Error(
          `${error instanceof Error ? error.message : String(error)}; route=${window.location.href}; ` +
            `active=${JSON.stringify(activeTab())}; tabs=${JSON.stringify(state.session.tabs)}`,
        )
      }
      await waitFor(() => world.editor?.getText().includes(TEXT_B), {
        label: "el editor real hidrata el contenido de B",
        timeoutMs: 15_000,
      })
      await waitForHydrationReady()
      const shellAfterIdOpen = mounted.container.querySelector('[data-page="editor"]')
      expect(shellAfterIdOpen, "cambiar el id de ruta remonta EditorShell").not.toBe(shellBeforeIdOpen)
      expectOnlyDocuments([documentA.writingId, documentB.writingId])

      const replaceStateShell = shellAfterIdOpen
      const afterIdNotifications = locationChangeCount
      await clickTab(mounted.container, documentA.writingId)
      await waitForHydrationReady()
      expect(locationChangeCount, "el cambio interno no notifica al entry").toBe(afterIdNotifications)
      expect(mounted.container.querySelector('[data-page="editor"]')).toBe(replaceStateShell)

      world.openDialogResult = documentB.file.path
      await emitTauriEvent("menu:open-file")
      await waitFor(() => activeTab()?.writing_id === documentB.writingId, {
        label: "apertura por path resuelta al UUID de B",
        timeoutMs: 15_000,
      })
      await waitFor(() => world.editor?.getText().includes(TEXT_B), {
        label: "el editor real vuelve a mostrar B tras abrir por path",
        timeoutMs: 15_000,
      })
      await waitForHydrationReady()
      expect(locationChangeCount, "Open File conserva la propiedad interna de replaceState").toBe(
        afterIdNotifications,
      )
      expect(mounted.container.querySelector('[data-page="editor"]')).toBe(replaceStateShell)
      expectOnlyDocuments(expectedDocumentIds)

      const routeInfo = consoleInfo.mock.calls.slice(idNavigationInfoStart).flat().join(" ")
      expect(routeInfo).not.toContain("no-restorable-tab")
      const reactWarnings = [...consoleError.mock.calls, ...consoleWarn.mock.calls].flat().join(" ")
      expect(reactWarnings).not.toContain("useInsertionEffect must not schedule updates")

      const sessionBeforeFailureSetup = await readEditorSession()
      expect(sessionBeforeFailureSetup.tabs.map((tab) => tab.writing_id).sort()).toEqual(expectedDocumentIds)
      const localWritingIdsBeforeFailedOpen = (await localDB.writings.getAll())
        .map((writing) => writing.id)
        .sort()
      const filesBeforeFailedOpen = await readWorkspaceMarkdown()
      const missingWritingId = "54100000-0000-4000-8000-000000000541"
      for (const writingId of expectedDocumentIds) closeTab(writingId)
      openWritingTab({ writingId: missingWritingId, title: "Missing ODE-541 target" })
      await writeEditorSession(getEditorSessionState().session)
      const missingTargetSession = await readEditorSession()
      expect(missingTargetSession.tabs.map((tab) => tab.writing_id)).toEqual([missingWritingId])

      const infoBeforeFailedOpen = consoleInfo.mock.calls.length
      const missingHref = `/write?id=${encodeURIComponent(missingWritingId)}`

      await mounted.render(
        <>
          <DesktopWriteEntry />
          <PushStateDuringInsertion hrefs={[missingHref]} onPushReturn={() => {}} />
        </>,
      )
      await waitFor(
        () => {
          const failureInfo = consoleInfo.mock.calls.slice(infoBeforeFailedOpen).flat().join(" ")
          return (
            failureInfo.includes(
              `[editor] unified-open unavailable documentId=${missingWritingId} status=orphaned`,
            ) && failureInfo.includes(`[editor] unavailable writing ${missingWritingId}`)
          )
        },
        { label: "la ruta por UUID inexistente llega a la recuperación de orphaned", timeoutMs: 15_000 },
      )
      await waitForHydrationReady()

      await waitFor(async () => (await readEditorSession()).tabs.length === 0, {
        label: "la recuperación del tab unavailable persiste una sesión vacía",
      })
      expect(sessionWritingIds(), "la recuperación no crea un tab draft en el store de sesión").toEqual([])
      expect(getEditorSessionState().session.active_tab_id).toBeNull()
      const persistedSessionAfterFailedOpen = await readEditorSession()
      expect(
        persistedSessionAfterFailedOpen.tabs.map((tab) => tab.id).sort(),
        "orphaned no persiste una pestaña de fallback",
      ).toEqual([])
      expect(
        persistedSessionAfterFailedOpen.tabs.map((tab) => tab.writing_id).sort(),
        "orphaned no persiste un draft ni otro writing",
      ).toEqual([])
      expect(
        persistedSessionAfterFailedOpen.tabs.some(
          (tab) => tab.id === EDITOR_DRAFT_TAB_ID || tab.writing_id === null,
        ),
        "orphaned no persiste una pestaña de borrador",
      ).toBe(false)

      expect(
        (await catalogRows()).map((row) => row.id).sort(),
        "orphaned no añade un writing al catálogo desktop",
      ).toEqual(expectedDocumentIds)
      expect(
        (await localDB.writings.getAll()).map((writing) => writing.id).sort(),
        "orphaned no añade una fila al almacén IndexedDB de compatibilidad",
      ).toEqual(localWritingIdsBeforeFailedOpen)
      const filesAfterFailedOpen = await readWorkspaceMarkdown()
      expect(
        filesAfterFailedOpen.map((file) => file.path).sort(),
        "orphaned no materializa un .md de fallback",
      ).toEqual(filesBeforeFailedOpen.map((file) => file.path).sort())
      expect(
        filesAfterFailedOpen.map((file) => ({ path: file.path, contents: file.contents })).sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
      ).toEqual(
        filesBeforeFailedOpen.map((file) => ({ path: file.path, contents: file.contents })).sort((a, b) =>
          a.path.localeCompare(b.path),
        ),
      )
    },
    TEST_TIMEOUT_MS,
  )
})
