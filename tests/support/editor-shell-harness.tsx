/**
 * Banco de pruebas compartido para `components/editor/editor-shell.tsx` (ODE-556).
 *
 * Por qué existe: los tres tests que montaban el shell antes de este harness
 * declaraban ~40 `vi.mock` cada uno — incluido `@tiptap/react`, lo que dejaba
 * al editor como un stub incapaz de ver selección, cursor o scroll — y ~460
 * líneas de decorado antes de la primera assertion. Ver
 * `workflow/quality/editor-shell-decomposition-diagnostic.md`.
 *
 * Regla de fidelidad (regla 3 de `workflow/quality/capability-proof-contract.md`):
 * aquí se dobla SOLO lo que no puede ejecutarse fuera de la app —
 *
 *   - la red (Supabase/API HTTP)        → `installNetworkDouble`
 *   - el transporte nativo de Tauri     → `tauriCoreDouble` / `tauriEventDouble`
 *   - los diálogos nativos del SO       → `tauriDialogDouble`
 *   - el proveedor de AI                → `aiServiceDouble`
 *   - el router de Next                 → `nextNavigationDouble`
 *
 * Todo lo demás corre real: TipTap con sus extensiones reales, el store de
 * sesión, `PersistenceCoordinator`, `lib/corrections/*`, `lib/local-db` sobre
 * `fake-indexeddb`, `lib/editor/*` y los componentes hijos del editor.
 *
 * `vi.mock` se hoistea por archivo, así que los dobles de módulo no pueden
 * aplicarse desde aquí: cada test declara la lista corta (ver `EXAMPLE` abajo)
 * y delega en las factorías de `editor-shell-doubles.ts`. Con eso, el decorado
 * por archivo pasa de ~460 líneas a ~25.
 *
 * IMPORTANTE: las factorías de `vi.mock` deben importar
 * `./support/editor-shell-doubles`, NO este archivo. Este importa `EditorShell`,
 * y hacerlo desde el factory de `vi.mock("@tiptap/react")` cierra un ciclo
 * (mock → harness → EditorShell → `@tiptap/react` → mock) que cuelga la carga
 * del test sin imprimir ni el nombre del archivo.
 *
 * EXAMPLE — cabecera de un test que use el harness:
 *
 *   vi.mock("@tiptap/react", async (importOriginal) => {
 *     const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
 *     return createTiptapCaptureModule(await importOriginal())
 *   })
 *   vi.mock("next/navigation", async () =>
 *     (await import("./support/editor-shell-doubles")).nextNavigationDouble())
 *   vi.mock("@tauri-apps/api/core", async (importOriginal) =>
 *     (await import("./support/editor-shell-doubles")).tauriCoreDouble(await importOriginal()))
 *   vi.mock("@tauri-apps/api/event", async () =>
 *     (await import("./support/editor-shell-doubles")).tauriEventDouble())
 *   vi.mock("@tauri-apps/plugin-dialog", async () =>
 *     (await import("./support/editor-shell-doubles")).tauriDialogDouble())
 *   vi.mock("@/lib/services/desktop/runtime-detection", async () =>
 *     (await import("./support/editor-shell-doubles")).runtimeDetectionDouble())
 *   vi.mock("@/lib/services/ai-service-factory", async () =>
 *     (await import("./support/editor-shell-doubles")).aiServiceDouble())
 */
import "fake-indexeddb/auto"

import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"

import { EditorShell } from "@/components/editor/editor-shell"
import { resetLearnedWordsCacheForTest } from "@/lib/corrections/learned-words-loader"
import { isMacPlatform } from "@/lib/keyboard-shortcuts"
import { getSyncWorker } from "@/lib/sync/worker"
import { getEditorSessionState, resetEditorSessionStoreForTests } from "@/lib/stores/editor-session-store"

import { type EditorHandle, type HarnessWorld, defaultNetwork, tauriEventListeners, world } from "./editor-shell-doubles"
import { readWorkspaceMarkdown } from "./editor-shell-desktop-doubles"
import { beginPersistenceCoordinatorCapture } from "./persistence-coordinator-capture"

export {
  aiServiceDouble,
  createCorrectionBlocksCaptureModule,
  createTiptapCaptureModule,
  nextNavigationDouble,
  runtimeDetectionDouble,
  tauriCoreDouble,
  tauriDialogDouble,
  tauriEventDouble,
  world,
} from "./editor-shell-doubles"
export type { EditorHandle } from "./editor-shell-doubles"

/**
 * Activa una captura opt-in de los PersistenceCoordinators reales que se creen
 * durante el montaje siguiente, para que un test pueda esperar su settle().
 */
export function capturePersistenceCoordinators() {
  return beginPersistenceCoordinatorCapture()
}

/* ------------------------------------------------------------------ *
 * Mundo: reset y APIs de entorno que happy-dom no trae
 * ------------------------------------------------------------------ */

function installBrowserGaps() {
  const w = globalThis as unknown as Record<string, unknown>

  if (typeof w.matchMedia !== "function") {
    w.matchMedia = (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    })
  }

  if (typeof w.ResizeObserver !== "function") {
    w.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    }
  }

  if (typeof w.IntersectionObserver !== "function") {
    w.IntersectionObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() {
        return []
      }
    }
  }

  window.confirm = () => true
  window.scrollTo = () => {}
}

/**
 * Recoge errores no manejados. Sin esto, una promesa rechazada dentro de un
 * efecto deja la UI a medias en silencio y el test falla después por un
 * síntoma que no explica la causa.
 */
function installErrorCollector() {
  if (errorCollectorInstalled) return
  errorCollectorInstalled = true
  window.addEventListener("error", (event) => {
    world.unhandledErrors.push({ kind: "error", message: String((event as ErrorEvent).message) })
  })
  window.addEventListener("unhandledrejection", (event) => {
    const reason = (event as PromiseRejectionEvent).reason
    world.unhandledErrors.push({
      kind: "rejection",
      message: reason instanceof Error ? `${reason.message}\n${reason.stack ?? ""}` : String(reason),
    })
  })
  const originalOnError = console.error
  console.error = (...args: unknown[]) => {
    const first = args[0]
    if (first instanceof Error) {
      world.unhandledErrors.push({ kind: "error", message: `${first.message}\n${first.stack ?? ""}` })
    }
    originalOnError(...(args as []))
  }
}

let errorCollectorInstalled = false

/** Lanza si el shell tragó algún error durante el test. */
export function assertNoUnhandledErrors() {
  if (world.unhandledErrors.length === 0) return
  throw new Error(
    `El shell produjo ${world.unhandledErrors.length} error(es) no manejado(s):\n` +
      world.unhandledErrors.map((entry) => `- [${entry.kind}] ${entry.message}`).join("\n"),
  )
}

/**
 * Deja el mundo en estado limpio entre tests. Llamar en `beforeEach`.
 *
 * Nota: NO limpia `fake-indexeddb` por defecto. La base local es un
 * colaborador real y varios escenarios necesitan que un documento escrito en
 * un paso siga ahí en el siguiente; los tests que quieran partir de cero
 * deben usar ids distintos, que es lo que hace producción.
 */
export function resetEditorShellWorld(overrides: Partial<HarnessWorld> = {}) {
  world.isDesktop = false
  world.pathname = "/write"
  world.searchParams = new URLSearchParams("")
  world.navigations = []
  world.tauriInvoke = () => undefined
  world.tauriCalls = []
  world.saveDialogResult = null
  world.saveDialogCalls = []
  world.openDialogResult = null
  world.networkCalls = []
  world.network = defaultNetwork()
  world.editor = null
  world.shellTableOfContentsInput = null
  world.shellCorrectionLifecycleInput = null
  world.shellEditorInstanceRef = null
  world.aiReview = async () => ({ error: null, data: { corrections: [] } })
  world.aiReviewCalls = []
  world.suggestTitleCalls = []
  world.learnedWords = []
  world.learnedWordsCalls = 0
  world.learnWordCalls = []
  world.getPreviewLink = async () => ({
    error: null,
    data: { active: false, token: null, link: null, createdAt: null },
  })
  world.rotatePreviewLink = async () => ({
    error: null,
    data: { active: false, token: null, link: null, createdAt: null },
  })
  world.revokePreviewLink = async (writingId: string) => ({
    error: null,
    data: { writingId, revoked: true },
  })
  world.sharingGetPreviewLinkCalls = []
  world.sharingRotatePreviewLinkCalls = []
  world.sharingRevokePreviewLinkCalls = []
  world.hydrateCorrectionBlocks = async () => ({ error: null, data: [] })
  world.correctionHydrationCalls = []
  world.correctionPersistCalls = []
  world.onShellCommit = null
  world.fsWatchers = []
  world.windowCloseHandler = null
  world.windowDestroyCalls = 0

  Object.assign(world, overrides)

  world.unhandledErrors = []

  resetEditorSessionStoreForTests()
  // Caché de módulo de la app: sin esto, la lista de un test se filtra al
  // siguiente, igual que el store de sesión.
  resetLearnedWordsCacheForTest()
  installBrowserGaps()
  installErrorCollector()
  installNetworkDouble()
}

/**
 * Sustituye `fetch` por el router del harness. La red es el único boundary
 * verdaderamente externo del camino web, y dejarla real hace el test no
 * determinista (el sync worker reintenta contra localhost).
 */
export function installNetworkDouble() {
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url
    const method = (init?.method ?? "GET").toUpperCase()
    world.networkCalls.push({ url, method })
    return world.network(url, init)
  }) as typeof fetch
}

/* ------------------------------------------------------------------ *
 * Montaje del shell
 * ------------------------------------------------------------------ */

export type MountedEditorShell = {
  container: HTMLDivElement
  /** El editor real de TipTap. Lanza si todavía no montó. */
  editor: () => EditorHandle
  /** Vuelve a renderizar con otras props — cambio de documento por ruta. */
  render: (props?: EditorShellTestProps) => Promise<void>
  unmount: () => Promise<void>
  /** Nodo `.ProseMirror` real. */
  prosemirror: () => HTMLElement | null
}

export type EditorShellTestProps = {
  writingId?: string
  forceNewWriting?: boolean
  /**
   * `key` de React, como la ponen las entradas reales (`/write/[id]`,
   * `DesktopWriteEntry`): cambiarla entre renders remonta la shell (ODE-571).
   */
  key?: string
  /** Sustituto de la creación de borradores desktop, para controlar su tiempo. */
  createDesktopDraftOverride?: ComponentProps<typeof EditorShell>["createDesktopDraftOverride"]
  /**
   * Monta la shell dentro de un `<main>` desplazable, como hace el layout de
   * la app (`components/navigation/sidebar.tsx`). La shell lee y restaura el
   * scroll de ese `<main>` en el view_state de cada pestaña; sin él, ese
   * contenedor no existe en el test. Opción de montaje, no prop de la shell.
   */
  withAppMain?: boolean
}

let richLayoutHarnessUsers = 0
let richLayoutOriginalResizeObserver: PropertyDescriptor | undefined
let richLayoutHarnessResizeObserver: typeof ResizeObserver | null = null

/**
 * happy-dom has no layout engine, so EditorShell's normal mounted-surface
 * tests receive a stable positive Rich measurement. Tests that exercise a
 * pending or zero-size surface can override this at the browser boundary.
 */
function installRichLayoutHarness(): () => void {
  if (richLayoutHarnessUsers === 0) {
    richLayoutOriginalResizeObserver = Object.getOwnPropertyDescriptor(globalThis, "ResizeObserver")
    richLayoutHarnessResizeObserver = class implements ResizeObserver {
      private readonly observed = new Set<Element>()

      constructor(private readonly callback: ResizeObserverCallback) {}

      observe(target: Element) {
        this.observed.add(target)
        queueMicrotask(() => {
          if (!this.observed.has(target)) return
          const entry = {
            target,
            contentRect: new DOMRect(0, 0, 800, 600),
          } as ResizeObserverEntry
          this.callback([entry], this)
        })
      }

      unobserve(target: Element) {
        this.observed.delete(target)
      }

      disconnect() {
        this.observed.clear()
      }
    }
    Object.defineProperty(globalThis, "ResizeObserver", {
      configurable: true,
      writable: true,
      value: richLayoutHarnessResizeObserver,
    })
  }
  richLayoutHarnessUsers += 1

  let released = false
  return () => {
    if (released) return
    released = true
    richLayoutHarnessUsers = Math.max(0, richLayoutHarnessUsers - 1)
    if (richLayoutHarnessUsers !== 0) return
    if (richLayoutOriginalResizeObserver) {
      Object.defineProperty(globalThis, "ResizeObserver", richLayoutOriginalResizeObserver)
    } else {
      Reflect.deleteProperty(globalThis, "ResizeObserver")
    }
    richLayoutOriginalResizeObserver = undefined
    richLayoutHarnessResizeObserver = null
  }
}

/**
 * Monta `EditorShell` de verdad, con React DOM y `act`. Devuelve drivers en
 * vez de obligar a cada test a reconstruir el andamiaje.
 */
export async function mountEditorShell(
  props: EditorShellTestProps = {},
): Promise<MountedEditorShell> {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  const releaseRichLayoutHarness = installRichLayoutHarness()

  const container = document.createElement("div")
  const appMain = props.withAppMain ? document.createElement("main") : null
  if (appMain) {
    appMain.appendChild(container)
    document.body.appendChild(appMain)
  } else {
    document.body.appendChild(container)
  }
  const root: Root = createRoot(container)

  const render = async (next: EditorShellTestProps = props) => {
    const { key, withAppMain: _withAppMain, ...shellProps } = next
    await act(async () => {
      root.render(<EditorShell key={key} {...shellProps} />)
    })
    await flush()
  }

  await render(props)

  return {
    container,
    editor: () => {
      if (!world.editor) throw new Error("El editor real todavía no montó")
      return world.editor
    },
    prosemirror: () => container.querySelector(".ProseMirror"),
    render,
    unmount: async () => {
      await act(async () => {
        root.unmount()
      })
      releaseRichLayoutHarness()
      container.remove()
      appMain?.remove()
      await quiesceSyncWorker()
    },
  }
}

/**
 * Detiene el SyncWorker real y espera a que termine cualquier flush en vuelo.
 *
 * Es un singleton de la app, así que sobrevive al desmontaje del shell. Las
 * pruebas que guardan de verdad encolan mutaciones; si un flush sigue en curso
 * cuando Vitest desmonta happy-dom, marca la mutación contra `localDB` sin
 * `window` y revienta como rechazo no manejado en OTRA prueba. Pasó en CI
 * (ODE-564): `stop()` solo cancela el siguiente flush, no el que ya corre.
 */
async function quiesceSyncWorker(timeoutMs = 5_000) {
  const worker = getSyncWorker()
  worker.stop()
  const internals = worker as unknown as { isRunning: boolean }
  const deadline = Date.now() + timeoutMs
  while (internals.isRunning && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
}

/* ------------------------------------------------------------------ *
 * Drivers
 * ------------------------------------------------------------------ */

/** Deja correr microtasks, timers de 0ms y un frame de animación. */
export async function flush(times = 2) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve()
      await new Promise((resolve) => setTimeout(resolve, 0))
    })
  }
}

/** Avanza el tiempo real (debounces del shell) sin usar fake timers. */
export async function advance(ms: number) {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, ms))
  })
  await flush(1)
}

/**
 * Escribe en el editor REAL, por el mismo comando que usa la UI. El `onUpdate`
 * del shell se dispara como en producción — no se simula.
 */
export async function typeInEditor(text: string) {
  const editor = world.editor
  if (!editor) throw new Error("El editor real todavía no montó")
  await act(async () => {
    editor.commands.insertContent(text)
  })
  await flush(1)
}

/** Reemplaza todo el contenido del editor real. */
export async function setEditorContent(content: string) {
  const editor = world.editor
  if (!editor) throw new Error("El editor real todavía no montó")
  await act(async () => {
    editor.commands.setContent(content)
  })
  await flush(1)
}

/**
 * Pulsa un elemento con el gesto de puntero REAL.
 *
 * Los tabs del editor (`editor-tabs.tsx`) no escuchan `click`: implementan un
 * gesto propio con `pointerdown` + `pointerup` y `setPointerCapture`, porque
 * en WKWebView un click nativo rompe el arrastre. `node.click()` por tanto no
 * activa nada y deja el test navegando por un camino que el usuario no puede
 * producir — el mismo tipo de falso verde que tuvo el e2e de ODE-555 con un
 * selector que no existía.
 */
export async function pointerClick(node: HTMLElement) {
  await act(async () => {
    dispatchPointerClick(node)
  })
  await flush(2)
}

/**
 * El mismo gesto que `pointerClick`, pero síncrono y fuera de `act`: para
 * dispararlo DENTRO de una ventana de commit (desde `world.onShellCommit`),
 * donde esperar rompería justo el orden que se quiere reproducir.
 */
export function dispatchPointerClick(node: HTMLElement) {
  const element = node as HTMLElement & {
    setPointerCapture?: (id: number) => void
    releasePointerCapture?: (id: number) => void
  }
  element.setPointerCapture ??= () => {}
  element.releasePointerCapture ??= () => {}

  const makeEvent = (type: string) => {
    const init = {
      bubbles: true,
      cancelable: true,
      button: 0,
      buttons: type === "pointerup" ? 0 : 1,
      clientX: 10,
      clientY: 10,
      pointerId: 1,
      isPrimary: true,
      pointerType: "mouse",
    } as unknown as PointerEventInit
    const PointerEventCtor = (window as unknown as { PointerEvent?: typeof PointerEvent }).PointerEvent
    return PointerEventCtor
      ? new PointerEventCtor(type, init)
      : new MouseEvent(type, init as MouseEventInit)
  }

  node.dispatchEvent(makeEvent("pointerdown"))
  node.dispatchEvent(makeEvent("pointerup"))
}

/**
 * Retiene los `requestAnimationFrame` para poder observar la ventana entre
 * "trabajo agendado" y "trabajo ejecutado" — que es donde viven las carreras
 * de identidad del shell (ODE-555). No falsea el trabajo diferido: lo ejecuta
 * de verdad, solo controla cuándo.
 */
export type FrameController = {
  pending: () => number
  takePending: () => FrameRequestCallback[]
  settle: (rounds?: number) => Promise<void>
  settleUntil: (
    predicate: () => boolean,
    options?: { timeoutMs?: number; label?: string },
  ) => Promise<void>
  runCallbacks: (callbacks: FrameRequestCallback[]) => Promise<void>
  /** Ejecuta lo encolado (y lo que eso encole a su vez) dentro de `act`. */
  flush: () => Promise<void>
  /** Devuelve el `requestAnimationFrame` nativo. */
  restore: () => void
}

export function holdAnimationFrames(): FrameController {
  const original = window.requestAnimationFrame
  const originalCancel = window.cancelAnimationFrame
  let queue: Array<{ id: number; callback: FrameRequestCallback }> = []
  let nextId = 1

  window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
    const id = nextId++
    queue.push({ id, callback })
    return id
  }) as typeof window.requestAnimationFrame

  window.cancelAnimationFrame = ((id: number) => {
    queue = queue.filter((entry) => entry.id !== id)
  }) as typeof window.cancelAnimationFrame

  return {
    pending: () => queue.length,
    /**
     * Saca de la cola lo agendado hasta ahora y lo devuelve sin ejecutarlo.
     *
     * Permite reproducir la carrera de verdad: un callback del documento
     * viejo que llega TARDE, después de que el documento nuevo ya hizo su
     * propio trabajo. Drenar todo de una vez no la reproduce — el restore del
     * documento nuevo pisa al viejo y el resultado final sale bien aunque la
     * guarda de generación no exista.
     */
    takePending: () => {
      const taken = queue
      queue = []
      return taken.map((entry) => entry.callback)
    },
    /** Ejecuta callbacks retenidos previamente, dentro de `act`. */
    runCallbacks: async (callbacks: FrameRequestCallback[]) => {
      await act(async () => {
        for (const callback of callbacks) callback(performance.now())
        await Promise.resolve()
      })
      await flush(1)
    },
    /**
     * Drena el trabajo diferido hasta que deja de aparecer trabajo nuevo.
     *
     * Bajo carga (suite completa) la hidratación agenda su frame más tarde,
     * así que un único `flush()` puede no encontrar nada que ejecutar y dejar
     * el test dependiendo del timing. `settle()` espera a que aparezca y lo
     * drena hasta que la cola queda estable.
     */
    settle: async (rounds = 6) => {
      for (let round = 0; round < rounds; round += 1) {
        if (queue.length === 0) {
          await flush(1)
          if (queue.length === 0) continue
        }
        const current = queue
        queue = []
        await act(async () => {
          for (const entry of current) entry.callback(performance.now())
          await Promise.resolve()
        })
        await flush(1)
      }
    },
    /**
     * Drena trabajo diferido hasta que `predicate` se cumple.
     *
     * `waitFor` NO sirve aquí: no ejecuta los frames retenidos, así que
     * esperar con él a un efecto que depende de un frame retenido se bloquea
     * a sí mismo para siempre. Esta espera drena en cada vuelta.
     */
    settleUntil: async (
      predicate: () => boolean,
      { timeoutMs = 5000, label = "condición" }: { timeoutMs?: number; label?: string } = {},
    ) => {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (predicate()) return
        const current = queue
        queue = []
        if (current.length > 0) {
          await act(async () => {
            for (const entry of current) entry.callback(performance.now())
            await Promise.resolve()
          })
        }
        await flush(1)
      }
      throw new Error(`settleUntil agotó ${timeoutMs}ms esperando: ${label}`)
    },
    flush: async () => {
      // Un callback diferido puede encolar otro (rich mode encola dos niveles).
      for (let wave = 0; wave < 10 && queue.length > 0; wave += 1) {
        const current = queue
        queue = []
        await act(async () => {
          for (const entry of current) entry.callback(performance.now())
          await Promise.resolve()
        })
      }
      await flush(1)
    },
    restore: () => {
      window.requestAnimationFrame = original
      window.cancelAnimationFrame = originalCancel
      queue = []
    },
  }
}

/**
 * Los dos contenedores de scroll que la shell lee al guardar el view_state de
 * una pestaña y escribe al restaurarlo (`persistCurrentWorkspaceViewState`,
 * `useDocumentHydration`). happy-dom no tiene layout: `scrollTop` guarda lo que
 * se le asigne, sin recortar al alto del contenido.
 */
function viewportNodes() {
  const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
  const shellViewport = document.querySelector<HTMLElement>("main")
  if (!editorViewport || !shellViewport) {
    throw new Error("La shell no tiene montados sus contenedores de scroll")
  }
  return { editorViewport, shellViewport }
}

export type ViewportScroll = { editorScrollTop: number; shellScrollTop: number }

/** Desplaza los contenedores reales de la shell, como lo haría el usuario. */
export function scrollViewport({ editorScrollTop, shellScrollTop }: ViewportScroll) {
  const { editorViewport, shellViewport } = viewportNodes()
  editorViewport.scrollTop = editorScrollTop
  shellViewport.scrollTop = shellScrollTop
}

/** Lee el scroll actual de los contenedores reales de la shell. */
export function readViewport(): ViewportScroll {
  const { editorViewport, shellViewport } = viewportNodes()
  return { editorScrollTop: editorViewport.scrollTop, shellScrollTop: shellViewport.scrollTop }
}

/** Espera a que una condición se cumpla, sin `sleep` ciego. */
export async function waitFor<T>(
  predicate: () => T | null | undefined | false,
  { timeoutMs = 2000, label = "condición" }: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  let last: T | null | undefined | false = null
  while (Date.now() < deadline) {
    last = predicate()
    if (last) return last as T
    await flush(1)
  }
  throw new Error(`waitFor agotó ${timeoutMs}ms esperando: ${label}`)
}

/**
 * La fase de hidratación del documento activo, publicada por la shell en el
 * DOM (`data-hydration-phase`). Los tests que fijan scroll/selección sobre un
 * documento o afirman que su salida guardó la vista deben esperarla: con la
 * fase todavía en "loading", la restauración diferida está pendiente y, desde
 * ODE-624, la salida ya no guarda esa vista (y la restauración pisaría lo que
 * el test fije antes).
 */
export async function waitForHydrationReady(label = "fase de hidratación en ready") {
  await waitFor(
    () => document.querySelector('[data-page="editor"]')?.getAttribute("data-hydration-phase") === "ready",
    { label, timeoutMs: 10_000 },
  )
}

/* ------------------------------------------------------------------ *
 * Drivers de modo desktop
 * ------------------------------------------------------------------ */

/**
 * Pulsa el botón real de "New Artifact": el del estado vacío (con texto) o el
 * "+" de la barra de pestañas (`aria-label="New Artifact"`). Espera a que el
 * editor asiente: el handler limpia el editor y difiere el foco un par de
 * frames, y escribir antes hace que el shell pise el texto (ODE-557).
 */
/**
 * Emite un evento nativo de Tauri (p. ej. `menu:save-as`, la acción del menú
 * nativo) a los oyentes que la app registró con `listen`. Falla si nadie
 * escucha ese canal: un evento que se pierde en silencio sería un
 * NON_PRODUCTION_PATH.
 */
export async function emitTauriEvent(channel: string, payload: unknown = null) {
  const listeners = tauriEventListeners.get(channel)
  if (!listeners || listeners.size === 0) {
    throw new Error(`Nadie escucha el evento nativo "${channel}"`)
  }
  await act(async () => {
    for (const listener of [...listeners]) listener({ event: channel, payload })
  })
  await flush()
}

/**
 * Entrega un evento del watcher nativo de fs (`plugin:fs|watch`) a cada
 * watcher vivo cuyo alcance cubre alguna de `paths`, como haría el sistema
 * operativo tras un cambio hecho fuera de la app. El resto de la cadena —la
 * supresión de auto-escrituras, el reconciliador, el catálogo— corre real.
 * Falla si ningún watcher cubre esas rutas: un evento que nadie observa
 * sería un NON_PRODUCTION_PATH (ODE-599).
 */
export async function emitFsWatchEvent(
  paths: string[],
  type: unknown = { modify: { kind: "data", mode: "content" } },
) {
  const covers = (scope: string, path: string) => path === scope || path.startsWith(`${scope}/`)
  const targets = world.fsWatchers.filter(
    (watcher) => !watcher.closed && watcher.paths.some((scope) => paths.some((path) => covers(scope, path))),
  )
  if (targets.length === 0) {
    throw new Error(
      `Ningún watcher nativo observa ${JSON.stringify(paths)}. Vivos: ${JSON.stringify(
        world.fsWatchers.filter((watcher) => !watcher.closed).map((watcher) => watcher.paths),
      )}`,
    )
  }
  await act(async () => {
    for (const watcher of targets) watcher.channel.onmessage({ type, paths, attrs: {} })
  })
  await flush()
}

/**
 * Pide cerrar la ventana nativa como lo haría el sistema operativo y devuelve
 * la promesa del oyente de la app, que resuelve cuando la guardia terminó
 * (asentó y llamó a `destroy()`, o falló). `prevented()` dice si la app
 * retuvo el cierre (ODE-599).
 */
export function requestWindowClose(): { settled: Promise<unknown>; prevented: () => boolean } {
  const handler = world.windowCloseHandler
  if (!handler) throw new Error("La app no registró ningún oyente de cierre de ventana")
  let prevented = false
  const settled = Promise.resolve(handler({ preventDefault: () => (prevented = true) }))
  return { settled, prevented: () => prevented }
}

export async function clickNewArtifact(container: HTMLElement) {
  const button = await waitFor(
    () =>
      Array.from(container.querySelectorAll("button")).find(
        (candidate) =>
          (candidate.textContent ?? "").includes("New Artifact") ||
          candidate.getAttribute("aria-label") === "New Artifact",
      ),
    { label: 'botón "New Artifact"' },
  )
  button.click()
  await advance(400)
}

/** Espera a que algún `.md` del workspace contenga `needle` y lo devuelve. */
export async function waitForMarkdownContaining(needle: string, timeoutMs = 20_000) {
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


/* ------------------------------------------------------------------ *
 * Drivers de selección y formularios (ODE-606)
 * ------------------------------------------------------------------ */

/**
 * Pulsa un atajo de la shell por el camino real: un `keydown` en `window`,
 * donde la shell escucha, con el modificador de comando de la plataforma que
 * detecta la app (⌘ en Mac, Ctrl en el resto). Un solo evento: disparar los
 * dos modificadores "por si acaso" rompería los atajos que alternan (focus
 * mode) (ODE-602).
 */
export async function pressEditorShortcut({
  key,
  code,
  shift = false,
  alt = false,
}: {
  key: string
  code?: string
  shift?: boolean
  alt?: boolean
}) {
  const mac = isMacPlatform()
  await act(async () => {
    window.dispatchEvent(
      new KeyboardEvent("keydown", {
        key,
        code,
        shiftKey: shift,
        altKey: alt,
        metaKey: mac,
        ctrlKey: !mac,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await flush(2)
}

/** Pulsa Escape donde lo escucha la shell (`window`). */
export async function pressEscape() {
  await act(async () => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true }))
  })
  await flush(2)
}

/**
 * Selecciona `needle` en el editor REAL por el camino del navegador: foco en
 * el `.ProseMirror`, un `Range` del DOM sobre el nodo de texto y el evento
 * `selectionchange`, que es lo que escucha el `DOMObserver` de ProseMirror
 * cuando el usuario arrastra. No usa `setTextSelection`: el shell tiene que
 * leer la selección desde el DOM, como en producción, y su `selectionUpdate`
 * (el que abre el popup) se dispara igual que con el ratón.
 *
 * Verifica su propio efecto: si ProseMirror no adoptó la selección, lanza.
 * Devuelve el rango en posiciones del documento.
 */
export async function selectEditorText(needle: string, occurrence = 0) {
  const editor = world.editor
  if (!editor) throw new Error("El editor real todavía no montó")
  const root = editor.view.dom as HTMLElement

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let seen = 0
  let target: { node: Text; offset: number } | null = null
  while (walker.nextNode()) {
    const node = walker.currentNode as Text
    let index = node.data.indexOf(needle)
    while (index !== -1) {
      if (seen === occurrence) {
        target = { node, offset: index }
        break
      }
      seen += 1
      index = node.data.indexOf(needle, index + 1)
    }
    if (target) break
  }
  if (!target) throw new Error(`El texto ${JSON.stringify(needle)} no está en el editor`)

  await act(async () => {
    root.focus()
    const range = document.createRange()
    range.setStart(target.node, target.offset)
    range.setEnd(target.node, target.offset + needle.length)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
    document.dispatchEvent(new Event("selectionchange"))
  })
  await flush(2)

  const { from, to } = editor.state.selection
  // `EditorHandle` solo declara lo que usan los tests viejos; el doc es el de
  // ProseMirror real.
  const selected = (editor.state.doc as unknown as ProseMirrorNode).textBetween(from, to)
  if (selected !== needle) {
    throw new Error(
      `ProseMirror no adoptó la selección del DOM: esperaba ${JSON.stringify(needle)}, tiene ${JSON.stringify(selected)}`,
    )
  }
  return { from, to }
}

/**
 * Escribe en un `<textarea>`/`<input>` controlado por React: el setter nativo
 * más el evento `input`, que es lo que React escucha para su `onChange`.
 * Asignar `.value` a secas no lo dispara.
 */
export async function fillTextField(field: HTMLTextAreaElement | HTMLInputElement, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set
  await act(async () => {
    setter?.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
  if (field.value !== value) throw new Error("El campo no aceptó el valor escrito")
}

/** Espera a que una condición ASÍNCRONA (p. ej. una lectura de `localDB`) se cumpla. */
export async function waitForAsync<T>(
  probe: () => Promise<T | null | undefined | false>,
  { timeoutMs = 5000, label = "condición" }: { timeoutMs?: number; label?: string } = {},
): Promise<T> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await probe()
    if (value) return value as T
    await advance(50)
  }
  throw new Error(`waitForAsync agotó ${timeoutMs}ms esperando: ${label}`)
}

/**
 * Activa la pestaña del documento con el gesto real y verifica que la
 * activación ocurrió (ver "Un driver debe verificar su propio efecto" en
 * `workflow/testing/integration-harness-catalog.md`).
 */
export async function clickEditorTab(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  if (!node) throw new Error(`La pestaña de ${writingId} no está en el DOM`)
  await pointerClick(node)
  // La activación espera a que la escritura pendiente del documento saliente
  // sea durable (exit protocol): el driver verifica el efecto tras ese evento,
  // no en el mismo tick del gesto.
  try {
    await waitFor(() => getEditorSessionState().session.active_tab_id === tab.id, {
      label: `activación de la pestaña de ${writingId}`,
      timeoutMs: 10_000,
    })
  } catch {
    const active = getEditorSessionState().session.active_tab_id
    throw new Error(`El gesto sobre la pestaña de ${writingId} no la activó (activa: ${active})`)
  }
}

/** Cierra la pestaña del documento con su botón real de cerrar. */
export async function closeEditorTab(writingId: string) {
  const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
  if (!tab) throw new Error(`No hay pestaña abierta para ${writingId}`)
  const node = document.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
  const close = node?.querySelector<HTMLElement>('[aria-label^="Close "]')
  if (!close) throw new Error(`La pestaña de ${writingId} no tiene botón de cerrar en el DOM`)
  await pointerClick(close)
  const stillOpen = getEditorSessionState().session.tabs.some((candidate) => candidate.writing_id === writingId)
  if (stillOpen) throw new Error(`El gesto de cerrar no cerró la pestaña de ${writingId}`)
}

/* ------------------------------------------------------------------ *
 * Lecturas de anotaciones: documento real y sidebar renderizado (ODE-606)
 * ------------------------------------------------------------------ */

export type EditorHighlightSpan = { from: number; to: number; text: string; type: string | null }
export type EditorAnnotationReference = { pos: number; type: string; text: string }

/**
 * Lee el documento del editor real: los tramos contiguos con marca
 * `highlight` (con su `annotationType`, `null` si es un highlight suelto) y
 * los nodos de referencia. Es lo que hay en el documento, no lo que el shell
 * cree que hay.
 */
export function readEditorAnnotations() {
  const editor = world.editor
  if (!editor) throw new Error("El editor real todavía no montó")
  const marks: EditorHighlightSpan[] = []
  const references: EditorAnnotationReference[] = []
  ;(editor.state.doc as unknown as ProseMirrorNode).descendants((node, pos) => {
    if (node.isText) {
      const highlight = node.marks.find((mark) => mark.type.name === "highlight")
      if (!highlight) return
      const type = (highlight.attrs.annotationType as string | null) ?? null
      const last = marks[marks.length - 1]
      if (last && last.to === pos && last.type === type) {
        last.to = pos + node.nodeSize
        last.text += node.text ?? ""
      } else {
        marks.push({ from: pos, to: pos + node.nodeSize, text: node.text ?? "", type })
      }
      return
    }
    if (node.type.name === "annotationReference" || node.type.name === "footnoteReference") {
      references.push({ pos, type: String(node.attrs.type), text: String(node.attrs.text ?? "") })
    }
  })
  return { marks, references }
}

/** Las entradas que el sidebar de notas renderiza; `null` si no está montado. */
export function readNotesSidebar() {
  const panel = document.querySelector('[data-testid="editor-panel-notes"]')
  if (!panel) return null
  return Array.from(panel.querySelectorAll("article")).map((article) => ({
    anchor: article.querySelector("p")?.textContent ?? "",
    body: article.querySelector("textarea")?.value ?? "",
    badge: (article.querySelector("button")?.textContent ?? "").trim(),
  }))
}

/** Abre el sidebar de notas con el botón real del status bar (si no lo está). */
export async function openNotesSidebar() {
  const toggle = await waitFor(
    () => document.querySelector<HTMLElement>('button[aria-label="Notes panel"]'),
    { label: 'botón "Notes panel"' },
  )
  if (toggle.getAttribute("aria-pressed") !== "true") {
    await act(async () => {
      toggle.click()
    })
    await flush(2)
  }
  return waitFor(() => readNotesSidebar(), { label: "sidebar de notas montado" })
}

/** El popup de selección, si está abierto. */
export function selectionPopup() {
  return document.querySelector<HTMLElement>('[data-testid="selection-popup"]')
}

/** Pulsa una acción del popup de selección con su gesto real (`pointerdown`). */
export async function clickSelectionPopupAction(label: "Mark passage" | "Annotate passage" | "Add footnote") {
  const button = selectionPopup()?.querySelector<HTMLElement>(`[aria-label="${label}"]`)
  if (!button) throw new Error(`El popup de selección no está abierto (acción "${label}")`)
  await pointerClick(button)
}
