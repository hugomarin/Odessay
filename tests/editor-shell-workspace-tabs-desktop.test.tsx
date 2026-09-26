/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-588 (desktop) — El lápiz de una pestaña de fondo la selecciona
 * y abre el modal de renombrado con el título y el cuerpo de ESA pestaña, no
 * del documento anterior.
 *
 * Variante desktop del caso web en `editor-shell-workspace-tabs.test.tsx`. En
 * desktop la hidratación va por el opener unificado (disco/catálogo) y un
 * efecto de la shell (`editor-shell.tsx` ~l.1814) aplica el título del
 * catálogo cuando la fase pasa a "ready" — el mismo commit en el que el efecto
 * del renombrado construye el snapshot. Esta prueba fija ese orden: el modal
 * lleva el título y el cuerpo de B.
 *
 * Camino de producción (desktop): dos documentos reales en el workspace
 * temporal (creados con `createDesktopDraft`), A activo y B de fondo, sobre el
 * catálogo y el filesystem reales del harness. Doble: el transporte nativo de
 * Tauri, el sync cloud y el proveedor de AI.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("next/navigation", async () =>
  (await import("./support/editor-shell-doubles")).nextNavigationDouble(),
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
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const { mountEditorShell, pointerClick, resetEditorShellWorld, waitFor, world } = await import(
  "./support/editor-shell-harness"
)
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { createEditorSessionTab, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const TEXT_A = "Texto de A, ODE588."
// Suficientemente largo para habilitar la sugerencia por IA (≥ 12 palabras) y
// distinguible de A: el cuerpo que recibe el modal se observa por la entrada
// que llega a `suggestTitle`.
const TEXT_B =
  "El documento B tiene un contenido lo suficientemente largo como para pedir una sugerencia de titulo automatica en la prueba de ODE588."

const bodyJson = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-workspace-tabs-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  const a = await createDesktopDraft({
    title: "Documento A",
    initialBodyJson: bodyJson(TEXT_A),
    initialBodyText: TEXT_A,
  })
  const b = await createDesktopDraft({
    title: "Documento B",
    initialBodyJson: bodyJson(TEXT_B),
    initialBodyText: TEXT_B,
  })
  if (a.error || !a.data || b.error || !b.data) {
    throw new Error(`createDesktopDraft falló: ${a.error?.message ?? b.error?.message}`)
  }
  writingA = a.data.id
  writingB = b.data.id
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
  vi.restoreAllMocks()
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

describe("ODE-588 — pestañas de fondo en desktop", () => {
  it(
    "el lápiz de una pestaña de fondo abre el modal con el título y el cuerpo de esa pestaña",
    async () => {
      // Mutación: en `useWorkspaceTabs`, abrir el modal en cuanto cambia
      // `active_tab_id` (sin esperar la hidratación del documento pedido) →
      // rojo: el snapshot llevaría el título y el cuerpo de A (ODE-588).
      mounted = await mountEditorShell({ writingId: writingA })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 15_000 })
      await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })

      const pencil = tabNode(writingB).querySelector<HTMLElement>('button[aria-label^="Rename"]')
      expect(pencil, "el lápiz de la pestaña de B").toBeTruthy()
      await pointerClick(pencil!)

      await waitFor(() => activeWritingId() === writingB, { label: "B pasa a ser la activa" })
      const input = await waitFor(
        () => document.querySelector<HTMLInputElement>('input[aria-label="Artifact name"]'),
        { label: "el modal de renombrado se abre", timeoutMs: 15_000 },
      )
      expect(input.value, "el modal se abre con el título de B").toBe("Documento B")

      // El cuerpo que recibe el modal es el de B: se observa por la entrada que
      // llega a la sugerencia por IA (su `bodyText`).
      const suggest = await waitFor(
        () =>
          Array.from(document.querySelectorAll<HTMLButtonElement>("button")).find(
            (button) => (button.textContent ?? "").trim() === "Suggest",
          ),
        { label: "botón Suggest habilitado con el cuerpo de B", timeoutMs: 15_000 },
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
})
