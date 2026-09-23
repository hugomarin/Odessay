/**
 * @vitest-environment happy-dom
 *
 * ODE-557 — Humo del modo desktop del harness de `EditorShell`.
 *
 * Runtime: **desktop** (declarado explícitamente, corrección de contexto que
 * viene de ODE-556: el runtime decide si el invariante siquiera existe, así
 * que no puede quedar implícito en el brief ni en el test).
 *
 * Property: con el harness en modo desktop, lo que el usuario escribe en el
 * editor real acaba en el `.md` del workspace, en disco. Si esto no se
 * cumple, cualquier prueba desktop construida encima estaría midiendo un
 * camino muerto.
 *
 * Camino de producción: `EditorShell` monta con `forceNewWriting` (el mismo
 * "New Artifact" que dispara la UI) → `createDesktopDraft` real →
 * `DesktopDocumentService` real → `FilesystemDocumentService` real →
 * escritura real de fs (tmp + rename) a través del doble del transporte
 * nativo. Escritura real en el editor real, sin simular `onUpdate`.
 *
 * Completion event: el invariante se evalúa leyendo el archivo del disco
 * después de que venzan los debounces del save path — no cuando se llama a
 * `tauriWriteFile`, que solo significa "el guardado empezó".
 *
 * Colaboradores reales: EditorShell, TipTap + extensiones reales, editor
 * session store, PersistenceCoordinator, DesktopDocumentService,
 * FilesystemDocumentService, el catálogo con las reglas de consistencia
 * reales, y fs real contra un directorio temporal.
 * Dobles: el transporte nativo de Tauri (no hay puente en Vitest), el flush a
 * la nube (red), los diálogos del SO, el proveedor de AI y el router de Next.
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
  assertNoUnhandledErrors,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
} = await import("./support/editor-shell-harness")
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")

/** Montar el shell real y esperar al save path desktop es caro bajo carga. */
const DESKTOP_TEST_TIMEOUT_MS = 40_000

/** El texto lleva marca propia para no confundirlo con placeholders del editor. */
const TYPED = "ODE557-TEXTO-ESCRITO-EN-EL-EDITOR-REAL"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  // Una vez por archivo: getDocumentService() memoiza el runtime desktop en
  // su primera resolución, así que el root no se puede cambiar por test.
  createDesktopWorkspace()
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

describe("ODE-557 — modo desktop del harness", () => {
  it(
    "escribe en el .md del workspace lo que el usuario teclea en el editor real",
    async () => {
      // Entry point real: el shell arranca sin documento abierto y el usuario
      // pulsa "New Artifact", que es literalmente el botón del estado vacío.
      // (La prop `forceNewWriting` existe para la ruta /write?new, pero en el
      // timing del harness su efecto se dispara antes de que el store de
      // sesión termine de cargar y la pestaña no sobrevive — ver nota del PR.)
      mounted = await mountEditorShell()

      const newArtifact = await waitFor(
        () =>
          Array.from(mounted!.container.querySelectorAll("button")).find((button) =>
            (button.textContent ?? "").includes("New Artifact"),
          ),
        { label: 'botón "New Artifact" del estado vacío' },
      )
      newArtifact.click()

      const prosemirror = await waitFor(() => mounted!.prosemirror(), {
        label: "ProseMirror real montado tras crear el artefacto",
      })
      expect(prosemirror.getAttribute("contenteditable")).toBe("true")

      // El propio handler de "New Artifact" limpia el editor y difiere el
      // foco un par de frames; escribir antes de que eso asiente hace que el
      // shell pise el texto. Es el orden real: el usuario escribe sobre un
      // documento ya listo.
      await advance(400)

      // Escritura real en el editor real: el `onUpdate` del shell se dispara
      // solo, no se simula.
      await typeInEditor(TYPED)
      expect(mounted.editor().getText()).toContain(TYPED)

      // Completion event: el save path desktop está debounced (output del
      // editor + persistencia), así que esperamos a que el contenido aparezca
      // en el disco real en vez de asumir un tiempo fijo.
      let markdown: Awaited<ReturnType<typeof readWorkspaceMarkdown>> = []
      const deadline = Date.now() + 25_000
      while (Date.now() < deadline) {
        markdown = await readWorkspaceMarkdown()
        if (markdown.some((file) => file.contents.includes(TYPED))) break
        await advance(250)
      }

      const match = markdown.find((file) => file.contents.includes(TYPED))
      expect(
        match,
        `ningún .md del workspace contiene el texto escrito. Archivos en disco: ${JSON.stringify(
          markdown.map((file) => ({ path: file.path, bytes: file.contents.length })),
        )}`,
      ).toBeTruthy()

      // Y el shell no tragó ningún error por el camino.
      assertNoUnhandledErrors()
    },
    DESKTOP_TEST_TIMEOUT_MS,
  )
})
