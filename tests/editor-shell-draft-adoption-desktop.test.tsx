/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-577 — Lo que el autor hace antes de que cargue la sesión
 * persistida no se pierde al cargarla, y el borrador que materializa es el
 * documento de la shell: seguir escribiendo va al mismo archivo.
 *
 * Qué pasaba: `setSessionState` marcaba el store como cargado aunque la
 * lectura de la sesión persistida siguiera pendiente, y al llegar esa lectura
 * `initializeEditorSessionStore` sustituía el estado entero. La pestaña del
 * borrador abierta con "New Artifact" desaparecía y `active_tab_id` quedaba en
 * `null`; el espejo store → `activeEditorTabIdRef` copiaba ese `null`, así que
 * al materializarse `onMaterialized` veía `isSourceDraftActive: false`, no
 * adoptaba el documento y limpiaba igualmente la identidad efímera del
 * borrador. El siguiente guardado salía sin identidad y creaba OTRO documento
 * (y un "Save As" posterior, también). Pasaba en frío (pulsar "New Artifact"
 * antes de que cargue la sesión) y bajo carga, porque cualquier mutación
 * temprana del store adelantaba el `loaded`.
 *
 * Camino de producción: shell real en modo desktop, "New Artifact" real,
 * escritura real en TipTap, materialización real en el workspace temporal.
 * Lo único controlado es CUÁNDO llega la lectura de la sesión persistida
 * (`localDB.editorSessions.get`, retenida con `vi.spyOn` que delega en la
 * real): es una lectura de IndexedDB sin boundary externo más cercano, la
 * misma excepción declarada que las lecturas locales de ODE-574.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
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
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const { advance, clickNewArtifact, flush, mountEditorShell, resetEditorShellWorld, typeInEditor, waitFor, waitForMarkdownContaining } =
  await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { localDB } = await import("@/lib/local-db")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState, resetEditorSessionStoreForTests } = await import("@/lib/stores/editor-session-store")
const { readEditorSession, writeEditorSession } = await import("@/lib/editor/session-persistence")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-draft-adoption-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // La sesión persistida vive en fake-indexeddb, que el harness no limpia.
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

async function catalogRows() {
  return (await getDocumentCatalog()).list()
}

/**
 * Retiene la ENTREGA de la lectura de la sesión persistida hasta `release()`.
 * La lectura en sí ocurre al llamarla, como una transacción de IndexedDB
 * abierta al montar, antes de que el autor pueda hacer nada: ve la sesión
 * anterior aunque después se escriba otra.
 */
function holdSessionRead() {
  const original = localDB.editorSessions.get.bind(localDB.editorSessions)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let arrived!: () => void
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  vi.spyOn(localDB.editorSessions, "get").mockImplementation(async (id: string) => {
    const value = await original(id)
    arrived()
    await gate
    return value
  })
  return { release, started }
}

/** Crea un documento real con la sesión ya cargada y devuelve su id. */
async function createDocumentWithLoadedSession(text: string) {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(text)
  await advance(SAVE_WINDOW_MS)
  await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => {
      const writing = activeTab()?.writing_id
      return writing && writing !== EDITOR_DRAFT_TAB_ID ? writing : null
    },
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if ((await readEditorSession()).tabs.some((tab) => tab.writing_id === writingId)) break
    await advance(100)
  }
  await mounted.unmount()
  mounted = null
  return writingId
}

describe("ODE-577 — lo hecho antes de cargar la sesión sobrevive a la carga", () => {
  it(
    "New Artifact antes de que cargue la sesión: el borrador materializado es el documento de la shell",
    async () => {
      const hold = holdSessionRead()
      mounted = await mountEditorShell()
      await hold.started

      await clickNewArtifact(mounted.container)
      expect(getEditorSessionState().loaded, "la sesión persistida todavía no llegó").toBe(false)
      await typeInEditor("ODE577-PRIMERO")

      hold.release()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      expect(activeTab()?.id, "la pestaña del borrador sobrevive a la carga").toBe(EDITOR_DRAFT_TAB_ID)

      await advance(SAVE_WINDOW_MS)
      const first = await waitForMarkdownContaining("ODE577-PRIMERO")

      await typeInEditor(" ODE577-SEGUNDO")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE577-SEGUNDO")

      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path), "seguir escribiendo va al mismo archivo").toEqual([first.path])
      const rows = await catalogRows()
      expect(rows, "un solo documento").toHaveLength(1)
      expect(activeTab()?.writing_id, "la pestaña activa es ese documento").toBe(rows[0]?.id)
      expect(getEditorSessionState().session.tabs, "y es la única pestaña").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "las pestañas persistidas y el borrador abierto antes de cargar conviven tras la carga",
    async () => {
      const previous = await createDocumentWithLoadedSession("ODE577-ANTERIOR")
      resetEditorSessionStoreForTests()

      const hold = holdSessionRead()
      mounted = await mountEditorShell()
      await hold.started
      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE577-NUEVO")
      hold.release()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })

      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE577-NUEVO")
      const created = await waitFor(
        () => {
          const writing = activeTab()?.writing_id
          return writing && writing !== previous ? writing : null
        },
        { label: "el borrador nuevo es la pestaña activa y tiene identidad", timeoutMs: 15_000 },
      )

      const tabs = getEditorSessionState().session.tabs.map((tab) => tab.writing_id)
      expect(tabs, "la pestaña persistida no se pierde").toContain(previous)
      expect(tabs, "y el documento nuevo está a su lado").toContain(created)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await readEditorSession()).tabs.some((tab) => tab.writing_id === created)) break
        await advance(100)
      }
      const persisted = (await readEditorSession()).tabs.map((tab) => tab.writing_id)
      expect(persisted, "y la sesión persistida guarda las dos").toEqual(expect.arrayContaining([previous, created]))
    },
    TEST_TIMEOUT_MS,
  )
})
