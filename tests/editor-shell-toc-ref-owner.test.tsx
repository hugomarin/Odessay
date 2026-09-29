/** @vitest-environment happy-dom */
/** ODE-609: real heading updates and TOC navigation; a layout-phase reader
 * observes both refs through the real hook input before passive effects.
 * Mutation: restore the respective passive mirror and deferred write. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("@/hooks/useTableOfContents", async (importOriginal) => {
  const { createTableOfContentsCaptureModule } = await import("./support/editor-shell-doubles")
  return createTableOfContentsCaptureModule(await importOriginal<Record<string, unknown>>())
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

const { mountEditorShell, resetEditorShellWorld, waitFor, waitForHydrationReady, world } = await import(
  "./support/editor-shell-harness"
)

const { act } = await import("react")

const TEST_TIMEOUT_MS = 40_000
const TEXT = "Texto del documento con un editor propio."

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [{ type: "heading", attrs: { level: 1 }, content: [{ type: "text", text: bodyText }] }, { type: "heading", attrs: { level: 2 }, content: [{ type: "text", text: "Segundo encabezado" }] }],
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

describe("ODE-609 — TOC refs before passive effects", () => {
  it.fails.each(["items", "active"] as const)("%s pertenece al estado del commit actual", async (kind) => {
    const stale: string[] = []
    let observed = 0
    world.onShellCommit = () => {
      const input = world.shellTableOfContentsInput
      if (!input) return
      if (kind === "items" && input.tableOfContentsItems.length > 0) {
        observed++
        if (input.tableOfContentsItemsRef.current !== input.tableOfContentsItems) stale.push("items anteriores")
      }
      if (kind === "active" && input.selectedTableOfContentsItemId !== null) {
        observed++
        if (input.activeTableOfContentsItemIdRef.current !== input.selectedTableOfContentsItemId) stale.push("activo anterior")
      }
    }
    mounted = await mountEditorShell({ writingId })
    await waitForHydrationReady()
    const toggle = await waitFor(() => mounted!.container.querySelector<HTMLButtonElement>('button[aria-label="Table of contents"]'), { label: "abrir TOC" })
    await act(async () => toggle.click())
    const item = await waitFor(() => {
      const items = mounted!.container.querySelectorAll<HTMLButtonElement>('nav[aria-label="Artifact sections"] button')
      return items.length === 2 ? items[1] : null
    }, { label: "segundo encabezado de TOC" })
    await act(async () => item.click())
    world.onShellCommit = null
    expect(observed, "control positivo: un commit con items / activo").toBeGreaterThan(0)
    expect(stale, "no queda el valor del commit anterior").toEqual([])
  }, TEST_TIMEOUT_MS)
})
