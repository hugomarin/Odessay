/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-401/ODE-402 — "Guardar como" en desktop mueve el documento; no
 * lo copia.
 *
 * Property: cuando el usuario elige otra ruta con "Save As" (menú nativo), el
 * `.md` del documento se MUEVE ahí. Si el traslado sale bien, la pestaña toma
 * el nombre final (con sufijo si la ruta elegida ya existía) y no hay aviso.
 * Si falla, nada cambia: el título sigue siendo el del documento, no aparece
 * ninguna copia en el destino, el archivo original conserva el contenido y el
 * aviso muestra la ruta original, no la elegida.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-save-to-disk-relocate.test.tsx`, que montaba la shell con un
 * editor de cartón y ~40 dobles, incluido el propio servicio de traslado.
 * Aquí el traslado es el de producción (`relocateDesktopWriting`) sobre el fs
 * real del directorio temporal.
 *
 * Camino de producción: "New Artifact" real, escritura real, evento nativo
 * `menu:save-as` a través del bus de menú real, diálogo nativo doblado
 * (`world.saveDialogResult`) y traslado real en disco. El fallo es uno real:
 * la carpeta elegida es, en disco, un archivo, así que no se puede crear.
 *
 * Mutation test (ODE-574): adoptar la ruta elegida aunque el traslado falle
 * pone en rojo el caso de fallo; ignorar la ruta final devuelta por el
 * traslado (el sufijo de colisión) pone en rojo el de éxito.
 */
import { mkdir, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
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
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000
const BODY = "ODE574-CUERPO-DE-LA-CARTA"
const FAILURE_NOTICE = "couldn't be moved to the chosen folder"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-save-as-relocate-")
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

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

/** Crea un documento real con contenido y devuelve su `.md` y su título. */
async function createDocument() {
  mounted = await mountEditorShell()
  // Esperar a que cargue la sesión antes de "New Artifact". Pulsarlo durante
  // la carga deja la shell sin adoptar el documento cuando se materializa
  // (hallazgo de ODE-574, registrado aparte); esta prueba es sobre Save As.
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(BODY)
  await advance(6_000)
  const file = await waitForMarkdownContaining(BODY)
  const tab = await waitFor(
    () => {
      const current = activeTab()
      return current?.writing_id && current.writing_id !== EDITOR_DRAFT_TAB_ID ? current : null
    },
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  return { file, title: tab.title }
}

describe("ODE-574 — Save As mueve el documento (ODE-401/ODE-402)", () => {
  it(
    "si el traslado falla: mismo título, nada en el destino y el aviso muestra la ruta original",
    async () => {
      const { file, title } = await createDocument()

      // La "carpeta" elegida es un archivo: el traslado no puede crearla.
      const blocker = join(desktopWorkspaceRoot(), "no-es-carpeta")
      await writeFile(blocker, "")
      const chosen = join(blocker, "Renamed.md")
      world.saveDialogResult = chosen

      await emitTauriEvent("menu:save-as")
      await waitFor(() => mounted!.container.textContent?.includes(FAILURE_NOTICE), {
        label: "aviso de traslado fallido",
        timeoutMs: 15_000,
      })

      expect(activeTab()?.title, "el título sigue siendo el del documento").toBe(title)
      expect(await exists(chosen), "no queda copia en el destino").toBe(false)
      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path), "el documento sigue donde estaba").toEqual([file.path])
      expect(files[0].contents).toContain(BODY)
      const text = mounted!.container.textContent ?? ""
      expect(text, "el aviso muestra la ruta original").toContain(file.path)
      expect(text, "y no la elegida").not.toContain(chosen)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si el traslado sale bien: la pestaña toma el nombre final, con sufijo de colisión, y no hay aviso",
    async () => {
      const { file } = await createDocument()

      // Ya hay un "Renamed.md" en la carpeta elegida: el traslado debe sufijar.
      const chosenDir = join(desktopWorkspaceRoot(), "elegida")
      await mkdir(chosenDir, { recursive: true })
      await writeFile(join(chosenDir, "Renamed.md"), "ocupado")
      world.saveDialogResult = join(chosenDir, "Renamed.md")

      await emitTauriEvent("menu:save-as")
      await waitFor(() => activeTab()?.title === "Renamed 2", {
        label: "título del nombre final",
        timeoutMs: 15_000,
      })

      const moved = join(chosenDir, "Renamed 2.md")
      const files = await readWorkspaceMarkdown()
      expect(files.find((entry) => entry.path === moved)?.contents, "el documento está en su ruta final").toContain(BODY)
      expect(await exists(file.path), "movido, no copiado: el original ya no está").toBe(false)
      expect(files.find((entry) => entry.path === join(chosenDir, "Renamed.md"))?.contents, "el ocupante no se toca").toBe(
        "ocupado",
      )
      expect(mounted!.container.textContent ?? "").not.toContain(FAILURE_NOTICE)
    },
    TEST_TIMEOUT_MS,
  )
})
