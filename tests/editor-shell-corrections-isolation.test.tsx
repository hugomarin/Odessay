/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-559 (ex-requisito 4c de ODE-556) — Una respuesta de corrección
 * pedida para el documento A no se aplica sobre B si el autor cambió a B
 * mientras estaba en vuelo.
 *
 * Camino de producción (web): A y B abiertos como pestañas de la misma shell,
 * análisis manual real desde el panel sobre A, gesto real de pestaña a B con
 * la respuesta en vuelo, B hidratado, y entonces llega la respuesta de A.
 * Colaboradores reales: EditorShell, TipTap, useManualCorrections,
 * lib/corrections/*, el panel y `localDB` sobre fake-indexeddb. Doble: solo el
 * proveedor de AI (`world.aiReview`), que retiene la respuesta.
 *
 * A y B tienen el MISMO párrafo a propósito: el id de bloque se deriva de
 * contenido y posición, así que la sugerencia de A tendría dónde aplicarse en
 * B y la validación de hash/texto del bloque no la descarta. Lo que se prueba
 * es la identidad, no el contenido.
 *
 * Control positivo: la misma respuesta, sin cambiar de documento, deja una
 * sugerencia accionable. Sin él, la ausencia de sugerencias no probaría nada
 * (regla 8 de `workflow/quality/capability-proof-contract.md`).
 *
 * Qué descarta la respuesta (investigación de ODE-559, mutando de una en una):
 *
 *   - Cambiar de documento cancela la corrida: el efecto de
 *     `useManualCorrections` sobre `currentWritingId` pone `cancelledRef`, así
 *     que `isCurrentRun` deja de valer.
 *   - Y además cambia la identidad: la comprobación
 *     `currentWritingIdRef.current === requestWritingId` aparecía TRES veces
 *     (tras la respuesta en `runPackages`, al entrar en
 *     `processPackageResponse` y por bloque).
 *
 *   Cualquiera de esas cuatro guardas bastaba sola: la prueba solo se ponía
 *   en rojo quitando las cuatro. Por eso ODE-556 no pudo falsificarla (quitó
 *   dos apariciones y `isCurrentRun`; la tercera siguió protegiendo). Ahora
 *   son una sola compuerta, `isResponseStillCurrent`.
 *
 *   Con contenido DISTINTO en B hay otra capa: la revalidación de hash y
 *   texto del bloque en `processPackageResponse` también descarta la
 *   respuesta, aun sin la compuerta. Por eso esta prueba usa el mismo párrafo.
 *
 * Mutation test (ODE-559): `isResponseStillCurrent` devolviendo siempre
 * `true` pone en rojo el caso de B y deja verde el control positivo. Quitar
 * solo una de sus dos mitades no lo pone en rojo: se cubren entre sí.
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
type AiReviewInput = import("./support/editor-shell-doubles").AiReviewInput

const TEST_TIMEOUT_MS = 40_000
const PARAGRAPH = "Este parrafo tiene un herror de ortografia evidente."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: PARAGRAPH }] }] },
    body_text: PARAGRAPH,
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
  // Ids nuevos por test: fake-indexeddb persiste entre tests del archivo y un
  // documento ya revisado no volvería a pedir nada.
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, "Documento B"))
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })
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
  const node = tab ? document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`) : null
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

function acceptButtons() {
  return document.querySelectorAll('[aria-label="Accept"]').length
}

/** Respuesta canónica del proveedor, retenida hasta `release()`. */
function holdReview() {
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  world.aiReview = async (input: AiReviewInput) => {
    await gate
    return {
      error: null,
      data: {
        summary: "Una corrección clara.",
        language: "es",
        corrections: (input.correctionBlocks ?? []).map((block) => ({
          blockId: block.id,
          type: "spelling",
          severity: "medium",
          confidence: "high",
          originalText: "herror",
          replacementText: "error",
          reason: "Falta de ortografía.",
        })),
      },
    }
  }
  return { release }
}

/** Abre el panel con el atajo real (ver `editor-shell-corrections-path.test.tsx`). */
async function openCorrectionsPanel() {
  const dispatch = (modifier: "ctrl" | "meta") => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key: "s",
        code: "KeyS",
        altKey: true,
        ctrlKey: modifier === "ctrl",
        metaKey: modifier === "meta",
        bubbles: true,
      }),
    )
  }
  await flush(1)
  dispatch("ctrl")
  await flush(2)
  if (!document.querySelector("#corrections-analyze-button")) {
    dispatch("meta")
    await flush(2)
  }
  await waitFor(() => document.querySelector<HTMLButtonElement>("#corrections-analyze-button"), {
    label: "panel de correcciones abierto",
    timeoutMs: 5000,
  })
}

/** A abierto e hidratado, panel abierto y un análisis de A en vuelo. */
async function analysisOfAInFlight() {
  const review = holdReview()
  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => mounted!.editor().getText().includes("herror") && hydrationPhase() === "ready", {
    label: "A hidratado",
    timeoutMs: 10_000,
  })
  await openCorrectionsPanel()
  document.querySelector<HTMLButtonElement>("#corrections-analyze-button")!.click()
  await waitFor(() => world.aiReviewCalls.length > 0, { label: "petición de A en vuelo", timeoutMs: 5000 })
  expect(world.aiReviewCalls[0]?.writingId).toBe(writingA)
  return review
}

describe("ODE-559 — una respuesta de corrección de A no se aplica sobre B", () => {
  it(
    "control positivo: sin cambiar de documento, la respuesta deja una sugerencia accionable",
    async () => {
      const review = await analysisOfAInFlight()
      expect(acceptButtons(), "nada antes de la respuesta").toBe(0)

      review.release()
      await advance(1500)
      await waitFor(() => acceptButtons() > 0, { label: "sugerencia accionable en A", timeoutMs: 8000 })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si el autor cambió a B, la respuesta de A llega y no deja nada en B",
    async () => {
      const review = await analysisOfAInFlight()

      await pointerClick(tabNode(writingB))
      await waitFor(() => activeWritingId() === writingB && hydrationPhase() === "ready", {
        label: "B activo e hidratado",
        timeoutMs: 10_000,
      })
      expect(mounted!.editor().getText(), "B tiene el mismo párrafo que A").toContain("herror")

      review.release()
      await advance(1500)
      await flush(5)

      expect(activeWritingId(), "B sigue activo").toBe(writingB)
      expect(acceptButtons(), "ninguna sugerencia de A sobre B").toBe(0)
    },
    TEST_TIMEOUT_MS,
  )
})
