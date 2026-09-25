/**
 * @vitest-environment happy-dom
 *
 * ODE-581 — "Open File" del menú nativo abre la pestaña con el título del
 * documento que se abre, nunca con el del anterior.
 *
 * Property: con A abierto, abrir B desde el menú nativo crea la pestaña de B
 * con el título de B desde el primer commit en que existe. El título de A no
 * se filtra ni un instante.
 *
 * Por qué existe: ODE-563 cambió `handleMenuOpenFile` para que la pestaña
 * nueva lea el título ya aplicado de B (`applyDocumentMetadata`) en vez de
 * `titleRef`, que en ese momento todavía describe a A. Ese arreglo visible no
 * tenía prueba propia.
 *
 * Runtime: **desktop** (el menú nativo solo existe ahí).
 *
 * Camino de producción: el evento nativo real `menu:open-file` → diálogo
 * nativo (doblado, devuelve la ruta) → `open_file` (doblado, lee el disco
 * real) → `handleMenuOpenFile` → opener unificado real → catálogo real sobre
 * los dobles de sus comandos. Los dos archivos existen en disco con nombres
 * distintos antes de abrirlos.
 *
 * Completion event: la pestaña del store en CADA commit de la shell
 * (`world.onShellCommit`), no solo el estado final: un título equivocado que
 * luego se corrige por hidratación también tiene que ponerla en rojo.
 *
 * Mutation test (ODE-581): tomar el título de la pestaña de `titleRef` antes
 * de aplicar los metadatos de B pone en rojo la prueba.
 */
import { writeFileSync } from "node:fs"
import { join } from "node:path"

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

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
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const { emitTauriEvent, flush, mountEditorShell, resetEditorShellWorld, waitFor } = await import(
  "./support/editor-shell-harness"
)
const { world } = await import("./support/editor-shell-doubles")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { tauriOpenFileDouble } = await import("./integration/documents/support/real-desktop-doubles")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { mkdirSync } = await import("node:fs")

const TEST_TIMEOUT_MS = 60_000

const A = { title: "Carta a Marta", body: "ODE581 cuerpo de la carta." }
const B = { title: "Informe anual", body: "ODE581 cuerpo del informe." }

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-menu-open-title-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // El opener consulta la sesión de la nube antes de decidir (sin sesión no
  // hay red). Basta con que el cliente de Supabase de desktop se construya.
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

/** Escribe un `.md` real en una carpeta del workspace temporal y devuelve su ruta. */
function writeMarkdownFile(title: string, body: string) {
  const folder = join(desktopWorkspaceRoot(), "Documentos")
  mkdirSync(folder, { recursive: true })
  const path = join(folder, `${title}.md`)
  writeFileSync(path, `${body}\n`)
  return path
}

/** "Open File" del menú nativo, eligiendo `path` en el diálogo. */
async function openFromNativeMenu(path: string, body: string, alerts: string[] = []) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  await flush(5)
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await waitFor(() => alerts.length > 0 || mounted!.editor().getText().includes(body), {
    label: `documento abierto: ${body}`,
    timeoutMs: 15_000,
  })
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await flush(3)
}

describe("ODE-581 — Open File del menú nativo usa el título del documento abierto", () => {
  it(
    "con A abierto, la pestaña de B nace con el título de B",
    async () => {
      const pathA = writeMarkdownFile(A.title, A.body)
      const pathB = writeMarkdownFile(B.title, B.body)
      world.tauriInvoke = async (command, args) => {
        if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
        throw new Error(`Comando nativo no previsto en esta prueba: ${command}`)
      }
      // Una carpeta fuera de todo BindingRoot pide consentimiento para
      // registrarla (ODE-375): se acepta, como haría el usuario.
      const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
      const alerts: string[] = []
      window.alert = (message?: unknown) => {
        alerts.push(String(message))
      }

      mounted = await mountEditorShell()
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })

      await openFromNativeMenu(pathA, A.body, alerts)
      const writingA = activeTab()?.writing_id
      expect(writingA, "A abierto con identidad").toBeTruthy()
      expect(activeTab()?.title, "control positivo: la pestaña de A dice A").toBe(A.title)

      // Sonda: en cada commit de la shell, el título de cualquier pestaña que
      // no sea la de A. La primera vez que aparece la de B es la que cuenta.
      const titlesSeenForB: string[] = []
      world.onShellCommit = () => {
        for (const tab of getEditorSessionState().session.tabs) {
          if (tab.writing_id && tab.writing_id !== writingA) titlesSeenForB.push(tab.title)
        }
      }

      await openFromNativeMenu(pathB, B.body, alerts)
      world.onShellCommit = null

      const writingB = activeTab()?.writing_id
      expect(writingB, "B abierto con su propia identidad").toBeTruthy()
      expect(writingB).not.toBe(writingA)
      expect(titlesSeenForB.length, "control positivo: la sonda vio la pestaña de B").toBeGreaterThan(0)
      expect(titlesSeenForB[0], "la pestaña de B nace con el título de B").toBe(B.title)
      expect(titlesSeenForB, "el título de A nunca aparece en la pestaña de B").not.toContain(A.title)
      expect(activeTab()?.title).toBe(B.title)

      const tabLabel = document.querySelector<HTMLElement>(`[data-editor-tab-id="${activeTab()!.id}"]`)
      expect(tabLabel?.textContent, "la pestaña visible dice B").toContain(B.title)
      expect(tabLabel?.textContent).not.toContain(A.title)

      const record = await (await getDocumentCatalog()).getById(writingB!)
      expect(record?.title, "los metadatos durables de B").toBe(B.title)
      expect(record?.binding?.canonicalPath).toBe(pathB)
      expect(confirm.mock.calls.length, "a lo sumo un consentimiento, para la carpeta").toBeLessThanOrEqual(1)
    },
    TEST_TIMEOUT_MS,
  )
})
