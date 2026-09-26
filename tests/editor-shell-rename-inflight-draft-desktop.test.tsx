/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-585 — En desktop, renombrar un borrador cuya materialización
 * ya está en vuelo deja el documento con ese nombre (archivo, catálogo y
 * pestaña), y el modal solo informa éxito si el nombre quedó aplicado.
 *
 * Qué pasaba: el modal esperaba a que el documento fuera durable y se cerraba
 * con éxito, pero el nombre se perdía. La materialización en vuelo nace como
 * "Untitled artifact"; el título del renombrado viajaba como override de un
 * guardado en cola, y en desktop `saveWriting` conserva la ruta canónica: el
 * título sale del nombre del `.md`. Renombrar un documento con archivo exige
 * `renameWriting`, que mueve el archivo.
 *
 * Camino de producción: "New Artifact" real, escritura real en TipTap, lápiz
 * de la pestaña y modal de renombrado reales, materialización y renombrado
 * reales en el workspace temporal (`rename_file` doblado por el dueño
 * canónico, fiel al comando Rust). Lo único controlado es CUÁNDO termina la
 * creación del borrador (`createDesktopDraftOverride`, que delega en la de
 * producción) y, en un caso, que el renombrado del archivo falle.
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

const { act } = await import("react")
const { advance, clickNewArtifact, flush, mountEditorShell, pointerClick, resetEditorShellWorld, typeInEditor, waitFor, waitForMarkdownContaining } =
  await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { failNextRenameFile } = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000
const RENAME_FAILURE = "Could not save this name. Try again."
const BODY = "ODE585-CONTENIDO-REAL"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-rename-inflight-draft-")
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

type CreateDesktopDraft = typeof createProductionDesktopDraft

/** Creación de borradores que se retiene hasta `release()`, como un disco lento. */
function holdDraftCreation() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const create: CreateDesktopDraft = async (options) => {
    calls += 1
    await released
    return createProductionDesktopDraft(options)
  }
  return { create, release, calls: () => calls }
}

async function mountWithBlankDraft(createDesktopDraftOverride?: CreateDesktopDraft) {
  mounted = await mountEditorShell({ createDesktopDraftOverride })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  return mounted
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

async function catalogRows() {
  return (await getDocumentCatalog()).list()
}

function renameInput() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]')
}

/** Abre el modal real con el lápiz de la pestaña activa, escribe el nombre y pulsa "Save name". */
async function renameActiveTab(title: string) {
  const tab = activeTab()
  if (!tab) throw new Error("No hay pestaña activa")
  const pencil = document
    .querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
    ?.querySelector<HTMLElement>('button[aria-label^="Rename"]')
  if (!pencil) throw new Error("La pestaña activa no tiene lápiz de renombrar")
  await pointerClick(pencil)
  const input = await waitFor(() => renameInput(), { label: "modal de renombrado abierto" })
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, title)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  const save = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]')).find(
        (button) => (button.textContent ?? "").trim() === "Save name",
      ),
    { label: 'botón "Save name"' },
  )
  await act(async () => {
    save.click()
  })
  await flush(2)
}

/** Borrador con contenido cuya materialización queda en vuelo, retenida. */
async function draftWithMaterializationInFlight() {
  const hold = holdDraftCreation()
  await mountWithBlankDraft(hold.create)
  await typeInEditor(BODY)
  await advance(SAVE_WINDOW_MS)
  await waitFor(() => hold.calls() === 1, { label: "materialización en vuelo" })
  return hold
}

describe("ODE-585 — renombrar un borrador con la materialización en vuelo", () => {
  it(
    "el documento queda con el nombre elegido: archivo, catálogo y pestaña",
    async () => {
      const hold = await draftWithMaterializationInFlight()
      await renameActiveTab("Título mientras se guarda")
      expect(renameInput(), "el modal espera a que el documento sea durable").toBeTruthy()

      hold.release()
      await waitFor(() => !renameInput(), { label: "el modal se cierra", timeoutMs: 15_000 })
      expect(document.body.textContent ?? "").not.toContain(RENAME_FAILURE)

      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path.split("/").pop()), "un solo archivo, con ese nombre").toEqual([
        "Título mientras se guarda.md",
      ])
      expect(files[0]?.contents, "con lo escrito").toContain(BODY)
      const rows = await catalogRows()
      expect(rows, "un solo documento").toHaveLength(1)
      expect(rows[0]?.title, "el catálogo tiene el nombre").toBe("Título mientras se guarda")
      await waitFor(() => activeTab()?.title === "Título mientras se guarda", { label: "la pestaña tiene el nombre" })

      // Y sigue siendo el mismo documento al seguir escribiendo.
      await typeInEditor(" ODE585-DESPUES")
      await advance(SAVE_WINDOW_MS)
      const after = await waitForMarkdownContaining("ODE585-DESPUES")
      expect(after.path, "lo escrito después va al archivo renombrado").toBe(files[0]?.path)
      expect(await readWorkspaceMarkdown()).toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si el renombrado del archivo falla, el modal lo dice y sigue abierto",
    async () => {
      vi.spyOn(console, "error").mockImplementation(() => {})
      const hold = await draftWithMaterializationInFlight()
      failNextRenameFile(() => {
        throw new Error("EACCES: permission denied")
      })
      await renameActiveTab("Título que no se aplica")

      hold.release()
      await waitFor(() => document.body.textContent?.includes(RENAME_FAILURE), {
        label: "el modal muestra el fallo",
        timeoutMs: 15_000,
      })
      expect(renameInput(), "y sigue abierto").toBeTruthy()
      const files = await readWorkspaceMarkdown()
      expect(files, "el documento está a salvo, con su nombre de antes").toHaveLength(1)
      expect(files[0]?.contents).toContain(BODY)
      expect(files[0]?.path.split("/").pop()).not.toBe("Título que no se aplica.md")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "sin nada en vuelo, renombrar un borrador en blanco lo materializa con ese nombre una sola vez",
    async () => {
      await mountWithBlankDraft()
      await renameActiveTab("Nombre que yo quería")
      await waitFor(() => !renameInput(), { label: "el modal se cierra", timeoutMs: 15_000 })

      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path.split("/").pop()), "sin sufijo de colisión").toEqual([
        "Nombre que yo quería.md",
      ])
      const rows = await catalogRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.title).toBe("Nombre que yo quería")
    },
    TEST_TIMEOUT_MS,
  )
})
