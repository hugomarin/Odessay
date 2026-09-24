/**
 * @vitest-environment happy-dom
 *
 * ODE-572 — Lo escrito en un borrador sin materializar sobrevive a cualquier
 * cambio de la lista de pestañas.
 *
 * Property: mientras el usuario escribe en un borrador desktop que todavía no
 * tiene archivo, nada de lo que pase en OTRAS pestañas (el catálogo que cambia
 * el título de otra, un borrador de una shell anterior que se materializa
 * tarde) borra ese texto del editor, y el texto acaba en el `.md` del borrador.
 *
 * Por qué existe: la rama "sin documento" del efecto de hidratación
 * (`hooks/useDocumentHydration.ts`) limpiaba el editor en cada re-ejecución del
 * efecto, y `editorSession.tabs` es una de sus dependencias. Cualquier cambio
 * de pestañas con el borrador activo borraba lo escrito (ODE-572).
 *
 * Camino de producción: "New Artifact" real, escritura real, remontaje por
 * `key` como `DesktopWriteEntry` y guardado real a `.md` en un directorio
 * temporal. Estímulos: el cambio de título entra por
 * `syncWritingTitlesFromCatalog`, la función del store que usa
 * `useCatalogEditorSessionSync` (el catálogo es otro subsistema); en el caso
 * de remontaje, lo único controlado es CUÁNDO termina la creación del borrador
 * viejo (`createDesktopDraftOverride`, que delega en la de producción).
 *
 * Mutation test (ODE-572): volver a limpiar el editor en cada re-ejecución de
 * la rama "sin documento" pone en rojo los dos casos.
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
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState, syncWritingTitlesFromCatalog } = await import("@/lib/stores/editor-session-store")
const { act } = await import("react")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-draft-tabs-change-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const { session } = getEditorSessionState()
      const writingId = session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id
      return writingId && writingId !== EDITOR_DRAFT_TAB_ID ? writingId : null
    },
    { label: "identidad materializada del documento activo", timeoutMs: 15_000 },
  )
}

describe("ODE-572 — el borrador sin materializar sobrevive a los cambios de pestañas", () => {
  it(
    "un título que el catálogo cambia en otra pestaña no borra el borrador",
    async () => {
      mounted = await mountEditorShell()
      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE572-DOCUMENTO-A")
      await waitForMarkdownContaining("ODE572-DOCUMENTO-A")
      const writingA = await waitForMaterializedWritingId()

      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE572-BORRADOR-VIVO")

      // El catálogo informa de que A cambió de título (por ejemplo, se renombró
      // su archivo fuera de la app). `useCatalogEditorSessionSync` lo lleva al
      // store con esta misma función; el borrador sigue sin archivo.
      await act(async () => {
        syncWritingTitlesFromCatalog(new Map([[writingA, "ODE572 renombrado fuera"]]))
      })
      await flush(5)
      expect(
        getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingA)?.title,
        "la lista de pestañas cambió",
      ).toBe("ODE572 renombrado fuera")

      expect(mounted.editor().getText(), "el borrador conserva lo escrito").toContain("ODE572-BORRADOR-VIVO")
      await advance(6_000)
      const draftFile = await waitForMarkdownContaining("ODE572-BORRADOR-VIVO")
      expect(draftFile.contents).not.toContain("ODE572-DOCUMENTO-A")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un borrador de la shell anterior que se materializa tarde no borra el borrador nuevo",
    async () => {
      let release!: () => void
      const released = new Promise<void>((resolve) => {
        release = resolve
      })
      let calls = 0
      const heldCreate: typeof createProductionDesktopDraft = async (options) => {
        calls += 1
        await released
        return createProductionDesktopDraft(options)
      }

      mounted = await mountEditorShell({ key: "write-root", createDesktopDraftOverride: heldCreate })
      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE572-BORRADOR-VIEJO")
      await advance(400)

      await mounted.render({ key: "write-new", forceNewWriting: true })
      await flush(5)
      await waitFor(() => calls > 0, { label: "materialización vieja en curso" })
      await waitFor(() => mounted!.prosemirror(), { label: "editor de la entrada nueva" })
      await typeInEditor("ODE572-BORRADOR-NUEVO")

      release()
      await waitForMarkdownContaining("ODE572-BORRADOR-VIEJO")
      await flush(5)

      expect(mounted.editor().getText(), "el borrador nuevo conserva lo escrito").toContain("ODE572-BORRADOR-NUEVO")
      await advance(6_000)
      const newFile = await waitForMarkdownContaining("ODE572-BORRADOR-NUEVO")
      expect(newFile.contents).not.toContain("ODE572-BORRADOR-VIEJO")
      expect((await readWorkspaceMarkdown()).length, "un archivo por borrador").toBe(2)
    },
    TEST_TIMEOUT_MS,
  )
})
