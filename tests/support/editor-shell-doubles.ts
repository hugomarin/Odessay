/**
 * Dobles de boundary para el harness del editor shell (ODE-556).
 *
 * Este módulo NO importa `EditorShell` ni ningún módulo de la app a propósito:
 * las factorías de `vi.mock` lo importan desde dentro de su propio factory, y
 * si este archivo arrastrara la app se formaría un ciclo
 * (`vi.mock("@tiptap/react")` → harness → EditorShell → `@tiptap/react`) que
 * deja la carga del test colgada para siempre. Comprobado en vivo: el runner
 * se queda sin imprimir siquiera el nombre del archivo.
 *
 * El montaje y los drivers viven en `editor-shell-harness.tsx`.
 */
import { vi } from "vitest"

/* ------------------------------------------------------------------ *
 * Estado compartido de los dobles
 * ------------------------------------------------------------------ */

type TauriInvokeHandler = (command: string, args?: Record<string, unknown>) => unknown

type NetworkHandler = (input: string, init?: RequestInit) => Response | Promise<Response>

export type HarnessWorld = {
  /** `isDesktopRuntime()`; el shell bifurca caminos enteros según esto. */
  isDesktop: boolean
  /** Ruta que devuelve `usePathname`. */
  pathname: string
  searchParams: URLSearchParams
  /** Navegaciones que el shell pidió, en orden. Es aserción, no decorado. */
  navigations: Array<{ kind: "push" | "replace"; href: string }>
  /** Respuestas del transporte nativo, por comando. */
  tauriInvoke: TauriInvokeHandler
  /** Comandos nativos efectivamente invocados, en orden. */
  tauriCalls: Array<{ command: string; args?: Record<string, unknown> }>
  /** Resultado del diálogo nativo de guardado (null = cancelado). */
  saveDialogResult: string | null
  openDialogResult: string | string[] | null
  /** Peticiones HTTP salientes y su router. */
  networkCalls: Array<{ url: string; method: string }>
  network: NetworkHandler
  /**
   * Handler del review de correcciones. Devolver una promesa pendiente deja
   * la petición "en vuelo", que es donde vive la carrera de identidad: la
   * respuesta puede llegar cuando el documento activo ya es otro.
   */
  aiReview: (input: AiReviewInput) => Promise<AiReviewResult>
  /** Peticiones de review realmente emitidas, en orden. */
  aiReviewCalls: AiReviewInput[]
  /** El editor real de TipTap, capturado (no sustituido). */
  editor: EditorHandle | null
  /**
   * Errores no manejados durante el test (excepciones y promesas rechazadas).
   *
   * Existe porque un `catch {}` de producción o una promesa rechazada en un
   * efecto no rompen el render: el test sigue, ve una pantalla vacía y falla
   * mucho más tarde por un síntoma que no explica nada. Regla 7 del
   * capability-proof-contract: un error tragado no es ejecución exitosa.
   */
  unhandledErrors: Array<{ kind: "error" | "rejection"; message: string }>
}

export type AiReviewInput = {
  writingId?: string
  correctionBlocks?: Array<{ id: string; text: string; hash: string }>
  [key: string]: unknown
}

export type AiReviewResult = {
  error: unknown
  data:
    | {
        summary?: unknown
        language?: string
        corrections?: unknown[]
        [key: string]: unknown
      }
    | null
}

export type EditorHandle = {
  commands: Record<string, (...args: unknown[]) => boolean>
  getText: () => string
  getJSON: () => Record<string, unknown>
  getHTML: () => string
  isEmpty: boolean
  isDestroyed: boolean
  state: { doc: { content: { size: number } }; selection: { from: number; to: number } }
  view: { dom: HTMLElement }
  chain: () => Record<string, unknown>
}

export function defaultNetwork(): NetworkHandler {
  return () =>
    new Response(JSON.stringify({ error: "network disabled in harness" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    })
}

/**
 * Único objeto de estado del harness. Los tests lo leen y escriben; las
 * factorías de dobles lo cierran por referencia.
 */
export const world: HarnessWorld = {
  isDesktop: false,
  pathname: "/write",
  searchParams: new URLSearchParams(""),
  navigations: [],
  tauriInvoke: () => undefined,
  tauriCalls: [],
  saveDialogResult: null,
  openDialogResult: null,
  networkCalls: [],
  network: defaultNetwork(),
  editor: null,
  unhandledErrors: [],
  aiReview: async () => ({ error: null, data: { corrections: [] } }),
  aiReviewCalls: [],
}

/* ------------------------------------------------------------------ *
 * Factorías de dobles — solo boundaries que no caben en la terminal
 * ------------------------------------------------------------------ */

/**
 * Envuelve el `useEditor` REAL para quedarnos con la instancia. No sustituye
 * nada: el editor, sus extensiones y su ProseMirror son los de producción.
 */
export function createTiptapCaptureModule(actual: Record<string, unknown>) {
  const realUseEditor = actual.useEditor as (options: unknown, deps?: unknown) => EditorHandle | null
  return {
    ...actual,
    useEditor: (options: unknown, deps?: unknown) => {
      const editor = realUseEditor(options, deps)
      if (editor) world.editor = editor
      return editor
    },
  }
}

export function nextNavigationDouble() {
  return {
    useRouter: () => ({
      push: (href: string) => {
        world.navigations.push({ kind: "push", href })
      },
      replace: (href: string) => {
        world.navigations.push({ kind: "replace", href })
      },
      prefetch: vi.fn(),
      back: vi.fn(),
      forward: vi.fn(),
      refresh: vi.fn(),
    }),
    usePathname: () => world.pathname,
    useSearchParams: () => world.searchParams,
    useParams: () => ({}),
    redirect: vi.fn(),
    notFound: vi.fn(),
  }
}

export function tauriCoreDouble(actual: Record<string, unknown>) {
  return {
    ...actual,
    invoke: async (command: string, args?: Record<string, unknown>) => {
      world.tauriCalls.push({ command, args })
      return world.tauriInvoke(command, args)
    },
  }
}

export function tauriEventDouble() {
  return {
    listen: async () => () => {},
    emit: async () => {},
    once: async () => () => {},
  }
}

export function tauriDialogDouble() {
  return {
    save: async () => world.saveDialogResult,
    open: async () => world.openDialogResult,
    message: async () => {},
    ask: async () => true,
    confirm: async () => true,
  }
}

export function runtimeDetectionDouble() {
  return { isDesktopRuntime: () => world.isDesktop }
}

export function aiServiceDouble() {
  return {
    getAIService: () => ({
      listLearnedWords: async () => ({ items: [] }),
      learnWord: async () => ({ error: null }),
      deleteLearnedWord: async () => ({ error: null }),
      reviewPublication: async (input: AiReviewInput) => {
        world.aiReviewCalls.push(input)
        return world.aiReview(input)
      },
      suggestTitle: async () => ({ error: null, data: null }),
      hydrateCorrectionBlocks: async () => ({ error: null, data: [] }),
    }),
  }
}

