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
 *
 * ODE-640 — la navegación por slug del documento activo al sincronizar. Un
 * `synced` del activo relee su fila local y, en web, reemplaza la URL por
 * `/write/<slug>`. La clase añade cuatro casos: positivo con UUID de ruta y
 * slug guardado (exactamente un replace), desktop (sin navegación), fila sin
 * slug (sin navegación) y la carrera del lookup de A retenido con cambio a B
 * (el resultado viejo no navega al documento nuevo). Se afirma el router, no
 * `applyDocumentMetadata`: el patch de metadata solo cambia estado, no URL.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { emitSyncStatusChange } from "@/lib/sync/events"
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
// El caso desktop de ODE-640 monta la shell en ese runtime; su catálogo
// necesita el workspace temporal y el doble de `@tauri-apps/api/path`.
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)

const { flush, mountEditorShell, pointerClick, resetEditorShellWorld, waitFor, world } =
  await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)

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

const SLUG_A = "documento-a"
const SLUG_B = "documento-b"

/** El slug es metadata/alias URL de la fila local; la identidad sigue siendo el UUID. */
async function setSlug(writingId: string, slug: string) {
  const record = await localDB.writings.get(writingId)
  if (!record) throw new Error(`No hay fila local para ${writingId}`)
  await localDB.writings.save({ ...record, slug })
}

/** Emite el evento real de sync, como lo hace el worker al confirmar la nube. */
async function emitSynced(writingId: string) {
  await act(async () => {
    emitSyncStatusChange({ writingId, status: "synced" })
  })
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-route-projection-ode640-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
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

describe("ODE-640 — la navegación por slug del documento activo al sincronizar", () => {
  it(
    "un synced del activo con slug guardado reemplaza la URL una sola vez",
    async () => {
      await setSlug(writingA, SLUG_A)
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      world.navigations = []

      await emitSynced(writingA)

      const navigation = await waitFor(() => world.navigations[0], { label: "navegación al slug de A" })
      expect(navigation).toEqual({ kind: "replace", href: `/write/${SLUG_A}` })
      await flush(3)
      expect(world.navigations, "un solo replace").toEqual([{ kind: "replace", href: `/write/${SLUG_A}` }])
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "un synced del activo en desktop no navega",
    async () => {
      await setSlug(writingA, SLUG_A)
      resetEditorShellWorld({ isDesktop: true })
      mounted = await mountEditorShell({ writingId: writingA })
      await flush(3)
      world.navigations = []

      const getSpy = vi.spyOn(localDB.writings, "get")
      try {
        await emitSynced(writingA)
        await waitFor(() => getSpy.mock.calls.some(([id]) => id === writingA), { label: "lookup local del activo" })
        await flush(3)
        expect(world.navigations, "el runtime desktop salta la navegación").toEqual([])
      } finally {
        getSpy.mockRestore()
      }
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  it(
    "un synced del activo sin slug no navega",
    async () => {
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      world.navigations = []

      const getSpy = vi.spyOn(localDB.writings, "get")
      try {
        await emitSynced(writingA)
        await waitFor(() => getSpy.mock.calls.some(([id]) => id === writingA), { label: "lookup local del activo" })
        await flush(3)
        expect(world.navigations, "sin slug no hay destino al que navegar").toEqual([])
      } finally {
        getSpy.mockRestore()
      }
    },
    SHELL_TEST_TIMEOUT_MS,
  )

  // it.fails: el bug real de ODE-640 es que el callback no revalida qué UUID
  // sigue activo después del `await localDB.writings.get`; el resultado viejo
  // de A navega cuando B ya es el activo. El fix lo convierte en `it` sin
  // tocar este cuerpo.
  it.fails(
    "un lookup de A retenido no navega después de activar B",
    async () => {
      await setSlug(writingA, SLUG_A)
      await setSlug(writingB, SLUG_B)
      resetEditorShellWorld()
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => mounted!.editor().getText().includes("Texto de A"), { label: "hidratación de A" })
      world.navigations = []

      const realGet = localDB.writings.get.bind(localDB.writings)
      let releaseLookup: () => void = () => {}
      const heldLookup = new Promise<void>((resolve) => {
        releaseLookup = resolve
      })
      const getSpy = vi.spyOn(localDB.writings, "get").mockImplementation(async (id: string) => {
        if (id === writingA) await heldLookup
        return realGet(id)
      })

      try {
        await emitSynced(writingA)
        await waitFor(() => getSpy.mock.calls.some(([id]) => id === writingA), { label: "lookup de A retenido" })

        await mounted.render({ writingId: writingB })
        await waitFor(() => mounted!.editor().getText().includes("Texto de B"), { label: "hidratación de B" })

        releaseLookup()
        await flush(5)

        expect(world.navigations, "el resultado viejo de A no navega al documento nuevo").toEqual([])
      } finally {
        getSpy.mockRestore()
      }
    },
    SHELL_TEST_TIMEOUT_MS,
  )
})
