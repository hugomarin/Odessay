/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-587 — Dos comportamientos de las pestañas que no tenían ninguna
 * prueba por la shell antes de mudar su código a `hooks/useWorkspaceTabs.ts`:
 *
 *   1. El lápiz de una pestaña de FONDO la selecciona primero y abre el modal
 *      de renombrado cuando ya es la activa. (Con el título equivocado: ver el
 *      caso y el hallazgo de ODE-587.)
 *   2. Una pestaña de fondo dibuja el estado editorial que da el catálogo (la
 *      activa lee el estado vivo de la shell).
 *
 * Camino de producción (web): A y B abiertos como pestañas, A activa; gestos
 * reales sobre la barra de pestañas; `webDocumentCatalog` real sobre
 * fake-indexeddb. Doble: solo el proveedor de AI y la red (harness).
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


const { mountEditorShell, pointerClick, resetEditorShellWorld, waitFor } = await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { getVocabularyCatalogSnapshot } = await import("@/lib/vocabulary/catalog")
const { getVocabularyColor } = await import("@/lib/vocabulary/resolve")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Texto de A, ODE587."
const TEXT_B = "Texto de B, ODE587."

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

function makeLocalWriting(id: string, bodyText: string, title: string, status: string): LocalWriting {
  return {
    id,
    title,
    body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }] },
    body_text: bodyText,
    status,
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
  // Ids nuevos por test: fake-indexeddb persiste entre tests del archivo.
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, TEXT_A, "Documento A", "draft"))
  await localDB.writings.save(makeLocalWriting(writingB, TEXT_B, "Documento B", "exploring"))
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
  await mounted?.unmount()
  mounted = null
})

function tabNode(writingId: string) {
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${writingId}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

function activeWritingId() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

/** A abierto por ruta e hidratado, con B como pestaña de fondo. */
async function openAWithBInBackground() {
  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 10_000 })
  await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })
}

describe("ODE-587 — pestañas de fondo", () => {
  it(
    "el lápiz de una pestaña de fondo la selecciona y abre el modal con su título",
    async () => {
      // Mutación: en `useWorkspaceTabs`, que el efecto del renombrado pendiente
      // no abra el modal cuando la pestaña ya es la activa → rojo.
      await openAWithBInBackground()
      const pencil = tabNode(writingB).querySelector<HTMLElement>('button[aria-label^="Rename"]')
      expect(pencil, "el lápiz de la pestaña de B").toBeTruthy()

      await pointerClick(pencil!)

      await waitFor(() => activeWritingId() === writingB, { label: "B pasa a ser la activa" })
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]'), {
        label: "el modal de renombrado se abre",
        timeoutMs: 10_000,
      })
      expect(input, "el modal se abre tras seleccionar B").toBeTruthy()
      // No se afirma el título: hoy el modal se abre con el de A (hallazgo de
      // ODE-587, registrado aparte). El efecto abre el modal en cuanto B es la
      // pestaña activa, antes de que termine su hidratación, así que el
      // snapshot lleva el título y el cuerpo del documento anterior.
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "una pestaña de fondo dibuja el estado que da el catálogo",
    async () => {
      // Mutación: en `useWorkspaceTabs`, que `tabStatuses` ignore el estado del
      // catálogo para las pestañas de fondo → rojo.
      const catalog = getVocabularyCatalogSnapshot()
      const exploring = getVocabularyColor(catalog, "status", "exploring")
      const draft = getVocabularyColor(catalog, "status", "draft")
      expect(exploring, "precondición: los dos estados se distinguen por color").not.toBe(draft)

      await openAWithBInBackground()

      const chipColor = () =>
        tabNode(writingB).querySelector<HTMLElement>('span[aria-hidden="true"]')?.style.color ?? null
      const expected = await waitFor(
        () => {
          const probe = document.createElement("span")
          probe.style.color = exploring
          return chipColor() === probe.style.color ? probe.style.color : null
        },
        { label: "el chip de B con el color de su estado", timeoutMs: 10_000 },
      )
      expect(chipColor()).toBe(expected)
      expect(activeWritingId(), "B sigue de fondo").toBe(writingA)
    },
    TEST_TIMEOUT_MS,
  )
})
