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
 *
 * ODE-604 — DOC-05 completo (guardar mientras se cambia de pestaña). Los casos
 * de arriba prueban que la edición en vuelo llega al disco de A y no al de B.
 * El bloque "DOC-05" añade lo que faltaba del guion A → B → escribir en B →
 * volver a A: que B no recibe nada de A, que al volver a A el editor muestra
 * lo último de A, que la barra y la pestaña de cada documento dicen el estado
 * que proyecta su fila durable, y el mismo guion en **web**. En web la cola
 * del editor se vacía en un frame (no en un debounce), así que la edición
 * pendiente se retiene con `holdAnimationFrames`: si la salida no la volcara,
 * el frame retenido correría con B ya activo y la edición de A se perdería.
 *
 * Mutation test (ODE-604): en `prepareDocumentExit`, no llamar a
 * `flushQueuedRichModeUpdate()` pone en rojo los dos casos DOC-05: al volver a
 * A, su editor no muestra la edición que tenía pendiente al salir.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

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
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdWriteFile } = await import("./integration/documents/support/real-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEditorSessionTab, createEmptyEditorSession } = await import(
  "@/lib/local-db/editor-sessions"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { mapCatalogRecordToSaveState, mapLocalSyncStatusToSaveState } = await import("@/components/editor/save-state")
const { localDB } = await import("@/lib/local-db")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

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

async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>(
        '[data-testid="editor-statusbar"] button',
      )).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => button.click())
  await flush(2)
  await waitFor(
    () =>
      label === "Markdown"
        ? mounted!.container.querySelector('textarea[aria-label="Markdown source"]')
        : !mounted!.container.querySelector('textarea[aria-label="Markdown source"]') && mounted!.prosemirror(),
    { label: `el editor en modo ${label}` },
  )
}

async function typeInMarkdown(text: string) {
  const textarea = mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(textarea, `${textarea.value}${text}`)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
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

/* ------------------------------------------------------------------ *
 * ODE-604 — DOC-05: el guion completo, en desktop y en web
 * ------------------------------------------------------------------ */

const PENDING_A = "ODE604-PENDIENTE-DE-A"
const TYPED_IN_B = "ODE604-ESCRITO-EN-B"

const SAVE_STATE_BY_LABEL: Record<string, string> = {
  Saved: "saved",
  "Saving...": "saving",
  "Saved locally": "saved-local",
  "Needs attention": "error",
}

/** Lo que muestra la status bar, traducido a `EditorSaveState`. */
function barSaveState() {
  const label = mounted?.container
    .querySelector('[data-testid="editor-statusbar"] [aria-live="polite"]')
    ?.textContent?.trim()
  if (label === undefined) return null
  return SAVE_STATE_BY_LABEL[label] ?? `desconocido: ${label}`
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

/**
 * La pestaña de cada documento dice el estado que proyecta su fila durable, y
 * la barra dice el de la pestaña activa. `project` es la proyección de
 * producción de cada runtime (catálogo en desktop, `localDB` en web).
 */
async function expectBarAndTabsMatchDurable(
  writingIds: string[],
  project: (writingId: string) => Promise<string>,
) {
  for (const writingId of writingIds) {
    const expected = await project(writingId)
    await waitFor(() => tabFor(writingId)?.save_state === expected, {
      label: `la pestaña de ${writingId} en ${expected}`,
      timeoutMs: 10_000,
    })
  }
  expect(barSaveState(), "la barra dice el estado de la pestaña activa").toBe(
    tabFor(activeWritingId()!)?.save_state,
  )
}

/** Como `waitFor`, pero para lecturas asíncronas del estado durable. */
async function eventually<T>(read: () => Promise<T | null>, label: string, timeoutMs = 10_000): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await read()
    if (value) return value
    await advance(100)
  }
  throw new Error(`eventually agotó ${timeoutMs}ms esperando: ${label}`)
}

async function projectDesktopSaveState(writingId: string) {
  const record = await (await getDocumentCatalog()).getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  return mapCatalogRecordToSaveState(record, navigator.onLine)
}

async function projectWebSaveState(writingId: string) {
  const row = await localDB.writings.get(writingId)
  if (!row) throw new Error(`Sin fila local para ${writingId}`)
  return mapLocalSyncStatusToSaveState(row.sync_status, row.lifecycle, navigator.onLine)
}

describe("ODE-604 — DOC-05: guardar mientras se cambia de pestaña", () => {
  it(
    "desktop: al salir de A, el Markdown pendiente se guarda con la identidad de A",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      await pointerClick(tabNode(a.writingId))
      await waitFor(
        () => activeWritingId() === a.writingId && mounted!.editor().getText().includes(TEXT_A),
        { label: "A activo con su contenido" },
      )
      await switchMode("Markdown")

      const annotation = '<Annotation id="source-switch-ann" type="personal" comment="nota">ancla fuente</Annotation>'
      await typeInMarkdown(` ${annotation}`)
      expect(await contentsOf(a.file.path), "el debounce de Markdown sigue pendiente").not.toContain(
        "source-switch-ann",
      )

      await pointerClick(tabNode(b.writingId))
      await waitFor(
        () => activeWritingId() === b.writingId && mounted!.editor().getText().includes(TEXT_B),
        { label: "B activo después de vaciar el Markdown saliente" },
      )
      const saved = await waitForMarkdownContaining("source-switch-ann")
      expect(saved.path, "la anotación se guarda bajo el documento saliente").toBe(a.file.path)
      expect(saved.contents).toContain(annotation)
      expect(await contentsOf(b.file.path), "B no recibe el contenido de A").not.toContain("source-switch-ann")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "desktop: no activa B hasta que la escritura pendiente de A es durable",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      await pointerClick(tabNode(a.writingId))
      await waitFor(
        () => activeWritingId() === a.writingId && mounted!.editor().getText().includes(TEXT_A),
        { label: "A activo con su contenido" },
      )
      await advance(300)

      const held = holdWriteFile((path) => path === a.file.path)
      try {
        await typeInEditor(" ODE604-A-DURABLE-ANTES-DE-B")
        await pointerClick(tabNode(b.writingId))
        await held.started
        await flush(5)

        expect(activeWritingId(), "la identidad activa no cambia mientras el write de A sigue retenido").toBe(
          a.writingId,
        )
        expect(mounted!.editor().getText(), "el editor aún muestra A durante el write").toContain(TEXT_A)
      } finally {
        held.release()
      }

      await waitFor(
        () => activeWritingId() === b.writingId && mounted!.editor().getText().includes(TEXT_B),
        { label: "B se activa tras completar la escritura durable", timeoutMs: 15_000 },
      )
      expect(await contentsOf(a.file.path)).toContain("ODE604-A-DURABLE-ANTES-DE-B")
      expect(await contentsOf(b.file.path)).not.toContain("ODE604-A-DURABLE-ANTES-DE-B")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "desktop: A → B con la edición de A pendiente → escribir en B → volver a A",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument(TEXT_A)
      const b = await createDocument(TEXT_B)

      await pointerClick(tabNode(a.writingId))
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A activo con su contenido" })
      await advance(300)
      await typeInEditor(` ${PENDING_A}`)
      // Control del estado de partida: la edición de A todavía no está en disco.
      expect(await contentsOf(a.file.path), "la edición de A está pendiente al salir").not.toContain(PENDING_A)

      await pointerClick(tabNode(b.writingId))
      await waitFor(() => activeWritingId() === b.writingId && mounted!.editor().getText().includes(TEXT_B), {
        label: "B activo con su contenido",
      })
      expect(mounted!.editor().getText(), "B no muestra la edición de A").not.toContain(PENDING_A)
      await advance(300)
      await typeInEditor(` ${TYPED_IN_B}`)

      await pointerClick(tabNode(a.writingId))
      await waitFor(
        () => activeWritingId() === a.writingId && mounted!.editor().getText().includes(PENDING_A),
        { label: "al volver, A muestra lo último de A", timeoutMs: 10_000 },
      )
      expect(mounted!.editor().getText(), "sin lo escrito en B").not.toContain(TYPED_IN_B)

      // Completion events, uno por documento: el `.md` de A con lo último de
      // A y el de B con lo escrito en B (su guardado es el que más tarda: sale
      // del debounce de B tras volver a A).
      const diskA = await eventually(async () => {
        const contents = await contentsOf(a.file.path)
        return contents.includes(PENDING_A) ? contents : null
      }, "el .md de A con su edición")
      const diskB = await eventually(async () => {
        const contents = await contentsOf(b.file.path)
        return contents.includes(TYPED_IN_B) ? contents : null
      }, "el .md de B con lo escrito en B")
      expect(diskA, "el disco de A tiene lo último de A").toContain(PENDING_A)
      expect(diskB, "control positivo: B guarda lo suyo").toContain(TYPED_IN_B)
      expect(diskB, "B no tiene nada de A").not.toContain(PENDING_A)
      expect(diskA, "ni A nada de B").not.toContain(TYPED_IN_B)

      await expectBarAndTabsMatchDurable([a.writingId, b.writingId], projectDesktopSaveState)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "web: A → B con la edición de A en un frame retenido → escribir en B → volver a A",
    async () => {
      const writingA = crypto.randomUUID()
      const writingB = crypto.randomUUID()
      const seed = (id: string, text: string) =>
        localDB.writings.save({
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
        } as Parameters<typeof localDB.writings.save>[0])
      await seed(writingA, TEXT_A)
      await seed(writingB, TEXT_B)
      resetEditorShellWorld()
      await writeEditorSession({
        ...createEmptyEditorSession(),
        active_tab_id: writingA,
        tabs: [
          createEditorSessionTab({ id: writingA, writingId: writingA, title: TEXT_A }),
          createEditorSessionTab({ id: writingB, writingId: writingB, title: TEXT_B }),
        ],
      })

      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 10_000 })
      await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })
      await advance(300)

      const frames = holdAnimationFrames()
      try {
        await typeInEditor(` ${PENDING_A}`)
        expect(frames.pending(), "la edición de A queda en un frame retenido").toBeGreaterThan(0)
        expect((await localDB.writings.get(writingA))?.body_text, "y todavía no está guardada").not.toContain(
          PENDING_A,
        )

        await pointerClick(tabNode(writingB))
        await frames.settleUntil(
          () => activeWritingId() === writingB && mounted!.editor().getText().includes(TEXT_B),
          { label: "B activo con su contenido" },
        )
        expect(mounted!.editor().getText(), "B no muestra la edición de A").not.toContain(PENDING_A)
        await frames.settle()
        await typeInEditor(` ${TYPED_IN_B}`)
        await frames.settle()

        await pointerClick(tabNode(writingA))
        await frames.settleUntil(
          () => activeWritingId() === writingA && mounted!.editor().getText().includes(PENDING_A),
          { label: "al volver, A muestra lo último de A" },
        )
        expect(mounted!.editor().getText(), "sin lo escrito en B").not.toContain(TYPED_IN_B)
        await frames.settle()
      } finally {
        frames.restore()
      }
      // Completion event: la fila local de A con lo último de A.
      const rowA = await eventually(
        async () => {
          const row = await localDB.writings.get(writingA)
          return row?.body_text?.includes(PENDING_A) ? row : null
        },
        "la fila local de A con su edición",
      )
      // Y la de B con lo escrito en B.
      const rowB = await eventually(
        async () => {
          const row = await localDB.writings.get(writingB)
          return row?.body_text?.includes(TYPED_IN_B) ? row : null
        },
        "la fila local de B con lo escrito en B",
      )
      expect(rowA?.body_text, "la fila local de A tiene lo último de A").toContain(PENDING_A)
      expect(rowB?.body_text, "control positivo: B guarda lo suyo").toContain(TYPED_IN_B)
      expect(rowB?.body_text, "B no tiene nada de A").not.toContain(PENDING_A)
      expect(rowA?.body_text, "ni A nada de B").not.toContain(TYPED_IN_B)

      await expectBarAndTabsMatchDurable([writingA, writingB], projectWebSaveState)
    },
    TEST_TIMEOUT_MS,
  )
})
