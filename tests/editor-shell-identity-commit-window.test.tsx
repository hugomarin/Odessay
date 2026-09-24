/**
 * @vitest-environment happy-dom
 *
 * ODE-564 — Un cambio de documento hecho dentro de una ventana de commit se
 * mantiene.
 *
 * Property: si el usuario cambia de documento justo cuando otro cambio
 * acaba de hacer commit (antes de que corran sus efectos pasivos), el
 * documento que queda activo, el que muestra el editor y al que se atribuye
 * lo que se escribe después es el último que eligió. Nada rezagado del
 * cambio anterior lo devuelve atrás.
 *
 * Por qué existe antes del cambio: `currentWritingIdRef` tenía un efecto
 * espejo (`ref = currentWritingId` tras cada commit) además de escrituras
 * imperativas en cada handler. Un espejo pendiente de un commit anterior
 * puede reescribir el ref con el documento viejo después de que el handler
 * escribió el nuevo — la misma forma que el bug de ODE-561. ODE-564 elimina
 * el espejo; esta prueba es la red de ese cambio.
 *
 * Técnica (integration-harness-catalog §Trampas): `world.onShellCommit` corre
 * en fase de layout de cada commit del shell, antes de sus efectos pasivos.
 * Qué commit trae el efecto rezagado es un detalle de implementación, así que
 * se barren las ventanas; una ventana que deja de existir falla por timeout.
 *
 * Camino de producción: A y B abiertos por ruta → gesto real de pestaña a B →
 * dentro de la ventana N, gesto real de vuelta a A → escritura real en el
 * editor real → guardado real sobre fake-indexeddb.
 *
 * Mutation test (ODE-564): dejar el ref de identidad en el documento anterior
 * al volver a A la pone en rojo — lo escrito se atribuye a B.
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

const {
  advance,
  dispatchPointerClick,
  flush,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  world,
} = await import("./support/editor-shell-harness")

const SHELL_TEST_TIMEOUT_MS = 40_000
const COMMIT_WINDOWS = [1, 2, 3, 4, 5]

const TEXT_A = "Texto de A."
const TEXT_B = "Texto de B."
const EDIT = " ODE564-ESCRITO-TRAS-VOLVER"

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

function tabFor(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

function tabNode(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return { tab, node }
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

async function waitForPersisted(writingId: string, needle: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const record = await localDB.writings.get(writingId)
    if (record?.body_text.includes(needle)) return record
    await advance(200)
  }
  const record = await localDB.writings.get(writingId)
  throw new Error(`El registro de ${writingId} nunca contuvo ${JSON.stringify(needle)} (body: ${JSON.stringify(record?.body_text)})`)
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

describe("ODE-564 — un cambio de documento dentro de una ventana de commit se mantiene", () => {
  it.each(COMMIT_WINDOWS)(
    "volver a A en la ventana %i del cambio a B deja A activo y le atribuye lo escrito",
    async (targetCommit) => {
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "hidratación de A" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => tabFor(writingB), { label: "pestaña de B" })
      await pointerClick(tabNode(writingA).node)
      await waitFor(() => activeWritingId() === writingA && mounted!.editor().getText().includes(TEXT_A), {
        label: "A activo con su contenido",
      })
      await flush(3)

      // La sonda: en la ventana N de los commits del cambio a B, gesto real
      // de vuelta a A, síncrono y antes de los efectos pasivos de ese commit.
      const probe = { armed: true, commits: 0, fired: false, activeRightAfter: null as string | null }
      world.onShellCommit = () => {
        if (!probe.armed || probe.fired) return
        probe.commits += 1
        if (probe.commits !== targetCommit) return
        probe.fired = true
        dispatchPointerClick(tabNode(writingA).node)
        // Control positivo: el gesto sí activó A, dentro de la ventana.
        probe.activeRightAfter = activeWritingId()
      }

      await pointerClick(tabNode(writingB).node)
      await waitFor(() => probe.fired, { label: `ventana de commit ${targetCommit}`, timeoutMs: 5000 })
      world.onShellCommit = null
      expect(probe.activeRightAfter, "el gesto de vuelta activó A dentro de la ventana").toBe(writingA)

      // Todo el trabajo pendiente se asienta. El último cambio elegido fue A.
      await advance(500)
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), {
        label: "el editor termina mostrando A",
        timeoutMs: 5000,
      })
      expect(activeWritingId(), "A sigue activo tras asentarse el cambio a B").toBe(writingA)

      // Y lo que se escribe ahora se atribuye a A, no a B.
      await typeInEditor(EDIT)
      const savedA = await waitForPersisted(writingA, EDIT.trim())
      expect(savedA.body_text).toContain(EDIT.trim())
      const recordB = await localDB.writings.get(writingB)
      expect(recordB?.body_text, "B no recibe lo escrito tras volver a A").not.toContain(EDIT.trim())
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
