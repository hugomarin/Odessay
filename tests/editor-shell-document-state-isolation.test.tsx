/**
 * @vitest-environment happy-dom
 *
 * ODE-625 — document ownership for annotation projections and Markdown selection.
 *
 * These regressions use the real shell/hydration path. The only held work is
 * requestAnimationFrame, which opens the production window between applying a
 * document and restoring its saved selection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"

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
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")

const ANNOTATED_A = "62511111-1111-4111-8111-111111111111"
const EMPTY_B = "62522222-2222-4222-8222-222222222222"
const SELECTION_A = "62533333-3333-4333-8333-333333333333"
const SELECTION_B = "62544444-4444-4444-8444-444444444444"

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

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

async function clickTab(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)

  await pointerClick(node)
  if (getEditorSessionState().session.active_tab_id !== tab.id) {
    throw new Error(`El gesto no activó la pestaña de ${writingId}`)
  }
}

async function clickButton(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.getAttribute("aria-label") === label,
  )
  if (!button) throw new Error(`No existe el botón ${label}`)

  await act(async () => button.click())
  await flush(2)
}

async function clickButtonByText(container: HTMLElement, label: string) {
  const button = Array.from(container.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === label,
  )
  if (!button) throw new Error(`No existe el botón ${label}`)

  await act(async () => button.click())
  await flush(2)
}

async function setMarkdownSelection(container: HTMLElement, selectedText: string) {
  const textarea = await waitFor(
    () => container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source"]'),
    { label: "textarea Markdown visible" },
  )
  const start = textarea.value.indexOf(selectedText)
  if (start < 0) throw new Error(`No se encontró la selección ${selectedText} en Markdown`)
  const end = start + selectedText.length

  await act(async () => {
    textarea.setSelectionRange(start, end)
    textarea.dispatchEvent(new Event("select", { bubbles: true }))
  })
  await flush(1)

  return { start, end }
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

  it("keeps B's saved Markdown selection when leaving before B's restore frame runs", async () => {
    await localDB.writings.save(
      makeLocalWriting(SELECTION_A, "Documento A", "Texto propio de A para seleccionar."),
    )
    await localDB.writings.save(
      makeLocalWriting(SELECTION_B, "Documento B", "Texto propio de B con selección distinta."),
    )

    mounted = await mountEditorShell({ writingId: SELECTION_A })
    await waitFor(() => mounted!.editor().getText().includes("Texto propio de A"), {
      label: "hidratación de A",
    })

    // Abrir B por la ruta real produce la segunda pestaña; su selección se
    // establece después de activar cada pestaña y el shell la guarda al salir.
    await mounted.render({ writingId: SELECTION_B })
    await waitFor(() => mounted!.editor().getText().includes("Texto propio de B"), {
      label: "hidratación de B",
    })

    await clickTab(SELECTION_A)
    await waitFor(() => mounted!.editor().getText().includes("Texto propio de A"), {
      label: "A activo antes de fijar su selección",
    })
    await clickButtonByText(mounted.container, "Markdown")
    const selectionA = await setMarkdownSelection(mounted.container, "seleccionar")

    await clickTab(SELECTION_B)
    await waitFor(() => mounted!.editor().getText().includes("Texto propio de B"), {
      label: "B activo antes de fijar su selección",
    })
    await clickButtonByText(mounted.container, "Markdown")
    const selectionB = await setMarkdownSelection(mounted.container, "selección distinta")

    await clickTab(SELECTION_A)
    await waitFor(
      () => mounted!.container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source"]')?.value.includes("Texto propio de A"),
      { label: "A vuelve en modo Markdown" },
    )
    await flush(4)

    expect(tabFor(SELECTION_B)?.view_state?.markdownSelectionStart).toBe(selectionB.start)
    expect(tabFor(SELECTION_B)?.view_state?.markdownSelectionEnd).toBe(selectionB.end)

    const textareaA = mounted.container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source"]')
    expect(textareaA?.selectionStart).toBe(selectionA.start)
    expect(textareaA?.selectionEnd).toBe(selectionA.end)

    const frames = holdAnimationFrames()
    try {
      await clickTab(SELECTION_B)
      await waitFor(
        () => mounted!.container.querySelector<HTMLTextAreaElement>('[aria-label="Markdown source"]')?.value.includes("Texto propio de B"),
        { label: "B contenido aplicado antes del frame de restauración" },
      )
      expect(mounted.container.querySelector("[data-hydration-phase]")?.getAttribute("data-hydration-phase")).toBe(
        "loading",
      )
      expect(frames.pending(), "B tiene trabajo de restauración diferido pendiente").toBeGreaterThan(0)

      // Salir de B con su rAF de restauración todavía retenido debe guardar su
      // selección anterior, nunca el ref que sigue perteneciendo a A.
      await clickTab(SELECTION_A)

      expect(tabFor(SELECTION_B)?.view_state?.markdownSelectionStart).toBe(selectionB.start)
      expect(tabFor(SELECTION_B)?.view_state?.markdownSelectionEnd).toBe(selectionB.end)
    } finally {
      frames.restore()
    }
  }, SHELL_TEST_TIMEOUT_MS)
})
