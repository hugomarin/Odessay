/**
 * @vitest-environment happy-dom
 *
 * @contract AI-05 / AI-06 (ODE-597) — Aceptar, rechazar o aprender una
 * corrección desde la burbuja de la decoración en línea tiene el mismo efecto
 * que hacerlo desde el panel: la transacción correcta en el editor, la
 * sugerencia resuelta en la caché de bloques y el bloque volcado al proveedor.
 *
 * Hasta ODE-597 solo se probaba el botón del panel. La burbuja entra por otro
 * camino: la extensión de la decoración despacha
 * `odessay:publication-suggestion-action` y lo atiende
 * `handleAutomaticInlineAction` en `useCorrectionLifecycle`. Si ese listener
 * desaparece, la burbuja se cierra y no pasa nada, en silencio.
 *
 * Camino de producción (web): documento abierto por ruta → atajo real de
 * correcciones → "Analyze" real → el proveedor responde con el contrato
 * canónico → click real en el texto decorado → click real en la acción de la
 * burbuja → transacción real de TipTap → caché real sobre fake-indexeddb.
 * Doble: solo el proveedor de AI (review, volcado de bloques, learn word).
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

const { act } = await import("react")
const { advance, flush, mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)
const { localDB } = await import("@/lib/local-db")
const { CORRECTION_MEMORY_STORAGE_KEY } = await import("@/lib/editor/correction-memory-client")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting

const TEST_TIMEOUT_MS = 40_000
const PARAGRAPH = "Este parrafo tiene un herror de ortografia evidente."
const CORRECTED = "Este parrafo tiene un error de ortografia evidente."

let writingId = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string): LocalWriting {
  return {
    id,
    title: "Documento con erratas",
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
  // Id nuevo por test: fake-indexeddb persiste entre tests del archivo.
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
  // Rechazar y aprender recuerdan la huella de la corrección en localStorage,
  // y la admisión filtra esa huella en cualquier documento. Sin esto, el test
  // siguiente analiza y no recibe ninguna sugerencia.
  window.localStorage.removeItem(CORRECTION_MEMORY_STORAGE_KEY)
  world.aiReview = async (input) => ({
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
  })
  await localDB.writings.save(makeLocalWriting(writingId))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

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

/** Documento abierto, analizado y con la sugerencia decorada en el texto. */
async function analyzedDocument() {
  mounted = await mountEditorShell({ writingId })
  await waitFor(() => mounted!.editor().getText().includes("herror"), { label: "hidratación del documento" })
  await openCorrectionsPanel()
  document.querySelector<HTMLButtonElement>("#corrections-analyze-button")!.click()
  await advance(1500)
  await waitFor(() => mounted!.prosemirror()?.querySelector(".pub-suggestion-pending[data-suggestion-id]"), {
    label: "la sugerencia decorada en el texto",
    timeoutMs: 8000,
  })
}

/**
 * El gesto real: click en el texto decorado (abre la burbuja) y click en la
 * acción de la burbuja. Ambos pasan por el `handleDOMEvents.click` de la
 * extensión, que es quien despacha el evento; el test nunca lo despacha a mano.
 */
async function pressInlineAction(action: "accept" | "reject" | "learn") {
  const decorated = mounted!.prosemirror()!.querySelector<HTMLElement>(".pub-suggestion-pending[data-suggestion-id]")
  if (!decorated) throw new Error("No hay texto decorado")
  await act(async () => {
    decorated.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
  await flush(2)
  const button = await waitFor(
    () => mounted!.prosemirror()?.querySelector<HTMLButtonElement>(`.pub-suggestion-bubble-action[data-action="${action}"]`),
    { label: `la acción "${action}" de la burbuja`, timeoutMs: 5000 },
  )
  await act(async () => {
    button.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }))
  })
  await flush(2)
}

/** Estados de las sugerencias del bloque en caché, hasta que coincidan con `expected`. */
async function waitForCachedStatuses(expected: string[]) {
  let statuses: string[] = []
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const blocks = await localDB.correctionBlocks.getByWriting(writingId)
    statuses = blocks.flatMap((block) => block.suggestions.map((suggestion) => suggestion.status))
    if (JSON.stringify(statuses) === JSON.stringify(expected)) return statuses
    await advance(100)
  }
  return statuses
}

/**
 * Regla 7: el volcado remoto corre en segundo plano y su error se traga; se
 * afirma aparte. Solo cuentan los volcados posteriores a `sinceCall`, para no
 * confundirlos con el del análisis.
 */
async function waitForRemotePersist(sinceCall: number, expected: string[]) {
  await waitFor(
    () =>
      world.correctionPersistCalls
        .slice(sinceCall)
        .some(
          (call) =>
            call.writingId === writingId &&
            call.blockId !== undefined &&
            JSON.stringify(call.suggestionStatuses ?? []) === JSON.stringify(expected),
        ),
    { label: `el proveedor recibe el bloque con [${expected.join(", ")}]`, timeoutMs: 5000 },
  )
}

function decoratedSuggestionCount() {
  return mounted!.prosemirror()?.querySelectorAll(".pub-suggestion-pending[data-suggestion-id]").length ?? 0
}

describe("AI-05 / AI-06 — acciones desde la burbuja de la decoración en línea", () => {
  it(
    "aceptar aplica el cambio una sola vez, lo marca aceptado y lo vuelca al proveedor",
    async () => {
      await analyzedDocument()
      const persistsBefore = world.correctionPersistCalls.length
      await pressInlineAction("accept")

      expect(mounted!.editor().getText(), "el cambio, una sola vez y en su rango").toBe(CORRECTED)
      await waitFor(() => decoratedSuggestionCount() === 0, { label: "la decoración desaparece" })
      expect(await waitForCachedStatuses(["accepted"]), "la caché de bloques la marca aceptada").toEqual(["accepted"])
      await waitForRemotePersist(persistsBefore, ["accepted"])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "rechazar no toca el texto, lo marca rechazado y lo vuelca al proveedor",
    async () => {
      await analyzedDocument()
      const persistsBefore = world.correctionPersistCalls.length
      await pressInlineAction("reject")

      expect(mounted!.editor().getText(), "el texto no cambia").toBe(PARAGRAPH)
      await waitFor(() => decoratedSuggestionCount() === 0, { label: "la decoración desaparece" })
      expect(await waitForCachedStatuses(["rejected"]), "la caché de bloques la marca rechazada").toEqual(["rejected"])
      await waitForRemotePersist(persistsBefore, ["rejected"])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "aprender no toca el texto, manda la palabra al proveedor y saca la sugerencia del bloque",
    async () => {
      await analyzedDocument()
      const persistsBefore = world.correctionPersistCalls.length
      await pressInlineAction("learn")

      expect(mounted!.editor().getText(), "el texto no cambia").toBe(PARAGRAPH)
      await waitFor(() => world.learnWordCalls.length > 0, { label: "el proveedor recibe la palabra" })
      expect(world.learnWordCalls.map((call) => call.word)).toEqual(["herror"])
      await waitFor(() => decoratedSuggestionCount() === 0, { label: "la decoración desaparece" })
      // La admisión con la palabra ya aprendida filtra la sugerencia: el bloque
      // queda sin ella, no con ella rechazada.
      expect(await waitForCachedStatuses([]), "la caché de bloques ya no la tiene").toEqual([])
      await waitForRemotePersist(persistsBefore, [])
    },
    TEST_TIMEOUT_MS,
  )
})
