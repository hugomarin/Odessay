/**
 * @vitest-environment happy-dom
 *
 * ODE-556 — Humo del camino real de correcciones (web).
 *
 * Property: el análisis de correcciones que el usuario dispara desde el panel
 * llega al proveedor y devuelve sugerencias visibles y accionables sobre el
 * documento activo.
 *
 * Qué NO es: no es la prueba de caracterización 4c (aislamiento entre
 * documentos). Ver la nota al final de este bloque.
 *
 * Camino de producción: documento abierto por ruta → atajo real de
 * correcciones → panel → clic real en "Analyze" → `useManualCorrections`
 * emite la petición → el proveedor responde con el contrato canónico → la
 * sugerencia aparece en el panel con sus acciones.
 *
 * Completion event: se asserta cuando la sugerencia está renderizada y
 * accionable (botón Accept en el DOM), no cuando la petición sale.
 *
 * Colaboradores reales: EditorShell, TipTap + extensiones reales,
 * useManualCorrections, lib/corrections/*, el adaptador de contrato, el panel
 * real y `localDB` sobre fake-indexeddb. Doble: solo el proveedor de AI.
 *
 * ---
 *
 * HALLAZGOS de ODE-556 sobre el subsistema de correcciones, que dejan el
 * requirement 4c SIN cerrar a propósito:
 *
 * 1. La cola **automática** del shell (timers, reintentos, circuit breaker;
 *    ~15 refs y cientos de líneas colgando de `correctionsEnabledRef`) es
 *    **inalcanzable en producción**: `correctionsEnabledRef` se inicializa en
 *    `useRef(false)` y no hay una sola asignación en `editor-shell.tsx`, así
 *    que `processCorrectionQueue` sale por su guarda antes de hacer nada.
 *    Probar esa cola habría sido un `NON_PRODUCTION_PATH` de manual.
 *
 * 2. El camino vivo es el análisis manual, y su invariante de identidad
 *    (`currentWritingIdRef.current !== requestWritingId` en
 *    `useManualCorrections`) **no pudo falsificarse**: quitándolo, y también
 *    neutralizando `isCurrentRun`, una respuesta emitida para A sigue sin
 *    aplicarse sobre B. Algo más arriba ya la descarta, y hasta identificar
 *    qué, cualquier aserción sobre ese invariante sería un verde vacuo
 *    (regla 8 de `workflow/quality/capability-proof-contract.md`).
 *
 *    **Resuelto en ODE-559:** no había nada "más arriba". El hook tenía
 *    cuatro guardas redundantes y la comprobación de identidad aparecía
 *    TRES veces; la mutación de ODE-556 quitó dos y la tercera (en
 *    `runPackages`) siguió protegiendo. Ahora son una sola compuerta,
 *    `isResponseStillCurrent`, con su proof en
 *    `tests/editor-shell-corrections-isolation.test.tsx`.
 *
 * El control positivo de este humo es justo lo que destapó (2): la primera
 * versión de la prueba de 4c afirmaba una ausencia en un mundo donde la
 * ausencia estaba garantizada, porque el payload del doble no cumplía el
 * contrato canónico y el análisis fallaba siempre.
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

const TEST_TIMEOUT_MS = 40_000

const PARAGRAPH = "Este parrafo tiene un herror de ortografia evidente."

/**
 * Id nuevo por test: `fake-indexeddb` es un colaborador real y persiste entre
 * tests del archivo, así que reutilizar el documento haría que el siguiente
 * encontrara bloques ya revisados y no emitiera ninguna petición.
 */
let writingId = ""

function makeLocalWriting(id: string, paragraphs: string[], title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: paragraphs.map((text) => ({ type: "paragraph", content: [{ type: "text", text }] })),
    },
    body_text: paragraphs.join("\n\n"),
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
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingId, [PARAGRAPH], "Documento con erratas"))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/**
 * Abre el panel de correcciones con el atajo real.
 *
 * El shell resuelve la "tecla de comando" según plataforma (`isCommandKey`:
 * ⌘ en mac, Ctrl fuera) y happy-dom no se identifica como mac, así que
 * emitimos las dos variantes — cada una es el gesto real en su plataforma.
 * El helper verifica su propio efecto: un atajo que no abre nada dejaría la
 * prueba navegando por un camino que el usuario no puede producir.
 */
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
    label: "el atajo de correcciones debe abrir el panel con su botón Analyze",
    timeoutMs: 5000,
  })
}

describe("ODE-556 — camino real de correcciones", () => {
  it(
    "entrega sugerencias accionables sobre el documento activo",
    async () => {
      world.aiReview = async (input) => ({
        error: null,
        data: {
          summary: "Una corrección clara.",
          language: "es",
          // Contrato canónico (ver tests/ai-corrections.test.ts): blockId +
          // originalText/replacementText. Con la forma equivocada el análisis
          // falla en silencio y el panel solo dice "no pudimos analizar".
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

      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes("herror"), {
        label: "hidratación del documento",
      })

      await openCorrectionsPanel()
      document.querySelector<HTMLButtonElement>("#corrections-analyze-button")!.click()

      // La petición sale de verdad, y para este documento.
      await waitFor(() => world.aiReviewCalls.length > 0, {
        label: "petición de revisión emitida",
        timeoutMs: 5000,
      })
      expect(world.aiReviewCalls[0]?.writingId).toBe(writingId)
      expect(world.aiReviewCalls[0]?.correctionBlocks?.length ?? 0).toBeGreaterThan(0)

      // Completion event: la sugerencia está renderizada y accionable.
      await advance(1500)
      const accept = await waitFor(
        () => document.querySelector<HTMLButtonElement>('[aria-label="Accept"]'),
        { label: "sugerencia accionable en el panel", timeoutMs: 8000 },
      )
      expect(accept).toBeTruthy()

      const panelText = mounted.container.textContent ?? ""
      expect(panelText).toContain("herror")
      expect(panelText).toContain("error")
    },
    TEST_TIMEOUT_MS,
  )
})
