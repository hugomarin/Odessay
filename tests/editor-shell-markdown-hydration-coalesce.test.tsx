/**
 * @vitest-environment happy-dom
 *
 * ODE-582 — La hidratación en modo Markdown termina aunque la cola de
 * selección fusione su restauración con otra.
 *
 * Property: al volver a un documento en modo Markdown, la hidratación sale a
 * "ready" aunque, antes de que corra su frame de restauración, otra acción
 * encole su propia selección en la misma cola (p. ej. negrita desde el
 * teclado). Y con la fase en "ready", la pestaña vuelve a publicar su estado.
 *
 * Por qué existe: la hidratación Markdown termina a través de la cola
 * compartida de restauración de selección (`onSettled: finishHydration`,
 * ODE-555). La cola guarda UNA petición pendiente y la última gana: una
 * petición sin `onSettled` que llegara con el frame ya agendado sustituía a la
 * de la hidratación y `finishHydration` no corría nunca. La fase se quedaba en
 * "loading", y con ella `publishTabState` y la reconciliación del título en
 * desktop, hasta la siguiente activación.
 *
 * Camino de producción: montaje por ruta sobre fake-indexeddb, botón real de
 * modo Markdown de la status bar, gesto real de pestaña para salir y volver, y
 * el atajo real de negrita (keydown en `window`). Los frames se retienen
 * (`holdAnimationFrames`) para abrir la ventana de forma determinista: se
 * ejecutan de uno en uno y la negrita entra justo cuando la restauración de
 * la hidratación ya está encolada y su frame todavía no corrió.
 *
 * Mutation test (ODE-582): volver a sustituir la petición pendiente sin
 * conservar su `onSettled` deja la fase en "loading" y pone la prueba en rojo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"
import { isMacPlatform } from "@/lib/keyboard-shortcuts"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
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

const { flush, holdAnimationFrames, mountEditorShell, pointerClick, resetEditorShellWorld, waitFor } =
  await import("./support/editor-shell-harness")
const { act } = await import("react")

const SHELL_TEST_TIMEOUT_MS = 40_000

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let frames: ReturnType<typeof holdAnimationFrames> | null = null

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

function currentPhase() {
  return document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") ?? null
}

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((entry) => entry.writing_id === writingId)
}

function tabNode(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

function markdownTextarea() {
  return document.querySelector<HTMLTextAreaElement>("textarea")
}

async function switchToMarkdownMode() {
  const button = [...document.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button')].find(
    (candidate) => candidate.textContent?.trim() === "Markdown",
  )
  if (!button) throw new Error("No está el botón de modo Markdown en la status bar")
  await act(async () => {
    button.click()
  })
  await waitFor(() => markdownTextarea()?.value.includes("Texto de A") ?? false, { label: "A en modo Markdown" })
}

/** El atajo real de negrita, como lo recibe `window`. */
async function pressBoldShortcut() {
  const mac = isMacPlatform()
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "b", metaKey: mac, ctrlKey: !mac, bubbles: true }))
  })
}

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  window.history.replaceState(null, "", "/write")
  await localDB.writings.save(makeLocalWriting(writingA, "Texto de A.", "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, "Texto de B.", "Documento B"))
  resetEditorShellWorld()
})

afterEach(async () => {
  frames?.restore()
  frames = null
  await mounted?.unmount()
  mounted = null
})

describe("ODE-582 — la hidratación Markdown termina aunque la cola fusione restauraciones", () => {
  it(
    "una negrita encolada antes del frame de la hidratación no deja la fase en loading",
    async () => {
      mounted = await mountEditorShell({ writingId: writingB })
      await waitFor(() => mounted!.editor().getText().includes("Texto de B"), { label: "hidratación de B" })
      await mounted.render({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      await waitFor(() => currentPhase() === "ready", { label: "A listo" })
      await switchToMarkdownMode()

      // Salir a B por su pestaña guarda la vista de A (modo Markdown); volver
      // a A la restaura por la cola de selección.
      await pointerClick(tabNode(writingB))
      await waitFor(() => currentPhase() === "ready" && (markdownTextarea()?.value.includes("Texto de B") || mounted!.editor().getText().includes("Texto de B")), { label: "B listo" })
      expect(tabFor(writingA)?.view_state?.mode, "precondición: A se guardó en modo Markdown").toBe("markdown")

      frames = holdAnimationFrames()
      await pointerClick(tabNode(writingA))

      // Frame a frame, hasta que la restauración de la hidratación quede
      // encolada con su propio frame pendiente: A ya está en el textarea, la
      // fase sigue en loading y hay un frame nuevo esperando. Ahí entra la
      // negrita, que encola su selección en la misma cola.
      let boldPressed = false
      for (let step = 0; step < 40 && !boldPressed; step += 1) {
        await flush(2)
        const pending = frames.takePending()
        if (pending.length === 0) continue
        await frames.runCallbacks(pending)
        if (currentPhase() === "loading" && markdownTextarea()?.value.includes("Texto de A") && frames.pending() > 0) {
          await pressBoldShortcut()
          boldPressed = true
        }
      }
      expect(boldPressed, "control positivo: la negrita entró con la restauración pendiente").toBe(true)

      await frames.settle(10)
      frames.restore()
      frames = null
      await flush(5)

      await waitFor(() => markdownTextarea()?.value.includes("**") ?? false, {
        label: "la negrita se aplicó al Markdown de A",
      })
      await waitFor(() => currentPhase() === "ready", { label: "la hidratación de A termina", timeoutMs: 5_000 })
      expect(tabFor(writingA)?.id, "A es la pestaña activa").toBe(getEditorSessionState().session.active_tab_id)
      // Con la fase en ready la pestaña vuelve a publicar: la edición de la
      // negrita aparece como guardado en curso en la pestaña de A.
      await waitFor(() => tabFor(writingA)?.has_pending_sync === true, {
        label: "la pestaña de A publica su estado de guardado",
        timeoutMs: 5_000,
      })
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
