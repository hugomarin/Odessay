/**
 * @vitest-environment happy-dom
 *
 * SHARE-05 (ODE-617, PR-A) — un cambio de visibilidad hecho desde el panel de
 * propiedades de la shell montada persiste en el almacenamiento local y viaja
 * explícito en el PATCH del SyncWorker; una sesión nueva lo conserva.
 *
 * Por qué existe: SHARE-05 estaba en NONE. El dueño real del cambio es
 * `PropertiesPanel.onVisibilityChange` → `editor-shell.tsx` (estado + ref) →
 * `persistEditorSnapshot` → `DocumentService` → cola de sync → `SyncWorker`.
 * Sin selector de visibilidad en la UI, el camino real que alcanza ese callback
 * es el guardia del panel: un documento `private` con destinatarios se fuerza a
 * `shared` (`properties-panel.tsx:274-281`). Ese estado (privado con shares) es
 * alcanzable — lo puede dejar el cliente desktop, que persiste la visibilidad
 * en `visibility_cache` (hallazgo F1b de ODE-616).
 *
 * Camino de producción (web): fila local inicial sembrada como fixture (mismo
 * precedente que ODE-611: el documento, antes del primer guardado) → la shell
 * la hidrata por `writingId` → botón real "Properties panel" → pestaña real
 * "Share" → `WritingSharesSection` lista destinatarios (la red es la frontera
 * externa; el body del PATCH se lee sustituyendo `world.network`, sin tocar el
 * banco compartido) → el guardia del panel aplica `shared` → guardado real
 * sobre `fake-indexeddb` → `SyncWorker` real `PATCH /api/writings/:id`.
 *
 * Evento de completitud: la fila local quedó en `shared` y el PATCH llevó
 * `visibility: "shared"` explícito. La recarga remonta la shell por ruta (una
 * sesión nueva) y afirma que el guardado hidratado vuelve a salir con `shared`.
 *
 * Mutación (BUILD): quitar `visibility` de `toRemotePayload`
 * (`lib/sync/queue.ts`) pone en rojo la afirmación del body. En web el Zod del
 * handler (`app/api/writings/[id]/route.ts:23`) tiene `default("private")`:
 * sin el campo, un documento compartido o público pasaría a privado sin aviso.
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
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForAsync,
} = await import("./support/editor-shell-harness")
const { getSyncWorker } = await import("@/lib/sync/worker")
const { defaultNetwork, world } = await import("./support/editor-shell-doubles")

const TEST_TIMEOUT_MS = 60_000
const TEXT = "El documento privado que el panel lleva a compartido."
const RELOAD_EDIT = " ODE617-TRAS-RECARGA"

let writingId = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
/** Bodies de los PATCH que el SyncWorker real mandó al handler. */
let patchBodies: Array<Record<string, unknown>> = []

function makeLocalWriting(id: string): LocalWriting {
  return {
    id,
    title: "Documento de visibilidad",
    body_json: {
      type: "doc",
      content: [{ type: "paragraph", content: [{ type: "text", text: TEXT }] }],
    },
    body_text: TEXT,
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

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

const SHARE_RECIPIENT = {
  userId: "reader-1",
  username: "lectora",
  displayName: "Lectora",
  canRespond: false,
  sharedAt: "2026-09-21T00:00:00.000Z",
}

/**
 * Frontera externa: la red. El panel lista los destinatarios (ya hay uno, el
 * estado privado-con-shares), el `SyncWorker` manda su PATCH y el eco remoto
 * devuelve lo enviado, como el handler real sobre la fila.
 */
function installVisibilityNetwork(seed: LocalWriting) {
  const fallback = defaultNetwork()
  world.network = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()

    if (url === `/api/writings/${seed.id}/shares` && method === "GET") {
      return jsonResponse({ data: [SHARE_RECIPIENT], error: null })
    }

    if (url === `/api/writings/${seed.id}/share-test-link`) {
      return jsonResponse({
        data: { active: false, token: null, link: null, createdAt: null },
        error: null,
      })
    }

    if (url === `/api/writings/${seed.id}` && method === "PATCH") {
      const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>
      patchBodies.push(body)
      return jsonResponse({
        data: {
          ...body,
          id: seed.id,
          author_id: body.author_id ?? null,
          created_at: seed.created_at,
          deleted_at: null,
          sync_status: "synced",
        },
        error: null,
      })
    }

    return fallback(url, init)
  }
}

/** Abre el panel de propiedades con su botón real y entra a la pestaña Share. */
async function openShareTab() {
  const propertiesButton = await waitFor(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Properties panel"]'),
    { label: 'botón "Properties panel"' },
  )
  propertiesButton.click()
  await flush(2)

  const shareTab = await waitFor(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="editor-right-panel-tabs"] [role="tab"]',
        ),
      ).find((tab) => (tab.textContent ?? "").trim() === "Share") ?? null,
    { label: "pestaña Share" },
  )
  shareTab.click()
  await flush(2)
}

async function waitForPatchBody(predicate: (body: Record<string, unknown>) => boolean) {
  return waitFor(() => patchBodies.find(predicate) ?? null, {
    label: "PATCH del SyncWorker con la visibilidad",
    timeoutMs: 15_000,
  })
}

beforeEach(async () => {
  writingId = crypto.randomUUID()
  patchBodies = []
  resetEditorShellWorld()
  const seed = makeLocalWriting(writingId)
  await localDB.writings.save(seed)
  installVisibilityNetwork(seed)
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

describe("ODE-617 — la visibilidad persiste entre sesiones y recargas", () => {
  it(
    "el guardia del panel fuerza shared: queda en la fila local y sale explícito en el PATCH; una sesión nueva lo conserva",
    async () => {
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes(TEXT), {
        label: "documento hidratado",
        timeoutMs: 10_000,
      })

      // Control positivo del punto de partida: la fila local es privada y no
      // hay ningún PATCH en vuelo.
      expect((await localDB.writings.get(writingId))?.visibility).toBe("private")
      expect(patchBodies, "todavía no hubo guardado remoto").toHaveLength(0)

      await openShareTab()

      // La lista de destinatarios (con una persona) llega; el guardia del
      // panel fuerza shared vía onVisibilityChange.
      const changedLocally = await waitForAsync(
        async () => {
          const row = await localDB.writings.get(writingId)
          return row?.visibility === "shared" ? row : null
        },
        { label: "fila local en shared", timeoutMs: 15_000 },
      )
      expect(changedLocally.lifecycle, "la fila sigue confirmada por la nube").toBe(
        "server-confirmed",
      )

      // El guardado llega al SyncWorker real: PATCH al handler con la
      // visibilidad elegida explícita.
      const firstPatch = await waitForPatchBody((body) => body.visibility === "shared")
      expect(firstPatch.version, "el guardado avanza la versión").toBeGreaterThan(1)
      expect(
        world.networkCalls.some(
          (call) => call.url === `/api/writings/${writingId}` && call.method === "PATCH",
        ),
        "el guardado salió por la ruta real del worker",
      ).toBe(true)

      // El eco del handler no pisa el valor: la fila canónica queda shared.
      await waitForAsync(
        async () => {
          const row = await localDB.writings.get(writingId)
          return row?.sync_status === "synced" && row.visibility === "shared" ? row : null
        },
        { label: "fila sincronizada en shared", timeoutMs: 15_000 },
      )

      // Recarga: sesión nueva (remontaje por ruta, como una entrada desde
      // Desk). La shell hidrata la fila local y el siguiente guardado vuelve a
      // llevar la visibilidad persistida, no la inicial.
      await mounted!.unmount()
      mounted = null
      const patchCountBefore = patchBodies.length
      mounted = await mountEditorShell({ key: `reload:${writingId}`, writingId })
      await waitFor(() => mounted!.editor().getText().includes(TEXT), {
        label: "documento reabierto por ruta",
      })
      expect((await localDB.writings.get(writingId))?.visibility, "la recarga lee shared del almacenamiento local").toBe(
        "shared",
      )

      await typeInEditor(RELOAD_EDIT)
      await waitForAsync(
        async () => {
          const row = await localDB.writings.get(writingId)
          return row?.body_text.includes(RELOAD_EDIT.trim()) ? row : null
        },
        { label: "edición guardada tras la recarga", timeoutMs: 15_000 },
      )
      const reloadPatch = await waitFor(
        () => patchBodies.slice(patchCountBefore).find((body) => body.visibility === "shared") ?? null,
        { label: "PATCH posterior a la recarga con shared", timeoutMs: 15_000 },
      )
      expect(reloadPatch.visibility, "la visibilidad persistida viaja en el payload").toBe(
        "shared",
      )
    },
    TEST_TIMEOUT_MS,
  )
})
