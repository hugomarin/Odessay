/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-604 — STATE-10: cambiar entre Rich y Markdown no pierde ni
 * duplica lo escrito.
 *
 * Property: lo último que el usuario escribió en un modo llega al otro modo y
 * al disco, aunque cambie de modo antes de que venza el debounce de guardado,
 * y un guardado que estaba en vuelo al cambiar de modo no provoca una segunda
 * escritura con contenido viejo.
 *
 * Por qué existe: `handleToggleMode` serializa (Rich → Markdown) o
 * deserializa (Markdown → Rich) el documento, y cada modo tiene su propia
 * cola: Rich encola la edición en un frame y un debounce de salida del editor;
 * Markdown, en un debounce de 800 ms que el cambio de modo CANCELA y sustituye
 * por un guardado inmediato. Nada de eso tenía escenario en el mapa, y el
 * corte 5 (ODE-605) va a mover justamente esas colas fuera de la shell.
 *
 * Runtime: **desktop**. Es donde las dos colas son asíncronas: en web la
 * edición Rich se vuelca en el mismo frame (ODE-556), así que "cambiar antes
 * de que venza" solo existe para Markdown. El caso Markdown → Rich se repite
 * en web.
 *
 * Camino de producción: "New Artifact" real, escritura real en TipTap, los
 * botones reales "Rich"/"Markdown" de la status bar y el textarea real
 * "Markdown source". El guardado real escribe `.md` en un directorio temporal
 * (desktop) o en `localDB` sobre fake-indexeddb (web). Lo único controlado es
 * CUÁNDO termina una escritura de disco (`holdWriteFile`).
 *
 * Completion event: el contenido del `.md` (o de la fila local) tras dejar
 * vencer los debounces, y el contenido visible del modo de destino.
 *
 * Mutation test (ODE-604):
 *   - en `handleToggleMode`, rama a Markdown, descartar la edición Rich en cola
 *     (cancelar su frame/debounce sin volcarla) → rojo el caso Rich → Markdown;
 *   - en `handleToggleMode`, rama a Rich, quitar el `persistEditorSnapshot`
 *     que sustituye al debounce de Markdown cancelado → rojo los casos
 *     Markdown → Rich (desktop y web) y el del guardado en vuelo (lo escrito
 *     en Markdown no llega nunca al disco);
 *   - quitar las DOS defensas contra el debounce de Markdown rezagado (el
 *     `clearTimeout` de `handleToggleMode` y la guarda `modeRef !== "markdown"`
 *     del propio guardado de Markdown) → rojo el caso del guardado en vuelo: el
 *     guardado viejo de Markdown reescribe el documento y pierde lo escrito
 *     después en Rich. Quitar solo una de las dos deja el caso en verde, y es
 *     correcto: son redundantes.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { Editor } from "@tiptap/core"

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
vi.mock("@tauri-apps/api/core", async (importOriginal) =>
  (await import("./support/editor-shell-doubles")).tauriCoreDouble(
    await importOriginal<Record<string, unknown>>(),
  ),
)
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

const { act } = await import("react")
const {
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  pointerClick,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdWriteFile, writeFileCalls } = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEditorSessionTab, createEmptyEditorSession } = await import(
  "@/lib/local-db/editor-sessions"
)
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { localDB } = await import("@/lib/local-db")

const TEST_TIMEOUT_MS = 60_000
const SAVE_WINDOW_MS = DESKTOP_PERSISTENCE_DEBOUNCE_MS + 1_000

type ResizeObservation = {
  callback: ResizeObserverCallback
  target: Element | null
  disconnected: boolean
  notify: (width: number, height: number) => void
}

const resizeObservations: ResizeObservation[] = []

class ControlledResizeObserver implements ResizeObserver {
  private target: Element | null = null
  private observation: ResizeObservation | null = null

  constructor(private readonly callback: ResizeObserverCallback) {}

  observe(target: Element) {
    this.target = target
    this.observation = {
      callback: this.callback,
      target,
      disconnected: false,
      notify: (width, height) => {
        if (!this.target) throw new Error("ResizeObserver has no observed Rich surface")
        const contentRect = new DOMRect(0, 0, width, height)
        this.callback(
          [{ target: this.target, contentRect } as ResizeObserverEntry],
          this,
        )
      },
    }
    resizeObservations.push(this.observation)
  }

  unobserve() {}

  disconnect() {
    if (this.observation) this.observation.disconnected = true
  }
}

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-mode-toggle-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  // La sesión persistida vive en fake-indexeddb, que el harness no limpia.
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  resizeObservations.length = 0
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

function tabForWritingId(writingId: string) {
  return getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingId)
}

async function clickTabForWritingId(writingId: string) {
  const tab = tabForWritingId(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = mounted!.container.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  await waitFor(() => getEditorSessionState().session.active_tab_id === tab.id, {
    label: `pestaña activa para ${writingId}`,
  })
}

/** Crea un documento real, guardado en disco, y lo deja activo en Rich. */
async function createDocument(text: string) {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(text)
  await advance(SAVE_WINDOW_MS)
  const file = await waitForMarkdownContaining(text)
  await waitFor(
    () => {
      const writing = activeTab()?.writing_id
      return writing && writing !== EDITOR_DRAFT_TAB_ID ? writing : null
    },
    { label: "pestaña activa con identidad", timeoutMs: 15_000 },
  )
  return file
}

/** Pulsa el botón real "Rich" o "Markdown" de la status bar y comprueba que el modo cambió. */
async function switchMode(label: "Rich" | "Markdown") {
  const button = await waitFor(
    () =>
      Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === label),
    { label: `botón "${label}" de la status bar` },
  )
  await act(async () => {
    button.click()
  })
  await flush(2)
  await waitFor(() => (label === "Markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()), {
    label: `el editor en modo ${label}`,
  })
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

/** Escribe al final del textarea real de Markdown, como el `onChange` de React lo recibe. */
async function typeInMarkdown(text: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(
      textarea,
      `${textarea.value}${text}`,
    )
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

async function contentsOf(path: string) {
  const files = await readWorkspaceMarkdown()
  return files.find((file) => file.path === path)?.contents ?? ""
}

function installOneShotDomAllocationFailure() {
  const ownDescriptor = Object.getOwnPropertyDescriptor(document, "createElement")
  const createElement = document.createElement.bind(document)
  let failed = false
  const restore = () => {
    if (ownDescriptor) {
      Object.defineProperty(document, "createElement", ownDescriptor)
    } else {
      Reflect.deleteProperty(document, "createElement")
    }
  }

  Object.defineProperty(document, "createElement", {
    configurable: true,
    writable: true,
    value: ((localName: string, options?: ElementCreationOptions) => {
      if (!failed) {
        failed = true
        restore()
        throw new Error("DOM allocation failed while creating the source parser")
      }
      return createElement(localName, options)
    }) as typeof document.createElement,
  })

  return { didFail: () => failed, restore }
}

describe("ODE-604 — STATE-10: cambiar de modo no pierde ni duplica lo escrito (desktop)", () => {
  it(
    "editar en Rich y cambiar a Markdown antes del debounce: el texto llega a Markdown y al disco",
    async () => {
      const file = await createDocument("ODE604-MODO-BASE")
      await advance(300)

      await typeInEditor(" ODE604-DESDE-RICH")
      // Control del estado de partida: la edición sigue en la cola de Rich.
      expect(await contentsOf(file.path), "la edición todavía no está en disco").not.toContain("ODE604-DESDE-RICH")
      await switchMode("Markdown")
      expect(markdownSource()?.value, "Markdown muestra lo escrito en Rich").toContain("ODE604-DESDE-RICH")

      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE604-DESDE-RICH")
      expect(await contentsOf(file.path), "y llega al archivo del documento").toContain("ODE604-DESDE-RICH")
      expect(await readWorkspaceMarkdown(), "sin crear otro archivo").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "editar en Markdown y volver a Rich antes del debounce: el texto llega a Rich y al disco",
    async () => {
      const file = await createDocument("ODE604-MODO-BASE")
      await switchMode("Markdown")
      await advance(SAVE_WINDOW_MS)

      await typeInMarkdown(" ODE604-DESDE-MARKDOWN")
      // Sin esperar el debounce de Markdown (800 ms): el cambio de modo lo cancela.
      await switchMode("Rich")
      expect(mounted!.editor().getText(), "Rich muestra lo escrito en Markdown").toContain("ODE604-DESDE-MARKDOWN")

      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE604-DESDE-MARKDOWN")
      expect(await contentsOf(file.path), "y llega al archivo del documento").toContain("ODE604-DESDE-MARKDOWN")
      expect(await readWorkspaceMarkdown(), "sin crear otro archivo").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cambiar de modo con un guardado en vuelo: no hay una segunda escritura con contenido viejo",
    async () => {
      const file = await createDocument("ODE604-MODO-BASE")
      const baseline = writeFileCalls().filter((call) => call.path === file.path).length
      const writesSinceBaseline = () => writeFileCalls().filter((call) => call.path === file.path).slice(baseline)

      const held = holdWriteFile((path) => path === file.path)
      await typeInEditor(" ODE604-EN-VUELO")
      await advance(SAVE_WINDOW_MS)
      await held.started
      expect(writesSinceBaseline(), "control positivo: el guardado de Rich está en vuelo").toHaveLength(1)

      await switchMode("Markdown")
      await typeInMarkdown(" ODE604-TRAS-EL-CAMBIO")
      await switchMode("Rich")
      // Seguir escribiendo en Rich dentro de la ventana del debounce de
      // Markdown (800 ms) que el cambio de modo canceló: si ese guardado viejo
      // sobreviviera, reescribiría el documento sin esta edición.
      await typeInEditor(" ODE604-RICH-FINAL")
      await advance(SAVE_WINDOW_MS)

      held.release()
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE604-RICH-FINAL")

      const writes = writesSinceBaseline()
      expect(writes[0]?.content, "el guardado retenido lleva la edición de Rich").toContain("ODE604-EN-VUELO")
      const later = writes.slice(1)
      expect(later.length, "tras el retenido, un guardado con lo último").toBeGreaterThanOrEqual(1)
      for (const write of later) {
        expect(write.content, "ninguna escritura posterior con contenido viejo").toContain("ODE604-TRAS-EL-CAMBIO")
        expect(write.content, "ninguna escritura posterior con contenido viejo").toContain("ODE604-RICH-FINAL")
      }
      const final = await contentsOf(file.path)
      expect(final, "el disco termina con lo último").toContain("ODE604-RICH-FINAL")
      expect(final).toContain("ODE604-TRAS-EL-CAMBIO")
      expect(final).toContain("ODE604-EN-VUELO")
      expect(mounted!.editor().getText(), "y el editor también").toContain("ODE604-RICH-FINAL")
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-540 — aplicar Source editado en Rich", () => {
  it(
    "espera a que Rich esté conectado y medido antes de aplicar y persistir el Source editado",
    async () => {
      const file = await createDocument("ODE540-LAYOUT-BASE")
      await switchMode("Markdown")
      await advance(SAVE_WINDOW_MS)

      const layout = { rect: new DOMRect(0, 0, 800, 500) }
      vi.stubGlobal("ResizeObserver", ControlledResizeObserver)
      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("EditorRichContent")
          ? layout.rect
          : originalGetBoundingClientRect.call(this)
      })

      await typeInMarkdown(" ODE540-LAYOUT-EDITED")
      const source = markdownSource()?.value ?? ""
      const originalRich = mounted!.editor().getText()
      const baselineWrites = writeFileCalls().filter((call) => call.path === file.path).length
      let editorUpdates = 0
      const onUpdate = () => {
        editorUpdates += 1
      }
      const realEditor = mounted!.editor() as unknown as Editor
      realEditor.on("update", onUpdate)

      layout.rect = new DOMRect(0, 0, 0, 0)
      const richButton = Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === "Rich")
      if (!richButton) throw new Error('No está el botón "Rich" de la status bar')
      await act(async () => richButton.click())
      await flush(2)

      expect(markdownSource(), "Rich hizo commit de la presentación antes de aplicar el snapshot").toBeNull()
      expect(mounted!.editor().getText(), "el Source sigue pendiente hasta la señal de layout").toBe(originalRich)
      expect(editorUpdates, "todavía no hay una aplicación a TipTap").toBe(0)

      // Que pase el debounce sin entregar dimensiones prueba que agendar el
      // commit no persiste el Source todavía.
      await advance(SAVE_WINDOW_MS)
      expect(writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites)).toHaveLength(0)
      expect(await contentsOf(file.path)).not.toContain("ODE540-LAYOUT-EDITED")

      const observation = [...resizeObservations]
        .reverse()
        .find((entry) => !entry.disconnected && entry.target?.classList.contains("EditorRichContent"))
      expect(observation, "la superficie Rich espera una medición del browser").toBeDefined()
      layout.rect = new DOMRect(0, 0, 800, 500)
      await act(async () => observation?.notify(800, 500))

      expect(mounted!.editor().getText()).toContain("ODE540-LAYOUT-EDITED")
      expect(editorUpdates, "el snapshot aceptado se aplica una sola vez").toBe(1)
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE540-LAYOUT-EDITED")
      expect(writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites)).toHaveLength(1)
      expect(await contentsOf(file.path)).toContain("ODE540-LAYOUT-EDITED")
      realEditor.off("update", onUpdate)

      // El valor se conserva para documentar que se probó el textarea real.
      expect(source).toContain("ODE540-LAYOUT-EDITED")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "conserva Rich y el archivo cuando el parser de Source no puede crear su DOM",
    async () => {
      const file = await createDocument("ODE540-PARSE-BASE")
      const originalRich = mounted!.editor().getText()
      const originalFile = await contentsOf(file.path)
      const baselineWrites = writeFileCalls().filter((call) => call.path === file.path).length
      await switchMode("Markdown")
      await advance(SAVE_WINDOW_MS)
      await typeInMarkdown(" ODE540-PARSE-EDITED")

      const domFailure = installOneShotDomAllocationFailure()
      const richButton = Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === "Rich")
      if (!richButton) throw new Error('No está el botón "Rich" de la status bar')
      await act(async () => richButton.click())
      domFailure.restore()
      await flush(2)
      await advance(SAVE_WINDOW_MS)

      const actual = {
        parserDomFailureReached: domFailure.didFail(),
        sourceVisible: Boolean(markdownSource()),
        sourceRetainsEdit: markdownSource()?.value.includes("ODE540-PARSE-EDITED") ?? false,
        richIsUntouched: mounted!.editor().getText() === originalRich,
        recoverableError: mounted!.container.querySelector('[role="alert"]')?.textContent?.includes(
          "Could not apply this source to Rich",
        ) ?? false,
        writes: writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites).length,
        fileIsUntouched: (await contentsOf(file.path)) === originalFile,
        documentCount: (await readWorkspaceMarkdown()).length,
      }

      expect(actual).toEqual({
        parserDomFailureReached: true,
        sourceVisible: true,
        sourceRetainsEdit: true,
        richIsUntouched: true,
        recoverableError: true,
        writes: 0,
        fileIsUntouched: true,
        documentCount: 1,
      })
    },
    TEST_TIMEOUT_MS,
  )


})

describe("ODE-604 — STATE-10 en web", () => {
  it(
    "editar en Markdown y volver a Rich antes del debounce: el texto llega a Rich y a la fila local",
    async () => {
      const writingId = crypto.randomUUID()
      const text = "ODE604-WEB-BASE"
      await localDB.writings.save({
        id: writingId,
        title: text,
        body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] },
        body_text: text,
        status: "draft",
        visibility: "private",
        version: 1,
        sync_status: "synced",
        lifecycle: "server-confirmed",
        created_at: "2026-09-20T00:00:00.000Z",
        updated_at: "2026-09-20T00:00:00.000Z",
        local_updated_at: Date.now(),
      } as Parameters<typeof localDB.writings.save>[0])
      resetEditorShellWorld()
      await writeEditorSession({
        ...createEmptyEditorSession(),
        active_tab_id: writingId,
        tabs: [createEditorSessionTab({ id: writingId, writingId, title: text })],
      })

      mounted = await mountEditorShell({ writingId })
      await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
      await waitFor(() => mounted!.editor().getText().includes(text), { label: "documento hidratado", timeoutMs: 10_000 })
      await switchMode("Markdown")
      await advance(1_000)

      await typeInMarkdown(" ODE604-WEB-DESDE-MARKDOWN")
      await switchMode("Rich")
      expect(mounted!.editor().getText(), "Rich muestra lo escrito en Markdown").toContain(
        "ODE604-WEB-DESDE-MARKDOWN",
      )

      const deadline = Date.now() + 10_000
      let saved = ""
      while (Date.now() < deadline) {
        saved = (await localDB.writings.get(writingId))?.body_text ?? ""
        if (saved.includes("ODE604-WEB-DESDE-MARKDOWN")) break
        await advance(100)
      }
      expect(saved, "y llega a la fila local del documento").toContain("ODE604-WEB-DESDE-MARKDOWN")
    },
    TEST_TIMEOUT_MS,
  )
})
