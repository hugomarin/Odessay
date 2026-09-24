/**
 * @vitest-environment happy-dom
 *
 * ODE-563 — Cada guardado lleva los metadatos de SU documento.
 *
 * Property: el registro que persiste un guardado lleva el título, estado,
 * tipo y visibilidad del documento guardado, nunca los de otro. En los dos
 * sentidos de un cambio de pestaña:
 *   - una edición en vuelo de A al pasar a B se guarda con los de A;
 *   - lo que se escribe después en B se guarda con los de B.
 *
 * Por qué existe antes del cambio: `persistEditorSnapshot` arma el guardado
 * leyendo refs espejo (`statusRef`, `visibilityRef`, ...), que hoy mantienen
 * a la vez un efecto espejo y varios escritores a mano. ODE-563 los deja con
 * un solo dueño, y eso cambia CUÁNDO se actualiza cada ref (en la escritura,
 * no tras el commit). Esta prueba es la red de ese cambio.
 *
 * Camino de producción: A y B abiertos por ruta → gesto real en las
 * pestañas → escritura real en el editor real → guardado real sobre
 * `fake-indexeddb`. Los metadatos de A y B son los de sus registros, que es
 * como llegan en la app; no se siembra nada en el estado de la shell.
 *
 * Completion event: el registro persistido contiene el texto escrito. Los
 * metadatos se leen de ese mismo registro, no de la llamada a guardar.
 *
 * Mutation test (ODE-563): quitar la sincronización de `visibilityRef` la pone
 * en rojo — B se guarda con la visibilidad inicial en vez de la suya.
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

const { advance, flush, mountEditorShell, pointerClick, resetEditorShellWorld, typeInEditor, waitFor } =
  await import("./support/editor-shell-harness")

const SHELL_TEST_TIMEOUT_MS = 40_000

const META_A = { title: "Documento A", status: "draft", artifactType: "general", visibility: "private" } as const
const META_B = { title: "Documento B", status: "review", artifactType: "essay", visibility: "shared" } as const

const EDIT_A = " ODE563-EDICION-EN-A"
const EDIT_B = " ODE563-EDICION-EN-B"

let writingA = ""
let writingB = ""

function makeLocalWriting(
  id: string,
  bodyText: string,
  meta: { title: string; status: string; artifactType: string; visibility: LocalWriting["visibility"] },
): LocalWriting {
  return {
    id,
    title: meta.title,
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: bodyText }] }],
    },
    body_text: bodyText,
    status: meta.status,
    artifact_type: meta.artifactType,
    visibility: meta.visibility,
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

/** Cambia de pestaña con el gesto real y verifica que la activación ocurrió. */
async function clickTab(writingId: string) {
  const tab = tabFor(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  const active = getEditorSessionState().session.active_tab_id
  if (active !== tab.id) {
    throw new Error(`El gesto sobre la pestaña de ${writingId} no la activó (activa: ${active})`)
  }
}

/** Espera a que el registro persistido de `writingId` contenga `needle`. */
async function waitForPersisted(writingId: string, needle: string) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const record = await localDB.writings.get(writingId)
    if (record?.body_text.includes(needle)) return record
    await advance(200)
  }
  const record = await localDB.writings.get(writingId)
  throw new Error(
    `El registro de ${writingId} nunca contuvo ${JSON.stringify(needle)} (body: ${JSON.stringify(record?.body_text)})`,
  )
}

function metadataOf(record: LocalWriting) {
  return {
    title: record.title,
    status: record.status,
    artifactType: record.artifact_type,
    visibility: record.visibility,
  }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeEach(async () => {
  // Ids nuevos por test: fake-indexeddb es real y persiste en el archivo.
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, "Texto de A.", META_A))
  await localDB.writings.save(makeLocalWriting(writingB, "Texto de B.", META_B))
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-563 — los metadatos de un guardado son los de su documento", () => {
  it(
    "guarda la edición en vuelo de A con los de A y lo escrito después en B con los de B",
    async () => {
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      await mounted.render({ writingId: writingB })
      await waitFor(() => tabFor(writingB), { label: "pestaña de B" })

      // A activo por el gesto real, con su contenido ya hidratado.
      await clickTab(writingA)
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "A activo" })
      await flush(3)

      // Edición en A y, sin esperar, cambio a B: la edición sale en vuelo.
      await typeInEditor(EDIT_A)
      await clickTab(writingB)

      const savedA = await waitForPersisted(writingA, EDIT_A.trim())
      expect(metadataOf(savedA), "la edición de A se guarda con los metadatos de A").toEqual(META_A)

      // Ya en B, con su contenido hidratado, se escribe y se guarda.
      await waitFor(() => mounted!.editor().getText().includes("Texto de B"), { label: "B activo" })
      await flush(3)
      await typeInEditor(EDIT_B)

      const savedB = await waitForPersisted(writingB, EDIT_B.trim())
      expect(metadataOf(savedB), "lo escrito en B se guarda con los metadatos de B").toEqual(META_B)

      // A no se contaminó después con nada de B.
      const finalA = await localDB.writings.get(writingA)
      expect(finalA?.body_text).not.toContain(EDIT_B.trim())
      expect(metadataOf(finalA!)).toEqual(META_A)
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
