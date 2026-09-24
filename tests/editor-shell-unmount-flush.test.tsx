/**
 * @vitest-environment happy-dom
 *
 * ODE-573 — Lo último que se escribe antes de salir del editor llega al disco.
 *
 * Property: en desktop, si el usuario escribe y la shell se desmonta enseguida
 * (sale del editor, o una entrada por URL la remonta con otra `key`), el texto
 * llega al `.md` del documento, por poco tiempo que haya pasado desde la
 * última tecla.
 *
 * Por qué existe: en desktop la edición espera 150 ms en una cola propia
 * (`DESKTOP_EDITOR_OUTPUT_DEBOUNCE_MS`) antes de llegar al coordinador de
 * persistencia. La limpieza de desmontaje cancelaba esa cola sin volcarla, y
 * el coordinador, que se cierra antes (su efecto está declarado antes), ya no
 * podía recibirla. Se perdía lo escrito en esa ventana (ODE-573).
 *
 * Camino de producción: "New Artifact" real, escritura real, desmontaje real
 * (o remontaje por `key` como `DesktopWriteEntry`) y guardado real a `.md` en
 * un directorio temporal.
 *
 * Mutation test (ODE-573): quitar el volcado de la cola antes de cerrar el
 * coordinador pone en rojo los dos casos.
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

const { advance, clickNewArtifact, mountEditorShell, resetEditorShellWorld, typeInEditor, waitForMarkdownContaining } =
  await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)

const TEST_TIMEOUT_MS = 60_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-unmount-flush-")
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

describe("ODE-573 — la edición en cola se vuelca al desmontar", () => {
  it(
    "salir del editor justo después de escribir en un borrador guarda el texto",
    async () => {
      mounted = await mountEditorShell()
      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE573-SALIDA-INMEDIATA")

      // Dentro de la ventana de 150 ms de la cola de desktop.
      await advance(50)
      await mounted.unmount()
      mounted = null

      await waitForMarkdownContaining("ODE573-SALIDA-INMEDIATA")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "remontar justo después de escribir en un documento con archivo guarda lo último",
    async () => {
      mounted = await mountEditorShell({ key: "write-root" })
      await clickNewArtifact(mounted.container)
      await typeInEditor("ODE573-DOCUMENTO")
      await advance(6_000)
      await waitForMarkdownContaining("ODE573-DOCUMENTO")

      await typeInEditor(" ODE573-ULTIMA-EDICION")
      await advance(50)
      await mounted.render({ key: "write-new", forceNewWriting: true })

      const file = await waitForMarkdownContaining("ODE573-ULTIMA-EDICION")
      expect(file.contents).toContain("ODE573-DOCUMENTO")
    },
    TEST_TIMEOUT_MS,
  )
})
