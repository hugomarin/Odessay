/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-587 — Dos comportamientos de las pestañas que no tenían ninguna
 * prueba por la shell antes de mudar su código a `hooks/useWorkspaceTabs.ts`:
 *
 *   1. El lápiz de una pestaña de FONDO la selecciona primero y abre el modal
 *      de renombrado cuando ya es la activa, con el título y el cuerpo de esa
 *      pestaña (el fix de ODE-588 espera a que termine su hidratación).
 *   2. Una pestaña de fondo dibuja el estado editorial que da el catálogo (la
 *      activa lee el estado vivo de la shell).
 *   3. El atajo de pestaña siguiente cambia a la pestaña contigua.
 *   4. "New Artifact" en web activa una identidad nueva, y lo que se escribe
 *      después va a ese documento, no al que estaba abierto.
 *
 * Camino de producción (web): A y B abiertos como pestañas, A activa; gestos
 * reales sobre la barra de pestañas; `webDocumentCatalog` real sobre
 * fake-indexeddb. Doble: solo el proveedor de AI y la red (harness).
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


const { advance, clickNewArtifact, flush, mountEditorShell, pointerClick, resetEditorShellWorld, typeInEditor, waitFor, world } =
  await import("./support/editor-shell-harness")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { getVocabularyCatalogSnapshot } = await import("@/lib/vocabulary/catalog")
const { getVocabularyColor } = await import("@/lib/vocabulary/resolve")

const TEST_TIMEOUT_MS = 30_000
const TEXT_A = "Texto de A, ODE587."
// Suficientemente largo para habilitar la sugerencia por IA (≥ 12 palabras) y
// distinguible de A: el cuerpo que recibe el modal se observa por la entrada
// que llega a `suggestTitle`.
const TEXT_B =
  "El documento B tiene un contenido lo suficientemente largo como para pedir una sugerencia de titulo automatica en la prueba de ODE588."

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
    "el lápiz de una pestaña de fondo la selecciona y abre el modal con su título y cuerpo",
    async () => {
      // Mutación: en `useWorkspaceTabs`, abrir el modal en cuanto cambia
      // `active_tab_id` (sin esperar la hidratación del documento pedido) →
      // rojo: el snapshot llevaría el título y el cuerpo de A (ODE-588).
      await openAWithBInBackground()
      const pencil = tabNode(writingB).querySelector<HTMLElement>('button[aria-label^="Rename"]')
      expect(pencil, "el lápiz de la pestaña de B").toBeTruthy()

      await pointerClick(pencil!)

      await waitFor(() => activeWritingId() === writingB, { label: "B pasa a ser la activa" })
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]'), {
        label: "el modal de renombrado se abre",
        timeoutMs: 10_000,
      })
      expect(input.value, "el modal se abre con el título de B").toBe("Documento B")

      // El cuerpo que recibe el modal es el de B: se observa por la entrada que
      // llega a la sugerencia por IA (su `bodyText`). El botón solo está
      // habilitado cuando el cuerpo tiene contenido suficiente, que es el de B.
      const suggest = await waitFor(
        () =>
          Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => (button.textContent ?? "").trim() === "Suggest",
          ),
        { label: "botón Suggest habilitado con el cuerpo de B", timeoutMs: 10_000 },
      )
      await act(async () => {
        suggest.click()
      })
      await waitFor(() => world.suggestTitleCalls.length >= 1, { label: "la sugerencia se pidió" })
      expect(world.suggestTitleCalls[0]?.bodyText ?? "", "el cuerpo enviado a la IA es el de B").toContain(
        "contenido lo suficientemente largo",
      )
      expect(world.suggestTitleCalls[0]?.bodyText ?? "", "y no el de A").not.toContain(TEXT_A)
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

/** Emite el atajo real: el shell resuelve la tecla de comando según plataforma. */
async function pressShortcut(key: string, code: string) {
  for (const modifier of ["ctrl", "meta"] as const) {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        shiftKey: true,
        ctrlKey: modifier === "ctrl",
        metaKey: modifier === "meta",
        bubbles: true,
      }),
    )
    await flush(2)
    if (activeWritingId() !== writingA) return
  }
}

describe("ODE-587 — crear pestaña y moverse entre pestañas", () => {
  it(
    "el atajo de pestaña siguiente cambia a la contigua",
    async () => {
      // Mutación: en la shell, que `selectAdjacentTabRef` no seleccione la
      // pestaña contigua → rojo.
      await openAWithBInBackground()
      await pressShortcut("]", "BracketRight")

      await waitFor(() => activeWritingId() === writingB, { label: "B pasa a ser la activa" })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_B), { label: "con B en el editor", timeoutMs: 10_000 })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "New Artifact en web activa una identidad nueva y lo escrito va a ese documento",
    async () => {
      // Mutación: en `handleCreateWorkspaceTab` (rama web), no activar la
      // identidad nueva → rojo.
      await openAWithBInBackground()
      await clickNewArtifact(mounted!.container)

      const created = await waitFor(
        () => {
          const id = activeWritingId()
          return id && id !== writingA && id !== writingB ? id : null
        },
        { label: "una identidad nueva activa", timeoutMs: 10_000 },
      )
      expect(mounted!.editor().getText(), "el editor queda vacío").toBe("")

      await typeInEditor("ODE587-NUEVO")
      await advance(500)
      for (let attempt = 0; attempt < 40; attempt += 1) {
        if ((await localDB.writings.get(created))?.body_text.includes("ODE587-NUEVO")) break
        await advance(100)
      }
      expect((await localDB.writings.get(created))?.body_text, "lo escrito va al documento nuevo").toContain("ODE587-NUEVO")
      expect((await localDB.writings.get(writingA))?.body_text, "y no a A").not.toContain("ODE587-NUEVO")
    },
    TEST_TIMEOUT_MS,
  )
})
