/**
 * @vitest-environment happy-dom
 *
 * ODE-570 — La hidratación es una fase explícita de la transición.
 *
 * Property: cuando una transición carga un documento, la fase pasa por
 * "loading" y siempre sale a "ready", también si el documento no se puede
 * abrir. Cuando la identidad nace del contenido que ya está en el editor
 * (motivo "identity"), no hay carga: la fase nunca pasa por "loading".
 *
 * Por qué existe: antes cada handler decidía si hidratar pasando a mano un
 * `hydrationWritingId`. ODE-570 lo deriva del motivo (`activationHydrates`) y
 * lo expone como `data-hydration-phase` en la raíz del editor. Esta prueba fija
 * el contrato observable de esa fase.
 *
 * Técnica: `world.onShellCommit` corre en la fase de layout de cada commit del
 * shell, con el DOM ya escrito, así que registra la fase de TODOS los commits,
 * no solo la final.
 *
 * Camino de producción: montaje por ruta, gesto real de pestaña y escritura
 * real sobre fake-indexeddb. La red previa (ODE-464, open-error en
 * editor-shell-tab-switch-persistence, selección, admisión, barridos de
 * ventanas) cubre el comportamiento de la hidratación en sí.
 *
 * Mutation test (ODE-570): hidratar también en "identity", o no volver a
 * "ready" al recuperar un documento no disponible, pone en rojo su caso.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

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

const { flush, mountEditorShell, pointerClick, resetEditorShellWorld, typeInEditor, waitFor, world } = await import(
  "./support/editor-shell-harness"
)

const SHELL_TEST_TIMEOUT_MS = 40_000

let writingA = ""
let writingB = ""
let phases: string[] = []

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

/** Registra la fase de cada commit del shell, sin repetir valores seguidos. */
function recordPhases() {
  phases = []
  world.onShellCommit = () => {
    const phase = currentPhase()
    if (phase !== null && phases[phases.length - 1] !== phase) phases.push(phase)
  }
}

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((entry) => entry.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  window.history.replaceState(null, "", "/write")
  await localDB.writings.save(makeLocalWriting(writingA, "Texto de A.", "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, "Texto de B.", "Documento B"))
  resetEditorShellWorld()
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

describe("ODE-570 — la hidratación como fase explícita", () => {
  it(
    "cambiar de pestaña pasa por loading y sale a ready con el documento nuevo",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => mounted!.editor().getText().includes("Texto de B"), { label: "hidratación de B" })
      await waitFor(() => currentPhase() === "ready", { label: "B listo" })

      recordPhases()
      await pointerClick(tabNode(writingA))
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "A de vuelta" })
      await waitFor(() => currentPhase() === "ready", { label: "fase ready tras volver a A" })

      expect(phases, "la selección carga el documento y termina").toEqual(["loading", "ready"])
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "un documento que no se puede abrir también sale a ready",
    async () => {
      // Qué pasa con la pestaña del documento no disponible en una entrada por
      // ruta queda fuera: hoy se conserva en el store (también antes de
      // ODE-570), registrado como hallazgo en el issue.
      const missing = crypto.randomUUID()
      recordPhases()
      mounted = await mountEditorShell({ writingId: missing })

      await waitFor(() => currentPhase() === "ready", { label: "fase ready tras recuperar", timeoutMs: 15_000 })
      await flush(3)

      expect(phases[0], "la entrada por ruta empieza cargando").toBe("loading")
      expect(currentPhase(), "y no se queda cargando").toBe("ready")
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "la identidad que nace del editor no carga nada: la fase nunca pasa por loading",
    async () => {
      recordPhases()
      mounted = await mountEditorShell()
      const navigation = await waitFor(
        () => world.navigations.find((entry) => entry.href.startsWith("/write/")),
        { label: "identidad creada al montar", timeoutMs: 5000 },
      )
      await typeInEditor("ODE570-TEXTO-VIVO")
      await flush(5)

      expect(navigation.href).toMatch(/^\/write\//)
      expect(phases, "sin carga en toda la creación de identidad").toEqual(["ready"])
      expect(mounted.editor().getText(), "el texto escrito sigue en el editor").toContain("ODE570-TEXTO-VIVO")
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
