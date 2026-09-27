/**
 * @vitest-environment happy-dom
 *
 * ODE-571 — La identidad del borrador es de la instancia de la shell.
 *
 * Property: si el usuario escribe en un borrador y entra a un documento nuevo
 * antes de que el borrador se guarde (en desktop, el "New" de la barra lateral
 * navega a `/write?new=1` y remonta la shell con otra `key`), el borrador
 * viejo se materializa en SU archivo y SU pestaña, aunque termine después de
 * que la instancia nueva montó su propio borrador; el de la instancia nueva
 * sigue siendo suyo.
 *
 * Por qué existe: es la prueba de remontaje que exige la enmienda del ADR
 * documento activo (ODE-568). Al desmontar, el coordinador de persistencia
 * vuelca lo pendiente y dispara `onMaterialized` "incondicionalmente", en la
 * instancia VIEJA, ya desmontada. Ese callback lee y borra la identidad del
 * borrador (`ephemeralDraftWritingIdRef`) y reconcilia su pestaña en el store
 * compartido. Por esa limpieza tardía, la Fase 5 deja la identidad del
 * borrador como identidad de instancia (ODE-571). Lo que la sostiene es que la
 * reconciliación usa la identidad del SNAPSHOT (`draftWritingId`), no la
 * identidad viva, y que el store solo convierte la pestaña borrador que lleva
 * ese mismo `draft_writing_id`.
 *
 * Camino de producción: "New Artifact" real, remontaje por `key` como
 * `DesktopWriteEntry` (`write-root` → `write-new`), escritura real y guardado
 * real a `.md` en un directorio temporal. Lo único controlado es CUÁNDO
 * termina la creación del borrador viejo (`createDesktopDraftOverride`, que
 * delega en la de producción).
 *
 * Mutation test (ODE-571): reconciliar sin `draftWritingId` en
 * `onMaterialized`, o quitar la guarda de `draft_writing_id` en
 * `reconcileMaterializedDraftTab`, ponen en rojo la prueba: el borrador viejo
 * se apropia de la pestaña borrador de la instancia nueva.
 *
 * Fuera de esta prueba, con motivo: escribir en la instancia nueva ANTES de
 * que el borrador viejo se materialice. Hoy ese texto se borra (el cambio de
 * pestañas del store re-ejecuta la hidratación sobre un borrador sin
 * identidad). Es un bug preexistente, registrado en ODE-571 con su receta.
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
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000
const TEXT_OLD = "ODE571-BORRADOR-VIEJO"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-draft-remount-")
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

type CreateDesktopDraft = typeof createProductionDesktopDraft

/**
 * La creación del borrador de la instancia vieja queda retenida hasta que la
 * prueba la suelta: así su `onMaterialized` llega DESPUÉS de que la instancia
 * nueva ya tiene su propio borrador, el orden en el que una identidad
 * compartida entre instancias se confundiría.
 */
function heldDesktopDraft() {
  let release!: () => void
  const released = new Promise<void>((resolve) => {
    release = resolve
  })
  let calls = 0
  const create: CreateDesktopDraft = async (options) => {
    calls += 1
    await released
    return createProductionDesktopDraft(options)
  }
  return { create, release, calls: () => calls }
}

describe("ODE-571 — la identidad del borrador es de la instancia", () => {
  it(
    "un borrador que se materializa tras el remontaje no se apropia del borrador de la instancia nueva",
    async () => {
      const held = heldDesktopDraft()
      mounted = await mountEditorShell({ key: "write-root", createDesktopDraftOverride: held.create })
      await clickNewArtifact(mounted.container)
      await typeInEditor(TEXT_OLD)
      // Los 400 ms dejan pasar el debounce de salida del editor (150 ms): lo
      // escrito dentro de esa ventana se pierde al desmontar (hallazgo aparte,
      // registrado en ODE-571).
      await advance(400)

      // Entrada nueva (el "New" de la barra lateral navega a /write?new=1)
      // antes de que venza el debounce del guardado: la shell vieja se
      // desmonta, su coordinador vuelca el borrador y queda retenido.
      await mounted.render({ key: "write-new", forceNewWriting: true })
      await flush(5)
      await waitFor(() => held.calls() > 0, { label: "materialización vieja en curso" })
      await waitFor(() => mounted!.prosemirror(), { label: "editor de la entrada nueva" })
      const draftBefore = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === null)
      expect(draftBefore?.draft_writing_id, "la instancia nueva tiene su propio borrador").toBeTruthy()

      // El borrador viejo se materializa ahora, con la instancia nueva montada.
      held.release()
      const oldFile = await waitForMarkdownContaining(TEXT_OLD)
      await flush(5)

      const { session } = getEditorSessionState()
      const activeTab = session.tabs.find((tab) => tab.id === session.active_tab_id)
      expect(activeTab?.writing_id, "la pestaña activa sigue siendo un borrador sin documento").toBeNull()
      expect(activeTab?.draft_writing_id, "y es el borrador de la instancia nueva").toBe(draftBefore?.draft_writing_id)
      const oldTab = session.tabs.find((tab) => tab.writing_id !== null)
      expect(oldTab, "el documento viejo tiene su propia pestaña").toBeTruthy()
      expect(oldFile.contents).toContain(TEXT_OLD)
      expect((await readWorkspaceMarkdown()).length, "un solo archivo: el del borrador viejo").toBe(1)
    },
    TEST_TIMEOUT_MS,
  )
})
