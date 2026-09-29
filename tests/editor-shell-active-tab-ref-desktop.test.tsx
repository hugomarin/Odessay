/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — `activeEditorTabIdRef` con un solo escritor (opción B de ODE-608)
 * en los caminos de desktop.
 *
 * Property 3 (materialización, sin regresión de ODE-577): al materializar un
 * borrador, el renombre del store (`reconcileMaterializedDraftTab`) cambia el
 * id de la pestaña y la copia lo sigue en el acto; el documento se adopta y
 * seguir escribiendo va al mismo archivo. En la ventana de commit del renombre,
 * cerrar la pestaña ya la reconoce como la activa y devuelve el documento a la
 * pestaña anterior.
 *
 * Property 4 (onError, riesgo 2 del análisis B, único cambio de comportamiento
 * aceptado): un error de guardado de la pestaña vieja que llega en la ventana
 * entre el cambio del store y el render ya no pinta `error` en la barra de
 * estado global; el badge de esa pestaña sí. Con el espejo (código de `main`),
 * la barra sí se pintaba de error.
 *
 * Camino de producción: shell real en modo desktop, "New Artifact" real,
 * escritura real en TipTap y guardado real a `.md` en un directorio temporal.
 * Lo único controlado es CUÁNDO termina el write retenido (`holdWriteFile`) y
 * su fallo (`failNextWriteFile`), dobles declarados de ODE-574/ODE-461.
 *
 * Mutation test (ODE-609):
 *   - quitar la suscripción al store → rojas la materialización (el borrador no
 *     se adopta y el segundo guardado crea otro documento) y la copia (el
 *     renombre no se ve en la ventana);
 *   - código de `main` (espejo + escrituras manuales) → roja la copia (el
 *     cierre en la ventana no reconoce la pestaña renombrada).
 *
 * La prueba de `onError` no discrimina el espejo en el harness: ahí el flush
 * pasivo del espejo gana la carrera de microtasks contra la cadena de error
 * del coordinador, así que el código de `main` también termina sin pintar la
 * barra. Fija el comportamiento aceptado (barra sin el error ajeno; badge de
 * la pestaña vieja en error) con su control positivo del fallo registrado; el
 * cambio de timing está documentado en el ADR (riesgo 2 de ODE-608).
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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
  dispatchPointerClick,
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
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { failNextWriteFile, holdCatalogReads, holdWriteFile, tauriOpenFileDouble } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = 6_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-active-tab-ref-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  world.onShellCommit = null
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function tabs() {
  return getEditorSessionState().session.tabs
}

function tabFor(writingId: string) {
  return tabs().find((tab) => tab.writing_id === writingId)
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function activeWritingId() {
  return activeTab()?.writing_id ?? null
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

/** Lo que muestra la status bar, traducido a `EditorSaveState`. */
function barSaveState() {
  const label = mounted?.container
    .querySelector('[data-testid="editor-statusbar"] [aria-live="polite"]')
    ?.textContent?.trim()
  if (label === undefined) return null
  const byLabel: Record<string, string> = {
    Saved: "saved",
    "Saving...": "saving",
    "Saved locally": "saved-local",
    "Needs attention": "error",
  }
  return byLabel[label] ?? `desconocido: ${label}`
}

/** Crea un documento real con contenido y devuelve su id y su `.md`. */
async function createDocument(text: string) {
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining(text)
  const writingId = await waitFor(
    () => {
      const tab = activeTab()
      return tab?.writing_id && tab.writing_id !== EDITOR_DRAFT_TAB_ID ? tab.writing_id : null
    },
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  return { writingId, file }
}

describe("ODE-609 — activeEditorTabIdRef dueño único en desktop", () => {
  it(
    "materializar un borrador: el documento se adopta y seguir escribiendo va al mismo archivo (sin regresión de ODE-577)",
    async () => {
      // Mutación: quitar la suscripción al store → rojo: `onMaterialized` no
      // adopta el borrador (la copia no vale el id del draft), la identidad
      // efímera se limpia y el siguiente guardado crea otro documento.
      mounted = await mountEditorShell()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await flush(3)

      const first = await createDocument("ODE609-MATERIALIZA")
      await typeInEditor(" ODE609-SEGUNDO")
      await advance(SAVE_WINDOW_MS)
      const second = await waitForMarkdownContaining("ODE609-SEGUNDO")
      expect(second.path, "el segundo guardado llega al mismo archivo").toBe(first.file.path)
      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path), "un solo documento").toEqual([first.file.path])
      expect(activeWritingId(), "el documento activo es el materializado").toBe(first.writingId)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la copia sigue al id real: cerrar la pestaña renombrada en la ventana del commit devuelve el documento a la anterior",
    async () => {
      // Mutación: código de `main` (espejo + escrituras manuales) o quitar la
      // suscripción → rojo: en la ventana del renombre la copia todavía vale el
      // id de borrador (o null), el cierre no reconoce la pestaña activa y el
      // editor se queda en el documento cerrado.
      mounted = await mountEditorShell()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await flush(3)

      const a = await createDocument("ODE609-ANTERIOR")

      const probe = { fired: false }
      world.onShellCommit = () => {
        if (probe.fired) return
        const tab = activeTab()
        if (!tab || tab.id === EDITOR_DRAFT_TAB_ID || tab.writing_id === a.writingId) return
        if (!document.querySelector(`[data-editor-tab-id="${tab.id}"]`)) return
        probe.fired = true
        dispatchPointerClick(closeButton(tab.id))
      }

      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE609-BORRADOR")
      await advance(SAVE_WINDOW_MS)
      await waitFor(() => probe.fired, {
        label: "la ventana del commit que renombra el borrador",
        timeoutMs: 15_000,
      })
      world.onShellCommit = null

      const bFile = await waitForMarkdownContaining("ODE609-BORRADOR")
      await waitFor(() => tabs().length === 1, { label: "el borrador renombrado se cierra" })
      await waitFor(() => activeWritingId() === a.writingId, {
        label: "A vuelve a ser el documento activo",
        timeoutMs: 10_000,
      })
      await waitFor(() => mounted!.editor().getText().includes("ODE609-ANTERIOR"), {
        label: "el editor vuelve al documento de A",
        timeoutMs: 10_000,
      })
      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path).sort(), "los dos documentos, sin duplicados").toEqual(
        [a.file.path, bFile.path].sort(),
      )
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un error de guardado de la pestaña vieja en la ventana del cambio no pinta la barra global",
    async () => {
      // Fija el comportamiento aceptado (único cambio de B): un error de la
      // pestaña vieja que llega en la ventana del cambio no pinta la barra
      // global; el badge de esa pestaña sí. Con el código de `main` el harness
      // no reproduce el rojo de forma determinista (su flush pasivo gana la
      // carrera de microtasks), así que la prueba no discrimina el espejo: su
      // valor es fijar la conducta con sus controles positivos (el fallo queda
      // registrado y el store ya cambió a B).
      mounted = await mountEditorShell()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await flush(3)

      const a = await createDocument("ODE609-ONERROR-A")
      const b = await createDocument("ODE609-ONERROR-B")

      // A activo con una edición todavía en cola (sin avanzar: el debounce no
      // corre antes del opener).
      await pointerClick(tabNode(tabFor(a.writingId)!.id))
      await waitFor(() => mounted!.editor().getText().includes("ODE609-ONERROR-A"), {
        label: "A activo con su contenido",
      })
      await typeInEditor(" ODE609-FALLA")

      // El volcado de salida de A queda retenido y falla al liberarlo en la
      // ventana de commit en la que B ya es el documento activo.
      const held = holdWriteFile((path) => path === a.file.path)
      failNextWriteFile(
        (path) => path === a.file.path,
        () => {
          throw new Error("database is locked")
        },
      )
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})

      // Se abre B por el camino real del menú nativo, con la lectura del
      // catálogo de B retenida hasta que la sonda la suelta (fase 1). Fase 2:
      // en la ventana de commit con B activo, se libera el write de A.
      world.openDialogResult = b.file.path
      world.tauriInvoke = async (command, args) => {
        if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
        throw new Error(`Comando nativo no previsto en esta prueba: ${command}`)
      }
      const hold = holdCatalogReads((key) => key === b.writingId || key === b.file.path)

      const probe = { releasedRead: false, releasedWrite: false }
      world.onShellCommit = () => {
        if (!probe.releasedRead) {
          probe.releasedRead = true
          hold.release()
          return
        }
        if (probe.releasedWrite || activeWritingId() !== b.writingId) return
        probe.releasedWrite = true
        held.release()
      }

      await emitTauriEvent("menu:open-file")
      await waitFor(() => probe.releasedWrite, {
        label: "ventana de commit con B abierto",
        timeoutMs: 15_000,
      })
      world.onShellCommit = null
      hold.release()

      await waitFor(() => tabFor(a.writingId)?.save_state === "error", {
        label: "el badge de A queda en error",
        timeoutMs: 10_000,
      })
      expect(activeWritingId(), "B sigue siendo el documento activo").toBe(b.writingId)
      expect(barSaveState(), "la barra de estado global no pinta el error ajeno").not.toBe("error")
      expect(
        errors.mock.calls.some(([message]) => message === "[editor:save] local save failed"),
        "el fallo queda registrado con su causa",
      ).toBe(true)
    },
    TEST_TIMEOUT_MS,
  )
})
