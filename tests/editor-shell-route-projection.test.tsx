/**
 * @vitest-environment happy-dom
 *
 * ODE-569 — Qué hace la URL en cada transición del documento activo.
 *
 * Dos clases distintas, y la prueba las distingue a propósito:
 *   - PROYECCIÓN: la URL refleja el documento activo sin navegar
 *     (`History.replaceState`, sin pasar por el router de Next). Cambiar de
 *     pestaña y crear un documento en desktop son proyecciones.
 *   - NAVEGACIÓN: el router de Next lleva a otra página. Abrir `/write` sin
 *     documento en web crea la identidad y navega a `/write/<id>`.
 *
 * Por qué existe antes del cambio: ODE-569 junta las proyecciones en
 * `activateDocument` y las navegaciones en una sola función declarada. Si la
 * mudanza perdiera una proyección o convirtiera una navegación en proyección
 * (o al revés), esta prueba se pone en rojo.
 *
 * Camino de producción: montaje por ruta y gesto real de pestaña. La
 * navegación se observa en el doble del router de Next (`world.navigations`),
 * el único boundary doblado aquí; la proyección, en `window.location`.
 *
 * Mutation test (ODE-569): quitar la proyección del cambio de pestaña, o la
 * navegación de la identidad creada en web, pone en rojo su caso. El caso
 * desktop vive en editor-shell-route-projection-desktop.test.tsx.
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

const { flush, mountEditorShell, pointerClick, resetEditorShellWorld, waitFor, world } =
  await import("./support/editor-shell-harness")

const SHELL_TEST_TIMEOUT_MS = 40_000

let writingA = ""
let writingB = ""

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

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((entry) => entry.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  window.history.replaceState(null, "", "/write")
  await localDB.writings.save(makeLocalWriting(writingA, "Texto de A.", "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, "Texto de B.", "Documento B"))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-569 — la URL en las transiciones del documento activo", () => {
  it(
    "cambiar de pestaña proyecta la ruta del documento, sin navegar",
    async () => {
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingB), {
        label: "pestaña de B",
      })
      await flush(3)
      world.navigations = []

      await pointerClick(tabNode(writingA))
      await waitFor(() => currentUrl() === `/write/${writingA}`, { label: "URL proyectada a A" })
      await pointerClick(tabNode(writingB))
      await waitFor(() => currentUrl() === `/write/${writingB}`, { label: "URL proyectada a B" })

      expect(world.navigations, "un cambio de pestaña no navega con el router").toEqual([])
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "abrir /write sin documento en web crea la identidad y navega a su ruta",
    async () => {
      // Web es local-first "ansioso" (ODE-405): sin documento en la ruta, la
      // shell crea la identidad al montar (`ensureIdentity`) y navega a ella.
      resetEditorShellWorld()
      mounted = await mountEditorShell()
      const navigation = await waitFor(
        () => world.navigations.find((entry) => entry.href.startsWith("/write/")),
        { label: "navegación a la identidad creada", timeoutMs: 5000 },
      )

      expect(navigation.kind).toBe("replace")
      const createdId = navigation.href.slice("/write/".length)
      expect(await localDB.writings.get(createdId), "la ruta apunta al documento creado").toBeTruthy()
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
