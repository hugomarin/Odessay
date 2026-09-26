/**
 * @vitest-environment happy-dom
 *
 * @contract AI-05 / AI-06 (ODE-586) — Aceptar una corrección desde el panel
 * aplica el cambio una sola vez, en el rango y documento previstos, lo guarda
 * y deja la sugerencia resuelta en la caché de bloques. Rechazarla no toca el
 * texto y deja constancia de la decisión.
 *
 * Existe antes de mudar el cluster de correcciones de `editor-shell.tsx` a un
 * hook (corte 2 de la fase 3): aceptar y rechazar no tenían ninguna prueba que
 * pasara por la shell, y la mudanza toca justo ese cableado.
 *
 * Camino de producción (web): documento abierto por ruta → atajo real de
 * correcciones → "Analyze" real → el proveedor responde con el contrato
 * canónico → botón real "Accept" o "Reject" del panel → transacción real de
 * TipTap → guardado real sobre fake-indexeddb. Doble: solo el proveedor de AI.
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

/** Documento abierto, analizado y con la sugerencia accionable en el panel. */
async function analyzedDocument() {
  mounted = await mountEditorShell({ writingId })
  await waitFor(() => mounted!.editor().getText().includes("herror"), { label: "hidratación del documento" })
  await openCorrectionsPanel()
  document.querySelector<HTMLButtonElement>("#corrections-analyze-button")!.click()
  await advance(1500)
  await waitFor(() => document.querySelector<HTMLButtonElement>('[aria-label="Accept"]'), {
    label: "sugerencia accionable",
    timeoutMs: 8000,
  })
}

/** El botón real del panel: "Accept" tiene `aria-label`; "Reject" solo su texto. */
async function pressPanelButton(label: "Accept" | "Reject") {
  const button = Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label || (candidate.textContent ?? "").trim() === label,
  )
  if (!button) throw new Error(`No hay botón ${label} en el panel`)
  await act(async () => {
    button.click()
  })
  await flush(2)
}

async function cachedSuggestionStatuses() {
  const blocks = await localDB.correctionBlocks.getByWriting(writingId)
  return blocks.flatMap((block) => block.suggestions.map((suggestion) => suggestion.status))
}

async function waitForSavedBody(predicate: (body: string) => boolean, label: string) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const body = (await localDB.writings.get(writingId))?.body_text ?? ""
    if (predicate(body)) return body
    await advance(100)
  }
  throw new Error(`El documento guardado nunca cumplió: ${label}`)
}

describe("AI-05 / AI-06 — aceptar y rechazar una corrección desde el panel", () => {
  it(
    "aceptar aplica el cambio una sola vez, lo guarda y deja la sugerencia aceptada",
    async () => {
      await analyzedDocument()
      await pressPanelButton("Accept")

      expect(mounted!.editor().getText(), "el cambio, una sola vez y en su rango").toBe(CORRECTED)
      await waitFor(() => !document.querySelector('[aria-label="Accept"]'), {
        label: "la sugerencia deja de ofrecerse",
      })
      await waitForSavedBody((body) => body === CORRECTED, "lleva la corrección")
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await cachedSuggestionStatuses()).includes("accepted")) break
        await advance(100)
      }
      expect(await cachedSuggestionStatuses(), "la caché de bloques la marca aceptada").toEqual(["accepted"])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "rechazar no toca el texto y deja la sugerencia rechazada",
    async () => {
      await analyzedDocument()
      await pressPanelButton("Reject")

      expect(mounted!.editor().getText(), "el texto no cambia").toBe(PARAGRAPH)
      await waitFor(() => !document.querySelector('[aria-label="Accept"]'), {
        label: "la sugerencia deja de ofrecerse",
      })
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await cachedSuggestionStatuses()).includes("rejected")) break
        await advance(100)
      }
      expect(await cachedSuggestionStatuses(), "la caché de bloques la marca rechazada").toEqual(["rejected"])
      expect((await localDB.writings.get(writingId))?.body_text, "el documento guardado sigue igual").toBe(PARAGRAPH)
    },
    TEST_TIMEOUT_MS,
  )
})
