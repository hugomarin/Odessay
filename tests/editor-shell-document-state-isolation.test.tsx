/**
 * @vitest-environment happy-dom
 *
 * ODE-625 — the Notes panel follows the document that finished hydration.
 *
 * Real shell/hydration path. This case keeps the Notes panel OPEN while the
 * route switches from A to B (same `version`), the path the network cases in
 * `editor-shell-annotation-roundtrip.test.tsx` do not take (they open the
 * panel after switching). The Markdown-selection regression that used to live
 * here was an exact duplicate of the ODE-606 case in
 * `editor-shell-selection-restore.test.tsx` and was removed in favor of it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

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

const {
  assertNoUnhandledErrors,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")

const ANNOTATED_A = "62511111-1111-4111-8111-111111111111"
const EMPTY_B = "62522222-2222-4222-8222-222222222222"

const SHELL_TEST_TIMEOUT_MS = 30_000

function makeLocalWriting(
  id: string,
  title: string,
  bodyText: string,
  options: { version?: number; bodyJson?: Record<string, unknown> } = {},
): LocalWriting {
  return {
    id,
    title,
    body_json:
      options.bodyJson ?? {
        type: "doc",
        content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
      },
    body_text: bodyText,
    status: "draft",
    visibility: "private",
    version: options.version ?? 3,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-09-20T00:00:00.000Z",
    updated_at: "2026-09-20T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  if (!button) throw new Error(`No existe el botón ${label}`)

  await act(async () => button.click())
  await flush(2)
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(() => {
  resetEditorShellWorld()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  assertNoUnhandledErrors()
})

describe("ODE-625 — editor state stays with its document", () => {
  it("recomputes the Notes panel from the document that finished hydration", async () => {
    const annotationBody = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Ancla exclusiva del documento A" },
            {
              type: "annotationReference",
              attrs: { id: "ode-625-a-note", type: "ai", index: 1, text: "Instrucción exclusiva de A" },
            },
          ],
        },
      ],
    }

    await localDB.writings.save(
      makeLocalWriting(ANNOTATED_A, "Documento A", "Ancla exclusiva del documento A", {
        bodyJson: annotationBody,
        version: 3,
      }),
    )
    await localDB.writings.save(
      makeLocalWriting(EMPTY_B, "Documento B", "Contenido exclusivo del documento B", { version: 3 }),
    )

    mounted = await mountEditorShell({ writingId: ANNOTATED_A })
    await waitFor(() => mounted!.editor().getText().includes("Ancla exclusiva del documento A"), {
      label: "hidratación del documento A con anotación",
    })
    await clickButton(mounted.container, "Notes panel")

    const notesPanel = await waitFor(
      () => mounted!.container.querySelector<HTMLElement>('[data-testid="editor-panel-notes"]'),
      { label: "panel de notas abierto" },
    )
    await waitFor(
      () =>
        Array.from(notesPanel.querySelectorAll("textarea")).some(
          (textarea) => textarea.value === "Instrucción exclusiva de A",
        ),
      { label: "anotación de A visible en Notes" },
    )

    // La shell sigue montada al navegar por ruta. Ambos documentos tienen la
    // misma versión, y B no tiene anotaciones.
    await mounted.render({ writingId: EMPTY_B })
    await waitFor(() => mounted!.editor().getText().includes("Contenido exclusivo del documento B"), {
      label: "contenido de B aplicado al editor",
    })
    await waitFor(() => mounted!.container.querySelector('[data-hydration-phase]')?.getAttribute("data-hydration-phase") === "ready", {
      label: "hidratación de B completada",
    })

    const visibleNotes = Array.from(notesPanel.querySelectorAll("textarea")).map((textarea) => textarea.value)
    expect(visibleNotes).not.toContain("Instrucción exclusiva de A")
    expect(notesPanel.textContent).toContain("No notes yet.")
  }, SHELL_TEST_TIMEOUT_MS)
})
