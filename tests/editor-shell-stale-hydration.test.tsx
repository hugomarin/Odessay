/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-464 — Trabajo de hidratación que termina tarde, cuando el
 * autor ya cambió de documento, no actúa: ni recupera la pestaña del
 * documento viejo, ni arranca su hidratación remota de correcciones, ni
 * vuelca sus bloques pendientes, ni pisa el documento nuevo con su contenido.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-empty-draft-persistence.test.tsx`. La prueba antigua cambiaba
 * de documento re-renderizando la shell con otra prop `writingId` (en
 * producción cada entrada por URL remonta la shell, ODE-571) y colgaba
 * `openWriting`, `localDB.writings.get` y `hydrateCorrectionBlocksFromRemote`
 * doblando esos módulos. Aquí A y B son pestañas de la misma shell y el
 * cambio es el gesto real de pestaña; la hidratación, el opener, la caché de
 * correcciones y `lib/corrections/persistence` corren reales sobre
 * fake-indexeddb.
 *
 * Runtime: web. El dueño de generación y sus compuertas son el mismo código
 * en los dos runtimes; lo que cambia es el camino de apertura. La
 * persistencia remota de correcciones solo corre para documentos confirmados
 * por el servidor en `localDB`, que es el camino web.
 *
 * Lo único controlado es CUÁNDO terminan dos lecturas:
 *   - `localDB.writings.get` de A, retenida con `vi.spyOn` que delega en la
 *     real (excepción declarada al contrato de dobles, la misma que el caso
 *     web de `editor-shell-tab-transitions-desktop.test.tsx`: no hay
 *     boundary externo más cercano a la lectura local de la apertura web);
 *   - la hidratación remota de correcciones de A, en el doble del servicio
 *     de AI (`world.hydrateCorrectionBlocks`), que es boundary de red.
 *
 * Mutation test (ODE-574): hacer que el dueño de generación nunca informe
 * `stale` (`lib/editor/hydration-generation.ts`: `isCurrent` siempre
 * verdadero, `run`/`runAsync` sin comprobación) pone en rojo los cuatro
 * casos. Las compuertas del hook están en capas (la de `runAsync` antes de
 * empezar, la de después de esperar, los `isCurrent()` sueltos), así que
 * quitar una sola queda tapada por la siguiente.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const { advance, flush, mountEditorShell, pointerClick, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)
const { localDB } = await import("@/lib/local-db")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type LocalCorrectionBlock = import("@/lib/local-db/schema").LocalCorrectionBlock

const TEST_TIMEOUT_MS = 40_000
const TEXT_A = "Texto de A, ODE464."
const TEXT_B = "Texto de B, ODE464."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

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

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function hydrationPhase() {
  return document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

/** B abierto por ruta, con la pestaña de A en la sesión pero sin hidratar. */
async function openBWithATab() {
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingB,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })
  mounted = await mountEditorShell({ writingId: writingB })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes(TEXT_B) && hydrationPhase() === "ready", {
    label: "B hidratado",
    timeoutMs: 10_000,
  })
  await flush(3)
}

/**
 * Retiene la próxima lectura local de `writingId` (`localDB.writings.get`),
 * que es la de su apertura, hasta `release()`. `done` resuelve cuando la
 * lectura real ya devolvió: la continuación de A llega a la compuerta de
 * generación en los microtasks siguientes.
 */
function holdLocalRead(writingId: string) {
  const original = localDB.writings.get.bind(localDB.writings)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let arrived!: () => void
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  let finished!: () => void
  const done = new Promise<void>((resolve) => {
    finished = resolve
  })
  let taken = false
  vi.spyOn(localDB.writings, "get").mockImplementation(async (id: string) => {
    if (id === writingId && !taken) {
      taken = true
      arrived()
      await gate
      const value = await original(id)
      finished()
      return value
    }
    return original(id)
  })
  return { release, started, done }
}

/** Cambia a A (retenido) y vuelve a B antes de que A termine. */
async function switchToAAndBackToB(started: Promise<void>) {
  await pointerClick(tabNode(writingA))
  await started
  await pointerClick(tabNode(writingB))
  await waitFor(
    () => activeWritingId() === writingB && mounted!.editor().getText().includes(TEXT_B) && hydrationPhase() === "ready",
    { label: "B activo e hidratado de nuevo", timeoutMs: 10_000 },
  )
}

describe("ODE-464 — el trabajo de hidratación rancio no actúa", () => {
  it(
    "un NOT_FOUND tardío de A no recupera su pestaña ni toca la sesión de B",
    async () => {
      // A no existe: su apertura termina en NOT_FOUND (o en open-error).
      await openBWithATab()
      const info = vi.spyOn(console, "info")
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      const hold = holdLocalRead(writingA)
      await switchToAAndBackToB(hold.started)
      const before = getEditorSessionState().session

      hold.release()
      await hold.done
      await advance(300)

      expect(info, "la recuperación de A no corre").not.toHaveBeenCalledWith(
        expect.stringContaining(`[editor] unavailable writing ${writingA}`),
      )
      expect(errors, "ni la rama open-error de A").not.toHaveBeenCalledWith(
        expect.stringContaining(`[editor] openWriting failed for ${writingA}`),
        expect.anything(),
      )
      const after = getEditorSessionState().session
      expect(after.active_tab_id, "B sigue activo").toBe(before.active_tab_id)
      expect(after.tabs.map((tab) => tab.id), "las pestañas no cambian").toEqual(before.tabs.map((tab) => tab.id))
      expect(mounted!.editor().getText()).toContain(TEXT_B)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un HYDRATED tardío de A, sin caché de correcciones, no arranca su hidratación remota",
    async () => {
      await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
      await openBWithATab()
      const hold = holdLocalRead(writingA)
      await switchToAAndBackToB(hold.started)

      hold.release()
      await hold.done
      await advance(300)

      expect(world.correctionHydrationCalls, "ninguna hidratación remota para A").not.toContain(writingA)
      expect(mounted!.editor().getText()).toContain(TEXT_B)
      expect(activeWritingId()).toBe(writingB)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un HYDRATED tardío de A, con un bloque pendiente en caché, no lo vuelca a remoto",
    async () => {
      await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
      const pending: LocalCorrectionBlock = {
        id: `block-${writingA}`,
        writingId: writingA,
        blockId: "b1",
        blockHash: "hash-a-1",
        suggestions: [],
        model: "test-model",
        engineRevision: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        latencyMs: null,
        promptTokens: null,
        completionTokens: null,
        syncedAt: null,
      }
      await localDB.correctionBlocks.saveMany([pending])
      await openBWithATab()
      const hold = holdLocalRead(writingA)
      await switchToAAndBackToB(hold.started)

      hold.release()
      await hold.done
      await advance(300)

      expect(
        world.correctionPersistCalls.map((call) => call.writingId),
        "el bloque pendiente de A no se vuelca",
      ).not.toContain(writingA)
      expect(mounted!.editor().getText()).toContain(TEXT_B)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "la respuesta remota de correcciones de A que llega con B ya hidratado se descarta",
    async () => {
      await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
      let releaseA!: () => void
      const heldA = new Promise<void>((resolve) => {
        releaseA = resolve
      })
      world.hydrateCorrectionBlocks = async (writingId) => {
        if (writingId === writingA) await heldA
        return { error: null, data: [] }
      }
      await openBWithATab()

      await pointerClick(tabNode(writingA))
      await waitFor(() => world.correctionHydrationCalls.includes(writingA), {
        label: "la hidratación remota de A en vuelo",
        timeoutMs: 10_000,
      })
      await pointerClick(tabNode(writingB))
      await waitFor(
        () => activeWritingId() === writingB && mounted!.editor().getText().includes(TEXT_B) && hydrationPhase() === "ready",
        { label: "B activo e hidratado", timeoutMs: 10_000 },
      )

      releaseA()
      await advance(300)

      expect(mounted!.editor().getText(), "el contenido de A no pisa a B").toContain(TEXT_B)
      expect(mounted!.editor().getText()).not.toContain(TEXT_A)
      expect(activeWritingId(), "B sigue activo").toBe(writingB)
      expect(world.correctionPersistCalls.map((call) => call.writingId)).not.toContain(writingA)
    },
    TEST_TIMEOUT_MS,
  )
})
