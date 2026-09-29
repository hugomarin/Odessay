/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — `modeRef` tiene un solo dueño (`applyEditorMode`): estado y ref se
 * escriben en el mismo paso, sin efecto espejo.
 *
 * Property: un cambio de modo pedido dentro de la ventana entre el render que
 * aplica el modo nuevo y sus efectos pasivos se evalúa contra el modo nuevo,
 * no contra el viejo. `handleToggleMode` lee `modeRef.current` en su guarda
 * (`nextMode === modeRef.current`); con el espejo, esa lectura devolvía el modo
 * anterior y el gesto se descartaba en silencio.
 *
 * Técnica (integration-harness-catalog §Trampas): `world.onShellCommit` corre
 * en fase de layout de cada commit del shell, antes de sus efectos pasivos.
 * La sonda pulsa el botón real "Rich" dentro de la ventana del commit que
 * aplica "Markdown".
 *
 * Camino de producción: documento real en fake-indexeddb → botones reales
 * "Markdown"/"Rich" de la status bar. Nada simulado salvo el mundo del harness.
 *
 * Mutation test (ODE-609): devolver el efecto espejo (`modeRef.current = mode`
 * tras el commit) y quitar la escritura del dueño deja la guarda leyendo
 * "rich" dentro de la ventana; el gesto a Rich se descarta → rojo.
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

const { act } = await import("react")
const { mountEditorShell, resetEditorShellWorld, waitFor, waitForHydrationReady, world } =
  await import("./support/editor-shell-harness")

const TEST_TIMEOUT_MS = 40_000
const TEXT = "Texto del documento en modo rich."

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
  await localDB.writings.save(makeLocalWriting(writingId, TEXT, "Documento de modo"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

function statusBarButton(label: "Rich" | "Markdown") {
  const button = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => (candidate.textContent ?? "").trim() === label)
  if (!button) throw new Error(`No está el botón "${label}" de la status bar`)
  return button
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

describe("ODE-609 — modeRef se lee entre el render y el efecto", () => {
  it(
    "un cambio a Rich pedido en la ventana del commit a Markdown no se descarta",
    async () => {
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes(TEXT), { label: "documento hidratado" })
      await waitForHydrationReady()

      // La sonda: en la ventana de commit que aplica Markdown (la fase de
      // layout del shell, antes de sus efectos pasivos), gesto real y síncrono
      // a Rich. Con el espejo, `modeRef` todavía vale "rich" y la guarda de
      // `handleToggleMode` descarta el gesto; con el dueño, vale "markdown" y
      // la transición se aplica.
      const probe = { fired: false }
      world.onShellCommit = () => {
        if (probe.fired || !markdownSource()) return
        probe.fired = true
        statusBarButton("Rich").click()
      }

      await act(async () => {
        statusBarButton("Markdown").click()
      })
      world.onShellCommit = null

      expect(probe.fired, "la sonda corrió en la ventana del commit a Markdown").toBe(true)
      await waitFor(() => !markdownSource() && mounted!.prosemirror(), {
        label: "de vuelta en Rich",
        timeoutMs: 5_000,
      })
      expect(mounted!.editor().getText(), "el texto sobrevivió al doble cambio").toContain(TEXT)
    },
    TEST_TIMEOUT_MS,
  )
})
