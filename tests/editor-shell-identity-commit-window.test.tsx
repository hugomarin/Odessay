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
 * Camino de producción: A, B y C abiertos por ruta (C activo) → gesto real de
 * pestaña a A → dentro de la ventana N, gesto real a B → escritura real en el
 * editor real → guardado real sobre fake-indexeddb.
 *
 * Por qué tres documentos y por qué se termina en B: B no coincide con ningún
 * valor que un ref de identidad rancio pudiera conservar (A, con el que se
 * montó el shell y al que se iba; C, el último abierto por ruta). Terminar en
 * el documento de montaje dejaba pasar un ref que nunca se actualizaba, por
 * pura coincidencia.
 *
 * Mutation test (ODE-564): un ref de identidad que no sigue al último cambio
 * la pone en rojo — lo escrito se atribuye a otro documento.
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
const TEXT_C = "Texto de C."
const EDIT = " ODE564-ESCRITO-TRAS-EL-CAMBIO"

let writingA = ""
let writingB = ""
let writingC = ""

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
  writingC = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B"))
  await localDB.writings.save(makeLocalWriting(writingC, TEXT_C, "Documento C"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

describe("ODE-564 — un cambio de documento dentro de una ventana de commit se mantiene", () => {
  it.each(COMMIT_WINDOWS)(
    "cambiar a B en la ventana %i del cambio a A deja B activo y le atribuye lo escrito",
    async (targetCommit) => {
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "hidratación de A" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => tabFor(writingB), { label: "pestaña de B" })
      await mounted.render({ writingId: writingC })
      await waitFor(() => tabFor(writingC), { label: "pestaña de C" })
      await waitFor(() => activeWritingId() === writingC && mounted!.editor().getText().includes(TEXT_C), {
        label: "C activo con su contenido",
      })
      await flush(3)

      // La sonda: en la ventana N de los commits del cambio a A, gesto real a
      // B, síncrono y antes de los efectos pasivos de ese commit.
      const probe = { armed: true, commits: 0, fired: false, activeRightAfter: null as string | null }
      world.onShellCommit = () => {
        if (!probe.armed || probe.fired) return
        probe.commits += 1
        if (probe.commits !== targetCommit) return
        probe.fired = true
        dispatchPointerClick(tabNode(writingB).node)
        // Control positivo: el gesto sí activó B, dentro de la ventana.
        probe.activeRightAfter = activeWritingId()
      }

      await pointerClick(tabNode(writingA).node)
      await waitFor(() => probe.fired, { label: `ventana de commit ${targetCommit}`, timeoutMs: 5000 })
      world.onShellCommit = null
      expect(probe.activeRightAfter, "el gesto activó B dentro de la ventana").toBe(writingB)

      // Todo el trabajo pendiente se asienta. El último cambio elegido fue B.
      await advance(500)
      await waitFor(() => mounted!.editor().getText().includes(TEXT_B), {
        label: "el editor termina mostrando B",
        timeoutMs: 5000,
      })
      expect(activeWritingId(), "B sigue activo tras asentarse el cambio a A").toBe(writingB)

      // Y lo que se escribe ahora se atribuye a B, no a A ni a C.
      await typeInEditor(EDIT)
      const savedB = await waitForPersisted(writingB, EDIT.trim())
      expect(savedB.body_text).toContain(EDIT.trim())
      for (const other of [writingA, writingC]) {
        const record = await localDB.writings.get(other)
        expect(record?.body_text, "ningún otro documento recibe lo escrito").not.toContain(EDIT.trim())
      }
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
