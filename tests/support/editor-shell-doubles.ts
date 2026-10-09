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
import { useLayoutEffect } from "react"
import { vi } from "vitest"

import type { TableOfContentsInput } from "@/hooks/useTableOfContents"
import type { CorrectionLifecycleInput } from "@/hooks/useCorrectionLifecycle"

import type { LearnWordInput, LearnedWordEntry } from "@/lib/services/contracts/ai-service"
import type { PreviewLinkState } from "@/lib/services/contracts/sharing-service"

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
  /**
   * Resultado del diálogo nativo de guardado (null = cancelado). Una promesa
   * deja el diálogo retenido: `save` es async y adopta la promesa, así que el
   * export queda en vuelo hasta que el test la resuelva (ODE-652).
   */
  saveDialogResult: string | null | Promise<string | null>
  /** Veces que la app abrió el diálogo nativo de guardado, con sus opciones. */
  saveDialogCalls: Array<Record<string, unknown> | undefined>
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
  /** Peticiones de sugerencia de título realmente emitidas, en orden. */
  suggestTitleCalls: Array<{ currentTitle?: string; bodyText?: string; writingId?: string }>
  /**
   * Respuesta del servicio de compartir para el preview link de un documento.
   * Devolver una promesa pendiente deja la respuesta "en vuelo": es donde vive
   * la carrera de identidad A→B de SHARE-03 (ODE-652). El servicio es el
   * boundary externo (Supabase/API) y el panel lo consume real.
   */
  getPreviewLink: (writingId: string) => Promise<{ error: unknown; data: PreviewLinkState | null }>
  rotatePreviewLink: (writingId: string) => Promise<{ error: unknown; data: PreviewLinkState | null }>
  revokePreviewLink: (
    writingId: string,
  ) => Promise<{ error: unknown; data: { writingId: string; revoked: boolean } | null }>
  /** Documentos cuyo preview link se pidió al servicio, en orden. */
  sharingGetPreviewLinkCalls: string[]
  /** Documentos cuyo preview link se rotó por el servicio, en orden. */
  sharingRotatePreviewLinkCalls: string[]
  /** Documentos cuyo preview link se revocó por el servicio, en orden. */
  sharingRevokePreviewLinkCalls: string[]
  /** Palabras que el proveedor devuelve como aprendidas por el usuario. */
  learnedWords: LearnedWordEntry[]
  /** Veces que el shell pidió la lista de palabras aprendidas. */
  learnedWordsCalls: number
  /** Palabras que el shell mandó a aprender al proveedor, en orden. */
  learnWordCalls: LearnWordInput[]
  /**
   * Handler de la hidratación remota de bloques de corrección. Devolver una
   * promesa pendiente deja la respuesta "en vuelo" (ODE-464, ODE-574).
   */
  hydrateCorrectionBlocks: (writingId: string) => Promise<{ error: unknown; data: unknown[] | null }>
  /** Documentos cuya hidratación remota de correcciones se pidió, en orden. */
  correctionHydrationCalls: string[]
  /**
   * Volcados remotos de bloques de corrección, en orden, con el estado de cada
   * sugerencia del bloque volcado (ODE-597: aceptar o rechazar se afirma sobre
   * lo que llegó al proveedor, no sobre la caché local).
   */
  correctionPersistCalls: Array<{ writingId?: string; blockId?: string; suggestionStatuses?: string[] }>
  /**
   * Se llama en cada commit del shell, en fase de layout: después del commit
   * y ANTES de sus efectos pasivos. Es la ventana donde un efecto pasivo
   * rezagado puede deshacer una acción imperativa (ODE-561, ODE-564).
   */
  onShellCommit: (() => void) | null
  /** El editor real de TipTap, capturado (no sustituido). */
  editor: EditorHandle | null
  /**
   * `editorInstanceRef` real de la shell (ODE-609), capturado por
   * `createCorrectionBlocksCaptureModule` —envuelve su primer consumidor sin
   * cambiar su comportamiento—. Deja que un test lea el ref desde
   * `world.onShellCommit`, la ventana entre el commit y sus efectos pasivos.
   */
  shellTableOfContentsInput: TableOfContentsInput | null
  shellCorrectionLifecycleInput: CorrectionLifecycleInput | null
  shellEditorInstanceRef: { current: EditorHandle | null } | null
  /**
   * Errores no manejados durante el test (excepciones y promesas rechazadas).
   *
   * Existe porque un `catch {}` de producción o una promesa rechazada en un
   * efecto no rompen el render: el test sigue, ve una pantalla vacía y falla
   * mucho más tarde por un síntoma que no explica nada. Regla 7 del
   * capability-proof-contract: un error tragado no es ejecución exitosa.
   */
  unhandledErrors: Array<{ kind: "error" | "rejection"; message: string }>
  /**
   * Watchers nativos (`plugin:fs|watch`) que la app registró, con el canal por
   * el que el sistema operativo le entregaría los eventos. `emitFsWatchEvent`
   * del harness los usa para simular un cambio hecho fuera de la app (ODE-599).
   */
  fsWatchers: FsWatcherRecord[]
  /**
   * Oyente de `onCloseRequested` de la ventana nativa y veces que la app pidió
   * `destroy()` tras asentarse. El sistema operativo es el boundary: la
   * guardia de cierre real corre entera (ODE-599).
   */
  windowCloseHandler: ((event: { preventDefault: () => void }) => unknown) | null
  windowDestroyCalls: number
}

export type FsWatcherRecord = {
  rid: number
  paths: string[]
  options: { recursive?: boolean; delayMs?: number } | undefined
  channel: { onmessage: (event: unknown) => void }
  closed: boolean
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
  saveDialogCalls: [],
  openDialogResult: null,
  networkCalls: [],
  network: defaultNetwork(),
  editor: null,
  shellTableOfContentsInput: null,
  shellCorrectionLifecycleInput: null,
  shellEditorInstanceRef: null,
  unhandledErrors: [],
  aiReview: async () => ({ error: null, data: { corrections: [] } }),
  aiReviewCalls: [],
  suggestTitleCalls: [],
  learnedWords: [],
  learnedWordsCalls: 0,
  learnWordCalls: [],
  getPreviewLink: async () => ({
    error: null,
    data: { active: false, token: null, link: null, createdAt: null },
  }),
  rotatePreviewLink: async () => ({
    error: null,
    data: { active: false, token: null, link: null, createdAt: null },
  }),
  revokePreviewLink: async (writingId: string) => ({
    error: null,
    data: { writingId, revoked: true },
  }),
  sharingGetPreviewLinkCalls: [],
  sharingRotatePreviewLinkCalls: [],
  sharingRevokePreviewLinkCalls: [],
  hydrateCorrectionBlocks: async () => ({ error: null, data: [] }),
  correctionHydrationCalls: [],
  correctionPersistCalls: [],
  onShellCommit: null,
  fsWatchers: [],
  windowCloseHandler: null,
  windowDestroyCalls: 0,
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
      // El shell llama a useEditor en cada render, así que este layout effect
      // corre en cada commit suyo: es la sonda de `world.onShellCommit`.
      // eslint-disable-next-line react-hooks/rules-of-hooks
      useLayoutEffect(() => {
        world.onShellCommit?.()
      })
      return editor
    },
  }
}

/**
 * Envuelve `useCorrectionBlocks` REAL (ODE-609) para quedarnos con el
 * `editorInstanceRef` que la shell le pasa —es su primer consumidor—. No
 * sustituye nada: delega en el hook real, así que la captura no cambia el
 * comportamiento. Es el equivalente, para el ref, de lo que
 * `createTiptapCaptureModule` hace con la instancia del editor.
 */
export function createCorrectionBlocksCaptureModule(actual: Record<string, unknown>) {
  const realUseCorrectionBlocks = actual.useCorrectionBlocks as (input: {
    editorInstanceRef: { current: EditorHandle | null }
  }) => unknown
  return {
    ...actual,
    useCorrectionBlocks: (input: { editorInstanceRef: { current: EditorHandle | null } }) => {
      world.shellEditorInstanceRef = input.editorInstanceRef
      return realUseCorrectionBlocks(input)
    },
  }
}

/** Captures live inputs while every correction collaborator remains real. */
export function createCorrectionLifecycleCaptureModule(actual: Record<string, unknown>) {
  const realHook = actual.useCorrectionLifecycle as (input: CorrectionLifecycleInput) => unknown
  return {
    ...actual,
    useCorrectionLifecycle: (input: CorrectionLifecycleInput) => {
      world.shellCorrectionLifecycleInput = input
      return realHook(input)
    },
  }
}

/** Observes the real TOC owner without replacing its logic. */
export function createTableOfContentsCaptureModule(actual: Record<string, unknown>) {
  const realHook = actual.useTableOfContents as (input: TableOfContentsInput) => unknown
  return {
    ...actual,
    useTableOfContents: (input: TableOfContentsInput) => {
      world.shellTableOfContentsInput = input
      return realHook(input)
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

/**
 * `Channel` del transporte nativo. El real registra su callback en
 * `window.__TAURI_INTERNALS__`, que no existe fuera de la app; este solo
 * guarda `onmessage` para que el harness entregue por él lo que entregaría el
 * sistema operativo.
 */
class HarnessChannel {
  onmessage: (message: unknown) => void
  constructor(onmessage?: (message: unknown) => void) {
    this.onmessage = onmessage ?? (() => {})
  }
}

let nextFsWatcherRid = 1

export function tauriCoreDouble(actual: Record<string, unknown>) {
  return {
    ...actual,
    Channel: HarnessChannel,
    invoke: async (command: string, args?: Record<string, unknown>) => {
      world.tauriCalls.push({ command, args })
      // El watcher de fs es transporte nativo puro: se registra y se cierra
      // aquí, y el harness emite sus eventos (`emitFsWatchEvent`).
      if (command === "allow_watch_path") return undefined
      if (command === "plugin:fs|watch") {
        const record: FsWatcherRecord = {
          rid: nextFsWatcherRid++,
          paths: (args?.paths as string[]) ?? [],
          options: args?.options as FsWatcherRecord["options"],
          channel: args?.onEvent as FsWatcherRecord["channel"],
          closed: false,
        }
        world.fsWatchers.push(record)
        return record.rid
      }
      if (command === "plugin:resources|close") {
        const watcher = world.fsWatchers.find((candidate) => candidate.rid === args?.rid)
        if (watcher) {
          watcher.closed = true
          return undefined
        }
      }
      return world.tauriInvoke(command, args)
    },
  }
}

/**
 * Adapters de args para los comandos cuyo objeto de `invoke` no es la lista de
 * parámetros del doble. Estos se mapean por nombre de campo, nunca por posición:
 * `catalog_list` aplana su query y `catalog_apply_workspace_removal` añade un
 * `nowMillis` interno; `settings_write` serializa su valor en `valueJson`.
 *
 * El resto de comandos cae al passthrough posicional: su wrapper envía un
 * literal cuyas claves están en el orden de los parámetros del doble. Un
 * comando cuya forma se desvíe de eso necesita un adapter aquí — si no,
 * `Object.values` entregaría argumentos desplazados en silencio (ODE-651).
 */
const invokeArgAdapters: Record<string, (args: Record<string, unknown>) => unknown[]> = {
  catalog_list: (args) => [
    args.dbPath,
    {
      cloudAccountId: args.cloudAccountId ?? null,
      includeDeleted: args.includeDeleted ?? false,
      localOnly: args.localOnly ?? false,
      limit: args.limit ?? 200,
    },
  ],
  catalog_apply_workspace_removal: (args) => [
    args.dbPath,
    args.bindingRootId,
    args.rootPath,
    args.deletedAt,
    args.updatedAt,
    args.nowMillis,
  ],
  settings_read: (args) => [args.configDir, args.key],
  settings_write: (args) => {
    const valueJson = args.valueJson
    if (typeof valueJson !== "string") {
      throw new Error("settings_write requiere valueJson como string")
    }
    return [args.configDir, args.key, JSON.parse(valueJson)]
  },
}

/**
 * Adapts production `invoke(command, args)` calls to the desktop command
 * doubles. Commands with a non-positional args shape go through
 * `invokeArgAdapters`, keyed by command and mapped by field name; the rest are
 * passed through by position. Two native serialization forms still need
 * translation on the result/rejection side: `settings_read`'s JSON string and
 * `write_file`'s string-valued `CONFLICT:` rejection.
 */
export function tauriInvokeRouterDouble(commandDoubles: object) {
  return async (command: string, args?: Record<string, unknown>) => {
    const doubleName = `tauri${command
      .split("_")
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join("")}`
    const commandDouble = Reflect.get(commandDoubles, doubleName)
    if (typeof commandDouble !== "function") {
      throw new Error(`Comando Tauri sin doble registrado: ${command}`)
    }

    const adapter = invokeArgAdapters[command]
    const callArgs = adapter ? adapter(args ?? {}) : Object.values(args ?? {})

    try {
      const result = await Reflect.apply(commandDouble, undefined, callArgs)
      if (command === "settings_read") {
        const serialized = JSON.stringify(result)
        if (serialized === undefined) throw new Error("settings_read double devolvió un valor no serializable")
        return serialized
      }
      return result
    } catch (error) {
      if (command === "write_file" && error instanceof Error && error.message.startsWith("CONFLICT:")) {
        throw error.message
      }
      throw error
    }
  }
}

/**
 * `@tauri-apps/api/window`: la ventana nativa. Guarda el oyente de
 * `onCloseRequested` para que el harness pida el cierre como lo haría el
 * sistema operativo (`requestWindowClose`).
 */
export function tauriWindowDouble() {
  return {
    getCurrentWindow: () => ({
      onCloseRequested: async (handler: (event: { preventDefault: () => void }) => unknown) => {
        world.windowCloseHandler = handler
        return () => {
          if (world.windowCloseHandler === handler) world.windowCloseHandler = null
        }
      },
      destroy: async () => {
        world.windowDestroyCalls += 1
      },
    }),
  }
}

/**
 * Oyentes registrados con `listen` de `@tauri-apps/api/event`, por canal.
 *
 * Vive a nivel de módulo y NO se resetea entre pruebas, a propósito: el bus de
 * menú (`lib/services/desktop/menu-event-bus.ts`) registra cada canal una sola
 * vez por proceso, igual que en la app. Resetearlo dejaría sordas a las
 * pruebas siguientes del archivo. Quién recibe el evento lo decide el propio
 * bus (su pila de suscriptores), no el doble.
 */
export const tauriEventListeners = new Map<
  string,
  Set<(event: { event: string; payload: unknown }) => void | Promise<void>>
>()

export function tauriEventDouble() {
  return {
    listen: async (
      channel: string,
      handler: (event: { event: string; payload: unknown }) => void | Promise<void>,
    ) => {
      const listeners = tauriEventListeners.get(channel) ?? new Set()
      listeners.add(handler)
      tauriEventListeners.set(channel, listeners)
      return () => {
        listeners.delete(handler)
      }
    },
    emit: async () => {},
    once: async () => () => {},
  }
}

export function tauriDialogDouble() {
  return {
    save: async (options?: Record<string, unknown>) => {
      world.saveDialogCalls.push(options)
      return world.saveDialogResult
    },
    open: async () => world.openDialogResult,
    message: async () => {},
    ask: async () => true,
    confirm: async () => true,
  }
}

export function runtimeDetectionDouble() {
  return { isDesktopRuntime: () => world.isDesktop }
}

/**
 * `@/lib/runtime/detect`: el otro detector de desktop, el que mira
 * `window.__TAURI_INTERNALS__`. En la app los dos coinciden; en el harness hay
 * que doblarlo para que no contradiga a `isDesktopRuntime`. Lo usa, p. ej.,
 * `loadContextualWorkspace` (el árbol del Workspace, ODE-580).
 */
export function tauriRuntimeDetectDouble() {
  return {
    isTauriRuntime: () => world.isDesktop,
    isWebRuntime: () => !world.isDesktop,
  }
}

/**
 * `@/lib/services/sharing-service-factory`: el servicio de compartir es una
 * frontera externa (Supabase/API). El doble implementa el contrato completo y
 * delega en `world` para que la prueba controle el resultado y pueda dejar una
 * respuesta retenida (SHARE-03, ODE-652).
 */
export function sharingServiceDouble() {
  return {
    createSharingService: () => ({
      getPreviewLink: async (writingId: string) => {
        world.sharingGetPreviewLinkCalls.push(writingId)
        return world.getPreviewLink(writingId)
      },
      rotatePreviewLink: async (writingId: string) => {
        world.sharingRotatePreviewLinkCalls.push(writingId)
        return world.rotatePreviewLink(writingId)
      },
      revokePreviewLink: async (writingId: string) => {
        world.sharingRevokePreviewLinkCalls.push(writingId)
        return world.revokePreviewLink(writingId)
      },
      listRecipients: async () => ({ error: null, data: [] }),
      shareWriting: async () => ({
        error: { code: "UNAVAILABLE", message: "Sharing is not available in this harness.", retryable: false },
        data: null,
      }),
      revokeShare: async () => ({
        error: { code: "UNAVAILABLE", message: "Sharing is not available in this harness.", retryable: false },
        data: null,
      }),
      listIncomingShares: async () => ({ error: null, data: [] }),
    }),
  }
}

export function aiServiceDouble() {
  return {
    getAIService: () => ({
      // Contrato real de AIService: `{ error, data: { items, nextCursor } }`.
      // La forma anterior (`{ items: [] }`) hacía que el loader lanzara y la
      // carga de palabras aprendidas fallara en silencio en todo el harness
      // (ODE-562).
      listLearnedWords: async () => {
        world.learnedWordsCalls += 1
        return { error: null, data: { items: [...world.learnedWords], nextCursor: null } }
      },
      // Contrato real: `{ error, data: LearnedWordEntry }`. Sin `data`, el
      // shell lo trata como fallo y revierte el aprendizaje (ODE-597).
      learnWord: async (input: LearnWordInput) => {
        world.learnWordCalls.push({ word: input.word, language: input.language })
        const entry: LearnedWordEntry = {
          id: `learned:${input.word}`,
          word: input.word.trim().toLowerCase(),
          language: input.language ?? "unknown",
          createdAt: new Date().toISOString(),
        }
        return { error: null, data: entry }
      },
      deleteLearnedWord: async () => ({ error: null }),
      reviewPublication: async (input: AiReviewInput) => {
        world.aiReviewCalls.push(input)
        return world.aiReview(input)
      },
      suggestTitle: async (input: { currentTitle?: string; bodyText?: string; writingId?: string }) => {
        world.suggestTitleCalls.push(input)
        return { error: null, data: null }
      },
      hydrateCorrectionBlocks: async (writingId: string) => {
        world.correctionHydrationCalls.push(writingId)
        return world.hydrateCorrectionBlocks(writingId)
      },
      persistCorrectionBlock: async (input: {
        writingId?: string
        block?: { id?: string; blockId?: string; suggestions?: Array<{ status?: string }> }
      }) => {
        world.correctionPersistCalls.push({
          writingId: input.writingId,
          blockId: input.block?.blockId,
          suggestionStatuses: input.block?.suggestions?.map((suggestion) => suggestion.status ?? ""),
        })
        return {
          error: null,
          data: { persistedId: input.block?.id ?? null, deletedIds: [], syncedAt: new Date().toISOString() },
        }
      },
    }),
  }
}
