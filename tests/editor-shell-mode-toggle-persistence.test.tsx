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
vi.mock("@tauri-apps/api/window", async () =>
  (await import("./support/editor-shell-doubles")).tauriWindowDouble(),
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
  requestWindowClose,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { holdWriteFile, writeFileCalls } = await import("./integration/documents/support/real-desktop-doubles")
const { DESKTOP_PERSISTENCE_DEBOUNCE_MS } = await import("@/components/editor/editor-shell")
const { getEditorSessionState, getRetainedUnconvertedSource } = await import("@/lib/stores/editor-session-store")
const { hasActiveEditorCloseGuard } = await import("@/hooks/useTauriCloseGuard")
const { world } = await import("./support/editor-shell-doubles")
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
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await mounted?.unmount()
  mounted = null
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

async function waitForFileMarkdownContaining(path: string, needle: string, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await contentsOf(path)).includes(needle)) return
    await flush(1)
  }
  throw new Error(`${path} no contiene ${JSON.stringify(needle)}`)
}

async function failCurrentSourceConversion() {
  const domFailure = installOneShotDomAllocationFailure()
  const richButton = Array.from(
    mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
  ).find((candidate) => (candidate.textContent ?? "").trim() === "Rich")
  if (!richButton) throw new Error('No está el botón "Rich" de la status bar')
  await act(async () => richButton.click())
  domFailure.restore()
  await flush(2)
  return domFailure.didFail()
}

async function closeTabForWritingId(writingId: string) {
  const tab = tabForWritingId(writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const closeButton = mounted!.container.querySelector<HTMLButtonElement>(
    `[data-editor-tab-id="${tab.id}"] button[aria-label="Close ${tab.title}"]`,
  )
  if (!closeButton) throw new Error(`No está el cierre de la pestaña de ${writingId}`)
  await pointerClick(closeButton)
}

function holdMarkdownSaveDebounce() {
  const originalSetTimeout = window.setTimeout.bind(window)
  const originalClearTimeout = window.clearTimeout.bind(window)
  const pending = new Map<number, { handler: TimerHandler; args: unknown[] }>()
  let nextTimerId = 90_000_000

  vi.spyOn(window, "setTimeout").mockImplementation(
    ((handler: TimerHandler, delay?: number, ...args: unknown[]) => {
      if (delay === 800) {
        const timerId = nextTimerId++
        pending.set(timerId, { handler, args })
        return timerId
      }
      return originalSetTimeout(handler, delay, ...args)
    }) as typeof window.setTimeout,
  )
  vi.spyOn(window, "clearTimeout").mockImplementation(((timerId: number) => {
    pending.delete(timerId)
    originalClearTimeout(timerId)
  }) as typeof window.clearTimeout)

  return {
    get pendingCount() {
      return pending.size
    },
    async fireLatest() {
      const entry = [...pending.entries()].at(-1)
      if (!entry) throw new Error("No hay debounce de Source pendiente")
      const [timerId, { handler, args }] = entry
      pending.delete(timerId)
      if (typeof handler !== "function") throw new Error("El debounce de Source no es invocable")
      await act(async () => {
        ;(handler as (...callbackArgs: unknown[]) => void)(...args)
      })
    },
  }
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
    "advierte al cerrar la ventana mientras Rich espera su señal de layout",
    async () => {
      await createDocument("ODE540-CLOSE-WAITING-LAYOUT")
      const originalRich = mounted!.editor().getText()

      vi.stubGlobal("ResizeObserver", ControlledResizeObserver)
      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("EditorRichContent")
          ? new DOMRect(0, 0, 0, 0)
          : originalGetBoundingClientRect.call(this)
      })

      await switchMode("Markdown")
      await typeInMarkdown(" ODE540-CLOSE-WAITING-LAYOUT-SOURCE")
      const expectedSource = markdownSource()?.value ?? ""
      await switchMode("Rich")
      expect(markdownSource(), "Rich desmonta Source antes de aplicar el snapshot").toBeNull()
      expect(mounted!.editor().getText(), "Rich aún espera la medición del browser").toBe(originalRich)
      expect(
        [...resizeObservations].some(
          (entry) => !entry.disconnected && entry.target?.classList.contains("EditorRichContent"),
        ),
        "la señal de layout continúa pendiente",
      ).toBe(true)

      await waitFor(() => world.windowCloseHandler, { label: "guardia Tauri de cierre de ventana" })
      const close = requestWindowClose()
      expect(close.prevented(), "la guardia intercepta el cierre de ventana").toBe(true)
      const warning = await waitFor(
        () => document.body.querySelector<HTMLElement>('[role="alertdialog"][aria-label="Unsaved Source changes"]'),
        { label: "aviso de cierre mientras falta la señal de layout", timeoutMs: 2_000 },
      )
      if (!warning) throw new Error("No apareció el aviso para el Source aún no aplicado")

      const keepEditing = Array.from(warning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Keep editing",
      )
      if (!keepEditing) throw new Error('No está la opción "Keep editing"')
      expect(document.activeElement, "Keep editing es la acción predeterminada").toBe(keepEditing)
      await act(async () => keepEditing.click())
      await act(async () => {
        await close.settled
      })
      expect(world.windowDestroyCalls, "Keep editing cancela el cierre").toBe(0)

      await switchMode("Markdown")
      expect(markdownSource()?.value, "el Source retenido sigue disponible").toBe(expectedSource)
    },
    TEST_TIMEOUT_MS,
  )

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
        recoverableError: mounted!.container.querySelector('[role="status"]')?.textContent?.includes(
          "Could not apply this source to Rich",
        ) ?? false,
        retryAction: Array.from(mounted!.container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Try again",
        ),
        keepEditingAction: Array.from(mounted!.container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Keep editing in Source",
        ),
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
        retryAction: true,
        keepEditingAction: true,
        writes: 0,
        fileIsUntouched: true,
        documentCount: 1,
      })

      const keepEditingButton = Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Keep editing in Source",
      )
      if (!keepEditingButton) throw new Error('No está la acción "Keep editing in Source"')
      await act(async () => keepEditingButton.click())
      await flush(2)
      expect(mounted!.container.querySelector('[role="status"]'), "la acción cierra el aviso").toBeNull()
      expect(markdownSource()?.value).toContain("ODE540-PARSE-EDITED")
      expect(await contentsOf(file.path)).toBe(originalFile)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "el debounce de Source conserva el texto ante un fallo de conversión y permite reintentar el guardado",
    async () => {
      const file = await createDocument("ODE540-DEBOUNCE-BASE")
      const originalRich = mounted!.editor().getText()
      const originalFile = await contentsOf(file.path)
      const baselineWrites = writeFileCalls().filter((call) => call.path === file.path).length
      await switchMode("Markdown")
      await advance(SAVE_WINDOW_MS)
      await typeInMarkdown(" ODE540-DEBOUNCE-EDITED")

      const realEditor = mounted!.editor() as unknown as Editor
      let editorUpdates = 0
      const onUpdate = () => {
        editorUpdates += 1
      }
      realEditor.on("update", onUpdate)

      // Instalar la falla junto al límite de 800 ms para que el camino real de
      // desktopDocumentEngine.sourceToRich reciba una excepción del DOM.
      await advance(700)
      const domFailure = installOneShotDomAllocationFailure()
      await advance(SAVE_WINDOW_MS)
      domFailure.restore()
      await flush(2)

      const beforeRetry = {
        parserFailureReached: domFailure.didFail(),
        sourceVisible: Boolean(markdownSource()),
        sourceRetainsEdit: markdownSource()?.value.includes("ODE540-DEBOUNCE-EDITED") ?? false,
        richIsUntouched: mounted!.editor().getText() === originalRich,
        notice: mounted!.container.querySelector('[role="status"]')?.textContent?.includes(
          "Your Source text is still here and remains unsaved",
        ) ?? false,
        retryAction: Array.from(mounted!.container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Try again",
        ),
        keepEditingAction: Array.from(mounted!.container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Keep editing in Source",
        ),
        editorUpdates,
        writes: writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites).length,
        fileIsUntouched: (await contentsOf(file.path)) === originalFile,
        documentCount: (await readWorkspaceMarkdown()).length,
      }

      expect(beforeRetry).toEqual({
        parserFailureReached: true,
        sourceVisible: true,
        sourceRetainsEdit: true,
        richIsUntouched: true,
        notice: true,
        retryAction: true,
        keepEditingAction: true,
        editorUpdates: 0,
        writes: 0,
        fileIsUntouched: true,
        documentCount: 1,
      })

      const retryButton = Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Try again",
      )
      if (!retryButton) throw new Error('No está la acción "Try again"')
      await act(async () => retryButton.click())
      await flush(2)
      await advance(SAVE_WINDOW_MS)
      await waitForMarkdownContaining("ODE540-DEBOUNCE-EDITED")

      expect(mounted!.editor().getText(), "Retry aplica la conversión a Rich").toContain("ODE540-DEBOUNCE-EDITED")
      expect(editorUpdates, "Retry aplica un solo snapshot").toBe(1)
      expect(writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites)).toHaveLength(1)
      expect(await contentsOf(file.path)).toContain("ODE540-DEBOUNCE-EDITED")
      expect(markdownSource(), "el autosave no cambia el modo elegido por la persona").toBeTruthy()
      realEditor.off("update", onUpdate)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "volver a Source antes de que Rich esté listo vuelve a programar el guardado del Source",
    async () => {
      const file = await createDocument("ODE540-QUICK-BASE")
      const originalRich = mounted!.editor().getText()
      const baselineWrites = writeFileCalls().filter((call) => call.path === file.path).length
      const sourceDebounce = holdMarkdownSaveDebounce()
      await switchMode("Markdown")
      await typeInMarkdown(" ODE540-QUICK-SOURCE")

      const layout = { rect: new DOMRect(0, 0, 0, 0) }
      vi.stubGlobal("ResizeObserver", ControlledResizeObserver)
      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("EditorRichContent")
          ? layout.rect
          : originalGetBoundingClientRect.call(this)
      })

      await switchMode("Rich")
      expect(markdownSource(), "el Source queda pendiente mientras Rich no tiene layout").toBeNull()
      expect(mounted!.editor().getText()).toBe(originalRich)
      expect(sourceDebounce.pendingCount, "cambiar a Rich cancela el debounce de Source").toBe(0)

      await switchMode("Markdown")
      expect(markdownSource()?.value).toContain("ODE540-QUICK-SOURCE")
      expect(mounted!.editor().getText(), "la transición pendiente se descarta").toBe(originalRich)
      expect(sourceDebounce.pendingCount, "volver a Source programa un debounce nuevo").toBe(1)
      await sourceDebounce.fireLatest()
      await waitForFileMarkdownContaining(file.path, "ODE540-QUICK-SOURCE")

      expect(writeFileCalls().filter((call) => call.path === file.path).slice(baselineWrites).length).toBeGreaterThan(0)
      expect(await contentsOf(file.path)).toContain("ODE540-QUICK-SOURCE")
      expect(mounted!.editor().getText(), "el guardado de Source actualiza el Rich oculto").toContain(
        "ODE540-QUICK-SOURCE",
      )
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "descarta el Source pendiente cuando el documento cambia antes de medir Rich",
    async () => {
      const firstFile = await createDocument("ODE540-STALE-A")
      const firstWritingId = activeTab()?.writing_id
      if (!firstWritingId) throw new Error("A no tiene identidad documental")

      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE540-STALE-B")
      await advance(SAVE_WINDOW_MS)
      const secondFile = await waitForMarkdownContaining("ODE540-STALE-B")
      const secondWritingId = activeTab()?.writing_id
      if (!secondWritingId) throw new Error("B no tiene identidad documental")

      await clickTabForWritingId(firstWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-STALE-A"), {
        label: "Rich de A después de volver a su pestaña",
      })
      await switchMode("Markdown")

      const layout = { rect: new DOMRect(0, 0, 800, 500) }
      vi.stubGlobal("ResizeObserver", ControlledResizeObserver)
      const originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect
      vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (this: HTMLElement) {
        return this.classList.contains("EditorRichContent")
          ? layout.rect
          : originalGetBoundingClientRect.call(this)
      })

      const sourceDebounce = holdMarkdownSaveDebounce()
      await typeInMarkdown(" ODE540-STALE-SOURCE")
      const firstBaselineWrites = writeFileCalls().filter((call) => call.path === firstFile.path).length
      const secondBaselineWrites = writeFileCalls().filter((call) => call.path === secondFile.path).length
      layout.rect = new DOMRect(0, 0, 0, 0)
      const richButton = Array.from(
        mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
      ).find((candidate) => (candidate.textContent ?? "").trim() === "Rich")
      if (!richButton) throw new Error('No está el botón "Rich" de la status bar')
      await act(async () => richButton.click())
      await flush(2)
      expect(sourceDebounce.pendingCount, "cambiar a Rich cancela el debounce de Source").toBe(0)

      expect(mounted!.editor().getText()).toContain("ODE540-STALE-A")
      expect(mounted!.editor().getText()).not.toContain("ODE540-STALE-SOURCE")
      await clickTabForWritingId(secondWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-STALE-B"), {
        label: "Rich de B después del cambio de pestaña",
      })

      const observation = [...resizeObservations]
        .reverse()
        .find((entry) => !entry.disconnected && entry.target?.classList.contains("EditorRichContent"))
      expect(observation, "la superficie Rich de B espera su medición").toBeDefined()
      layout.rect = new DOMRect(0, 0, 800, 500)
      await act(async () => observation?.notify(800, 500))
      await typeInEditor(" ODE540-STALE-B-CONTROL")
      await waitForFileMarkdownContaining(secondFile.path, "ODE540-STALE-B-CONTROL")

      expect(activeTab()?.writing_id).toBe(secondWritingId)
      expect(mounted!.editor().getText()).toContain("ODE540-STALE-B")
      expect(mounted!.editor().getText()).not.toContain("ODE540-STALE-SOURCE")
      expect(await contentsOf(firstFile.path)).not.toContain("ODE540-STALE-SOURCE")
      expect(await contentsOf(secondFile.path)).not.toContain("ODE540-STALE-SOURCE")
      const laterWrites = [
        ...writeFileCalls().filter((call) => call.path === firstFile.path).slice(firstBaselineWrites),
        ...writeFileCalls().filter((call) => call.path === secondFile.path).slice(secondBaselineWrites),
      ]
      expect(laterWrites.some((write) => write.content.includes("ODE540-STALE-SOURCE"))).toBe(false)
      expect(await readWorkspaceMarkdown()).toHaveLength(2)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "restaura Source fallido al volver a su pestaña y no filtra el aviso ni el texto a B",
    async () => {
      const firstFile = await createDocument("ODE540-TAB-A")
      const firstWritingId = activeTab()?.writing_id
      if (!firstWritingId) throw new Error("A no tiene identidad documental")

      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE540-TAB-B")
      await advance(SAVE_WINDOW_MS)
      const secondFile = await waitForMarkdownContaining("ODE540-TAB-B")
      const secondWritingId = activeTab()?.writing_id
      if (!secondWritingId) throw new Error("B no tiene identidad documental")

      await clickTabForWritingId(firstWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-TAB-A"), {
        label: "Rich de A antes de editar Source",
        timeoutMs: 10_000,
      })
      await switchMode("Markdown")
      await typeInMarkdown("\nODE540-UNCONVERTED-A")
      const exactSource = markdownSource()?.value
      expect(exactSource, "el Source editable está presente antes del fallo").toContain("ODE540-UNCONVERTED-A")
      expect(await failCurrentSourceConversion(), "sourceToRich falla en la entrada real del toggle").toBe(true)
      expect(mounted!.container.querySelector('[role="status"]')?.textContent).toContain(
        "Could not apply this source to Rich",
      )

      await clickTabForWritingId(secondWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-TAB-B"), {
        label: "Rich de B tras cambiar de pestaña",
        timeoutMs: 10_000,
      })
      expect(document.body.querySelector('[role="alertdialog"]'), "cambiar de documento no pregunta").toBeNull()

      const sourceOnB = markdownSource()?.value ?? null
      const noticeOnB = mounted!.container.querySelector('[role="status"]')?.textContent ?? ""
      const richTextOnB = mounted!.editor().getText()

      await clickTabForWritingId(firstWritingId)
      await waitFor(
        () =>
          mounted!.editor().getText().includes("ODE540-TAB-A") &&
          document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
        { label: "hidratación de A al volver", timeoutMs: 10_000 },
      )
      await flush(2)

      const restoredSource = markdownSource()?.value ?? null
      const noticeOnA = mounted!.container.querySelector('[role="status"]')?.textContent ?? ""
      if (restoredSource === exactSource) {
        const retryButton = Array.from(mounted!.container.querySelectorAll<HTMLButtonElement>("button")).find(
          (button) => button.textContent?.trim() === "Try again",
        )
        if (!retryButton) throw new Error('No está la acción "Try again" al volver a A')
        await act(async () => retryButton.click())
        await waitForFileMarkdownContaining(firstFile.path, "ODE540-UNCONVERTED-A")
      }

      expect({
        sourceOnB,
        noticeOnB: noticeOnB.includes("Could not apply this source to Rich"),
        richTextOnB,
        restoredSource,
        noticeOnA: noticeOnA.includes("Could not apply this source to Rich"),
        retrySavedA: (await contentsOf(firstFile.path)).includes("ODE540-UNCONVERTED-A"),
        bStillOwnsItsContent: (await contentsOf(secondFile.path)).includes("ODE540-TAB-B"),
      }).toEqual({
        sourceOnB: null,
        noticeOnB: false,
        richTextOnB: expect.stringContaining("ODE540-TAB-B"),
        restoredSource: exactSource,
        noticeOnA: true,
        retrySavedA: true,
        bStillOwnsItsContent: true,
      })
      expect(richTextOnB).not.toContain("ODE540-UNCONVERTED-A")
      expect((await contentsOf(secondFile.path))).not.toContain("ODE540-UNCONVERTED-A")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "oculta el aviso de conversión fallida al activar otra pestaña en Source",
    async () => {
      await createDocument("ODE540-NOTICE-A")
      const firstWritingId = activeTab()?.writing_id
      if (!firstWritingId) throw new Error("A no tiene identidad documental")

      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE540-NOTICE-B")
      await advance(SAVE_WINDOW_MS)
      const secondFile = await waitForMarkdownContaining("ODE540-NOTICE-B")
      const secondWritingId = activeTab()?.writing_id
      if (!secondWritingId) throw new Error("B no tiene identidad documental")

      await clickTabForWritingId(firstWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-NOTICE-A"), {
        label: "A activo antes de provocar el fallo",
      })
      await switchMode("Markdown")
      await typeInMarkdown(" ODE540-NOTICE-UNCONVERTED-A")
      expect(await failCurrentSourceConversion()).toBe(true)
      expect(mounted!.container.querySelector('[role="status"]')?.textContent).toContain(
        "Could not apply this source to Rich",
      )

      await clickTabForWritingId(secondWritingId)
      await waitFor(() => mounted!.editor().getText().includes("ODE540-NOTICE-B"), {
        label: "B hidratado después del cambio de pestaña",
      })
      await switchMode("Markdown")
      await flush(2)

      const sourceOnB = markdownSource()?.value ?? ""
      const noticeOnB = mounted!.container.querySelector('[role="status"]')?.textContent ?? ""
      expect(sourceOnB, "B conserva su propio Source").toContain("ODE540-NOTICE-B")
      expect(sourceOnB, "el texto fallido de A no aparece en B").not.toContain("ODE540-NOTICE-UNCONVERTED-A")
      expect(noticeOnB, "el aviso queda oculto en B").not.toContain("Could not apply this source to Rich")
      expect(await contentsOf(secondFile.path)).toContain("ODE540-NOTICE-B")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "restaura el Source fallido al salir a /desk y volver a /write con el mismo documento",
    async () => {
      const file = await createDocument("ODE540-ROUTE-BASE")
      const writingId = activeTab()?.writing_id
      if (!writingId) throw new Error("El documento no tiene identidad documental")

      await switchMode("Markdown")
      await typeInMarkdown("\nODE540-ROUTE-UNCONVERTED")
      const exactSource = markdownSource()?.value
      expect(exactSource, "el Source exacto existe antes del fallo").toContain("ODE540-ROUTE-UNCONVERTED")
      expect(await failCurrentSourceConversion(), "sourceToRich falla desde el botón real").toBe(true)
      expect(mounted!.container.querySelector('[role="status"]')?.textContent).toContain(
        "Could not apply this source to Rich",
      )

      world.pathname = "/desk"
      await mounted!.unmount()
      mounted = null
      expect(document.body.querySelector('[role="alertdialog"]'), "navegar a Desk no pide confirmación").toBeNull()

      world.pathname = "/write"
      mounted = await mountEditorShell({ writingId })
      await waitFor(
        () =>
          mounted!.editor().getText().includes("ODE540-ROUTE-BASE") &&
          document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
        { label: "el mismo documento vuelve a estar hidratado", timeoutMs: 10_000 },
      )
      await flush(2)

      const restoredSource = markdownSource()?.value ?? null
      const noticeOnReturn = mounted.container.querySelector('[role="status"]')?.textContent ?? ""
      const noticeVisibleOnReturn = noticeOnReturn.includes("Could not apply this source to Rich")
      const retryButton = Array.from(mounted.container.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Try again",
      )
      const fileUntouchedBeforeRetry = !(await contentsOf(file.path)).includes("ODE540-ROUTE-UNCONVERTED")
      let retrySavedSource = false
      let noticeAfterSuccessfulRetryReturn: string | null = null
      let sourceAfterSuccessfulRetryReturn: string | null = null

      if (restoredSource === exactSource && retryButton) {
        await act(async () => retryButton.click())
        await waitForFileMarkdownContaining(file.path, "ODE540-ROUTE-UNCONVERTED")
        expect(mounted.editor().getText(), "el reintento aplica el Source al Rich canónico").toContain(
          "ODE540-ROUTE-UNCONVERTED",
        )
        expect(getRetainedUnconvertedSource(writingId), "el reintento exitoso limpia el Source retenido").toBeNull()
        retrySavedSource = (await contentsOf(file.path)).includes("ODE540-ROUTE-UNCONVERTED")

        world.pathname = "/desk"
        await mounted.unmount()
        mounted = null
        world.pathname = "/write"
        mounted = await mountEditorShell({ writingId })
        await waitFor(
          () =>
            mounted!.editor().getText().includes("ODE540-ROUTE-UNCONVERTED") &&
            document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
          { label: "el documento queda en Rich tras el reintento confirmado", timeoutMs: 10_000 },
        )
        await flush(2)
        noticeAfterSuccessfulRetryReturn = mounted.container.querySelector('[role="status"]')?.textContent ?? null
        sourceAfterSuccessfulRetryReturn = markdownSource()?.value ?? null
      }

      expect({
        restoredSource,
        noticeVisibleOnReturn,
        retryAvailable: Boolean(retryButton),
        dialogOpenOnReturn: Boolean(document.body.querySelector('[role="alertdialog"]')),
        fileUntouchedBeforeRetry,
        retrySavedSource,
        noticeAfterSuccessfulRetryReturn: Boolean(
          noticeAfterSuccessfulRetryReturn?.includes("Could not apply this source to Rich"),
        ),
        sourceAfterSuccessfulRetryReturn,
      }).toEqual({
        restoredSource: exactSource,
        noticeVisibleOnReturn: true,
        retryAvailable: true,
        dialogOpenOnReturn: false,
        fileUntouchedBeforeRetry: true,
        retrySavedSource: true,
        noticeAfterSuccessfulRetryReturn: false,
        sourceAfterSuccessfulRetryReturn: expect.stringContaining("ODE540-ROUTE-UNCONVERTED"),
      })
    },
    TEST_TIMEOUT_MS,
  )

  it("registra el guard de cierre mientras EditorShell vive y lo libera al desmontar", async () => {
    mounted = await mountEditorShell()
    expect(hasActiveEditorCloseGuard(), "EditorShell monta su guard de cierre").toBe(true)

    await mounted.unmount()
    mounted = null
    expect(hasActiveEditorCloseGuard(), "la ruta libera el guard al desmontar EditorShell").toBe(false)

    mounted = await mountEditorShell()
    expect(hasActiveEditorCloseGuard(), "al volver a /write se registra el guard de editor").toBe(true)
  })

  it(
    "navegar tras una conversión correcta no deja un Source de fallo retenido",
    async () => {
      const file = await createDocument("ODE540-ROUTE-POSITIVE-BASE")
      const writingId = activeTab()?.writing_id
      if (!writingId) throw new Error("El documento no tiene identidad documental")

      await switchMode("Markdown")
      await typeInMarkdown("\nODE540-ROUTE-POSITIVE-SOURCE")
      await switchMode("Rich")
      await waitFor(
        () => mounted!.editor().getText().includes("ODE540-ROUTE-POSITIVE-SOURCE"),
        { label: "la conversión correcta aplica el Source al Rich" },
      )
      await waitForFileMarkdownContaining(file.path, "ODE540-ROUTE-POSITIVE-SOURCE")
      expect(mounted!.container.querySelector('[role="status"]')?.textContent ?? "").not.toContain(
        "Could not apply this source to Rich",
      )

      world.pathname = "/desk"
      await mounted!.unmount()
      mounted = null
      world.pathname = "/write"
      mounted = await mountEditorShell({ writingId })
      await waitFor(
        () =>
          mounted!.editor().getText().includes("ODE540-ROUTE-POSITIVE-SOURCE") &&
          document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
        { label: "la escritura correcta se restaura tras la navegación", timeoutMs: 10_000 },
      )
      await flush(2)

      expect({
        sourceConversionNotice: Boolean(
          mounted.container.querySelector('[role="status"]')?.textContent?.includes("Could not apply this source to Rich"),
        ),
        retryAvailable: Array.from(mounted.container.querySelectorAll("button")).some(
          (button) => button.textContent?.trim() === "Try again",
        ),
        dialogOpen: Boolean(document.body.querySelector('[role="alertdialog"]')),
        savedSource: await contentsOf(file.path),
      }).toEqual({
        sourceConversionNotice: false,
        retryAvailable: false,
        dialogOpen: false,
        savedSource: expect.stringContaining("ODE540-ROUTE-POSITIVE-SOURCE"),
      })
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "pide confirmación antes de cerrar una pestaña con Source sin convertir",
    async () => {
      await createDocument("ODE540-TAB-CLOSE")
      const writingId = activeTab()?.writing_id
      if (!writingId) throw new Error("La pestaña no tiene identidad documental")
      await switchMode("Markdown")
      await typeInMarkdown("\nODE540-TAB-CLOSE-UNCONVERTED")
      expect(await failCurrentSourceConversion()).toBe(true)

      await closeTabForWritingId(writingId)
      const warning = await waitFor(
        () => document.body.querySelector<HTMLElement>('[role="alertdialog"][aria-label="Unsaved Source changes"]'),
        { label: "confirmación para cerrar la pestaña con Source sin convertir", timeoutMs: 2_000 },
      )
      if (!warning) throw new Error("No apareció la confirmación para cerrar la pestaña")
      expect(warning.textContent).toContain("You have unsaved changes in Source that couldn't be converted")
      const keepEditing = Array.from(warning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Keep editing",
      )
      const closeAnyway = Array.from(warning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Close anyway",
      )
      expect(keepEditing).toBeTruthy()
      expect(closeAnyway).toBeTruthy()
      expect(document.activeElement, "Keep editing es la opción predeterminada").toBe(keepEditing)

      await act(async () => keepEditing!.click())
      await waitFor(() => document.body.querySelector('[role="alertdialog"]') === null, {
        label: "Keep editing cancela el cierre de pestaña",
      })
      expect(tabForWritingId(writingId), "la pestaña y su Source siguen abiertos").toBeTruthy()
      expect(markdownSource()?.value).toContain("ODE540-TAB-CLOSE-UNCONVERTED")

      await closeTabForWritingId(writingId)
      const secondWarning = await waitFor(
        () => document.body.querySelector<HTMLElement>('[role="alertdialog"][aria-label="Unsaved Source changes"]'),
        { label: "segunda confirmación para descartar Source", timeoutMs: 2_000 },
      )
      if (!secondWarning) throw new Error("No volvió a aparecer la confirmación de cierre")
      const confirmClose = Array.from(secondWarning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Close anyway",
      )
      if (!confirmClose) throw new Error('No está la acción "Close anyway"')
      await act(async () => confirmClose.click())
      await waitFor(() => !tabForWritingId(writingId), { label: "pestaña cerrada tras confirmar" })
      expect(getRetainedUnconvertedSource(writingId), "el descarte explícito limpia el Source de la sesión en memoria").toBeNull()
      expect(await contentsOf((await readWorkspaceMarkdown())[0]!.path)).not.toContain("ODE540-TAB-CLOSE-UNCONVERTED")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "cierra una pestaña limpia sin pedir confirmación",
    async () => {
      await createDocument("ODE540-TAB-CLEAN-CLOSE")
      const writingId = activeTab()?.writing_id
      if (!writingId) throw new Error("La pestaña no tiene identidad documental")
      await closeTabForWritingId(writingId)
      await waitFor(() => !tabForWritingId(writingId), { label: "pestaña limpia cerrada" })

      expect(document.body.querySelector('[role="alertdialog"]'), "el control limpio no pregunta").toBeNull()
      expect((await readWorkspaceMarkdown()).map((file) => file.contents)).toEqual([
        expect.stringContaining("ODE540-TAB-CLEAN-CLOSE"),
      ])
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
