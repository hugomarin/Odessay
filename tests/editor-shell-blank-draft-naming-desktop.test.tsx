/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 caso 3 y follow-ups — En desktop, nombrar un borrador
 * todavía en blanco es una señal tan deliberada como escribir: renombrarlo,
 * añadirle una imagen, abrir "Insert image" o elegir un nombre en el "Save
 * As" nativo lo materializan por el camino normal de escritura, y la UI solo
 * informa éxito cuando el documento es durable.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-empty-draft-persistence.test.tsx`, que llamaba a mano al
 * `onConfirm` de un modal de renombrado falso, al `onRunAction` de una
 * cabecera falsa y a los callbacks capturados de `useTauriMenuEvents`, con un
 * `relocateDesktopWriting` falso. Aquí todo es de producción: el lápiz de la
 * pestaña y el modal de renombrado reales, la acción "image" y "Save As" por
 * el bus de menú nativo (`emitTauriEvent`), la materialización y el traslado
 * reales sobre el workspace temporal. Lo único controlado es la creación del
 * borrador (`createDesktopDraftOverride`, que delega en la de producción o
 * falla) y la respuesta del diálogo nativo de guardado.
 *
 * Mutation test (ODE-574): cada caso nombra en su comentario la mutación que
 * lo pone en rojo.
 */
import { basename, dirname, join } from "node:path"
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
const {
  advance,
  clickNewArtifact,
  emitTauriEvent,
  flush,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { STARTER_DOCUMENTS, STARTER_DOCUMENT_IDS } = await import("@/lib/services/desktop/starter-documents")
const STARTER_FILENAMES = new Set(STARTER_DOCUMENTS.map((doc) => doc.filename))
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000
const RENAME_FAILURE = "Could not save this name. Try again."

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-blank-draft-naming-")
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

/** Monta la shell, espera la sesión y abre un borrador en blanco con "New Artifact". */
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

/**
 * Los documentos de bienvenida que siembra el primer arranque (ODE-449, el
 * reconciliador del workspace) no son de esta prueba: se excluyen del disco y
 * del catálogo. La propiedad sigue siendo "un solo documento del usuario".
 */
async function userMarkdown() {
  return (await readWorkspaceMarkdown()).filter(
    (file) => !STARTER_FILENAMES.has(basename(file.path)) || basename(dirname(file.path)) !== "artifact-studio-managed",
  )
}

async function catalogRows() {
  return (await (await getDocumentCatalog()).list()).filter((row) => !STARTER_DOCUMENT_IDS.has(row.id))
}

function renameInput() {
  return document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]')
}

function saveNameButton() {
  return Array.from(document.querySelectorAll<HTMLButtonElement>('button[type="button"]')).find((button) =>
    ["Save name", "Saving…"].includes((button.textContent ?? "").trim()),
  )
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
  const save = await waitFor(() => saveNameButton(), { label: 'botón "Save name"' })
  await act(async () => {
    save.click()
  })
  await flush(2)
}

describe("ODE-478 caso 3 — nombrar un borrador todavía en blanco", () => {
  it(
    "renombrar un borrador sin contenido lo materializa con ese nombre",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, ignorar el título
      // explícito (`hasExplicitTitle = false`) → rojo.
      await mountWithBlankDraft()
      await renameActiveTab("Nombre que yo quería")

      await waitFor(() => !renameInput(), { label: "el modal se cierra", timeoutMs: 15_000 })
      const rows = await catalogRows()
      expect(rows, "una fila en el catálogo").toHaveLength(1)
      expect(rows[0]?.title).toBe("Nombre que yo quería")
      expect(await userMarkdown(), "un .md en el workspace").toHaveLength(1)
      await waitFor(() => activeTab()?.writing_id === rows[0]?.id, { label: "la pestaña adopta el documento" })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si la materialización falla, el modal lo dice y sigue abierto, y el borrador sigue siéndolo",
    async () => {
      // Mutación: en `handleRenameWritingConfirm`, devolver `true` sin
      // esperar el resultado de `persistEditorSnapshot` → rojo.
      vi.spyOn(console, "error").mockImplementation(() => {})
      const failing: CreateDesktopDraft = async () =>
        ({ error: { code: "DB_ERROR", message: "disk full" }, data: null }) as Awaited<ReturnType<CreateDesktopDraft>>
      await mountWithBlankDraft(failing)
      await renameActiveTab("Nombre que yo quería")

      await waitFor(() => document.body.textContent?.includes(RENAME_FAILURE), {
        label: "el modal muestra el fallo",
        timeoutMs: 15_000,
      })
      expect(renameInput(), "y sigue abierto").toBeTruthy()
      expect(activeTab()?.writing_id ?? null, "la pestaña sigue siendo un borrador").toBeNull()
      expect(await userMarkdown(), "ningún .md").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "con un guardado ya en vuelo, el modal espera a que el documento sea durable",
    async () => {
      // Mutación: en `handleRenameWritingConfirm` (rama desktop sin
      // documento), quitar `{ awaitDurability: true }` → rojo: el modal se
      // cierra con la escritura todavía en vuelo.
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      const held: CreateDesktopDraft = async (options) => {
        calls += 1
        await released
        return createProductionDesktopDraft(options)
      }
      await mountWithBlankDraft(held)
      await typeInEditor("ODE478-CONTENIDO-REAL")
      await advance(SAVE_WINDOW_MS)
      await waitFor(() => calls === 1, { label: "materialización en vuelo" })

      await renameActiveTab("Título mientras se guarda")
      await advance(1_000)
      expect(renameInput(), "el modal no se cierra mientras la escritura sigue en vuelo").toBeTruthy()
      expect(await userMarkdown(), "nada en disco todavía").toEqual([])

      release()
      await waitFor(() => !renameInput(), { label: "el modal se cierra al ser durable", timeoutMs: 15_000 })
      expect(document.body.textContent ?? "").not.toContain(RENAME_FAILURE)
      await advance(SAVE_WINDOW_MS)
      const file = await waitForMarkdownContaining("ODE478-CONTENIDO-REAL")
      const rows = await catalogRows()
      expect(rows, "un solo documento").toHaveLength(1)
      // ODE-585: el nombre elegido mientras la materialización estaba en vuelo
      // es el título final del documento materializado, en el catálogo y en la
      // pestaña (antes se perdía: la materialización nacía "Untitled artifact"
      // y el guardado en cola no renombraba el archivo).
      expect(rows[0]?.title, "el nombre sobrevive en el catálogo").toBe("Título mientras se guarda")
      await waitFor(
        () => activeTab()?.title === "Título mientras se guarda",
        { label: "el nombre sobrevive en la pestaña", timeoutMs: 15_000 },
      )
      expect((await userMarkdown()).map((entry) => entry.path)).toEqual([file.path])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si lo primero que se añade es una imagen, el borrador se materializa",
    async () => {
      // Mutación: en `persistEditorSnapshot`, no pasar la señal estructural
      // `bodyIsEmpty` (queda solo `bodyText`, vacío con una imagen) → rojo.
      await mountWithBlankDraft()
      const editor = mounted!.editor()
      await act(async () => {
        editor.commands.insertContent({ type: "image", attrs: { src: "https://example.com/photo.png" } })
      })
      expect(editor.getText(), "una imagen no tiene texto").toBe("")
      await advance(SAVE_WINDOW_MS)

      await waitFor(() => activeTab()?.writing_id ?? null, { label: "la pestaña se materializa", timeoutMs: 15_000 })
      const files = await userMarkdown()
      expect(files, "un .md").toHaveLength(1)
      expect(files[0]?.contents, "con la imagen").toContain("photo.png")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    '"Insert image" sobre un borrador en blanco lo materializa antes de abrir el modal',
    async () => {
      // Mutación: en `openInsertImageModal`, abrir el modal sin materializar
      // antes → rojo.
      await mountWithBlankDraft()
      await emitTauriEvent("menu:image")

      await waitFor(() => document.body.textContent?.includes("Insert image"), {
        label: "el modal de imagen se abre",
        timeoutMs: 15_000,
      })
      expect(activeTab()?.writing_id, "cuando el modal se abre, el documento ya tiene identidad").toEqual(
        expect.any(String),
      )
      expect(await userMarkdown(), "y está en disco").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )
})

describe('ODE-478 follow-up — "Save As" sobre un borrador todavía efímero', () => {
  it(
    "un borrador en blanco también abre el selector nativo: elegir un nombre es nombrarlo",
    async () => {
      // Mutación: en `handleGetSaveContent`, devolver `null` si el cuerpo está
      // vacío → rojo.
      await mountWithBlankDraft()
      world.saveDialogResult = null
      await emitTauriEvent("menu:save-as")

      await waitFor(() => world.saveDialogCalls.length === 1, { label: "el selector nativo se abre" })
      await advance(SAVE_WINDOW_MS)
      expect(await userMarkdown(), "cancelar no escribe nada").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un borrador en blanco se materializa con el nombre de archivo elegido como título",
    async () => {
      // Mutación: en `handleSaveToDisk`, no materializar el borrador sin
      // identidad (`return false`) → rojo.
      await mountWithBlankDraft()
      const chosen = join(desktopWorkspaceRoot(), "elegida", "My Named File.md")
      world.saveDialogResult = chosen
      await emitTauriEvent("menu:save-as")

      await waitFor(() => activeTab()?.title === "My Named File", { label: "la pestaña toma el nombre", timeoutMs: 15_000 })
      await advance(SAVE_WINDOW_MS)
      const files = await userMarkdown()
      expect(files.map((entry) => entry.path), "un solo archivo, en la ruta elegida").toEqual([chosen])
      const rows = await catalogRows()
      expect(rows).toHaveLength(1)
      expect(rows[0]?.title).toBe("My Named File")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "con contenido pero sin identidad todavía, se materializa y después se traslada",
    async () => {
      // Mutación: la misma que el caso anterior → rojo.
      await mountWithBlankDraft()
      await typeInEditor("contenido real antes de guardar")
      expect(await userMarkdown(), "precondición: aún no se materializó").toEqual([])

      const chosen = join(desktopWorkspaceRoot(), "elegida", "My Note.md")
      world.saveDialogResult = chosen
      await emitTauriEvent("menu:save-as")

      await waitFor(() => activeTab()?.title === "My Note", { label: "la pestaña toma el nombre", timeoutMs: 15_000 })
      // Y el autoguardado que ya estaba en cola no crea otro documento.
      await advance(SAVE_WINDOW_MS)
      const files = await userMarkdown()
      expect(files.map((entry) => entry.path), "un solo archivo, en la ruta elegida").toEqual([chosen])
      expect(files[0]?.contents).toContain("contenido real antes de guardar")
      expect(await catalogRows(), "una sola fila").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )
})
