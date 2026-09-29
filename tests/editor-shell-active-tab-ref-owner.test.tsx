/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — `activeEditorTabIdRef` tiene un único escritor: la suscripción
 * síncrona al store de sesión (`useActiveEditorTabIdRef`, opción B de ODE-608).
 *
 * Property (los dos casos "leído entre el cambio del store y el render"):
 *
 *   1. Al abrir B por su ruta, `openWritingTab` cambia el store y la copia en
 *      la misma instrucción: en la ventana de commit siguiente la copia ya
 *      vale B, así que cerrar esa pestaña la reconoce como la activa y activa
 *      A. Con el efecto espejo la copia todavía vale A en esa ventana: el
 *      cierre no activa nada y la ruta sigue proyectando el documento cerrado.
 *   2. La sesión persistida que carga después del montaje
 *      (`initializeEditorSessionStore`) actualiza la copia sin render. El test
 *      suelta la lectura retenida desde la ventana de commit del montaje,
 *      antes del efecto de suscripción; ese cambio de la re-lectura queda
 *      enmascarado en la shell (el efecto de `publishTabState`, declarado
 *      después, vuelve a emitir en el mismo flush), así que la re-lectura se
 *      prueba a nivel de hook: `tests/hooks/useActiveEditorTabIdRef.test.tsx`.
 *
 * Técnica (integration-harness-catalog §Trampas): `world.onShellCommit` corre
 * en fase de layout de cada commit del shell, antes de sus efectos pasivos. La
 * sonda despacha el gesto real de cerrar sobre el botón de la pestaña en esa
 * ventana.
 *
 * Camino de producción (web): A y B son documentos reales en fake-indexeddb y
 * la entrada a B es la de la ruta (`useSessionRestore` → `openWritingTab`, el
 * mismo camino de los openers de archivo). El caso 2 usa la lectura real de la
 * sesión (`localDB.editorSessions.get`, retenida con `vi.spyOn` que delega en
 * la real), la misma excepción declarada que ODE-577.
 *
 * Mutation test (ODE-609):
 *   - volver al efecto espejo (`useEffect(() => { activeEditorTabIdRef.current
 *     = editorSession.active_tab_id }, [...])`) → rojos 1 y 2;
 *   - quitar la suscripción → rojos 1 y 2;
 *   - saltarse la re-lectura al suscribirse (`sync()` tras `subscribe`) queda
 *     **verde en esta shell** (la ventana queda enmascarada por el efecto de
 *     `publishTabState`): su fase roja vive en el test de hook
 *     `tests/hooks/useActiveEditorTabIdRef.test.tsx`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

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
  dispatchPointerClick,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
  world,
} = await import("./support/editor-shell-harness")
const {
  getEditorSessionState,
  initializeEditorSessionStore,
} = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Texto de A, ODE609-ref."
const TEXT_B = "Texto de B, ODE609-ref, el documento abierto por su ruta."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
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

function persistedSessionWithAB() {
  return {
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  }
}

/**
 * Retiene la ENTREGA de la lectura de la sesión persistida hasta `release()`.
 * La lectura en sí ocurre al llamarla (como una transacción abierta antes de
 * que el autor pueda hacer nada), así que ve la sesión anterior aunque después
 * se escriba otra (ODE-577).
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

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
  await writeEditorSession(persistedSessionWithAB())
})

afterEach(async () => {
  world.onShellCommit = null
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

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

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

function tabIdForWriting(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)?.id ?? null
}

describe("ODE-609 — activeEditorTabIdRef se lee entre el cambio del store y el render", () => {
  it(
    "al abrir B por su ruta, la copia ya vale B en la ventana del commit: cerrarla activa A",
    async () => {
      // Se entra sin ruta (documento vacío, `currentWritingId` null): al abrir
      // B, `openWritingTab` fija `active_tab_id` y el efecto de publicación no
      // lo pisa (su guard de `currentWritingId === null` sale antes).
      mounted = await mountEditorShell()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await flush(2)

      // La sonda entra en la ventana de commit en la que el store ya tiene a B
      // activa pero los efectos pasivos de ese commit todavía no corrieron: con
      // el listener la copia ya vale B; con el espejo todavía vale null.
      const probe = { fired: false }
      world.onShellCommit = () => {
        if (probe.fired) return
        const tabB = tabIdForWriting(writingB)
        if (!tabB || getEditorSessionState().session.active_tab_id !== tabB) return
        if (!document.querySelector(`[data-editor-tab-id="${tabB}"]`)) return
        probe.fired = true
        dispatchPointerClick(closeButton(tabB))
      }

      await mounted.render({ writingId: writingB })
      await waitFor(() => probe.fired, {
        label: "la sonda entró en la ventana de commit con B activa",
        timeoutMs: 10_000,
      })
      world.onShellCommit = null

      await waitFor(() => activeWritingId() === writingA, {
        label: "cerrar B (la activa) devuelve el documento a A",
        timeoutMs: 10_000,
      })
      expect(window.location.href, "la ruta no proyecta el documento cerrado").not.toContain(writingB)
      expect(window.location.href, "y proyecta A, el documento siguiente").toContain(writingA)
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), {
        label: "A es el documento en pantalla",
        timeoutMs: 10_000,
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la sesión que carga después del montaje actualiza la copia sin render",
    async () => {
      // La sesión empieza a cargar antes de montar (como la arrancan
      // `useCatalogEditorSessionSync`/`useRecentWritings`), con la entrega de
      // la lectura retenida.
      const hold = holdSessionRead()
      void initializeEditorSessionStore()
      mounted = await mountEditorShell()

      // Fase 1: en la ventana de commit del montaje —antes del efecto de
      // suscripción del hook— se suelta la lectura. Ese cambio cae entre el
      // render y la suscripción, pero la shell lo enmascara: el efecto de
      // `publishTabState`, declarado después, vuelve a emitir en el mismo
      // flush. Lo que este caso fija es que la carga de la sesión persistida
      // actualiza la copia sin render; la re-lectura al suscribirse se prueba
      // en `tests/hooks/useActiveEditorTabIdRef.test.tsx`.
      // Fase 2: en la ventana de commit con A activa tras la carga, se cierra A.
      const probe = { released: false, fired: false }
      world.onShellCommit = () => {
        if (!probe.released) {
          probe.released = true
          hold.release()
          return
        }
        if (probe.fired || !getEditorSessionState().loaded) return
        const tabA = tabIdForWriting(writingA)
        if (!tabA || getEditorSessionState().session.active_tab_id !== tabA) return
        if (!document.querySelector(`[data-editor-tab-id="${tabA}"]`)) return
        probe.fired = true
        dispatchPointerClick(closeButton(tabA))
      }

      await waitFor(() => probe.fired, {
        label: "ventana de commit con A activa tras la carga",
        timeoutMs: 10_000,
      })
      world.onShellCommit = null

      await waitFor(() => activeWritingId() === writingB, {
        label: "cerrar A (la activa) activa B",
        timeoutMs: 10_000,
      })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_B), {
        label: "B es el documento en pantalla",
        timeoutMs: 10_000,
      })
    },
    TEST_TIMEOUT_MS,
  )
})
