/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-604 — DOC-01 (crear documento) y DOC-07 (renombrar) a través
 * de la shell, con los dobles reales.
 *
 * DOC-01. Property: crear un documento y escribir deja exactamente UN
 * documento durable, cuya identidad no cambia después de materializarse (ni
 * al seguir escribiendo ni al reabrirlo por su UUID); y un borrador en blanco
 * no deja ningún documento durable. Se afirma sobre el estado durable (el
 * `.md` y la fila del catálogo en desktop, la fila de `localDB` en web), nunca
 * contando llamadas.
 *
 * Evidencia que ya existía y NO se duplica aquí:
 * `tests/editor-shell-draft-materialization-desktop.test.tsx` (ODE-405/461)
 * prueba en desktop que la primera escritura materializa un solo archivo y una
 * sola fila, que escribir durante la materialización no crea otra identidad,
 * que escribir y borrar no materializa nada, que montar/remontar vacío no
 * escribe nada y que el reintento de una materialización fallida reusa la
 * identidad. Lo que faltaba y está aquí: que la identidad sobrevive a
 * reabrir el documento por su UUID (desktop), y DOC-01 en web.
 *
 * Hallazgo (ODE-626, ya arreglado): en web, un borrador en blanco dejaba fila
 * durable en `localDB` y encolaba un `upsert` de sync. Los dos casos que lo
 * caracterizaban como `it.fails` son ahora `it`: el borrador en blanco no crea
 * fila ni mutación, y "crear y escribir" deja exactamente una fila nueva, la
 * de la pestaña. El caso "crear y escribir" afirma sobre TODAS las filas
 * nuevas, sin filtrar por texto.
 *
 * DOC-07. Property: renombrar un documento durable desde la shell (lápiz de
 * la pestaña y modal reales) conserva su UUID y cambia de forma coherente la
 * ruta del archivo, la fila del catálogo y la pestaña. El renombrado de un
 * borrador con la materialización en vuelo ya lo cubre
 * `tests/editor-shell-rename-inflight-draft-desktop.test.tsx` (ODE-585); aquí
 * se renombra un documento que ya tiene archivo, el caso normal. Solo desktop:
 * en web renombrar solo cambia el título de la fila local (no hay ruta ni
 * catálogo), y ese camino es el mismo guardado con título que DOC-03.
 *
 * Camino de producción: "New Artifact" real, escritura real en TipTap,
 * remontaje por `key` como una entrada desde Desk, lápiz y modal reales. En
 * desktop el guardado y el renombrado reales escriben en un directorio
 * temporal (`write_file`/`rename_file` doblados por su dueño canónico, fieles
 * al comando Rust) y el catálogo es el `SqliteDocumentCatalog` real sobre el
 * doble de sus comandos nativos. En web, `localDB` real sobre fake-indexeddb.
 *
 * Hallazgo (ODE-629, review de ODE-604): renombrar con un guardado más nuevo
 * en vuelo pierde ese guardado — el archivo renombrado queda con el snapshot
 * que el rename leyó antes de mover. Caracterización `it.fails` en el bloque
 * DOC-07; el guardado se retiene en `write_file` (`holdWriteFile`) para que el
 * rename ocurra de verdad mientras está en vuelo.
 *
 * Mutation test (ODE-604): en `DesktopDocumentService.renameWriting`
 * (`lib/services/document-service-factory.ts`), devolver el registro
 * renombrado sin `persist()` (el archivo se mueve pero el catálogo no se
 * actualiza) pone en rojo el caso DOC-07.
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
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdWriteFile, writeFileCalls } = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { localDB } = await import("@/lib/local-db")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-create-rename-")
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

async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  return mounted
}

async function catalogRows() {
  return (await getDocumentCatalog()).list()
}

/** Espera a que la pestaña activa tenga identidad materializada y la devuelve. */
async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const writing = activeTab()?.writing_id
      return writing && writing !== EDITOR_DRAFT_TAB_ID ? writing : null
    },
    { label: "pestaña activa con identidad", timeoutMs: 15_000 },
  )
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

/** Como `waitFor`, pero para lecturas asíncronas del estado durable. */
async function eventually(read: () => Promise<boolean | undefined>, label: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await read()) return
    await advance(100)
  }
  throw new Error(`eventually agotó ${timeoutMs}ms esperando: ${label}`)
}

async function exists(path: string) {
  return (await readWorkspaceMarkdown()).some((file) => file.path === path)
}

describe("ODE-604 — DOC-01: crear documento (desktop)", () => {
  it(
    "la identidad materializada sobrevive a seguir escribiendo y a reabrir el documento por su UUID",
    async () => {
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE604-CREAR-PRIMERO")
      await advance(SAVE_WINDOW_MS)
      const file = await waitForMarkdownContaining("ODE604-CREAR-PRIMERO")
      const writingId = await waitForMaterializedWritingId()

      await typeInEditor(" ODE604-CREAR-SEGUNDO")
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE604-CREAR-SEGUNDO")
      expect(activeTab()?.writing_id, "seguir escribiendo no cambia la identidad").toBe(writingId)

      // Reabrir por su UUID, como una entrada desde Desk (remontaje por `key`).
      await mounted!.render({ key: writingId, writingId })
      await waitFor(() => mounted!.editor().getText().includes("ODE604-CREAR-SEGUNDO"), {
        label: "reabierto por su UUID con lo último",
        timeoutMs: 10_000,
      })
      await typeInEditor(" ODE604-CREAR-TRAS-REABRIR")
      await advance(SAVE_WINDOW_MS)
      const after = await waitForMarkdownContaining("ODE604-CREAR-TRAS-REABRIR")

      expect(after.path, "lo escrito tras reabrir va al mismo archivo").toBe(file.path)
      expect(await readWorkspaceMarkdown(), "un solo documento durable en disco").toHaveLength(1)
      const rows = await catalogRows()
      expect(rows.map((row) => row.id), "una sola fila, con la identidad del primer guardado").toEqual([writingId])
      expect(rows[0]?.binding?.canonicalPath, "y su ruta es la del archivo").toBe(file.path)
      expect(activeTab()?.writing_id, "la pestaña conserva la identidad").toBe(writingId)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-604 — DOC-01: crear documento (web)", () => {
  async function mountWeb() {
    resetEditorShellWorld()
    return mountLoaded()
  }

  async function newLocalWritings(before: Set<string>) {
    return (await localDB.writings.getAll()).filter((writing) => !before.has(writing.id))
  }

  async function localWritingIds() {
    return new Set((await localDB.writings.getAll()).map((writing) => writing.id))
  }

  /** Crear por el gesto real y escribir; devuelve la identidad de la pestaña y las filas nuevas. */
  async function createAndType(before: Set<string>) {
    await mountWeb()
    await clickNewArtifact(mounted!.container)
    await typeInEditor("ODE604-WEB-CREAR")
    const writingId = await waitFor(() => activeTab()?.writing_id ?? null, { label: "pestaña con identidad" })
    // Completion event: la fila local del documento con lo escrito.
    await eventually(
      async () => (await localDB.writings.get(writingId))?.body_text?.includes("ODE604-WEB-CREAR"),
      "fila local con lo escrito",
    )
    return { writingId, created: await newLocalWritings(before) }
  }

  /**
   * Parte TODAS las filas durables nuevas (sin filtrar por texto) en la de la
   * pestaña y el resto, y describe el resto para que cualquier fila extra sea
   * visible en la aserción.
   */
  function partitionNewRows(created: Awaited<ReturnType<typeof newLocalWritings>>, writingId: string) {
    return {
      own: created.filter((writing) => writing.id === writingId),
      others: created
        .filter((writing) => writing.id !== writingId)
        .map((writing) => ({ blank: !(writing.body_text ?? "").trim(), title: writing.title })),
    }
  }

  it(
    "crear y escribir: lo escrito vive en el documento de la pestaña, cuya identidad no cambia, y ninguna otra fila nueva tiene contenido",
    async () => {
      const before = await localWritingIds()
      const { writingId, created } = await createAndType(before)

      const { own, others } = partitionNewRows(created, writingId)
      expect(own.map((writing) => writing.body_text), "la fila de la pestaña, con lo escrito").toEqual([
        expect.stringContaining("ODE604-WEB-CREAR"),
      ])
      // Cardinalidad sobre TODAS las filas nuevas: ninguna fuera de la pestaña,
      // ni siquiera un borrador en blanco (ODE-626).
      expect(others, "ninguna fila nueva fuera de la pestaña").toEqual([])

      await typeInEditor(" ODE604-WEB-SIGUE")
      await eventually(
        async () => (await localDB.writings.get(writingId))?.body_text?.includes("ODE604-WEB-SIGUE"),
        "fila local con lo nuevo",
      )
      expect(activeTab()?.writing_id, "la identidad no cambia al seguir escribiendo").toBe(writingId)
      const after = partitionNewRows(await newLocalWritings(before), writingId)
      expect(after.own, "sigue habiendo una sola fila de la pestaña").toHaveLength(1)
      expect(after.others, "y seguir escribiendo no añade ninguna fila").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )

  // Regresión de ODE-626 sobre el caso "crear y escribir": el invariante
  // completo de DOC-01 es que quede exactamente UNA fila durable nueva, la de
  // la pestaña. Antes del fix quedaba además la fila en blanco.
  it(
    "crear y escribir deja exactamente una fila durable nueva, la de la pestaña (ODE-626)",
    async () => {
      const before = await localWritingIds()
      const { writingId, created } = await createAndType(before)
      expect(created.map((writing) => writing.id), "todas las filas nuevas: solo la de la pestaña").toEqual([
        writingId,
      ])
    },
    TEST_TIMEOUT_MS,
  )

  // Regresión de ODE-626 (hallazgo de ODE-604): en web, pulsar "New Artifact"
  // escribía una fila vacía en `localDB` ("Untitled — <fecha>", `local-only`)
  // con un `upsert` encolado en la cola de sync. El montaje sin sesión lo cubre
  // `tests/editor-shell-blank-draft-web.test.tsx`, con control positivo.
  it(
    "un borrador en blanco no crea documento durable ni encola sync (ODE-626)",
    async () => {
      const before = await localWritingIds()
      await mountWeb()
      await clickNewArtifact(mounted!.container)
      expect(mounted!.editor().getText(), "el editor está en blanco").toBe("")
      await advance(1_500)

      const created = await newLocalWritings(before)
      const queued = (await localDB.syncQueue.getPending()).filter((mutation) =>
        created.some((writing) => JSON.stringify(mutation).includes(writing.id)),
      )
      expect(created.map((writing) => writing.body_text), "ningún documento durable nuevo").toEqual([])
      expect(queued, "ni mutación de sync").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-604 — DOC-07: renombrar un documento durable (desktop)", () => {
  it(
    "el UUID se conserva y ruta, título, catálogo y pestaña cambian a la vez",
    async () => {
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE604-RENOMBRAR-CUERPO")
      await advance(SAVE_WINDOW_MS)
      const original = await waitForMarkdownContaining("ODE604-RENOMBRAR-CUERPO")
      const writingId = await waitForMaterializedWritingId()
      const [rowBefore] = await catalogRows()
      expect(rowBefore?.id, "control: la fila del catálogo es la del documento").toBe(writingId)
      expect(rowBefore?.binding?.canonicalPath, "control: la ruta de partida").toBe(original.path)

      await renameActiveTab("ODE604 Nombre Nuevo")
      await waitFor(() => !renameInput(), { label: "el modal se cierra con éxito", timeoutMs: 15_000 })

      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path.split("/").pop()), "un solo archivo, con el nombre nuevo").toEqual([
        "ODE604 Nombre Nuevo.md",
      ])
      const renamedPath = files[0]!.path
      expect(files[0]?.contents, "con su contenido").toContain("ODE604-RENOMBRAR-CUERPO")
      expect(await exists(original.path), "la ruta vieja ya no existe").toBe(false)

      const rows = await catalogRows()
      expect(rows.map((row) => row.id), "el catálogo conserva un solo documento, el mismo UUID").toEqual([writingId])
      expect(rows[0]?.title, "con el título nuevo").toBe("ODE604 Nombre Nuevo")
      expect(rows[0]?.binding?.canonicalPath, "y la ruta nueva").toBe(renamedPath)

      await waitFor(() => activeTab()?.title === "ODE604 Nombre Nuevo", { label: "la pestaña con el título nuevo" })
      expect(activeTab()?.writing_id, "la pestaña conserva el UUID").toBe(writingId)

      // Y sigue siendo el mismo documento al seguir escribiendo.
      await typeInEditor(" ODE604-TRAS-RENOMBRAR")
      await advance(SAVE_WINDOW_MS)
      const after = await waitForMarkdownContaining("ODE604-TRAS-RENOMBRAR")
      expect(after.path, "lo escrito después va al archivo renombrado").toBe(renamedPath)
      expect(await readWorkspaceMarkdown()).toHaveLength(1)
      expect((await catalogRows()).map((row) => row.id)).toEqual([writingId])
    },
    TEST_TIMEOUT_MS,
  )

  // Caracterización de ODE-629 (hallazgo del review de ODE-604, P1). El
  // guardado más nuevo ya decidió escribir en la ruta vieja cuando el
  // renombrado mueve el archivo: al soltarse, `write_file` lo rechaza con
  // CONFLICT ("no longer exists on disk") y no se reintenta, mientras
  // `DesktopDocumentService.renameWriting` persiste en la ruta nueva el
  // snapshot que leyó ANTES de mover (`openWriting`). Resultado: el archivo
  // renombrado queda con el contenido viejo y lo nuevo solo vive en el editor
  // (la pestaña queda en `error`); cerrar la app lo pierde. `it.fails` pasa
  // mientras el bug exista; cuando ODE-629 lo arregle se pondrá en rojo: quitar
  // el `.fails` y actualizar DOC-07 en el mapa.
  it.fails(
    "renombrar con un guardado más nuevo en vuelo no pierde ese guardado (ODE-629)",
    async () => {
      await mountLoaded()
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE604-CARRERA-BASE")
      await advance(SAVE_WINDOW_MS)
      const original = await waitForMarkdownContaining("ODE604-CARRERA-BASE")
      const writingId = await waitForMaterializedWritingId()

      // El guardado más nuevo sale y queda retenido en `write_file` sobre la
      // ruta vieja: ya decidió su ruta y su contenido, y el disco aún no lo tiene.
      const baseline = writeFileCalls().length
      const held = holdWriteFile((path) => path === original.path)
      await typeInEditor(" ODE604-CARRERA-NUEVO")
      await advance(SAVE_WINDOW_MS)
      await held.started
      expect(
        writeFileCalls().slice(baseline).map((call) => call.content.includes("ODE604-CARRERA-NUEVO")),
        "control positivo: el guardado con lo nuevo está en vuelo",
      ).toEqual([true])

      // Renombrar mientras ese guardado sigue en vuelo, y soltarlo después.
      await renameActiveTab("ODE604 Carrera")
      await waitFor(() => !renameInput(), { label: "el modal se cierra", timeoutMs: 15_000 })
      held.release()
      // Completion event: el guardado retenido resolvió de una de las dos
      // formas posibles — lo nuevo llegó al archivo renombrado, o la pestaña
      // reporta el fallo del guardado. Luego se deja vencer otra ventana de
      // guardado por si hubiera un reintento.
      await eventually(
        async () =>
          activeTab()?.save_state === "error" ||
          (await readWorkspaceMarkdown()).some((file) => file.contents.includes("ODE604-CARRERA-NUEVO")),
        "el guardado retenido resolvió",
      )
      await advance(SAVE_WINDOW_MS)
      await flush(3)
      expect(mounted!.editor().getText(), "control: el editor tiene lo nuevo").toContain("ODE604-CARRERA-NUEVO")

      const files = await readWorkspaceMarkdown()
      expect(files.map((file) => file.path.split("/").pop()), "un solo archivo, con el nombre nuevo").toEqual([
        "ODE604 Carrera.md",
      ])
      expect(files[0]?.contents, "el guardado más nuevo sobrevive al renombrado").toContain("ODE604-CARRERA-NUEVO")
      const rows = await catalogRows()
      expect(rows.map((row) => row.id), "un solo documento, el mismo UUID").toEqual([writingId])
      expect(rows[0]?.binding?.canonicalPath, "apuntando al archivo renombrado").toBe(files[0]?.path)
    },
    TEST_TIMEOUT_MS,
  )
})
