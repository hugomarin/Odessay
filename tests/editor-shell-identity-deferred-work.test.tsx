/**
 * @vitest-environment happy-dom
 *
 * ODE-556 — Prueba de caracterización 1 de 3: identidad y trabajo diferido.
 *
 * Property: ningún trabajo diferido por la hidratación de un documento puede
 * aplicarse después de que la identidad activa cambió. En concreto: el restore
 * de selección/scroll de A, agendado en un `requestAnimationFrame` durante la
 * hidratación de A, no puede ejecutarse sobre B cuando el usuario cambió de
 * pestaña antes de que ese frame corriera.
 *
 * Por qué importa: es la clase de bug de ODE-555 — el trabajo diferido y la
 * cancelación de generación compiten sin orden garantizado, y cuando el
 * perdedor es el restore no hay error, ni excepción, ni remount. Falla en
 * silencio.
 *
 * Camino de producción (regla 1 y 2 de capability-proof-contract.md):
 *   documento A abierto por ruta → escritura real en el editor real →
 *   selección real → clic real en la pestaña de B (`data-editor-tab-id`,
 *   mismo nodo que pulsa el usuario) → hidratación de B → frame diferido
 *   liberado.
 * No se siembra `view_state`: lo escribe el propio shell al cambiar de
 * pestaña, que es como se produce en la app.
 *
 * Completion event: el invariante se evalúa DESPUÉS de drenar los frames
 * retenidos (`frames.flush()`), no cuando se agendan — medir antes daría
 * verde sin haber ejecutado el trabajo que puede corromper el estado.
 *
 * Colaboradores reales: EditorShell, TipTap + extensiones reales, editor
 * session store, PersistenceCoordinator, lib/local-db sobre fake-indexeddb,
 * webDocumentService, EditorTopbar y los tabs reales.
 * Dobles: solo red, transporte nativo de Tauri, diálogos del SO, proveedor de
 * AI y el router de Next (ver tests/support/editor-shell-harness.tsx).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"

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
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)

const {
  flush,
  holdAnimationFrames,
  pointerClick,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
} = await import("./support/editor-shell-harness")

const WRITING_A = "11111111-1111-4111-8111-111111111111"
const WRITING_B = "22222222-2222-4222-8222-222222222222"

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
    },
    body_text: bodyText,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

/**
 * Montar el shell real con TipTap real cuesta ~1s aislado, pero bastante más
 * con la suite completa compitiendo por CPU. El default de Vitest (5s) deja
 * estas pruebas intermitentes sin que nada esté mal en el producto.
 */
const SHELL_TEST_TIMEOUT_MS = 30_000

const A_SCROLL_TOP = 120

function writingArea() {
  return document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
}

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

/**
 * Cambia de pestaña con el gesto real y VERIFICA que la activación ocurrió.
 *
 * La verificación no es decorativa: la primera versión de esta prueba usaba
 * `node.click()`, que estos tabs ignoran (gesto de puntero propio), así que el
 * test navegaba sin cambiar de documento y aun así pasaba. Un driver que no
 * comprueba su propio efecto es un `NON_PRODUCTION_PATH` esperando a ocurrir.
 */
async function clickTab(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  const active = getEditorSessionState().session.active_tab_id
  if (active !== tab.id) {
    throw new Error(
      `El gesto sobre la pestaña de ${writingId} no la activó (activa: ${active}). ` +
        "El driver no está pulsando por el camino real.",
    )
  }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  resetEditorShellWorld()
  await localDB.writings.save(
    makeLocalWriting(WRITING_A, "Documento A con contenido suficiente.", "Documento A"),
  )
  await localDB.writings.save(
    makeLocalWriting(WRITING_B, "Documento B con contenido distinto.", "Documento B"),
  )
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-556 — trabajo diferido de hidratación y cambio de identidad", () => {
  it("monta el shell con el editor real y hidrata el documento de la ruta", async () => {
    mounted = await mountEditorShell({ writingId: WRITING_A })

    const editor = await waitFor(
      () => (mounted!.editor().getText().includes("Documento A") ? mounted!.editor() : null),
      { label: "el editor real hidratado con el cuerpo de A" },
    )

    expect(editor.getText()).toContain("Documento A")
    expect(mounted.prosemirror()?.textContent).toContain("Documento A")
  }, SHELL_TEST_TIMEOUT_MS)

  it("descarta el restore diferido de A cuando la identidad activa cambió a B antes de que el frame corriera", async () => {
    // 1. A abierto por ruta e hidratado.
    mounted = await mountEditorShell({ writingId: WRITING_A })
    await waitFor(() => mounted!.editor().getText().includes("Documento A"), {
      label: "hidratación de A",
    })

    // 2. B abierto por el mismo camino de ruta que usa el producto.
    await mounted.render({ writingId: WRITING_B })
    await waitFor(() => tabFor(WRITING_B), { label: "pestaña de B" })

    // 3. Vuelta a A con un clic real y scroll real sobre el viewport real.
    //    `scrollTop` es exactamente la propiedad que el shell lee para
    //    construir el view_state, así que asignarla es lo que deja un
    //    usuario que scrollea — no un view_state sembrado a mano.
    await clickTab(WRITING_A)
    const viewport = writingArea()
    expect(viewport, "el viewport real del editor debe existir").toBeTruthy()
    // El scroll se fija DESPUÉS de que el restore de A haya asentado: si se
    // asigna antes, el propio restore (con el scroll guardado de A, 0) lo
    // pisa. Es el orden real — el usuario scrollea sobre un documento ya
    // restaurado, no a mitad de la restauración.
    await flush(2)
    viewport!.scrollTop = A_SCROLL_TOP

    // 4. Salir a B hace que el shell persista el view_state de A. Lo
    //    comprobamos porque es la precondición de la carrera.
    await clickTab(WRITING_B)
    const savedA = tabFor(WRITING_A)?.view_state
    expect(savedA?.scrollTop).toBe(A_SCROLL_TOP)

    // 5. La carrera: volvemos a A con los frames retenidos, así que su
    //    restore queda agendado pero sin ejecutar...
    const frames = holdAnimationFrames()
    try {
      await clickTab(WRITING_A)

      // El trabajo diferido de A queda retenido SIN ejecutar. Lo sacamos de
      // la cola para poder soltarlo más tarde que el de B: la carrera real no
      // es "los dos restores compiten", es "el callback del documento viejo
      // llega tarde, cuando el nuevo ya terminó".
      // Esperamos a que A agende su restore en vez de darlo por hecho: bajo
      // carga (suite completa) la hidratación tarda más y asumir el timing
      // convierte la prueba en intermitente.
      await waitFor(() => frames.pending() > 0, {
        label: "A debe agendar su restore diferido",
      })
      const staleFrames = frames.takePending()

      // El usuario se va a B, y B completa su propio restore.
      await clickTab(WRITING_B)
      await frames.settle()

      // Línea base neutra antes de soltar el frame rancio. No dependemos de
      // que B re-aplique su propio scroll (puede o no agendarlo según su
      // view_state): lo que se mide es si el callback de A, que ya no es el
      // dueño, escribe sobre el viewport del documento activo.
      const viewportB = writingArea()
      expect(viewportB, "el viewport debe seguir montado con B activo").toBeTruthy()
      viewportB!.scrollTop = 0

      // Completion event: ahora llega, tarde, el frame que dejó A.
      await frames.runCallbacks(staleFrames)

      // Invariante: ese callback pertenece a una generación que ya no es la
      // dueña, así que no puede tocar el documento activo.
      const { session } = getEditorSessionState()
      const activeTab = session.tabs.find((tab) => tab.id === session.active_tab_id)
      expect(activeTab?.writing_id, "el documento activo debe seguir siendo B").toBe(WRITING_B)
      expect(mounted.editor().getText()).toContain("Documento B")
      expect(
        writingArea()?.scrollTop,
        "el scroll guardado de A no puede aplicarse sobre B por un frame rancio",
      ).toBe(0)
    } finally {
      frames.restore()
    }
  }, SHELL_TEST_TIMEOUT_MS)
})
