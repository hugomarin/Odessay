/** @vitest-environment happy-dom */
/** ODE-609: real analysis and learned-word loading through the real shell.
 * A layout-phase observer reads real lifecycle inputs before passive effects.
 * Mutation: restore the delayed mirrors instead of synchronous state writers. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("@/hooks/useCorrectionLifecycle", async (importOriginal) => {
  const { createCorrectionLifecycleCaptureModule } = await import("./support/editor-shell-doubles")
  return createCorrectionLifecycleCaptureModule(await importOriginal<Record<string, unknown>>())
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
const { localDB } = await import("@/lib/local-db")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting

const TEST_TIMEOUT_MS = 40_000
const PARAGRAPH = "Este parrafo tiene un herror de ortografia evidente."

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
  world.learnedWords = [{ id: "learned-ode609", word: "palabraaprendida", language: "es", createdAt: "2026-09-20T00:00:00.000Z" }]
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
  world.onShellCommit = null
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

describe("ODE-609 — correction refs before passive effects", () => {
  it.each(["suggestions", "learned"] as const)("%s se lee como el estado del commit actual", async (kind) => {
    const stale: string[] = []
    let observed = 0
    world.onShellCommit = () => {
      const input = world.shellCorrectionLifecycleInput
      if (!input) return
      if (kind === "suggestions" && input.automaticCorrectionSuggestions.length > 0) {
        observed++
        if (input.automaticCorrectionSuggestionsRef.current !== input.automaticCorrectionSuggestions) stale.push("sugerencias anteriores")
      }
      if (kind === "learned" && input.learnedWords.length > 0) {
        observed++
        if (input.learnedWordsRef.current !== input.learnedWords) stale.push("palabras anteriores")
      }
    }
    await analyzedDocument()
    await waitFor(() => world.shellCorrectionLifecycleInput?.learnedWords.length, { label: "palabras cargadas desde el proveedor" })
    world.onShellCommit = null
    expect(observed, "control positivo: commit con datos del proveedor").toBeGreaterThan(0)
    expect(stale, "ninguna lectura del estado anterior").toEqual([])
  }, TEST_TIMEOUT_MS)
})
