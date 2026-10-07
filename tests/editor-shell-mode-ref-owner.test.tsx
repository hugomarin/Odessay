/**
 * @vitest-environment happy-dom
 *
 * ODE-609 — `modeRef` tiene un solo dueño (`applyEditorMode`): estado y ref se
 * escriben en el mismo paso, sin efecto espejo.
 *
 * Property (el caso real "leído entre render y efecto"): con el espejo, el
 * efecto pasivo del commit que aplica Markdown pisa el ref —que un gesto a
 * Rich dentro de esa misma ventana ya había dejado en "rich"— y lo deja en
 * "markdown" durante la ventana del commit de Rich. Un gesto a Markdown
 * dentro de esa ventana vuelve a coincidir con la guarda
 * `nextMode === modeRef.current` de `handleToggleMode` y se descarta en
 * silencio. Con el dueño, el ref vale "rich" en esa ventana y el gesto se
 * aplica.
 *
 * Técnica (integration-harness-catalog §Trampas): `world.onShellCommit` corre
 * en fase de layout de cada commit del shell, antes de sus efectos pasivos.
 * La sonda encadena tres gestos reales sobre los botones de la status bar:
 * Markdown; Rich en la ventana de ese commit; Markdown en la ventana del
 * commit de Rich.
 *
 * Camino de producción: documento real en fake-indexeddb → botones reales
 * "Markdown"/"Rich" de la status bar. Nada simulado salvo el mundo del harness.
 *
 * Mutation test (ODE-609): devolver el efecto espejo
 * (`useEffect(() => { modeRef.current = mode }, [mode])`) junto al dueño deja
 * el ref en "markdown" durante la ventana del commit de Rich; el tercer gesto
 * se descarta y el test agota el waitFor "termina en Markdown" → rojo. El
 * código de `main` (espejo + escrituras manuales de cada transición) cae por
 * el mismo tercer gesto, no por quitar la escritura del dueño.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"

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

const { act } = await import("react")
const { mountEditorShell, resetEditorShellWorld, waitFor, waitForHydrationReady, world } =
  await import("./support/editor-shell-harness")

const TEST_TIMEOUT_MS = 40_000
const TEXT = "Texto del documento en modo rich."

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

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let writingId = ""

beforeEach(async () => {
  writingId = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingId, TEXT, "Documento de modo"))
})

afterEach(async () => {
  world.onShellCommit = null
  await mounted?.unmount()
  mounted = null
})

function statusBarButton(label: "Rich" | "Markdown") {
  const button = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => (candidate.textContent ?? "").trim() === label)
  if (!button) throw new Error(`No está el botón "${label}" de la status bar`)
  return button
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

describe("ODE-609 — modeRef se lee entre el render y el efecto", () => {
  it(
    "los gestos pedidos en las ventanas de commit de Markdown y de Rich terminan en Markdown",
    async () => {
      mounted = await mountEditorShell({ writingId })
      await waitFor(() => mounted!.editor().getText().includes(TEXT), { label: "documento hidratado" })
      await waitForHydrationReady()

      const probe = { markdownToRich: false, richToMarkdown: false }
      world.onShellCommit = () => {
        // Ventana del commit que aplica Markdown: el textarea ya está en el
        // DOM y los efectos pasivos de este commit todavía no corrieron. Gesto
        // real y síncrono a Rich: con el espejo la guarda lee el ref, que la
        // escritura manual de la transición ya dejó en "markdown", así que
        // pasa; el retraso aparece en el commit siguiente.
        if (!probe.markdownToRich && markdownSource()) {
          probe.markdownToRich = true
          statusBarButton("Rich").click()
          return
        }
        // Ventana del commit que aplica Rich: el textarea ya no está y el
        // ProseMirror sí. Con el espejo, el efecto pasivo del commit anterior
        // acaba de pisar el ref con "markdown"; con el dueño, vale "rich".
        // Gesto real y síncrono a Markdown: con el espejo la guarda
        // `nextMode === modeRef.current` lo descarta y el modo se queda en
        // Rich; con el dueño, se aplica.
        if (
          probe.markdownToRich &&
          !probe.richToMarkdown &&
          !markdownSource() &&
          mounted!.prosemirror()
        ) {
          probe.richToMarkdown = true
          statusBarButton("Markdown").click()
        }
      }

      await act(async () => {
        statusBarButton("Markdown").click()
      })
      world.onShellCommit = null

      expect(
        probe.markdownToRich,
        "la sonda pulsó Rich en la ventana del commit a Markdown",
      ).toBe(true)
      expect(
        probe.richToMarkdown,
        "la sonda pulsó Markdown en la ventana del commit a Rich",
      ).toBe(true)
      await waitFor(() => markdownSource(), { label: "termina en Markdown", timeoutMs: 5_000 })
      expect(markdownSource()?.value, "el texto sobrevivió a los tres gestos").toContain(TEXT)
    },
    TEST_TIMEOUT_MS,
  )
})
