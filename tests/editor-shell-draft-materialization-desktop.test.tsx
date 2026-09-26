/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-405 y ODE-461 — En desktop, un borrador solo se vuelve
 * documento con contenido real (nunca al montar ni al restaurar), se
 * materializa una sola vez con una sola identidad, y el guardado posterior no
 * lee el documento en el frame de la tecla, no solapa escrituras y no se queda
 * atascado tras un fallo.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-empty-draft-persistence.test.tsx`, que montaba la shell con un
 * editor de cartón (`onUpdate` llamado a mano), ~40 módulos doblados y un
 * `createDesktopDraft` falso que solo contaba llamadas. Aquí la escritura es
 * real en TipTap, el borrador se materializa por el servicio de producción y
 * las aserciones van contra el disco y el catálogo del workspace temporal. Lo
 * único controlado es CUÁNDO o SI termina una operación de disco
 * (`createDesktopDraftOverride` delega en la de producción; `holdWriteFile`
 * y `failNextWriteFile` en el dueño canónico de los dobles).
 *
 * Mutation test (ODE-574): cada caso nombra en su comentario la mutación que
 * lo pone en rojo.
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
const {
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { failNextWriteFile, holdWriteFile, writeFileCalls } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState, resetEditorSessionStoreForTests } = await import("@/lib/stores/editor-session-store")
const { readEditorSession, writeEditorSession } = await import("@/lib/editor/session-persistence")
const { EDITOR_DRAFT_TAB_ID, createEditorSessionTab, createEmptyEditorSession } = await import(
  "@/lib/local-db/editor-sessions"
)
const { localDB } = await import("@/lib/local-db")

const TEST_TIMEOUT_MS = 60_000
/** Lo que tarda un guardado de desktop en arrancar, con margen. */
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-draft-materialization-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // La sesión persistida vive en fake-indexeddb, que el harness no limpia:
  // sin esto, la pestaña de una prueba se restauraría en la siguiente.
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

type CreateDesktopDraft = typeof createProductionDesktopDraft

/**
 * Retiene la lectura de la sesión persistida para actuar determinísticamente
 * antes de que cargue (ODE-577). Sin esto, la lectura (rápida en
 * fake-indexeddb) suele completar durante el montaje y el test actúa tras la
 * carga sin ejercitar la ventana pre-carga.
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

/**
 * Monta la shell reteniendo la sesión para que las acciones iniciales del
 * test ocurran determinísticamente pre-carga (ODE-577). La lectura se suelta
 * sola tras la ventana de acciones; el replay asienta en segundo plano.
 */
async function mountLoaded(createDesktopDraftOverride?: CreateDesktopDraft) {
  const hold = holdSessionRead()
  mounted = await mountEditorShell({ createDesktopDraftOverride })
  await hold.started
  expect(getEditorSessionState().loaded, "pre-carga: la sesión todavía no cargó").toBe(false)
  await flush(3)
  setTimeout(() => hold.release(), 2_000)
  return mounted
}

/**
 * Monta la shell esperando a que cargue la sesión. Espera legítima (no rodeo
 * ODE-577): estos tests miden restauración post-carga (reabrir por UUID,
 * restaurar borrador, remontar vacío), no acciones pre-carga.
 */
async function mountSettled() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada para restaurar" })
  await flush(3)
  return mounted
}

function tabs() {
  return getEditorSessionState().session.tabs
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

async function catalogRows() {
  return (await getDocumentCatalog()).list()
}

/** Crea un documento real y espera a que su pestaña adopte su identidad (ODE-577). */
async function createDocument(text: string) {
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(6_000)
  const file = await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => {
      const writing = activeTab()?.writing_id
      return writing && writing !== EDITOR_DRAFT_TAB_ID ? writing : null
    },
    { label: "pestaña activa con identidad", timeoutMs: 15_000 },
  )
  return { writingId, file }
}

function writesTo(path: string) {
  return writeFileCalls().filter((call) => call.path === path)
}

describe("ODE-405 — un borrador de desktop solo se materializa con contenido real", () => {
  it(
    "al relanzar, la pestaña guardada se reabre por su UUID y no nace un borrador",
    async () => {
      // Mutación: en `editor-shell.tsx`, no llamar a `activateDocument(…,
      // "restore")` en la rama `desktop-hydration` del restore → rojo.
      await mountSettled()
      const { writingId, file } = await createDocument("ODE405-RESTAURADO")
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const persisted = await readEditorSession()
        if (persisted.tabs.some((tab) => tab.writing_id === writingId)) break
        await advance(100)
      }

      // Relanzar la app: otra shell y el store de sesión desde cero.
      await mounted!.unmount()
      mounted = null
      resetEditorSessionStoreForTests()
      const info = vi.spyOn(console, "info")
      await mountSettled()

      await waitFor(() => mounted!.editor().getText().includes("ODE405-RESTAURADO"), {
        label: "el documento restaurado en el editor",
        timeoutMs: 10_000,
      })
      expect(activeTab()?.writing_id, "la pestaña activa es la del documento").toBe(writingId)
      const restored = new RegExp(`^\\[editor:session-restore\\] hydrated ${writingId} duration_ms=\\d+$`)
      await waitFor(() => info.mock.calls.some(([line]) => restored.test(String(line))), {
        label: "restore registrado con su duración",
      })
      await advance(SAVE_WINDOW_MS)
      expect((await readWorkspaceMarkdown()).map((entry) => entry.path), "ningún archivo nuevo").toEqual([file.path])
      expect(await catalogRows(), "ninguna fila nueva").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "una pestaña de borrador guardada sin UUID se restaura como borrador y no escribe nada",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, quitar el guard
      // `isBodyBlank && !hasExplicitTitle` → rojo (ver PR).
      await writeEditorSession({
        ...createEmptyEditorSession(),
        active_tab_id: EDITOR_DRAFT_TAB_ID,
        tabs: [createEditorSessionTab({ id: EDITOR_DRAFT_TAB_ID, writingId: null, title: "Untitled", saveState: "saved-local" })],
      })

      await mountSettled()
      await waitFor(() => activeTab()?.id === EDITOR_DRAFT_TAB_ID, { label: "borrador restaurado y activo" })
      await advance(SAVE_WINDOW_MS)

      expect(tabs()).toHaveLength(1)
      expect(tabs()[0]?.writing_id, "sigue siendo un borrador").toBeNull()
      expect(await readWorkspaceMarkdown(), "ningún .md").toEqual([])
      expect(await catalogRows(), "ninguna fila en el catálogo").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "montar y remontar sin contenido no escribe nada ni abre pestañas",
    async () => {
      // Mutación: en `editor-shell.tsx`, quitar el `return` de la rama
      // `remain-empty` del restore → rojo (se abre una pestaña de borrador).
      await mountSettled()
      await advance(SAVE_WINDOW_MS)
      expect(await readWorkspaceMarkdown(), "ningún .md al montar").toEqual([])
      expect(tabs(), "ninguna pestaña al montar").toHaveLength(0)
      expect(getEditorSessionState().session.active_tab_id).toBeNull()

      await mounted!.unmount()
      mounted = null
      await mountSettled()
      await advance(SAVE_WINDOW_MS)
      expect(await readWorkspaceMarkdown(), "ningún .md al remontar").toEqual([])
      expect(await catalogRows(), "ninguna fila en el catálogo").toEqual([])
      expect(tabs(), "ninguna pestaña al remontar").toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la primera escritura real materializa exactamente un documento, y seguir escribiendo no crea otro",
    async () => {
      // Mutación: ver PR.
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE405-PRIMERAS")
      await advance(SAVE_WINDOW_MS)
      const first = await waitForMarkdownContaining("ODE405-PRIMERAS")

      await typeInEditor(" ODE405-SIGUIENTES")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE405-SIGUIENTES")

      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path), "un solo archivo, el del primer guardado").toEqual([first.path])
      const rows = await catalogRows()
      expect(rows, "una sola fila en el catálogo").toHaveLength(1)
      expect(activeTab()?.writing_id, "y es la identidad de la pestaña").toBe(rows[0]?.id)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "New Artifact sobre un documento abierto deja el editor vacío y lo escrito después va a otro archivo",
    async () => {
      // Mutación: en `handleCreateWorkspaceTab`, no vaciar el editor al abrir
      // el borrador nuevo → rojo.
      await mountLoaded()
      const a = await createDocument("ODE405-DOCUMENTO-A")

      await clickNewArtifact(mounted!.container)
      expect(mounted!.editor().getText(), "el editor queda vacío").toBe("")
      expect(activeTab()?.id, "el borrador nuevo es la pestaña activa").toBe(EDITOR_DRAFT_TAB_ID)
      await advance(SAVE_WINDOW_MS)
      expect(await readWorkspaceMarkdown(), "abrir el borrador no crea archivo").toHaveLength(1)

      await typeInEditor("ODE405-DOCUMENTO-NUEVO")
      await advance(SAVE_WINDOW_MS)
      const created = await waitForMarkdownContaining("ODE405-DOCUMENTO-NUEVO")
      expect(created.path, "otro archivo").not.toBe(a.file.path)
      expect(created.contents, "sin el texto de A").not.toContain("ODE405-DOCUMENTO-A")
      const files = await readWorkspaceMarkdown()
      expect(files.find((entry) => entry.path === a.file.path)?.contents, "A no recibe lo nuevo").not.toContain(
        "ODE405-DOCUMENTO-NUEVO",
      )
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "escribir mientras el borrador se materializa no crea una segunda identidad",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, que `pump()` no espere al
      // guardado en vuelo (`if (scheduledKey !== null)`) → rojo.
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
      await mountLoaded(create)
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE405-PRIMERO")
      await advance(SAVE_WINDOW_MS)
      await waitFor(() => calls === 1, { label: "materialización en vuelo" })

      await typeInEditor(" ODE405-DURANTE")
      await advance(SAVE_WINDOW_MS)
      expect(calls, "la escritura durante la materialización espera").toBe(1)

      release()
      const file = await waitForMarkdownContaining("ODE405-DURANTE", 20_000)
      expect(file.contents).toContain("ODE405-PRIMERO")
      expect(calls, "una sola materialización").toBe(1)
      expect(await readWorkspaceMarkdown(), "un solo archivo").toHaveLength(1)
      expect(await catalogRows(), "una sola fila").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "escribir y borrar antes de que guarde no materializa nada",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, quitar el guard
      // `isBodyBlank && !hasExplicitTitle` → rojo.
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      const editor = mounted!.editor()
      await act(async () => {
        editor.commands.insertContent("x")
        editor.commands.deleteRange({ from: 1, to: 2 })
      })
      expect(editor.getText(), "el editor queda vacío").toBe("")
      await advance(SAVE_WINDOW_MS)

      expect(await readWorkspaceMarkdown(), "ningún .md").toEqual([])
      expect(await catalogRows(), "ninguna fila").toEqual([])
      expect(activeTab()?.writing_id ?? null, "la pestaña sigue siendo un borrador").toBeNull()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si la primera materialización falla, el reintento usa la misma identidad",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, pasar un UUID nuevo en vez
      // de `snapshot.draftWritingId` a `createDesktopDraft` → rojo.
      vi.spyOn(console, "error").mockImplementation(() => {})
      const attempts: Array<string | null | undefined> = []
      const create: CreateDesktopDraft = async (options) => {
        attempts.push(options?.writingId)
        if (attempts.length === 1) {
          return { error: { code: "DB_ERROR", message: "temporary failure" }, data: null } as Awaited<
            ReturnType<CreateDesktopDraft>
          >
        }
        return createProductionDesktopDraft(options)
      }
      await mountLoaded(create)
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE405-PRIMER-INTENTO")
      await advance(SAVE_WINDOW_MS)
      await waitFor(() => attempts.length === 1, { label: "primer intento fallido" })
      expect(await readWorkspaceMarkdown(), "el intento fallido no deja archivo").toEqual([])

      await typeInEditor(" ODE405-REINTENTO")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE405-REINTENTO")

      expect(attempts, "dos intentos").toHaveLength(2)
      expect(attempts[0], "con una identidad").toEqual(expect.any(String))
      expect(attempts[1], "la misma").toBe(attempts[0])
      await waitFor(() => activeTab()?.writing_id === attempts[0], { label: "la pestaña adopta esa identidad" })
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-461 — fiabilidad del guardado en desktop", () => {
  it(
    "teclear no lee el documento entero en el frame de la tecla",
    async () => {
      // Mutación: en el `onUpdate` de `useEditor` (`editor-shell.tsx`), volcar
      // la edición en el acto (`flushQueuedRichModeUpdate()`) en vez de
      // diferirla a un frame → rojo.
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      const editor = mounted!.editor()
      const getText = vi.spyOn(editor, "getText")
      const getJSON = vi.spyOn(editor, "getJSON")

      let readsInKeystrokeFrame = { text: -1, json: -1 }
      await act(async () => {
        const before = { text: getText.mock.calls.length, json: getJSON.mock.calls.length }
        editor.commands.insertContent("t")
        editor.commands.insertContent("ratar")
        readsInKeystrokeFrame = {
          text: getText.mock.calls.length - before.text,
          json: getJSON.mock.calls.length - before.json,
        }
      })
      expect(readsInKeystrokeFrame, "ninguna lectura completa dentro de la tecla").toEqual({ text: 0, json: 0 })

      await advance(SAVE_WINDOW_MS)
      const file = await waitForMarkdownContaining("tratar")
      expect(file.contents, "la lectura diferida guarda lo último").toContain("tratar")
      expect(getJSON, "la lectura ocurre, fuera de la tecla").toHaveBeenCalled()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un guardado que se dispara con otro en vuelo espera, y después guarda lo último",
    async () => {
      // Mutación: en `persistence-coordinator.ts`, que `pump()` no espere al
      // guardado en vuelo (`if (scheduledKey !== null)`) → rojo.
      await mountLoaded()
      const { file } = await createDocument("ODE461-PRIMERO")
      const baseline = writesTo(file.path).length

      const held = holdWriteFile((path) => path === file.path)
      await typeInEditor(" ODE461-SEGUNDO")
      await advance(SAVE_WINDOW_MS)
      await held.started

      await typeInEditor(" ODE461-TERCERO")
      await advance(SAVE_WINDOW_MS)
      expect(writesTo(file.path).length - baseline, "solo el guardado retenido está en vuelo").toBe(1)

      held.release()
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE461-TERCERO")
      const writes = writesTo(file.path).slice(baseline)
      expect(writes, "uno en vuelo y uno en cola, no más").toHaveLength(2)
      expect(writes[0]?.content).toContain("ODE461-SEGUNDO")
      expect(writes[0]?.content).not.toContain("ODE461-TERCERO")
      expect(writes[1]?.content, "el de la cola lleva lo último").toContain("ODE461-TERCERO")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un guardado que falla se registra, deja la pestaña en error y no atasca los siguientes",
    async () => {
      // Mutaciones: en el `onError` del coordinador (`editor-shell.tsx`), no
      // marcar la pestaña con `saveState: "error"` → rojo; en
      // `persistence-coordinator.ts`, no liberar `inFlight` en el `finally`
      // de `start()` → rojo.
      await mountLoaded()
      const { file } = await createDocument("ODE461-ANTES")
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})

      failNextWriteFile(
        (path) => path === file.path,
        () => {
          throw new Error("database is locked")
        },
      )
      await typeInEditor(" ODE461-FALLA")
      await advance(SAVE_WINDOW_MS)
      await waitFor(
        () =>
          errors.mock.calls.some(
            ([message, detail]) =>
              message === "[editor:save] local save failed" &&
              (detail as { error?: string } | undefined)?.error === "database is locked",
          ),
        { label: "el fallo queda registrado con su causa" },
      )
      await waitFor(() => activeTab()?.save_state === "error", { label: "la pestaña muestra el error" })

      await typeInEditor(" ODE461-DESPUES")
      await advance(SAVE_WINDOW_MS)
      const saved = await waitForMarkdownContaining("ODE461-DESPUES")
      expect(saved.path, "el siguiente guardado llega al mismo archivo").toBe(file.path)
      await waitFor(() => activeTab()?.save_state !== "error", { label: "y la pestaña sale del error" })
      expect(world.unhandledErrors).toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})
