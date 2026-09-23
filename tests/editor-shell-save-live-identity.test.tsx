/**
 * @vitest-environment happy-dom
 *
 * ODE-556 — Prueba de caracterización 2 de 3: guardado contra identidad viva.
 *
 * Runtime: **desktop**. No es un detalle de configuración: en web,
 * `scheduleQueuedRichModeUpdate` vacía la cola de forma síncrona
 * (`!isDesktopRuntime()`), así que la carrera que esta prueba persigue
 * literalmente no existe ahí. La primera versión de este test corría en web,
 * pasaba en verde y no detectaba su propia mutación (ODE-556/ODE-557).
 *
 * Property: una edición escrita en A y todavía en la cola cuando el usuario
 * cambia de pestaña acaba atribuida a A — nunca al documento al que se
 * cambió, y nunca perdida.
 *
 * Por qué importa: el `onUpdate` del editor encola trabajo que retiene el
 * editor del documento viejo. Si esa cola se vacía después de que la
 * identidad cambió, el texto se escribe en el documento equivocado. Es
 * pérdida silenciosa: ni error, ni aviso; simplemente el párrafo no está
 * donde se escribió. `editor-shell.tsx` vacía la cola a propósito antes de
 * mover la identidad (ODE-478 caso 2) y esta prueba es la red que protege esa
 * decisión cuando el archivo se rompa en piezas.
 *
 * Camino de producción: "New Artifact" real → escritura real en el editor
 * real → "New Artifact" otra vez → escritura real → clic real (gesto de
 * puntero) en la pestaña de A → escritura real → clic real en la pestaña de
 * B con la edición todavía en vuelo.
 *
 * Completion event: el invariante se evalúa sobre los `.md` del disco, tras
 * dejar vencer los debounces del save path — no sobre "se llamó a
 * tauriWriteFile".
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

const { advance, mountEditorShell, pointerClick, resetEditorShellWorld, typeInEditor, waitFor } =
  await import("./support/editor-shell-harness")
const {
  createDesktopWorkspace,
  destroyDesktopWorkspace,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID } = await import("@/lib/local-db/editor-sessions")

const TEST_TIMEOUT_MS = 60_000

const TEXT_A = "ODE556-DOCUMENTO-A"
const TEXT_B = "ODE556-DOCUMENTO-B"
const PENDING_EDIT = " ODE556-EDICION-EN-VUELO"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-save-identity-")
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

/**
 * Pulsa el botón real de "New Artifact".
 *
 * Son dos controles distintos según el estado de la UI: el del estado vacío
 * lleva el texto, y el de la barra de pestañas es el "+" con
 * `aria-label="New Artifact"`. Ambos son entry points reales del producto.
 */
async function clickNewArtifact() {
  const button = await waitFor(
    () =>
      Array.from(mounted!.container.querySelectorAll("button")).find(
        (candidate) =>
          (candidate.textContent ?? "").includes("New Artifact") ||
          candidate.getAttribute("aria-label") === "New Artifact",
      ),
    { label: 'botón "New Artifact"' },
  )
  button.click()
  // El handler limpia el editor y difiere el foco un par de frames; escribir
  // antes de que asiente hace que el shell pise el texto (ODE-557).
  await advance(400)
}

/** Cambia de pestaña con el gesto real y verifica que la activación ocurrió. */
async function clickTab(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((entry) => entry.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  const active = getEditorSessionState().session.active_tab_id
  if (active !== tab.id) {
    throw new Error(`El gesto sobre la pestaña de ${writingId} no la activó (activa: ${active})`)
  }
}

/**
 * Espera a que el documento activo tenga identidad materializada y la
 * devuelve.
 *
 * Leer `active_tab_id` justo después de escribir no basta: hasta que la
 * materialización reconcilia la pestaña, el id activo sigue siendo el
 * marcador de borrador (`EDITOR_DRAFT_TAB_ID`). Bajo carga (CI) esa ventana
 * se ensancha y el test buscaba después una pestaña `draft` que ya no existe.
 */
async function waitForMaterializedWritingId() {
  return waitFor(
    () => {
      const { session } = getEditorSessionState()
      const active = session.tabs.find((tab) => tab.id === session.active_tab_id)
      const writingId = active?.writing_id
      if (!writingId || writingId === EDITOR_DRAFT_TAB_ID) return null
      return writingId
    },
    { label: "identidad materializada del documento activo", timeoutMs: 15_000 },
  )
}

/** Espera a que el texto aparezca en algún `.md` del workspace y devuelve su ruta. */
async function waitForMarkdownContaining(needle: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const files = await readWorkspaceMarkdown()
    const match = files.find((file) => file.contents.includes(needle))
    if (match) return match
    await advance(250)
  }
  const files = await readWorkspaceMarkdown()
  throw new Error(
    `Ningún .md contiene ${JSON.stringify(needle)}. Archivos: ${JSON.stringify(
      files.map((file) => ({ path: file.path, bytes: file.contents.length })),
    )}`,
  )
}

describe("ODE-556 — edición en vuelo y cambio de identidad (desktop)", () => {
  it(
    "atribuye a A una edición que seguía en la cola cuando el usuario cambió a B",
    async () => {
      mounted = await mountEditorShell()

      // Documento A: creado y materializado con contenido real.
      await clickNewArtifact()
      await typeInEditor(TEXT_A)
      const fileA = await waitForMarkdownContaining(TEXT_A)
      const writingA = await waitForMaterializedWritingId()

      // Documento B: mismo camino, documento distinto.
      await clickNewArtifact()
      await typeInEditor(TEXT_B)
      const fileB = await waitForMarkdownContaining(TEXT_B)
      const writingB = await waitForMaterializedWritingId()

      expect(writingA).not.toBe(writingB)
      expect(fileA.path).not.toBe(fileB.path)

      // Volvemos a A y escribimos sin esperar a que venza el debounce: la
      // edición queda deliberadamente en vuelo.
      await clickTab(writingA)
      await waitFor(() => mounted!.editor().getText().includes(TEXT_A), {
        label: "A activo con su propio contenido",
      })
      await typeInEditor(PENDING_EDIT)

      // Y cambiamos a B con esa edición todavía encolada.
      await clickTab(writingB)

      // Completion event: dejamos vencer los debounces del save path.
      await advance(6_000)

      const files = await readWorkspaceMarkdown()
      const contentsA = files.find((file) => file.path === fileA.path)?.contents ?? ""
      const contentsB = files.find((file) => file.path === fileB.path)?.contents ?? ""

      expect(contentsA, "la edición en vuelo debe quedar en A").toContain(PENDING_EDIT.trim())
      expect(contentsB, "la edición de A no puede atribuirse a B").not.toContain(
        PENDING_EDIT.trim(),
      )
      expect(contentsB, "B conserva su propio contenido").toContain(TEXT_B)
    },
    TEST_TIMEOUT_MS,
  )
})
