/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — precondición de la opción B: `handleSelectWorkspaceTab` resuelve la
 * pestaña desde el store vivo, no desde `editorSession.tabs` del último render.
 *
 * Property: un clic sobre la pestaña de un documento ya cerrado —el clic llega
 * en la misma ventana que el cierre, antes de que React repinte la barra— no
 * cambia el documento en pantalla, ni el store, ni la copia de la pestaña
 * activa. Sin la guarda, `focusTab` no encuentra la pestaña muerta, pero
 * `activateDocument` sí cambia el documento: la shell mostraría un documento
 * cerrado con otra pestaña como activa.
 *
 * Camino de producción (web): A y B abiertos como pestañas, A activa; el
 * cierre es el gesto real sobre el botón de cerrar de B y el clic es el gesto
 * real sobre la pestaña. Ambos se disparan desde `world.onShellCommit` (un
 * layout effect de la shell real): corren en el mismo bloque síncrono de un
 * commit, así que el clic usa los props del render de ese commit —el que
 * todavía lista B— y React no puede repintar la barra entre los dos gestos.
 *
 * Mutation test (ODE-609): volver a leer de `editorSession.tabs` en
 * `handleSelectWorkspaceTab` → rojo: el clic atraviesa la guarda y
 * `activateDocument` cambia el documento a B, ya cerrado.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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
  advance,
  dispatchPointerClick,
  mountEditorShell,
  resetEditorShellWorld,
  waitFor,
  waitForHydrationReady,
  world,
} = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Texto de A, ODE609-guard."
const TEXT_B = "Texto de B, ODE609-guard, no debe aparecer tras cerrar su pestaña."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string, bodyText: string, title: string): LocalWriting {
  return {
    id,
    title,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
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

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
})

function tabNode(writingId: string) {
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${writingId}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

function closeButton(writingId: string) {
  const button = tabNode(writingId).querySelector<HTMLElement>('button[aria-label^="Close"]')
  if (!button) throw new Error(`La pestaña de ${writingId} no tiene botón de cerrar`)
  return button
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

describe("ODE-609 — el clic sobre una pestaña cerrada no cambia el documento", () => {
  it(
    "cerrar B y pulsar su pestaña en la misma ventana de commit no activa un documento muerto",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), {
        label: "A hidratado",
        timeoutMs: 10_000,
      })
      await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), {
        label: "pestaña de B en el DOM",
      })
      await waitForHydrationReady()

      const routeBefore = `${window.location.pathname}${window.location.search}`

      // En la ventana de commit, B se cierra (gesto real) y su pestaña —que
      // sigue en el DOM con los props del render de este commit— recibe el
      // clic antes de que React pueda repintar. El handler del render todavía
      // lista B; la guarda tiene que resolver contra el store vivo.
      const probe = { fired: false }
      world.onShellCommit = () => {
        if (probe.fired || !document.querySelector(`[data-editor-tab-id="${writingB}"]`)) return
        probe.fired = true
        dispatchPointerClick(closeButton(writingB))
        dispatchPointerClick(tabNode(writingB))
      }

      await waitFor(() => probe.fired, { label: "la ventana de commit con B en el DOM", timeoutMs: 10_000 })
      world.onShellCommit = null

      await waitFor(() => !getEditorSessionState().session.tabs.some((tab) => tab.id === writingB), {
        label: "B quedó cerrada",
      })
      await advance(50)

      expect(activeWritingId(), "el store sigue en A").toBe(writingA)
      expect(
        `${window.location.pathname}${window.location.search}`,
        "la ruta no proyecta el documento muerto",
      ).toBe(routeBefore)
      await waitForHydrationReady()
      expect(mounted.editor().getText(), "el documento en pantalla sigue siendo A").toContain(TEXT_A)
      expect(mounted.editor().getText(), "nunca se cargó el documento cerrado").not.toContain(TEXT_B)
    },
    TEST_TIMEOUT_MS,
  )
})
