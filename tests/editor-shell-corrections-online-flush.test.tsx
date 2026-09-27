/**
 * @vitest-environment happy-dom
 *
 * @contract AI-06 (ODE-597) — Al recuperar la conexión, los bloques de
 * corrección que quedaron solo en la caché local (`syncedAt === null`) del
 * documento activo se vuelcan al proveedor. Los que ya estaban sincronizados
 * no se reenvían, y sin documento activo no se vuelca nada.
 *
 * El handler vive en `useCorrectionLifecycle` (evento `online` de `window`) y
 * llama a `flushPendingCorrectionBlocks` de `useCorrectionBlocks`. El volcado
 * corre en segundo plano y producción traga su error, así que se afirma su
 * efecto en el boundary (regla 7 del capability-proof-contract). El PR #502
 * dejó constancia de que quitar este handler no rompía ninguna prueba.
 *
 * Camino de producción (web): documento abierto por ruta, hidratado sobre
 * fake-indexeddb → bloque pendiente en la caché real de bloques → evento
 * `online` real → lectura real de la caché → volcado por el servicio de AI.
 * Doble: solo el proveedor de AI.
 *
 * El bloque pendiente se siembra DESPUÉS de hidratar: si ya estuviera al
 * abrir, lo volcaría la hidratación (`useDocumentHydration`) y el test no
 * distinguiría quién lo hizo.
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
const { advance, mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)
const { localDB } = await import("@/lib/local-db")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type LocalCorrectionBlock = import("@/lib/local-db/schema").LocalCorrectionBlock

const TEST_TIMEOUT_MS = 40_000
const PARAGRAPH = "Un documento con correcciones pendientes de volcar."

let writingId = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string): LocalWriting {
  return {
    id,
    title: "Documento sin conexión",
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

function makeBlock(ownerId: string, blockId: string, syncedAt: string | null): LocalCorrectionBlock {
  return {
    id: `block-${ownerId}-${blockId}`,
    writingId: ownerId,
    blockId,
    blockHash: `hash-${ownerId}-${blockId}`,
    suggestions: [],
    model: "test-model",
    engineRevision: null,
    createdAt: "2026-09-20T00:00:00.000Z",
    latencyMs: null,
    promptTokens: null,
    completionTokens: null,
    syncedAt,
  }
}

async function goOnline() {
  await act(async () => {
    window.dispatchEvent(new Event("online"))
  })
  await advance(300)
}

beforeEach(async () => {
  // Id nuevo por test: fake-indexeddb persiste entre tests del archivo.
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("AI-06 — volcado de bloques pendientes al recuperar la conexión", () => {
  it(
    "con un documento activo, vuelca solo sus bloques pendientes",
    async () => {
      await localDB.writings.save(makeLocalWriting(writingId))
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes(PARAGRAPH), { label: "hidratación del documento" })
      await waitFor(() => world.correctionHydrationCalls.includes(writingId), {
        label: "la hidratación pidió las correcciones remotas",
        timeoutMs: 5000,
      })
      await advance(300)

      await localDB.correctionBlocks.saveMany([
        makeBlock(writingId, "pending", null),
        makeBlock(writingId, "synced", "2026-09-20T00:00:00.000Z"),
      ])
      const persistsBefore = world.correctionPersistCalls.length

      await goOnline()

      await waitFor(() => world.correctionPersistCalls.length > persistsBefore, {
        label: "el proveedor recibe el bloque pendiente",
        timeoutMs: 5000,
      })
      await advance(300)
      expect(world.correctionPersistCalls.slice(persistsBefore), "solo el pendiente, una vez").toEqual([
        { writingId, blockId: "pending", suggestionStatuses: [] },
      ])
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "sin documento activo, no vuelca nada",
    async () => {
      const otherWritingId = crypto.randomUUID()
      await localDB.correctionBlocks.saveMany([makeBlock(otherWritingId, "pending", null)])
      mounted = await mountEditorShell()
      await advance(300)
      const persistsBefore = world.correctionPersistCalls.length

      await goOnline()

      expect(world.correctionPersistCalls.slice(persistsBefore), "ningún volcado").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})
