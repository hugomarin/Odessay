/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-602 (corte 4a, entrega 1) — red del focus mode y de los paneles
 * A TRAVÉS de la shell, antes de mudar su cableado a hooks. La regla pura de
 * Escape (`resolveEscapeIntent`) ya tiene `tests/panel-behavior.test.ts`; lo
 * que no tenía prueba es el cableado de la shell: el atajo, lo que el focus
 * mode oculta y restaura, y qué cierra `closeActivePanel`.
 *
 *   1. El focus mode entra y sale sin perder la selección ni el contenido.
 *   2. Al salir, restaura el panel y la búsqueda que estaban abiertos.
 *   3. `closeActivePanel` (botón "Close panel") cierra el panel lateral que
 *      esté activo, sea cual sea la pestaña del panel.
 *   4. Escape cierra primero la búsqueda, después el panel, y fuera de eso
 *      sale del focus mode.
 *
 * Camino de producción (web): documento abierto por ruta; atajos reales sobre
 * `window` (⌘⇧F / Ctrl+Shift+F, ⌘F, ⌘⌥S); botones reales del status bar y del
 * panel. Dobles: solo la red y el proveedor de AI (harness).
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
  fillTextField,
  flush,
  mountEditorShell,
  pressEditorShortcut,
  pressEscape,
  resetEditorShellWorld,
  selectEditorText,
  waitFor,
} = await import("./support/editor-shell-harness")

const TEST_TIMEOUT_MS = 30_000
const TEXT = "El texto del documento con una frase seleccionada en medio."

let writingId = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string): LocalWriting {
  return {
    id,
    title: "Documento enfocado",
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: TEXT }] }] },
    body_text: TEXT,
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
  await localDB.writings.save(makeLocalWriting(writingId))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

async function openDocument() {
  mounted = await mountEditorShell({ writingId })
  await waitFor(() => mounted!.editor().getText().includes(TEXT), { label: "documento hidratado", timeoutMs: 10_000 })
}

function shellFocusMode() {
  return document.querySelector<HTMLElement>('[data-page="editor"]')?.dataset.focusMode ?? null
}

async function toggleFocusMode() {
  await pressEditorShortcut({ key: "F", code: "KeyF", shift: true })
}

function rightPanelTabs() {
  return document.querySelector<HTMLElement>('[data-testid="editor-right-panel-tabs"]')
}

function activeRightPanelTab() {
  return (rightPanelTabs()?.querySelector('[role="tab"][aria-selected="true"]')?.textContent ?? "").trim() || null
}

function findPanel() {
  return document.querySelector('section[aria-label="Find and replace"]')
}

async function openNotesPanel() {
  const toggle = await waitFor(() => document.querySelector<HTMLButtonElement>('button[aria-label="Notes panel"]'), {
    label: 'botón "Notes panel"',
  })
  await act(async () => {
    toggle.click()
  })
  await flush(2)
  await waitFor(() => activeRightPanelTab()?.startsWith("Notes"), { label: "panel de notas abierto" })
}

async function openFindPanel(query: string) {
  await pressEditorShortcut({ key: "f", code: "KeyF" })
  const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Find text"]'), {
    label: "panel de find/replace abierto",
  })
  await fillTextField(input, query)
}

function editorSelection() {
  const { from, to } = mounted!.editor().state.selection
  return { from, to }
}

describe("ODE-602 — focus mode a través de la shell", () => {
  it(
    "entra y sale sin perder la selección ni el contenido",
    async () => {
      await openDocument()
      const selected = await selectEditorText("frase seleccionada")
      expect(document.querySelector('[data-testid="editor-topbar"]'), "control: la topbar se ve").toBeTruthy()

      await toggleFocusMode()
      expect(shellFocusMode(), "el atajo entra en focus mode").toBe("true")
      expect(document.body.classList.contains("od-editor-focus-mode")).toBe(true)
      expect(document.querySelector('[data-testid="editor-topbar"]'), "el focus mode oculta la topbar").toBeNull()
      expect(document.querySelector('[data-testid="editor-statusbar"]'), "y el status bar").toBeNull()
      expect(mounted!.editor().getText(), "el contenido sigue").toBe(TEXT)
      expect(editorSelection(), "la selección sigue").toEqual(selected)

      await toggleFocusMode()
      expect(shellFocusMode(), "el atajo sale del focus mode").toBe("false")
      expect(document.body.classList.contains("od-editor-focus-mode")).toBe(false)
      expect(document.querySelector('[data-testid="editor-topbar"]'), "vuelve la topbar").toBeTruthy()
      expect(mounted!.editor().getText(), "el contenido sigue al salir").toBe(TEXT)
      expect(editorSelection(), "la selección sigue al salir").toEqual(selected)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "al salir restaura el panel y la búsqueda que estaban abiertos",
    async () => {
      // Mutación: en `exitFocusMode`, no restaurar `focusModeRestorationRef`
      // → rojo: al salir no vuelven ni el panel ni la búsqueda.
      await openDocument()
      await openNotesPanel()
      await openFindPanel("frase")
      expect(findPanel(), "control: la búsqueda está abierta").toBeTruthy()

      await toggleFocusMode()
      expect(rightPanelTabs(), "el focus mode cierra el panel").toBeNull()
      expect(findPanel(), "y la búsqueda").toBeNull()

      await toggleFocusMode()
      expect(activeRightPanelTab() ?? "", "vuelve el panel de notas").toMatch(/^Notes/)
      expect(findPanel(), "vuelve la búsqueda").toBeTruthy()
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Escape sale del focus mode cuando no hay nada más abierto",
    async () => {
      await openDocument()
      await toggleFocusMode()
      expect(shellFocusMode()).toBe("true")

      await pressEscape()
      expect(shellFocusMode(), "Escape sale del focus mode").toBe("false")
      expect(mounted!.editor().getText()).toBe(TEXT)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-602 — paneles a través de la shell", () => {
  it(
    "el botón de cerrar del panel cierra el panel activo, sea cual sea su pestaña",
    async () => {
      // Mutación: `closeActivePanel` que solo cierre "notes" (el panel con el
      // que se abrió) → rojo: tras cambiar a Grammar, cerrar no cierra.
      await openDocument()
      await openNotesPanel()

      const grammarTab = Array.from(rightPanelTabs()!.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
        (tab) => (tab.textContent ?? "").trim().startsWith("Grammar"),
      )
      expect(grammarTab, "la pestaña Grammar del panel").toBeTruthy()
      await act(async () => {
        grammarTab!.click()
      })
      await flush(2)
      expect(activeRightPanelTab() ?? "").toMatch(/^Grammar/)

      const close = rightPanelTabs()!.querySelector<HTMLButtonElement>('button[aria-label="Close panel"]')
      expect(close, 'el botón "Close panel"').toBeTruthy()
      await act(async () => {
        close!.click()
      })
      await flush(2)

      expect(rightPanelTabs(), "el panel se cerró").toBeNull()
      expect(mounted!.editor().getText(), "el documento no se tocó").toBe(TEXT)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "Escape cierra primero la búsqueda, después el panel, y no toca el focus mode que no está",
    async () => {
      await openDocument()
      // El atajo real del panel de correcciones (⌘⌥S / Ctrl+Alt+S).
      await pressEditorShortcut({ key: "s", code: "KeyS", alt: true })
      await waitFor(() => activeRightPanelTab()?.startsWith("Grammar"), { label: "panel Grammar abierto" })
      await openFindPanel("frase")

      await pressEscape()
      expect(findPanel(), "el primer Escape cierra la búsqueda").toBeNull()
      expect(activeRightPanelTab() ?? "", "el panel sigue abierto").toMatch(/^Grammar/)

      await pressEscape()
      expect(rightPanelTabs(), "el segundo Escape cierra el panel").toBeNull()
      expect(shellFocusMode()).toBe("false")
      expect(mounted!.editor().getText()).toBe(TEXT)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})
