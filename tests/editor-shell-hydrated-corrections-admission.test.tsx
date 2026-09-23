/**
 * @vitest-environment happy-dom
 *
 * ODE-562 — Las sugerencias hidratadas desde caché pasan por la admisión.
 *
 * Property (skill-corrections, Regla 2 — admisión única): una sugerencia
 * guardada en la caché de bloques no se muestra al reabrir el documento si ya
 * no la admitiría el filtro vigente. El caso real: el usuario aprendió la
 * palabra después de que la caché se escribiera.
 *
 * Por qué existe antes del corte: la hidratación de la caché vive en el
 * efecto de hidratación de `editor-shell.tsx`, que ODE-562 muda a un hook. Si
 * la mudanza dejara de pasar por `admitCorrectionSuggestions`, nada se pondría
 * en rojo: la admisión tiene unit tests, pero su cableado con la hidratación
 * no lo vigilaba ninguno.
 *
 * Camino de producción, en dos sesiones:
 *   1. Sesión 1, sin palabras aprendidas: documento abierto por ruta →
 *      análisis real desde el panel → el shell escribe la caché de bloques
 *      por su propio camino (no se siembra a mano: el formato normalizado de
 *      una sugerencia es justo donde un doble mal hecho falla en silencio).
 *   2. Sesión 2, con "herror" ya aprendida: shell nuevo sobre otro documento
 *      (las palabras aprendidas cargan ahí, ANTES de la hidratación que
 *      importa) → apertura del documento por ruta → hidratación desde caché.
 * Que la lista cargue antes importa: el shell re-admite lo visible cuando la
 * lista llega, y si llegara después taparía una hidratación sin admisión.
 *
 * Control positivo: la otra sugerencia del mismo bloque (palabra no
 * aprendida) SÍ aparece. Sin eso, la ausencia de "herror" podría deberse a
 * que la hidratación no entregó nada.
 *
 * Completion event: el panel muestra la sugerencia admitida.
 *
 * Mutation test (ODE-562): saltarse `admitCorrectionSuggestions` en la
 * hidratación (pasar `flattenPersistedSuggestions(...)` directo) la pone en
 * rojo — "herror" reaparece.
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

const { advance, flush, mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)

const TEST_TIMEOUT_MS = 60_000

const PARAGRAPH = "Este parrafo tiene un herror de ortografia evidente."
const LEARNED = { original: "herror", replacement: "error" }
const NOT_LEARNED = { original: "ortografia", replacement: "ortografía" }

let writingId = ""
let otherWritingId = ""

function makeLocalWriting(id: string, text: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text }] }],
    },
    body_text: text,
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

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  // Ids nuevos por test: fake-indexeddb es real y persiste en el archivo.
  writingId = crypto.randomUUID()
  otherWritingId = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingId, PARAGRAPH, "Documento con erratas"))
  await localDB.writings.save(makeLocalWriting(otherWritingId, "Otro documento limpio.", "Otro"))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/** Abre el panel con el atajo real (mismo helper que el humo de corrections). */
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
    label: "el atajo de correcciones debe abrir el panel",
    timeoutMs: 5000,
  })
}

/** Texto original de cada sugerencia visible, leído SOLO del panel. */
function visibleSuggestionOriginals() {
  const panel = document.querySelector("#editor-panel-corrections")
  return Array.from(panel?.querySelectorAll(".pub-suggestion-pending") ?? []).map(
    (node) => node.textContent ?? "",
  )
}

describe("ODE-562 — la hidratación de la caché de correcciones pasa por la admisión", () => {
  it(
    "no muestra al reabrir una sugerencia sobre una palabra aprendida después de escribirse la caché",
    async () => {
      // --- Sesión 1: el análisis real escribe la caché con las dos sugerencias.
      world.aiReview = async (input) => ({
        error: null,
        data: {
          summary: "Dos correcciones.",
          language: "es",
          corrections: (input.correctionBlocks ?? []).flatMap((block) =>
            [LEARNED, NOT_LEARNED].map((entry) => ({
              blockId: block.id,
              type: "spelling",
              severity: "medium",
              confidence: "high",
              originalText: entry.original,
              replacementText: entry.replacement,
              reason: "Falta de ortografía.",
            })),
          ),
        },
      })

      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes("herror"), {
        label: "hidratación del documento (sesión 1)",
      })
      await openCorrectionsPanel()
      document.querySelector<HTMLButtonElement>("#corrections-analyze-button")!.click()
      await advance(1500)
      await waitFor(() => visibleSuggestionOriginals().length === 2, {
        label: "las dos sugerencias visibles tras el análisis",
        timeoutMs: 8000,
      })

      // Precondición: la caché quedó escrita por el shell con ambas.
      // (Bucle propio: `waitFor` no espera predicados asíncronos.)
      let cachedOriginals: string[] = []
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const blocks = await localDB.correctionBlocks.getByWriting(writingId)
        cachedOriginals = blocks.flatMap((block) => block.suggestions.map((s) => s.original_text))
        if (cachedOriginals.includes(LEARNED.original) && cachedOriginals.includes(NOT_LEARNED.original)) break
        await advance(200)
      }
      expect(cachedOriginals, "caché de bloques con las dos sugerencias").toEqual(
        expect.arrayContaining([LEARNED.original, NOT_LEARNED.original]),
      )

      await mounted.unmount()
      mounted = null

      // --- Sesión 2: el usuario aprendió "herror" entretanto.
      resetEditorShellWorld({
        learnedWords: [
          { id: "lw-1", word: LEARNED.original, language: "es", createdAt: "2026-09-21T00:00:00.000Z" },
        ],
      })

      // Otro documento primero: la lista de palabras aprendidas carga aquí,
      // antes de la hidratación bajo prueba.
      mounted = await mountEditorShell({ writingId: otherWritingId })
      await waitFor(() => mounted!.editor().getText().includes("Otro documento"), {
        label: "hidratación del otro documento",
      })
      await waitFor(() => world.learnedWordsCalls > 0, { label: "palabras aprendidas pedidas" })
      await flush(4)

      // Apertura del documento con caché, por el mismo camino de ruta.
      await mounted.render({ writingId })
      await waitFor(() => mounted!.editor().getText().includes("herror"), {
        label: "hidratación del documento (sesión 2)",
      })
      await openCorrectionsPanel()

      // Control positivo: la hidratación sí entregó la caché.
      await waitFor(() => visibleSuggestionOriginals().includes(NOT_LEARNED.original), {
        label: "la sugerencia no aprendida vuelve desde la caché",
        timeoutMs: 8000,
      })

      // La propiedad: la aprendida no pasa la admisión.
      expect(
        visibleSuggestionOriginals(),
        "una palabra aprendida no puede reaparecer desde la caché",
      ).not.toContain(LEARNED.original)
      // Y no hubo análisis nuevo que explique lo visto: todo vino de la caché.
      expect(world.aiReviewCalls).toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )
})
