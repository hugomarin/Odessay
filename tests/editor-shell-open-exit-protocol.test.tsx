/**
 * @vitest-environment happy-dom
 *
 * ODE-580 — El protocolo de salida en las dos transiciones que ABREN un
 * documento: desde el árbol del Workspace (`handleOpenWorkspaceDocument`) y
 * desde el menú nativo "Open File" (`handleMenuOpenFile`).
 *
 * Property: al abrir B con una edición todavía en cola en A, esa edición entra
 * en el guardado de A ANTES de que el opener espere, no cuando B ya es el
 * documento activo. Y la vista saliente de A se guarda (menú) o, a propósito,
 * no se guarda (Workspace).
 *
 * Por qué existe: `tests/editor-shell-exit-protocol.test.tsx` (ODE-567) cubre
 * cambiar de pestaña, crear y cerrar, pero dejaba fuera estas dos: las dos
 * dependen de `prepareDocumentExit` antes de un `await`, y ninguna prueba de la
 * shell las ejercitaba.
 *
 * Runtime: **desktop** (en web la cola de la edición se vacía de forma
 * síncrona, ODE-556).
 *
 * Camino de producción: "New Artifact" real y escritura real en el editor
 * real. Workspace: la carpeta se registra con la API real del servicio
 * (`addExistingWorkspace`, con el diálogo nativo doblado), el panel se abre con
 * su botón real y B se abre haciendo click en su fila real del árbol. Menú: el
 * evento nativo real `menu:open-file`, con el diálogo y `open_file` doblados.
 *
 * Cómo se para el opener en su `await`: `holdCatalogReads` retiene la lectura
 * de la fila de B en el catálogo (por id o por ruta), que es lo primero que el
 * opener necesita de B. Mientras está retenida, A sigue activo.
 *
 * Por qué el reloj demuestra "antes del await": se avanza exactamente
 * `DESKTOP_PERSISTENCE_DEBOUNCE_MS` desde el click. Si la shell vuelca la
 * edición en cola al salir, el guardado de A se agenda en el click y el `.md`
 * ya la tiene. Si no la volcara, la edición esperaría su propio debounce de
 * salida del editor (150 ms) y el guardado de A caería después de ese punto.
 *
 * Completion event: el `.md` en disco y la pestaña del store.
 *
 * Mutation test (ODE-580): quitar el volcado, quitar el guardado de la vista
 * del menú, guardar la vista en el Workspace, o mover el protocolo de salida
 * detrás del `await`, pone en rojo el caso correspondiente.
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
  emitTauriEvent,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { world } = await import("./support/editor-shell-doubles")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdCatalogReads, tauriOpenFileDouble } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getDesktopWorkspaceService } = await import("@/lib/services/desktop/workspace-service")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")
const { act } = await import("react")

const TEST_TIMEOUT_MS = 60_000

const TEXT_A = "ODE580-DOCUMENTO-A"
const TEXT_B = "ODE580-DOCUMENTO-B"
const PENDING_EDIT = " ODE580-EDICION-EN-VUELO"
const SELECTION = { from: 3, to: 9 }

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-open-exit-protocol-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // El panel del Workspace monta el modal de vista previa, que construye el
  // cliente de Supabase de desktop (sin usarlo). La red es boundary externo:
  // basta con que el cliente se pueda construir.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  vi.unstubAllEnvs()
})

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

function tabNode(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const writingId = activeWritingId()
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

/** Deja A activo con una edición todavía en cola y una selección propia. */
async function leaveEditPendingInA(writingA: string) {
  await pointerClick(tabNode(writingA))
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A activo con su contenido" })
  await advance(300)
  await typeInEditor(PENDING_EDIT)
  mounted!.editor().commands.setTextSelection(SELECTION)
}

/**
 * Mientras el opener sigue esperando la fila de B: A es todavía el documento
 * activo y su `.md` ya tiene la edición que estaba en cola.
 */
async function expectFlushedBeforeTheAwait(
  hold: ReturnType<typeof holdCatalogReads>,
  a: { writingId: string; file: { path: string } },
) {
  await advance(DESKTOP_PERSISTENCE_DEBOUNCE_MS)
  expect(hold.hits(), "control positivo: el opener está parado leyendo la fila de B").toBeGreaterThan(0)
  expect(activeWritingId(), "B todavía no es el documento activo").toBe(a.writingId)
  expect(await contentsOf(a.file.path), "la edición en cola ya está en A antes del await").toContain(
    PENDING_EDIT.trim(),
  )
}

async function expectBOpenedAndEditOnlyInA(
  a: { writingId: string; file: { path: string } },
  b: { writingId: string; file: { path: string } },
) {
  await waitFor(() => activeWritingId() === b.writingId, { label: "B pasa a ser el documento activo", timeoutMs: 15_000 })
  await advance(6_000)
  expect(await contentsOf(a.file.path), "la edición sigue en A").toContain(PENDING_EDIT.trim())
  expect(await contentsOf(b.file.path), "y no pasa a B").not.toContain(PENDING_EDIT.trim())
}

describe("ODE-580 — protocolo de salida al abrir un documento (desktop)", () => {
  it(
    "desde el menú nativo Open File: vuelca la edición y guarda la vista de A antes de esperar al opener",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)
      await leaveEditPendingInA(a.writingId)

      world.openDialogResult = b.file.path
      world.tauriInvoke = async (command, args) => {
        if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
        throw new Error(`Comando nativo no previsto en esta prueba: ${command}`)
      }
      const hold = holdCatalogReads((key) => key === b.writingId || key === b.file.path)
      await emitTauriEvent("menu:open-file")

      await expectFlushedBeforeTheAwait(hold, a)
      const viewA = tabFor(a.writingId)?.view_state
      expect(viewA?.selectionFrom, "la vista de A se guarda antes del await").toBe(SELECTION.from)
      expect(viewA?.selectionTo).toBe(SELECTION.to)

      hold.release()
      await expectBOpenedAndEditOnlyInA(a, b)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "desde el árbol del Workspace: vuelca la edición antes de esperar al opener y, a propósito, no guarda la vista de A",
    async () => {
      mounted = await mountEditorShell()
      const b = await createDocument(TEXT_B)
      const a = await createDocument(TEXT_A)

      // Precondición: la carpeta de los dos documentos es un Workspace.
      world.openDialogResult = a.file.path.slice(0, a.file.path.lastIndexOf("/"))
      const registered = await (await getDesktopWorkspaceService()).addExistingWorkspace()
      expect(registered, "control positivo: la carpeta quedó registrada como Workspace").toBeTruthy()

      const workspaceButton = mounted.container.querySelector<HTMLButtonElement>('button[aria-label="Workspace"]')
      expect(workspaceButton, "el botón real del panel del Workspace").toBeTruthy()
      await act(async () => {
        workspaceButton!.click()
      })
      const bName = b.file.path.slice(b.file.path.lastIndexOf("/") + 1).replace(/\.md$/, "")
      const bRow = await waitFor(
        () =>
          [...document.querySelectorAll<HTMLButtonElement>('[role="tree"] button[role="treeitem"]')].find(
            (row) => row.textContent?.trim().endsWith(bName) && !row.textContent.trim().endsWith(`${bName} 2`),
          ) ?? null,
        { label: "la fila de B en el árbol del Workspace", timeoutMs: 15_000 },
      )

      await leaveEditPendingInA(a.writingId)
      const viewABefore = tabFor(a.writingId)?.view_state ?? null

      const hold = holdCatalogReads((key) => key === b.writingId || key === b.file.path)
      await act(async () => {
        bRow.click()
      })

      await expectFlushedBeforeTheAwait(hold, a)

      hold.release()
      await expectBOpenedAndEditOnlyInA(a, b)
      // Comportamiento vigente, declarado en `handleOpenWorkspaceDocument`
      // (`saveViewState: false`): esta transición no guarda la vista saliente.
      expect(tabFor(a.writingId)?.view_state ?? null, "la vista de A queda como estaba").toEqual(viewABefore)
      expect(tabFor(a.writingId)?.view_state?.selectionFrom, "no se guardó la selección nueva").not.toBe(
        SELECTION.from,
      )
    },
    TEST_TIMEOUT_MS,
  )
})
