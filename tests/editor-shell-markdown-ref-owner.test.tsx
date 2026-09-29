/** @vitest-environment happy-dom */
/** ODE-609: real shell, real hydration; a layout-phase reader observes the
 * derived markdown through its real correction consumer before passive effects.
 * Mutation: restore the passive mirror in place of the render writer. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

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

const { mountEditorShell, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)

const TEST_TIMEOUT_MS = 40_000
const TEXT = "Texto del documento con un editor propio."

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

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let writingId = ""

beforeEach(async () => {
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingId, TEXT, "Documento con editor"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

describe("ODE-609 — markdown derivado disponible antes del efecto pasivo", () => {
  it.fails("el lector de correcciones recibe el markdown del commit que acaba de adoptar", async () => {
    const readings: Array<{ live: string; adopted: string }> = []
    world.onShellCommit = () => {
      const input = world.shellCorrectionLifecycleInput
      const adopted = world.editor?.getText() ?? ""
      if (input && adopted.includes(TEXT)) {
        readings.push({ live: input.currentDocumentMarkdownRef.current, adopted })
      }
    }
    mounted = await mountEditorShell({ writingId })
    await waitFor(() => mounted!.editor().getText().includes(TEXT), { label: "documento hidratado" })
    world.onShellCommit = null
    expect(readings.length, "control positivo: commits con el documento adoptado").toBeGreaterThan(0)
    expect(readings.filter(({ live, adopted }) => !live.includes(adopted)), "ninguna lectura del markdown anterior").toEqual([])
  }, TEST_TIMEOUT_MS)
})
