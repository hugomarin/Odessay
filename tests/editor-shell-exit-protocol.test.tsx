/**
 * @vitest-environment happy-dom
 *
 * ODE-567 — El protocolo de salida del documento activo, por transición.
 *
 * Property: cuando el usuario deja el documento A (cambiando de pestaña,
 * creando uno nuevo o cerrando A), lo que tenía pendiente en A se guarda en A
 * y, si la transición lo contempla, A conserva su propia vista (la selección)
 * para cuando vuelva.
 *
 * Por qué existe antes del cambio: hoy cada handler de la shell repite a mano
 * ese protocolo (volcar la edición en cola, conservar el borrador, guardar el
 * view_state saliente). ODE-567 lo junta en una sola función, y esta prueba
 * es la red de esa mudanza: si la función dejara de volcar o de guardar en
 * alguna transición, se pone en rojo.
 *
 * Runtime: **desktop**. En web la cola de actualizaciones del editor se vacía
 * de forma síncrona, así que el volcado no es observable ahí (ODE-556).
 *
 * Camino de producción: "New Artifact" real, escritura real en el editor real,
 * gesto real de pestaña y botón real de cerrar pestaña; el guardado real
 * escribe `.md` en un directorio temporal.
 *
 * Completion event: el `.md` en disco y la pestaña del store, tras dejar
 * vencer los debounces, no la llamada a guardar.
 *
 * Las dos transiciones que ABREN un documento (árbol del Workspace,
 * `handleOpenWorkspaceDocument`, y menú nativo, `handleMenuOpenFile`) están en
 * `tests/editor-shell-open-exit-protocol.test.tsx` (ODE-580): necesitan dobles
 * que este archivo no monta. Allí queda caracterizado también que abrir desde
 * el Workspace NO guarda el view_state saliente (los otros cuatro sí).
 *
 * Mutation test (ODE-567): quitar el volcado de la edición en cola, o el
 * guardado del view_state, del protocolo de salida pone en rojo los casos
 * correspondientes.
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

const {
  advance,
  clickNewArtifact,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000

const TEXT_A = "ODE567-DOCUMENTO-A"
const TEXT_B = "ODE567-DOCUMENTO-B"
const PENDING_EDIT = " ODE567-EDICION-EN-VUELO"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-exit-protocol-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

function tabNode(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

/** Espera a que el documento activo tenga identidad materializada. */
async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const { session } = getEditorSessionState()
      const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
      return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
    },
    { label: "identidad materializada del documento activo", timeoutMs: 15_000 },
  )
}

/** Crea un documento real con contenido y devuelve su id y su `.md`. */
async function createDocument(text: string) {
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  const file = await waitForMarkdownContaining(text)
  const writingId = await waitForMaterializedWritingId()
  return { writingId, file }
}

async function contentsOf(path: string) {
  const files = await readWorkspaceMarkdown()
  return files.find((file) => file.path === path)?.contents ?? ""
}

/**
 * Deja A activo con una edición todavía en cola y una selección propia.
 * Devuelve la selección, para comprobar después si la transición la guardó.
 */
async function leaveEditPendingInA(writingA: string) {
  await pointerClick(tabNode(writingA))
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A activo con su contenido" })
  await advance(300)
  await typeInEditor(PENDING_EDIT)
  const selection = { from: 3, to: 9 }
  mounted!.editor().commands.setTextSelection(selection)
  return selection
}

describe("ODE-567 — protocolo de salida del documento activo (desktop)", () => {
  it(
    "al cambiar de pestaña: la edición en vuelo queda en A y A conserva su selección",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      const selection = await leaveEditPendingInA(a.writingId)
      await pointerClick(tabNode(b.writingId))
      await advance(6_000)

      expect(await contentsOf(a.file.path), "la edición en vuelo se vuelca a A").toContain(PENDING_EDIT.trim())
      expect(await contentsOf(b.file.path), "y no a B").not.toContain(PENDING_EDIT.trim())
      const viewA = tabFor(a.writingId)?.view_state
      expect(viewA?.selectionFrom, "A conserva su selección al salir").toBe(selection.from)
      expect(viewA?.selectionTo).toBe(selection.to)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "al crear un documento nuevo: la edición en vuelo queda en A y A conserva su selección",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      const selection = await leaveEditPendingInA(a.writingId)
      await clickNewArtifact(mounted.container)
      await advance(6_000)

      expect(await contentsOf(a.file.path), "la edición en vuelo se vuelca a A").toContain(PENDING_EDIT.trim())
      expect(await contentsOf(b.file.path)).not.toContain(PENDING_EDIT.trim())
      const viewA = tabFor(a.writingId)?.view_state
      expect(viewA?.selectionFrom, "A conserva su selección al salir").toBe(selection.from)
      expect(viewA?.selectionTo).toBe(selection.to)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "al cerrar A: la edición en vuelo se escribe antes de cerrar",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      await leaveEditPendingInA(a.writingId)
      const close = tabNode(a.writingId).querySelector<HTMLElement>('button[aria-label^="Close"]')
      expect(close, "el botón real de cerrar la pestaña de A").toBeTruthy()
      await pointerClick(close!)
      await waitFor(() => !tabFor(a.writingId), { label: "la pestaña de A se cierra", timeoutMs: 15_000 })
      await advance(6_000)

      expect(await contentsOf(a.file.path), "la edición en vuelo llega a A antes de cerrarla").toContain(
        PENDING_EDIT.trim(),
      )
      expect(await contentsOf(b.file.path), "y no a B").not.toContain(PENDING_EDIT.trim())
    },
    TEST_TIMEOUT_MS,
  )
})
