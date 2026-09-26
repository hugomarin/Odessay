/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-478 (casos 2, 4 y 5 y sus follow-ups) y ODE-555 (follow-up) —
 * Las transiciones de pestaña en desktop no pierden, mezclan ni dejan
 * huérfano nada de lo que el usuario escribió.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-shell-tab-switch-persistence.test.tsx`, que montaba la shell
 * con un editor de cartón, dobles de ~40 módulos propios y un topbar falso
 * (`onSelectTab`/`onCloseTab` llamados a mano). Aquí todo es de producción:
 * "New Artifact" real, gestos reales de pestaña y del botón de cerrar,
 * escritura real en TipTap y guardado real a `.md` en un directorio temporal.
 * Lo único controlado es CUÁNDO terminan ciertas operaciones de disco
 * (`createDesktopDraftOverride` delega en la de producción; `holdWriteFile`
 * retiene un write), y un fallo del catálogo nativo (`failCatalogGetById`).
 *
 * De las 7 pruebas del archivo antiguo, 6 están aquí. La de "cambiar de
 * pestaña vuelca la edición en cola al documento saliente" (caso 2) se retira:
 * la cubren `tests/editor-shell-exit-protocol.test.tsx` ("al cambiar de
 * pestaña…") y `tests/editor-shell-save-live-identity.test.tsx` (4b), en
 * desktop y por el camino real. La de ODE-555 (`open-error` no deja la
 * hidratación cargando) se parte en dos, porque cada runtime llega por otro
 * camino: en desktop la apertura va por el opener unificado, y en web por
 * `openWriting`, que es donde vive la rama `open-error`.
 *
 * Mutation test (ODE-574): cada caso nombra en su comentario la mutación que
 * lo pone en rojo.
 */
import { stat } from "node:fs/promises"
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

const {
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { failCatalogGetById, holdWriteFile } = await import("./integration/documents/support/real-desktop-doubles")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { localDB } = await import("@/lib/local-db")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 60_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-tab-transitions-")
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

/**
 * Creación de borradores que deja pasar las primeras `passThrough` llamadas y
 * retiene la siguiente hasta `release()`, como un disco lento.
 */
function holdDraftCreation(passThrough = 0) {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const create: CreateDesktopDraft = async (options) => {
    calls += 1
    if (calls > passThrough) await released
    return createProductionDesktopDraft(options)
  }
  return { create, release, calls: () => calls }
}

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

function tabs() {
  return getEditorSessionState().session.tabs
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function tabNode(tabId: string) {
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabId}"]`)
  if (!node) throw new Error(`La pestaña ${tabId} no está en el DOM`)
  return node
}

function closeButton(tabId: string) {
  const button = tabNode(tabId).querySelector<HTMLElement>('button[aria-label^="Close"]')
  if (!button) throw new Error(`La pestaña ${tabId} no tiene botón de cerrar`)
  return button
}

/** Crea un documento real y espera a que su pestaña tenga identidad. */
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

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

describe("ODE-574 — transiciones de pestaña en desktop (ODE-478)", () => {
  it(
    "salir de un borrador que se materializa y volver: no se pierde lo escrito, queda una pestaña y editar no crea otro archivo",
    async () => {
      // Mutación: no conservar el snapshot del borrador al salir
      // (`snapshotDraft: false` en la selección) → el editor vuelve vacío.
      const held = holdDraftCreation(1)
      await mountLoaded(held.create)
      const other = await createDocument("ODE574-OTRO-DOCUMENTO")

      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE574-NOTA-RAPIDA")
      await pointerClick(tabNode(other.writingId))
      await waitFor(() => held.calls() >= 2, { label: "materialización del borrador en curso", timeoutMs: 15_000 })

      await pointerClick(tabNode(EDITOR_DRAFT_TAB_ID))
      await waitFor(() => mounted!.editor().getText().includes("ODE574-NOTA-RAPIDA"), {
        label: "el borrador conserva lo escrito al volver",
      })

      held.release()
      const draftFile = await waitForMarkdownContaining("ODE574-NOTA-RAPIDA")
      await waitFor(() => tabs().length === 2 && tabs().every((tab) => tab.writing_id), {
        label: "dos pestañas, ambas con identidad",
        timeoutMs: 15_000,
      })

      await typeInEditor(" URGENTE")
      await advance(6_000)
      await waitForMarkdownContaining("URGENTE")
      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path).sort(), "ningún archivo de más").toEqual(
        [other.file.path, draftFile.path].sort(),
      )
      expect(held.calls(), "no se creó un segundo borrador").toBe(2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "New Artifact con una edición en cola en el borrador: la edición llega a su archivo",
    async () => {
      // Mutación: `flushPendingEdit: false` en la creación desktop → el
      // borrador se materializa sin lo último escrito.
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE574-NOTA-ANTES-DE-OTRA")
      await clickNewArtifact(mounted!.container)
      await advance(6_000)
      await waitForMarkdownContaining("ODE574-NOTA-ANTES-DE-OTRA")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cerrar una pestaña con su guardado en vuelo: sigue abierta y en Saving hasta que el write termina",
    async () => {
      // Mutación: no esperar `persistenceCoordinator.settle` al cerrar → la
      // pestaña desaparece antes de que el write termine.
      await mountLoaded()
      const doc = await createDocument("ODE574-DOCUMENTO-A")
      await typeInEditor(" ODE574-EDICION-AL-CERRAR")

      // Por nombre de archivo: en macOS el temporal puede llegar como /var o
      // como /private/var.
      const fileName = doc.file.path.split("/").pop()!
      const held = holdWriteFile((path) => path.endsWith(`/${fileName}`))
      await pointerClick(closeButton(doc.writingId))
      await held.started
      await flush(5)

      const tab = tabs().find((candidate) => candidate.writing_id === doc.writingId)
      expect(tab, "la pestaña sigue abierta mientras se guarda").toBeTruthy()
      expect(tab?.save_state, "y muestra que está guardando").toBe("saving")

      held.release()
      await waitFor(() => !tabs().some((candidate) => candidate.writing_id === doc.writingId), {
        label: "la pestaña se cierra al terminar el write",
        timeoutMs: 15_000,
      })
      await waitForMarkdownContaining("ODE574-EDICION-AL-CERRAR")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cerrar un borrador cuya materialización termina en mitad del cierre: no queda ninguna pestaña suya",
    async () => {
      // Mutación: cerrar por el id `draft` capturado antes del `await`, en
      // vez de por su identidad tras materializarse → sobrevive la pestaña.
      const held = holdDraftCreation(0)
      await mountLoaded(held.create)
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE574-CERRAR-MIENTRAS-SE-MATERIALIZA")

      await pointerClick(closeButton(EDITOR_DRAFT_TAB_ID))
      await waitFor(() => held.calls() >= 1, { label: "materialización en curso", timeoutMs: 15_000 })
      held.release()

      const file = await waitForMarkdownContaining("ODE574-CERRAR-MIENTRAS-SE-MATERIALIZA")
      await waitFor(() => tabs().length === 0, { label: "no queda ninguna pestaña", timeoutMs: 15_000 })
      expect(await exists(file.path), "el archivo se conserva").toBe(true)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "abrir un documento cuya lectura del catálogo falla: la hidratación no se queda cargando",
    async () => {
      // En desktop la apertura va por el opener unificado
      // (`isUnifiedOpenEnabled()` es `isDesktopRuntime()`), no por el
      // `openWriting` cuyo error es `open-error`: la prueba antigua lo
      // desactivaba con un doble y probaba un camino que desktop no usa. Aquí
      // el fallo es el real (el catálogo nativo no responde): el opener
      // reintenta (4 intentos), lo da por `unavailable`, la shell retira la
      // pestaña de B y vuelve a A, y la fase debe salir a `ready`.
      // Mutación: no llamar a `recoverUnavailableTab()` en la rama
      // `unavailable` de `hooks/useDocumentHydration.ts` → la fase se queda en
      // `loading` y B sigue abierta.
      await mountLoaded()
      const a = await createDocument("ODE574-DOCUMENTO-A")
      const b = await createDocument("ODE574-DOCUMENTO-B")
      await pointerClick(tabNode(a.writingId))
      await waitFor(() => mounted!.editor().getText().includes("ODE574-DOCUMENTO-A"), { label: "A activo" })

      failCatalogGetById(b.writingId, () => {
        throw new Error("catalog_get_by_id: database is locked")
      })
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
      // Registra la fase en cada commit: sin ver `loading`, la prueba podría
      // pasar sin que la apertura de B llegara a empezar.
      const phases: string[] = []
      world.onShellCommit = () => {
        const phase = document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase")
        if (phase && phases[phases.length - 1] !== phase) phases.push(phase)
      }
      await pointerClick(tabNode(b.writingId))

      // Deja correr los reintentos del opener (backoff con jitter).
      for (let step = 0; step < 12; step += 1) {
        await advance(2_000)
        if (phases.includes("loading") && phases[phases.length - 1] === "ready") break
      }
      world.onShellCommit = null
      expect(phases, "la apertura de B arranca y la fase sale a ready").toEqual(["loading", "ready"])
      expect(tabs().some((tab) => tab.writing_id === b.writingId), "la pestaña de B se retira").toBe(false)
      expect(activeTab()?.writing_id, "y vuelve a A").toBe(a.writingId)
      errorSpy.mockRestore()
      infoSpy.mockRestore()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cerrar una pestaña mientras el borrador de otra se materializa: se abre la pestaña de fondo ya renombrada",
    async () => {
      // Mutación: buscar la pestaña siguiente en la lista de pestañas de
      // antes del `await` del cierre → se abre un borrador vacío o nada.
      const held = holdDraftCreation(1)
      await mountLoaded(held.create)
      const a = await createDocument("ODE574-DOCUMENTO-A")

      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE574-NOTA-DE-FONDO")
      await pointerClick(tabNode(a.writingId))
      await waitFor(() => held.calls() >= 2, { label: "materialización del borrador en curso", timeoutMs: 15_000 })
      await waitFor(() => mounted!.editor().getText().includes("ODE574-DOCUMENTO-A"), { label: "A activo" })

      await typeInEditor(" ODE574-EDICION-DE-A")
      const restoreLog = vi.spyOn(console, "info")
      await pointerClick(closeButton(a.writingId))
      held.release()

      const draftFile = await waitForMarkdownContaining("ODE574-NOTA-DE-FONDO")
      await waitForMarkdownContaining("ODE574-EDICION-DE-A")
      await waitFor(() => tabs().length === 1 && !tabs().some((tab) => tab.writing_id === a.writingId), {
        label: "solo queda la pestaña del borrador",
        timeoutMs: 15_000,
      })
      await waitFor(() => mounted!.editor().getText().includes("ODE574-NOTA-DE-FONDO"), {
        label: "el editor muestra el borrador de fondo",
        timeoutMs: 15_000,
      })
      expect(tabs()[0].writing_id, "con su identidad definitiva").toBeTruthy()
      expect(draftFile.contents).toContain("ODE574-NOTA-DE-FONDO")
      expect(
        restoreLog.mock.calls.some((call) => String(call[0]).includes("[editor:session-restore] restorable")),
        "sin el rodeo de la restauración de sesión",
      ).toBe(false)
      restoreLog.mockRestore()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-574 — open-error en web (ODE-555)", () => {
  it(
    "un documento cuya lectura local falla (open-error): la hidratación sale a ready",
    async () => {
      // Excepción declarada al contrato de dobles: el fallo es del
      // almacenamiento del navegador (IndexedDB), un boundary externo, pero
      // `fake-indexeddb` no permite hacer fallar la lectura de una clave
      // concreta, así que se simula en el punto más cercano,
      // `localDB.writings.get`, solo para B. Con eso `openWriting` devuelve
      // `DB_ERROR` y la hidratación lo clasifica como `open-error`, la rama
      // que en web solo se alcanza así.
      // Mutación: no llamar a `finishHydration()` en la rama `open-error` de
      // `hooks/useDocumentHydration.ts` → la fase se queda en `loading`.
      const { localDB } = await import("@/lib/local-db")
      type LocalWriting = Parameters<typeof localDB.writings.save>[0]
      const writingA = crypto.randomUUID()
      const writingB = crypto.randomUUID()
      const makeLocalWriting = (id: string, text: string) =>
        ({
          id,
          title: text,
          body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
          body_text: text,
          status: "draft",
          visibility: "private",
          version: 1,
          sync_status: "synced",
          lifecycle: "server-confirmed",
          created_at: "2026-09-20T00:00:00.000Z",
          updated_at: "2026-09-20T00:00:00.000Z",
          local_updated_at: Date.now(),
        }) as LocalWriting
      await localDB.writings.save(makeLocalWriting(writingA, "ODE574-WEB-A"))
      await localDB.writings.save(makeLocalWriting(writingB, "ODE574-WEB-B"))

      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("ODE574-WEB-A"), { label: "A hidratado" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => mounted!.editor().getText().includes("ODE574-WEB-B"), { label: "B hidratado" })
      await pointerClick(tabNode(tabs().find((tab) => tab.writing_id === writingA)!.id))
      await waitFor(() => mounted!.editor().getText().includes("ODE574-WEB-A"), { label: "de vuelta en A" })

      const realGet = localDB.writings.get.bind(localDB.writings)
      const getSpy = vi.spyOn(localDB.writings, "get").mockImplementation(async (id: string) => {
        if (id === writingB) throw new Error("IndexedDB: read failed")
        return realGet(id)
      })
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const phases: string[] = []
      world.onShellCommit = () => {
        const phase = document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase")
        if (phase && phases[phases.length - 1] !== phase) phases.push(phase)
      }

      await pointerClick(tabNode(tabs().find((tab) => tab.writing_id === writingB)!.id))
      await waitFor(() => phases.includes("loading") && phases[phases.length - 1] === "ready", {
        label: "la fase pasa por loading y sale a ready",
        timeoutMs: 10_000,
      })
      world.onShellCommit = null

      expect(
        errorSpy.mock.calls.some((call) => String(call[0]).includes("[editor] openWriting failed")),
        "pasó por la rama open-error",
      ).toBe(true)
      expect(activeTab()?.writing_id, "B sigue activa").toBe(writingB)
      errorSpy.mockRestore()
      getSpy.mockRestore()
    },
    TEST_TIMEOUT_MS,
  )
})
