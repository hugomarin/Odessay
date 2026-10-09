/**
 * @vitest-environment happy-dom
 *
 * ODE-686 — tab identity and deferred hydration with document components.
 *
 * The shell is opened through its writing-id entry, then real tab pointer
 * gestures select documents. The component nodes are part of each durable
 * IndexedDB row so the test can tell which document the live editor owns.
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
  closeEditorTab,
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  waitFor,
} = await import("./support/editor-shell-harness")
const { createEmptyEditorSession, EDITOR_DRAFT_TAB_ID } = await import(
  "@/lib/local-db/editor-sessions"
)
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 90_000
const TEXT_A = "TAB686_A_BODY"
const TEXT_B = "TAB686_B_BODY"
const TEXT_C = "TAB686_C_BODY"

type JsonNode = { type?: string; attrs?: Record<string, unknown>; content?: JsonNode[] }

let writingA = ""
let writingB = ""
let writingC = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeComponentWriting(id: string, marker: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: marker }] },
        {
          type: "tip",
          attrs: { title },
          content: [
            { type: "paragraph", content: [{ type: "text", text: marker + "_COMPONENT_BODY" }] },
          ],
        },
      ],
    },
    body_text: marker + "\n" + marker + "_COMPONENT_BODY",
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-10-08T00:00:00.000Z",
    updated_at: "2026-10-08T00:00:00.000Z",
    local_updated_at: Date.now(),
  } as LocalWriting
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

function activeWritingId() {
  return activeTab()?.writing_id ?? null
}

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error("No hay pestaña para " + writingId)
  const node = document.querySelector<HTMLElement>('[data-editor-tab-id="' + tab.id + '"]')
  if (!node) throw new Error("La pestaña no está en el DOM para " + writingId)
  return node
}

function editorJson() {
  if (!mounted) throw new Error("La shell no está montada")
  return JSON.stringify(mounted.editor().getJSON())
}

function currentPhase() {
  return document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null
}

function markdownSource() {
  return mounted?.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]') ?? null
}

async function waitForActiveWriting(writingId: string, label: string) {
  await waitFor(() => activeWritingId() === writingId, {
    label,
    timeoutMs: 60_000,
  })
  await waitFor(
    () => currentPhase() === "ready",
    { label: label + " con hydrationPhase ready", timeoutMs: 60_000 },
  )
  await waitFor(
    () => mounted?.editor().getJSON() ?? null,
    { label: label + " con editor hidratado", timeoutMs: 60_000 },
  )
}

async function routeOpen(writingId: string) {
  await mounted!.render({ writingId, key: writingId })
  await waitForActiveWriting(writingId, "apertura por id de " + writingId)
}

async function pointerActivate(writingId: string) {
  await pointerClick(tabNode(writingId))
  await waitForActiveWriting(writingId, "gesto de pestaña de " + writingId)
}

async function switchToMarkdown() {
  if (markdownSource()) return
  const markdownButton = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => candidate.textContent?.trim() === "Markdown")
  if (!markdownButton) throw new Error("No está el botón Markdown de la status bar")
  await act(async () => markdownButton.click())
  await waitFor(() => markdownSource(), { label: "Source Markdown visible", timeoutMs: 60_000 })
}

async function selectMarkdownText(marker: string) {
  const source = markdownSource()
  if (!source) throw new Error("El editor no está en modo Markdown")
  const start = source.value.indexOf(marker)
  if (start < 0) throw new Error("El Source no contiene el rango de control: " + marker)
  const end = start + marker.length
  await act(async () => {
    source.focus()
    source.setSelectionRange(start, end)
    source.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }))
  })
  await flush(1)
  expect({ start: source.selectionStart, end: source.selectionEnd }).toEqual({ start, end })
  return { start, end }
}

/** Abre la pareja por id y deja ambas vistas Markdown con su rango propio guardado. */
async function openMarkdownPairWithSavedViews() {
  const textA = "Markdown A has a long selection target for ODE686."
  const textB = "Markdown B has a different selection target for ODE686."
  await localDB.writings.save(makeComponentWriting(writingA, textA, "TAB686_A_TIP"))
  await localDB.writings.save(makeComponentWriting(writingB, textB, "TAB686_B_TIP"))

  mounted = await mountEditorShell({ writingId: writingA, key: writingA })
  await waitForActiveWriting(writingA, "A abierto por id")
  await routeOpen(writingB)

  await pointerActivate(writingA)
  await switchToMarkdown()
  const selectionA = await selectMarkdownText("long selection")
  await pointerActivate(writingB)
  await switchToMarkdown()
  const selectionB = await selectMarkdownText("different selection")
  await pointerActivate(writingA)
  expect(markdownSource()?.selectionStart, "control positivo: el tab de A restaura su selección").toBe(
    selectionA.start,
  )
  expect(markdownSource()?.selectionEnd).toBe(selectionA.end)
  return { selectionA, selectionB, textA, textB }
}

function holdLocalWritingRead(writingId: string) {
  const original = localDB.writings.get.bind(localDB.writings)
  let release!: () => void
  let arrived!: () => void
  let completed!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  const done = new Promise<void>((resolve) => {
    completed = resolve
  })
  let taken = false
  vi.spyOn(localDB.writings, "get").mockImplementation(async (id: string) => {
    if (id === writingId && !taken) {
      taken = true
      arrived()
      await gate
      const value = await original(id)
      completed()
      return value
    }
    return original(id)
  })
  return { release, started, done }
}

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  writingC = crypto.randomUUID()
  resetEditorShellWorld()
  await writeEditorSession(createEmptyEditorSession())
  await localDB.writings.save(makeComponentWriting(writingA, TEXT_A, "TAB686_A_TIP"))
  await localDB.writings.save(makeComponentWriting(writingB, TEXT_B, "TAB686_B_TIP"))
  await localDB.writings.save(makeComponentWriting(writingC, TEXT_C, "TAB686_C_TIP"))
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

describe("ODE-686 — componentes, tabs e hidratación", () => {
  it(
    "abre A/B/C por id, cambia con puntero y restaura la sesión sin contenido ajeno ni draft fallback",
    async () => {
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      const infos = vi.spyOn(console, "info")
      const warnings = vi.spyOn(console, "warn")
      mounted = await mountEditorShell({ writingId: writingA, key: writingA })
      await waitForActiveWriting(writingA, "A abierto por ruta")
      expect(editorJson()).toContain("TAB686_A_TIP")
      expect(editorJson()).not.toContain("TAB686_B_TIP")

      await routeOpen(writingB)
      expect(editorJson()).toContain("TAB686_B_TIP")
      expect(editorJson()).not.toContain("TAB686_A_TIP")

      await routeOpen(writingC)
      expect(editorJson()).toContain("TAB686_C_TIP")
      expect(editorJson()).not.toContain("TAB686_B_TIP")

      await pointerActivate(writingA)
      expect(editorJson()).toContain("TAB686_A_BODY_COMPONENT_BODY")
      expect(editorJson()).not.toContain("TAB686_C_BODY_COMPONENT_BODY")

      await pointerActivate(writingC)
      expect(editorJson()).toContain("TAB686_C_BODY_COMPONENT_BODY")
      expect(editorJson()).not.toContain("TAB686_A_BODY_COMPONENT_BODY")

      await closeEditorTab(writingB)
      expect(getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingB)).toBe(false)

      await mounted.unmount()
      mounted = null
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingC, key: writingC })
      await waitFor(() => getEditorSessionState().loaded, {
        label: "sesión restaurada",
        timeoutMs: 60_000,
      })
      await waitForActiveWriting(writingC, "sesión restaurada en C")
      await waitFor(() => editorJson().includes("TAB686_C_BODY_COMPONENT_BODY"), {
        label: "contenido de C aplicado tras el remount",
        timeoutMs: 60_000,
      })

      const session = getEditorSessionState().session
      expect(session.tabs.map((tab) => tab.writing_id).sort()).toEqual([writingA, writingC].sort())
      expect(session.tabs.some((tab) => tab.writing_id === EDITOR_DRAFT_TAB_ID)).toBe(false)
      expect(await localDB.writings.get(EDITOR_DRAFT_TAB_ID)).toBeNull()
      expect(editorJson()).toContain("TAB686_C_BODY_COMPONENT_BODY")
      expect(editorJson()).not.toContain("TAB686_A_BODY_COMPONENT_BODY")

      const diagnosticText = [errors.mock.calls, infos.mock.calls, warnings.mock.calls]
        .flat()
        .map((args) => args.map(String).join(" "))
        .join("\n")
      expect(diagnosticText).not.toMatch(/insertion effect|no-restorable-tab/i)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "descarta el restore de A liberado tras que B terminó su hidratación",
    async () => {
      const { selectionA, selectionB, textA, textB } = await openMarkdownPairWithSavedViews()
      await pointerActivate(writingB)
      expect(markdownSource()?.selectionStart, "control positivo: B restaura su selección").toBe(
        selectionB.start,
      )

      const frames = holdAnimationFrames()
      try {
        await pointerClick(tabNode(writingA))
        await waitFor(
          () =>
            activeWritingId() === writingA &&
            currentPhase() === "loading" &&
            markdownSource()?.value.includes(textA) === true &&
            frames.pending() > 0,
          { label: "A agenda su restore Markdown mientras sigue loading", timeoutMs: 60_000 },
        )
        const staleA = frames.takePending()
        expect(staleA.length, "el restore diferido de A quedó retenido").toBeGreaterThan(0)

        await pointerClick(tabNode(writingB))
        await frames.settleUntil(
          () =>
            activeWritingId() === writingB &&
            currentPhase() === "ready" &&
            (markdownSource()?.value.includes(textB) ?? false),
          { label: "B hydrationPhase=ready antes de liberar el callback de A", timeoutMs: 60_000 },
        )
        await frames.settle(6)
        expect(markdownSource()?.selectionStart, "control positivo: B recuperó su rango propio").toBe(
          selectionB.start,
        )
        expect(markdownSource()?.selectionEnd).toBe(selectionB.end)

        await frames.runCallbacks(staleA)
        await frames.settle(6)
        const activeSource = markdownSource()
        expect(activeSource?.selectionStart, "el restore obsoleto de A no mueve la selección de B").toBe(
          selectionB.start,
        )
        expect(activeSource?.selectionEnd).toBe(selectionB.end)
        expect(editorJson()).toContain("TAB686_B_TIP")
        expect(editorJson()).not.toContain("TAB686_A_TIP")
      } finally {
        frames.restore()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "descarta la lectura hidratada de A liberada cuando B ya está ready",
    async () => {
      const { selectionB, textB } = await openMarkdownPairWithSavedViews()
      await pointerActivate(writingB)
      expect(markdownSource()?.selectionStart, "control positivo: B tiene su selección propia").toBe(
        selectionB.start,
      )

      const held = holdLocalWritingRead(writingA)
      try {
        await pointerClick(tabNode(writingA))
        await held.started
        await pointerClick(tabNode(writingB))
        await waitForActiveWriting(writingB, "B vuelve a ready mientras la lectura de A sigue retenida")
        expect(currentPhase()).toBe("ready")
        expect(markdownSource()?.value).toContain(textB)

        held.release()
        await held.done
        await flush(4)

        expect(activeWritingId()).toBe(writingB)
        expect(currentPhase(), "la hidratación vigente no vuelve a loading").toBe("ready")
        expect(editorJson()).toContain("TAB686_B_TIP")
        expect(editorJson()).not.toContain("TAB686_A_TIP")
        expect(markdownSource()?.selectionStart, "A no aplica su rango sobre B").toBe(selectionB.start)
        expect(markdownSource()?.selectionEnd).toBe(selectionB.end)

        await pointerActivate(writingA)
        expect(editorJson()).toContain("TAB686_A_TIP")
        expect(editorJson()).not.toContain("TAB686_B_TIP")
      } finally {
        held.release()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
