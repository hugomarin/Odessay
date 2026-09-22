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

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"

import { EditorShell } from "@/components/editor/editor-shell"
import { resetEditorSessionStoreForTests } from "@/lib/stores/editor-session-store"

import { type EditorHandle, type HarnessWorld, defaultNetwork, world } from "./editor-shell-doubles"

export {
  aiServiceDouble,
  createTiptapCaptureModule,
  nextNavigationDouble,
  runtimeDetectionDouble,
  tauriCoreDouble,
  tauriDialogDouble,
  tauriEventDouble,
  world,
} from "./editor-shell-doubles"
export type { EditorHandle } from "./editor-shell-doubles"

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
  world.openDialogResult = null
  world.networkCalls = []
  world.network = defaultNetwork()
  world.editor = null

  Object.assign(world, overrides)

  resetEditorSessionStoreForTests()
  installBrowserGaps()
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
}

/**
 * Monta `EditorShell` de verdad, con React DOM y `act`. Devuelve drivers en
 * vez de obligar a cada test a reconstruir el andamiaje.
 */
export async function mountEditorShell(
  props: EditorShellTestProps = {},
): Promise<MountedEditorShell> {
  ;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const container = document.createElement("div")
  document.body.appendChild(container)
  const root: Root = createRoot(container)

  const render = async (next: EditorShellTestProps = props) => {
    await act(async () => {
      root.render(<EditorShell {...next} />)
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
      container.remove()
    },
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

  await act(async () => {
    node.dispatchEvent(makeEvent("pointerdown"))
    node.dispatchEvent(makeEvent("pointerup"))
  })
  await flush(2)
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
