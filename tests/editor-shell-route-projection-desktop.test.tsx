/**
 * @vitest-environment happy-dom
 *
 * ODE-569 — La URL al crear un documento en desktop: proyección, no navegación.
 *
 * Property: con A activo (URL proyectada a A), "New Artifact" deja la URL en
 * `/write` sin pasar por el router de Next. En el bundle estático de desktop
 * una navegación del router remontaría la página; la URL sólo refleja el
 * documento activo.
 *
 * Por qué existe antes del cambio: ODE-569 mueve esta proyección, que vivía
 * suelta después de abrir la pestaña borrador, a `activateDocument({ href })`.
 * Vive en su propio archivo porque necesita los dobles de desktop; el caso web
 * está en editor-shell-route-projection.test.tsx.
 *
 * Camino de producción: "New Artifact" real, escritura real y gesto real de
 * pestaña; el guardado real escribe `.md` en un directorio temporal.
 *
 * Mutation test (ODE-569): quitar el `href` de la transición "create" en
 * desktop pone en rojo esta prueba.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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

const {
  clickNewArtifact,
  mountEditorShell,
  pointerClick,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-route-projection-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  window.history.replaceState(null, "", "/write")
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

function currentUrl() {
  return `${window.location.pathname}${window.location.search}`
}

function tabNode(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((entry) => entry.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  return node
}

async function createDocument(text: string) {
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await waitForMarkdownContaining(text)
  return waitFor(
    () => {
      const { session } = getEditorSessionState()
      const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
      return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
    },
    { label: "identidad materializada", timeoutMs: 15_000 },
  )
}

describe("ODE-569 — la URL al crear en desktop", () => {
  it(
    "New Artifact proyecta /write sin navegar con el router",
    async () => {
      mounted = await mountEditorShell()
      const a = await createDocument("ODE569-DOCUMENTO-A")
      const b = await createDocument("ODE569-DOCUMENTO-B")

      await pointerClick(tabNode(a))
      await waitFor(() => currentUrl() !== "/write" && currentUrl().includes(a), { label: "URL proyectada a A" })
      expect(currentUrl()).not.toContain(b)
      world.navigations = []

      await clickNewArtifact(mounted.container)
      await waitFor(() => currentUrl() === "/write", { label: "URL proyectada a /write" })

      expect(world.navigations, "crear en desktop no navega con el router").toEqual([])
    },
    TEST_TIMEOUT_MS,
  )
})
