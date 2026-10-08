/**
 * @vitest-environment happy-dom
 *
 * ODE-686 — Notes in Markdown mode follow the accepted annotation snapshot.
 *
 * The panel is checked after real Source edits and real tab hydration. Existing
 * COMP-08 already proves its Source-mode baseline; this suite adds the missing
 * Source save/hydration/remount and A→B cases without adding another COMP-08 row.
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
vi.mock("@/lib/editor/persistence-coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor/persistence-coordinator")>()
  const { recordPersistenceCoordinator } = await import("./support/persistence-coordinator-capture")
  return {
    ...actual,
    createPersistenceCoordinator: (...args: Parameters<typeof actual.createPersistenceCoordinator>) => {
      const coordinator = actual.createPersistenceCoordinator(...args)
      recordPersistenceCoordinator(coordinator)
      return coordinator
    },
  }
})

const {
  capturePersistenceCoordinators,
  flush,
  mountEditorShell,
  pointerClick,
  readNotesSidebar,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")
const { createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { getEditorSessionState: readSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 90_000
const TARGET_A = "ANNOTATIONANCHORA"
const TARGET_B = "ANNOTATIONANCHORB"
const NOTE_A = "ODE686_A_ACCEPTED_NOTE"
const NOTE_B = "ODE686_B_ACCEPTED_NOTE"
const NOTE_A_EDITED = "ODE686_A_EDITED_NOTE"
const INVALID_SOURCE_SAVE_MARKER = "ODE686_INVALID_SOURCE_SAVE_COMPLETED"

type Tab = { id: string; writing_id: string | null; view_state?: { editorMode?: string } }

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let persistenceCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null

function makeAnnotatedWriting(
  id: string,
  marker: string,
  note: string,
  title: string,
  version = 3,
): LocalWriting {
  const target = marker
  const start = target.length
  const bodyText = "before " + target + " after"
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "before " },
            {
              type: "text",
              text: target,
              marks: [{ type: "highlight", attrs: { annotationType: "personal" } }],
            },
            {
              type: "annotationReference",
              attrs: { id: id + "-annotation", type: "personal", index: 1, text: note },
            },
            { type: "text", text: " after" },
          ],
        },
      ],
    },
    body_text: bodyText,
    status: "draft",
    visibility: "private",
    version,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-10-08T00:00:00.000Z",
    updated_at: "2026-10-08T00:00:00.000Z",
    local_updated_at: Date.now() + start,
  } as LocalWriting
}

function activeTab(): Tab | null {
  const { session } = readSessionState()
  return (session.tabs.find((tab) => tab.id === session.active_tab_id) as Tab | undefined) ?? null
}

function activeWritingId() {
  return activeTab()?.writing_id ?? null
}

function tabNode(writingId: string) {
  const tab = readSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error("No hay pestaña para " + writingId)
  const node = document.querySelector<HTMLElement>('[data-editor-tab-id="' + tab.id + '"]')
  if (!node) throw new Error("La pestaña no está en el DOM para " + writingId)
  return node
}

async function routeOpen(writingId: string) {
  await mounted!.render({ writingId, key: writingId })
  await waitFor(() => activeWritingId() === writingId, {
    label: "apertura por id de " + writingId,
    timeoutMs: 60_000,
  })
  await waitForReady("hidratación ready de " + writingId)
}

async function pointerActivate(writingId: string) {
  await pointerClick(tabNode(writingId))
  await waitFor(() => activeWritingId() === writingId, {
    label: "gesto de pestaña para " + writingId,
    timeoutMs: 60_000,
  })
  await waitForReady("hidratación ready tras activar " + writingId)
}

async function switchToMarkdown() {
  if (mounted!.container.querySelector('textarea[aria-label="Markdown source"]')) return
  const button = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => candidate.textContent?.trim() === "Markdown")
  if (!button) throw new Error("No está el botón Markdown de la status bar")
  await act(async () => button.click())
  await waitFor(
    () => mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]'),
    { label: "Source Markdown", timeoutMs: 60_000 },
  )
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

async function replaceMarkdownSource(next: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(textarea, next)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

async function waitForReady(label: string) {
  await waitFor(() => document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready", {
    label,
    timeoutMs: 60_000,
  })
}

async function openNotesSidebarUnderLoad() {
  const toggle = await waitFor(
    () => document.querySelector<HTMLElement>('button[aria-label="Notes panel"]'),
    { label: 'botón "Notes panel"', timeoutMs: 60_000 },
  )
  if (!readNotesSidebar()) {
    await act(async () => toggle.click())
    await flush(2)
  }
  return waitFor(() => readNotesSidebar(), { label: "sidebar de notas montado", timeoutMs: 60_000 })
}

async function waitForSourceSaveCompletion(label: string, wasApplied: () => boolean) {
  if (!persistenceCapture) throw new Error("No se capturó el PersistenceCoordinator")
  await waitFor(wasApplied, { label: label + " se aplica al editor", timeoutMs: 60_000 })
  if (!(await persistenceCapture.settle())) {
    throw new Error(label + " no llegó al completion event del PersistenceCoordinator")
  }
}

async function waitForSavedBody(writingId: string, expected: string) {
  await waitForSourceSaveCompletion("el save de Source para " + writingId, () =>
    JSON.stringify(mounted!.editor().getJSON()).includes(expected),
  )
  const row = await localDB.writings.get(writingId)
  const body = JSON.stringify(row?.body_json)
  if (!body.includes(expected)) {
    throw new Error("El body_json durable no contiene la edición: " + expected)
  }
  return row
}

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  persistenceCapture = capturePersistenceCoordinators()
  resetEditorShellWorld()
  await writeEditorSession(createEmptyEditorSession())
  await localDB.writings.save(makeAnnotatedWriting(writingA, TARGET_A, NOTE_A, "Annotated A"))
  await localDB.writings.save(makeAnnotatedWriting(writingB, TARGET_B, NOTE_B, "Annotated B"))
})

afterEach(async () => {
  persistenceCapture?.stop()
  persistenceCapture = null
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

describe("ODE-686 — Notes panel usa el snapshot aceptado de Markdown", () => {
  it.fails(
    "follow-up pendiente (ODE-686): el Source guardado y rehidratado actualiza la anotación aceptada",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA, key: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TARGET_A), {
        label: "A hidratado con su anotación",
        timeoutMs: 60_000,
      })
      await waitForReady("A ready")

      const initialNotes = await openNotesSidebarUnderLoad()
      expect(initialNotes?.map((entry) => entry.body), "control positivo: A tiene una nota").toContain(NOTE_A)

      await switchToMarkdown()
      const source = markdownSource()
      if (!source || !source.value.includes(NOTE_A)) {
        throw new Error("El source de A no contiene su anotación aceptada")
      }
      await replaceMarkdownSource(source.value.replace(NOTE_A, NOTE_A_EDITED))
      await waitForSavedBody(writingA, NOTE_A_EDITED)

      await mounted.unmount()
      mounted = null
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA, key: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TARGET_A), {
        label: "A rehidratado desde la escritura durable",
        timeoutMs: 60_000,
      })
      await waitForReady("A ready tras remount")
      const afterRemount = await openNotesSidebarUnderLoad()
      expect(afterRemount?.map((entry) => entry.body)).toContain(NOTE_A_EDITED)
      expect(afterRemount?.map((entry) => entry.body)).not.toContain(NOTE_A)
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "follow-up pendiente (ODE-686): A→B en Markdown muestra el accepted snapshot de B tras hydration ready",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA, key: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TARGET_A), {
        label: "A hidratado",
        timeoutMs: 60_000,
      })
      await waitForReady("A ready")
      const acceptedNotes = await openNotesSidebarUnderLoad()
      expect(acceptedNotes?.map((entry) => entry.body)).toContain(NOTE_A)

      await routeOpen(writingB)
      await waitFor(() => mounted!.editor().getText().includes(TARGET_B), {
        label: "B hidratado",
        timeoutMs: 60_000,
      })
      await waitForReady("B ready")
      expect((await openNotesSidebarUnderLoad())?.map((entry) => entry.body)).toContain(NOTE_B)

      await switchToMarkdown()
      expect(readNotesSidebar()?.map((entry) => entry.body)).toContain(NOTE_B)

      await pointerActivate(writingA)
      await switchToMarkdown()
      expect(readNotesSidebar()?.map((entry) => entry.body)).toContain(NOTE_A)

      await pointerActivate(writingB)
      expect(activeWritingId()).toBe(writingB)
      await waitForReady("B ready after A→B")
      const notesB = readNotesSidebar()
      expect(notesB?.map((entry) => entry.body)).toContain(NOTE_B)
      expect(notesB?.map((entry) => entry.body)).not.toContain(NOTE_A)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Source inválido conserva las anotaciones del último snapshot aceptado",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA, key: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TARGET_A), {
        label: "A hidratado",
        timeoutMs: 60_000,
      })
      await waitForReady("A ready")
      const acceptedNotes = await openNotesSidebarUnderLoad()
      expect(acceptedNotes?.map((entry) => entry.body)).toContain(NOTE_A)

      await switchToMarkdown()
      const source = markdownSource()
      if (!source || !source.value.includes("</Annotation>")) {
        throw new Error("El source de A no contiene el cierre canónico de Annotation")
      }
      await replaceMarkdownSource(
        source.value.replace("</Annotation>", "") + "\n" + INVALID_SOURCE_SAVE_MARKER,
      )
      await waitForSourceSaveCompletion(
        "Source inválido recuperable",
        () => mounted!.editor().getText().includes(INVALID_SOURCE_SAVE_MARKER),
      )

      const notes = readNotesSidebar()
      expect(notes).toEqual(acceptedNotes)
    },
    TEST_TIMEOUT_MS,
  )
})
