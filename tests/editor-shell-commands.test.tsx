/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-603 (corte 4b, entrega 1) — RED del despachador de comandos de
 * `editor-shell.tsx` (`handleRunAction`), antes de moverlo a su hook.
 *
 * Qué fija:
 *
 *   1. **Una fila por acción, de la lista real.** `EditorShortcutAction`
 *      (`lib/editor/shortcuts.ts`) es la fuente única; no hay copia. La tabla
 *      `COMMAND_CASES` se tipa `satisfies Record<EditorShortcutAction, …>`, así
 *      que una acción nueva sin caso rompe `tsc`, y cada fila se ejecuta en
 *      runtime con `it.each` sobre la propia tabla.
 *   2. **Entrada real, nunca un handler interno.** Los comandos con atajo
 *      entran por el `keydown` real de la shell (el mismo evento que
 *      `getEditorShortcutAction` traduce), y los comandos que solo existen en
 *      el menú nativo entran por `menu:<acción>` en el bus real
 *      (`useTauriEditorMenuEvents` / `useTauriMenuEvents`). Los modales se
 *      abren por su atajo y se confirman por el formulario real.
 *   3. **Modo Rich y modo Markdown, para cada fila.** La tabla no declara
 *      modos: el runner recorre cada caso en ambos, Rich primero y Markdown
 *      después, y la aserción de Markdown es obligatoria (`tsc` no admite una
 *      fila sin ella). Las 17 acciones globales —despachadas antes de la rama
 *      de modo— también corren en Markdown con una transición observable
 *      (navegación, panel, pestaña, cookie, modal o borrador), no con el mismo
 *      chequeo repetido. `focusMode` es la única fila con `freshMountPerMode`:
 *      activar el foco oculta la status bar, que es la entrada real del cambio
 *      de modo, así que cada modo arranca de un montaje limpio. Los seis
 *      comandos sin rama Markdown (ODE-632) fijan el no-op actual con control
 *      positivo y un `it.fails` por comando.
 *   4. **Efecto canónico.** La marca, el nodo o la navegación del documento —
 *      no "se llamó a X". Tres familias (formato, inserción y nota) afirman
 *      además que el cambio llega a la persistencia real (`localDB` en web,
 *      el `.md` del workspace temporal en desktop).
 *   5. **`handleBackupLocalImage` en desktop** entra por el botón real del
 *      node view de la imagen local y confirma por el modal real; su dueño
 *      canónico (`lib/editor/local-image-backup.ts`) corre entero.
 *
 * Runtime: **web** para todo lo que tiene atajo o UI propia en la shell, y
 * **desktop** para lo que solo existe ahí (el menú nativo, `newWriting` y la
 * copia de respaldo de imagen local, que necesita `canonical_path`). Los
 * atajos que en un navegador real intercepta el chrome (⌘⇧] / ⌘⇧[, ⌘T, …)
 * corren aquí sobre el mismo manejador de producción: `handleRunAction` no
 * ramifica por runtime para ellos, y el runtime real de cada uno está
 * declarado en `EDITOR_SHORTCUT_HELP_SECTIONS`.
 *
 * Camino de producción: `window.dispatchEvent(keydown)` → `EditorShell` →
 * `getEditorShortcutAction` → `handleRunAction` → TipTap real / modales reales
 * / router doblado. Los dobles son del harness (`tests/support/`): red, Tauri,
 * diálogos del SO, AI, router — más el asset service del backup (lee la imagen
 * local y sube a Supabase Storage: boundary externo). Todo lo demás es real,
 * incluido TipTap con sus extensiones, `localDB`, el catálogo, el filesystem
 * temporal y `backUpLocalImage`.
 *
 * Mutaciones: cada fila se verificó rompiendo el `case "<acción>"` de
 * producción (el test de esa acción se pone rojo) y restaurándolo — barrido
 * 41/41 en la ronda inicial y barrido de las 17 globales en la ronda de
 * corrección; la rama de modo se invirtió en `bold` (rojo en ambos modos); y
 * un `return` temprano para `markdown` antes del despacho global puso rojas
 * las 17 aserciones nuevas de Markdown por su propia etiqueta. El detalle está
 * en la Guía de review del issue.
 *
 * Bug encontrado por la red: **ODE-632** (Medium) — los comandos de documento
 * sin rama Markdown (codeBlock, horizontalRule, clearStyles, copyAsMarkdown,
 * copyAsHtml, date) quedan mudos en ese modo. No se arregla en este corte.
 */
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { act } from "react"

import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import type { EditorShortcutAction } from "@/lib/editor/shortcuts"

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
/**
 * El flush a la nube y el asset service son boundary externo. En web se deja
 * el módulo real (su red la corta `world.network`); en desktop se doblan
 * porque el transporte nativo y Supabase Storage no existen dentro de Vitest.
 */
vi.mock("@/lib/sync/sync-service-factory", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { syncServiceDouble } = await import("./support/editor-shell-desktop-doubles")
  const { world } = await import("./support/editor-shell-doubles")
  const desktop = syncServiceDouble()
  return {
    ...actual,
    getSyncService: () =>
      world.isDesktop ? desktop.getSyncService() : (actual.getSyncService as () => unknown)(),
  }
})
vi.mock("@/lib/services/asset-service-factory", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>()
  const { desktopAssetServiceDouble } = await import("./support/editor-shell-desktop-doubles")
  const { world } = await import("./support/editor-shell-doubles")
  const desktop = desktopAssetServiceDouble()
  return {
    ...actual,
    getAssetService: () =>
      world.isDesktop ? desktop.getAssetService() : (actual.getAssetService as () => unknown)(),
  }
})

const {
  advance,
  assertNoUnhandledErrors,
  clickEditorTab,
  clickSelectionPopupAction,
  emitTauriEvent,
  fillTextField,
  flush,
  mountEditorShell,
  pressEditorShortcut,
  pressEscape,
  resetEditorShellWorld,
  selectEditorText,
  waitFor,
  waitForAsync,
  world,
} = await import("./support/editor-shell-harness")
const {
  createDesktopWorkspace,
  desktopAssetCalls,
  destroyDesktopWorkspace,
  readWorkspaceMarkdown,
  resetDesktopWorkspace,
} = await import("./support/editor-shell-desktop-doubles")
const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { EDITOR_DRAFT_TAB_ID, createEditorSessionTab, createEmptyEditorSession } = await import(
  "@/lib/local-db/editor-sessions"
)
const { EDITOR_SHORTCUT_HELP_SECTIONS } = await import("@/lib/editor/shortcuts")

const TEST_TIMEOUT_MS = 30_000
const DESKTOP_TEST_TIMEOUT_MS = 60_000
const TEXT_A = "Alfa bravo charlie delta eco."
const TEXT_B = "Foxtrot golf hotel india."
const UPLOADED_URL = "https://images.example.test/subida.png"
const ONLINE_BACKUP_URL = "https://cdn.example.test/foto-subida.png"

let writingA = ""
let writingB = ""
let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
const clipboardWrites: string[] = []

/* ------------------------------------------------------------------ *
 * Fixtures y lecturas canónicas
 * ------------------------------------------------------------------ */

function makeLocalWriting(id: string, title: string, text: string): LocalWriting {
  return {
    id,
    title,
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
  } as LocalWriting
}

function bodyJson(text: string) {
  return { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] }
}

function activeTabWritingId(): string | null {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)?.writing_id ?? null
}

type JsonNode = {
  type?: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: Array<{ type?: string; attrs?: Record<string, unknown> }>
  content?: JsonNode[]
}

function asDoc(value: unknown): JsonNode {
  return (value ?? {}) as JsonNode
}

function walkDoc(node: JsonNode | undefined, visit: (node: JsonNode) => void) {
  if (!node) return
  visit(node)
  for (const child of node.content ?? []) walkDoc(child, visit)
}

function nodeTypes(doc: JsonNode): string[] {
  const types: string[] = []
  walkDoc(doc, (node) => {
    if (node.type) types.push(node.type)
  })
  return types
}

function markTypes(doc: JsonNode): string[] {
  return markDetails(doc).map((mark) => mark.type)
}

function markDetails(doc: JsonNode): Array<{ type: string; attrs: Record<string, unknown> }> {
  const marks: Array<{ type: string; attrs: Record<string, unknown> }> = []
  walkDoc(doc, (node) => {
    for (const mark of node.marks ?? []) {
      if (mark.type) marks.push({ type: mark.type, attrs: mark.attrs ?? {} })
    }
  })
  return marks
}

function findNode(doc: JsonNode, type: string): JsonNode | undefined {
  let found: JsonNode | undefined
  walkDoc(doc, (node) => {
    if (!found && node.type === type) found = node
  })
  return found
}

function imageSources(doc: JsonNode): string[] {
  const sources: string[] = []
  walkDoc(doc, (node) => {
    if (node.type === "image" && typeof node.attrs?.src === "string") sources.push(node.attrs.src)
  })
  return sources
}

function todayIsoDate() {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, "0")
  const day = String(now.getDate()).padStart(2, "0")
  return `${now.getFullYear()}-${month}-${day}`
}

function buttonWithText(text: string, root: ParentNode = document) {
  return Array.from(root.querySelectorAll<HTMLButtonElement>("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === text && !candidate.classList.contains("sr-only"),
  )
}

async function clickButton(text: string, root: ParentNode = document) {
  const button = await waitFor(() => buttonWithText(text, root), { label: `botón "${text}"` })
  await act(async () => {
    button.click()
  })
  await flush(2)
}

/* ------------------------------------------------------------------ *
 * Mundo de la tabla: montaje por runtime y drivers de entrada
 * ------------------------------------------------------------------ */

type CommandMode = "rich" | "markdown"
type Shortcut = { key: string; code?: string; shift?: boolean; alt?: boolean }
type ToolbarInsertAction = Extract<EditorShortcutAction, "tipBlock" | "infoBlock" | "cardBlock">
type RealEntry =
  | { kind: "shortcut"; shortcut: Shortcut }
  | { kind: "menu"; action: EditorShortcutAction }
  | { kind: "toolbar-insert"; action: ToolbarInsertAction }
type CommandCheck = (world: CommandWorld) => void | Promise<void>
type CommandSetup = (world: CommandWorld) => Promise<void>

/**
 * La tabla de la red. `rich` y `markdown` son obligatorios: el runner recorre
 * ambos modos para cada fila y una acción sin aserción de Markdown rompe
 * `tsc`. El chequeo de cada modo entra por la entrada real del caso y afirma
 * el efecto (o el no-op cuando el modo no tiene rama, con su control positivo).
 */
type CommandCase = {
  entry: RealEntry
  runtime?: "desktop"
  rich: CommandCheck
  markdown: CommandCheck
  setup?: CommandSetup
  /**
   * Cada modo arranca de un montaje limpio. Necesario cuando una pasada deja
   * el shell en un estado que impide cambiar de modo: `focusMode` oculta la
   * status bar, que es la entrada real del cambio de modo.
   */
  freshMountPerMode?: boolean
}

const shortcut = (
  key: string,
  code?: string,
  modifiers: { shift?: boolean; alt?: boolean } = {},
): RealEntry => ({ kind: "shortcut", shortcut: { key, code, ...modifiers } })

const menu = (action: EditorShortcutAction): RealEntry => ({ kind: "menu", action })
const toolbarInsert = (action: ToolbarInsertAction): RealEntry => ({ kind: "toolbar-insert", action })

type CommandWorld = {
  action: EditorShortcutAction
  /** Entra por la entrada real del caso que se está ejecutando. */
  enter: () => Promise<void>
  /** Entra por cualquier otra entrada real (para montar el estado previo). */
  press: (entry: RealEntry) => Promise<void>
  /** Cambia de modo con el botón real de la status bar y verifica el cambio. */
  setMode: (mode: CommandMode) => Promise<void>
  json: () => JsonNode
  text: () => string
  markdownValue: () => string
  selectRichText: (needle: string) => Promise<void>
  selectMarkdownText: (needle: string) => Promise<void>
  appendMarkdown: (text: string) => Promise<void>
  waitForSaved: (predicate: (record: LocalWriting) => boolean, label: string) => Promise<LocalWriting>
}

function markdownSource(): HTMLTextAreaElement | null {
  return (
    mounted?.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]') ??
    document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
  )
}

async function pressRealEntry(entry: RealEntry) {
  if (entry.kind === "shortcut") {
    await pressEditorShortcut(entry.shortcut)
    return
  }
  if (entry.kind === "menu") {
    await emitTauriEvent(`menu:${entry.action}`)
    return
  }

  const insertTrigger = await waitFor(
    () => mounted?.container.querySelector<HTMLButtonElement>('button[aria-label="Insert"]') ?? null,
    { label: "menú Insert de la toolbar" },
  )
  await act(async () => {
    const makePointerEvent = (type: "pointerdown" | "pointerup") =>
      new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        button: 0,
        buttons: type === "pointerdown" ? 1 : 0,
        pointerId: 1,
        pointerType: "mouse",
      })
    insertTrigger.dispatchEvent(makePointerEvent("pointerdown"))
    insertTrigger.dispatchEvent(makePointerEvent("pointerup"))
  })
  await flush(2)

  const itemLabel = { tipBlock: "Tip", infoBlock: "Info", cardBlock: "Card" }[entry.action]
  const item = await waitFor(
    () =>
      Array.from(document.querySelectorAll<HTMLElement>('[role="menuitem"]')).find(
        (candidate) => candidate.getAttribute("aria-label") === itemLabel || (candidate.textContent ?? "").includes(itemLabel),
      ) ?? null,
    { label: `acción ${itemLabel} en el menú Insert` },
  )
  await act(async () => {
    item.click()
  })
  await flush(2)
}

async function setMode(mode: CommandMode) {
  const label = mode === "rich" ? "Rich" : "Markdown"
  const findButton = () =>
    Array.from(
      mounted!.container.querySelectorAll<HTMLButtonElement>('[data-testid="editor-statusbar"] button'),
    ).find((candidate) => (candidate.textContent ?? "").trim() === label)
  const reached = () =>
    mode === "markdown" ? markdownSource() : !markdownSource() && mounted!.prosemirror()

  await waitFor(findButton, { label: `botón "${label}" de la status bar` })

  // El click puede caer mientras el shell hidrata otra pestaña: con el
  // `editor` todavía null, `handleToggleMode` retorna sin cambiar de modo.
  // Se reintenta el mismo botón real (y se vuelve a buscar: la status bar
  // puede remontarse) hasta que el modo se alcanza.
  const deadline = Date.now() + 10_000
  while (!reached() && Date.now() < deadline) {
    const button = findButton()
    if (button) {
      await act(async () => {
        button.click()
      })
      await flush(2)
    } else {
      await flush(1)
    }
  }

  if (!reached()) {
    throw new Error(`El botón "${label}" no llevó el editor al modo ${mode}`)
  }
}

async function selectMarkdownText(needle: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  const start = textarea.value.indexOf(needle)
  if (start < 0) throw new Error(`El texto ${JSON.stringify(needle)} no está en el textarea`)
  await act(async () => {
    textarea.focus()
    textarea.setSelectionRange(start, start + needle.length)
    // `select` y `keyup` son los eventos reales que la shell escucha para
    // guardar la selección de Markdown (onSelect / onKeyUp del textarea).
    textarea.dispatchEvent(new Event("select", { bubbles: true }))
    textarea.dispatchEvent(new KeyboardEvent("keyup", { key: "Shift", bubbles: true }))
  })
  await flush(1)
}

async function appendMarkdown(text: string) {
  const textarea = markdownSource()
  if (!textarea) throw new Error("El editor no está en modo Markdown")
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(textarea, `${textarea.value}${text}`)
    textarea.dispatchEvent(new Event("input", { bubbles: true }))
  })
  await flush(1)
}

async function waitForSavedRecord(
  writingId: string,
  predicate: (record: LocalWriting) => boolean,
  label: string,
) {
  return waitForAsync(
    async () => {
      const record = await localDB.writings.get(writingId)
      return record && predicate(record) ? record : null
    },
    { label, timeoutMs: 10_000 },
  )
}

function makeWorld(action: EditorShortcutAction, testCase: CommandCase, documentWritingId: string): CommandWorld {
  return {
    action,
    enter: () => pressRealEntry(testCase.entry),
    press: pressRealEntry,
    setMode,
    json: () => mounted!.editor().getJSON() as JsonNode,
    text: () => mounted!.editor().getText(),
    markdownValue: () => {
      const textarea = markdownSource()
      if (!textarea) throw new Error("El editor no está en modo Markdown")
      return textarea.value
    },
    selectRichText: async (needle: string) => {
      await selectEditorText(needle)
    },
    selectMarkdownText,
    appendMarkdown,
    waitForSaved: (predicate, label) => waitForSavedRecord(documentWritingId, predicate, label),
  }
}

/** Web: documento A abierto por ruta, con B de fondo en la barra de pestañas. */
async function mountWebCommandWorld(action: EditorShortcutAction, testCase: CommandCase): Promise<CommandWorld> {
  // Ids nuevos por test: fake-indexeddb persiste entre tests del archivo.
  writingA = crypto.randomUUID()
  writingB = crypto.randomUUID()
  resetEditorShellWorld()
  await localDB.writings.save(makeLocalWriting(writingA, "Documento A", TEXT_A))
  await localDB.writings.save(makeLocalWriting(writingB, "Documento B", TEXT_B))
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })

  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 10_000 })
  await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })

  return makeWorld(action, testCase, writingA)
}

/** Desktop: dos documentos reales del workspace temporal, A activo y B de fondo. */
async function mountDesktopCommandWorld(
  action: EditorShortcutAction,
  testCase: CommandCase,
): Promise<CommandWorld> {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })

  // Título único por test: un guardado diferido de la prueba anterior puede
  // aterrizar en el workspace justo después de `resetDesktopWorkspace()`, y
  // dos tests con el mismo nombre de archivo chocarían contra `wx`.
  const suffix = crypto.randomUUID().slice(0, 8)
  const a = await createDesktopDraft({
    title: `Documento A ${suffix}`,
    initialBodyJson: bodyJson(TEXT_A),
    initialBodyText: TEXT_A,
  })
  const b = await createDesktopDraft({
    title: `Documento B ${suffix}`,
    initialBodyJson: bodyJson(TEXT_B),
    initialBodyText: TEXT_B,
  })
  if (a.error || !a.data || b.error || !b.data) {
    throw new Error(`createDesktopDraft falló: ${a.error?.message ?? b.error?.message}`)
  }
  writingA = a.data.id
  writingB = b.data.id
  await writeEditorSession({
    ...createEmptyEditorSession(),
    active_tab_id: writingA,
    tabs: [
      createEditorSessionTab({ id: writingA, writingId: writingA, title: "Documento A" }),
      createEditorSessionTab({ id: writingB, writingId: writingB, title: "Documento B" }),
    ],
  })

  mounted = await mountEditorShell({ writingId: writingA })
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await waitFor(() => mounted!.editor().getText().includes(TEXT_A), { label: "A hidratado", timeoutMs: 15_000 })
  await waitFor(() => document.querySelector(`[data-editor-tab-id="${writingB}"]`), { label: "pestaña de B" })

  return makeWorld(action, testCase, writingA)
}

/* ------------------------------------------------------------------ *
 * Ciclo de vida
 * ------------------------------------------------------------------ */

beforeAll(() => {
  createDesktopWorkspace("odessay-commands-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  clipboardWrites.length = 0
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: {
      writeText: async (text: string) => {
        clipboardWrites.push(text)
      },
    },
  })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/* ------------------------------------------------------------------ *
 * La tabla
 * ------------------------------------------------------------------ */

const IMAGE_UPLOAD_URL_MATCH = /\/api\/writings\/([^/]+)\/images$/

function installImageUploadNetwork() {
  world.network = (url, init) => {
    if (IMAGE_UPLOAD_URL_MATCH.test(url) && (init?.method ?? "GET").toUpperCase() === "POST") {
      return new Response(
        JSON.stringify({ data: { assetId: "asset-ode603", url: UPLOADED_URL, alt: "Subida" }, error: null }),
        { status: 200, headers: { "content-type": "application/json" } },
      )
    }
    return new Response(JSON.stringify({ error: "network disabled in harness" }), { status: 503 })
  }
}

async function submitLocalImageModal(alt: string) {
  const fileInput = await waitFor(() => document.querySelector<HTMLInputElement>('input[type="file"]'), {
    label: "el modal de insertar imagen",
  })
  const file = new File([new Uint8Array([137, 80, 78, 71])], "subida.png", { type: "image/png" })
  Object.defineProperty(fileInput, "files", { configurable: true, value: [file] })
  await act(async () => {
    fileInput.dispatchEvent(new Event("change", { bubbles: true }))
  })
  await flush(2)

  const altInput = await waitFor(
    () => document.querySelector<HTMLInputElement>('input[placeholder="Describe the image"]'),
    { label: "campo de alt del modal" },
  )
  await fillTextField(altInput, alt)

  const submit = await waitFor(
    () => {
      const button = buttonWithText("Insert image")
      return button && !button.disabled ? button : null
    },
    { label: 'botón "Insert image" habilitado' },
  )
  // El submit del formulario real (happy-dom no puede asignar `value` a un
  // `<input type="file">`, así que se entrega el evento que emite el navegador
  // con el archivo elegido; mismo camino que usa el e2e de ODE-602).
  await act(async () => {
    submit.form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
  })
  await flush(2)
}

/**
 * La navegación global corre antes de la rama de modo: la aserción de cada
 * modo exige que *esa* pasada haya producido la navegación, no que exista una
 * anterior (Rich y Markdown comparten el contador del router doblado).
 */
function navigatesTo(href: string): CommandCheck {
  return async (w) => {
    const before = world.navigations.length
    await w.enter()
    await waitFor(
      () => world.navigations.length === before + 1 && world.navigations.at(-1)?.href === href,
      { label: `navega a ${href} desde el modo actual` },
    )
  }
}

/** El evento global de búsqueda, contado por pasada (el listener es nuevo en cada una). */
function emitsOpenSearch(): CommandCheck {
  return async (w) => {
    const received: Event[] = []
    const listener = (event: Event) => received.push(event)
    window.addEventListener("odessay:open-search", listener)
    try {
      await w.enter()
      await waitFor(() => received.length === 1, { label: "evento odessay:open-search" })
    } finally {
      window.removeEventListener("odessay:open-search", listener)
    }
  }
}

/**
 * Los paneles que la pasada de Rich deja abiertos se cierran por su camino
 * real (Escape) y se vuelven a abrir desde Markdown: sin la transición, el
 * panel ya abierto no probaría que el comando corrió en este modo.
 */
function reopensPanelFromMarkdown(testId: string, label: string): CommandCheck {
  return async (w) => {
    expect(document.querySelector(`[data-testid="${testId}"]`), `control: Rich abrió ${label}`).toBeTruthy()
    await pressEscape()
    await waitFor(() => (document.querySelector(`[data-testid="${testId}"]`) ? null : true), {
      label: `${label} se cierra`,
    })
    await w.enter()
    await waitFor(() => document.querySelector(`[data-testid="${testId}"]`), {
      label: `${label} se abre desde Markdown`,
    })
  }
}

/** Paneles que alternan: la pasada de Markdown los apaga (transición observable). */
function togglesPanelOffFromMarkdown(testId: string, label: string): CommandCheck {
  return async (w) => {
    expect(document.querySelector(`[data-testid="${testId}"]`), `control: Rich abrió ${label}`).toBeTruthy()
    await w.enter()
    await waitFor(() => (document.querySelector(`[data-testid="${testId}"]`) ? null : true), {
      label: `${label} se cierra desde Markdown`,
    })
  }
}

/**
 * `focusMode` se prueba igual en ambos modos: control apagado, la entrada real
 * lo enciende. Corre con `freshMountPerMode` porque con el foco activo la
 * status bar —el botón real de cambio de modo— no existe.
 */
const focusModeTurnsOn: CommandCheck = async (w) => {
  expect(
    document.querySelector<HTMLElement>('[data-page="editor"]')?.dataset.focusMode,
    "control: el foco arranca apagado",
  ).toBe("false")
  await w.enter()
  expect(
    document.querySelector<HTMLElement>('[data-page="editor"]')?.dataset.focusMode,
    "focus mode activo",
  ).toBe("true")
  expect(document.body.classList.contains("od-editor-focus-mode"), "clase de focus mode").toBe(true)
}

const COMMAND_CASES = {
  /* --- Formato (marcas en línea) --- */
  bold: {
    entry: shortcut("b", "KeyB"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(markTypes(w.json()), "bold aplicado en Rich").toContain("bold")
      await w.waitForSaved((record) => markTypes(asDoc(record.body_json)).includes("bold"), "bold llega a lo guardado")
    },
    markdown: async (w) => {
      // "charlie" y no "bravo": el chequeo de Rich ya dejó `**bravo**` en el
      // documento, y togglear sobre él lo desenvolvería (comportamiento
      // correcto, pero no lo que este modo quiere fijar).
      await w.selectMarkdownText("charlie")
      await w.enter()
      expect(w.markdownValue(), "bold envuelto en Markdown").toContain("**charlie**")
      await w.waitForSaved((record) => markTypes(asDoc(record.body_json)).includes("bold"), "bold llega a lo guardado")
    },
  },
  italic: {
    entry: shortcut("i", "KeyI"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(markTypes(w.json()), "italic aplicado en Rich").toContain("italic")
    },
    markdown: async (w) => {
      await w.selectMarkdownText("charlie")
      await w.enter()
      expect(w.markdownValue(), "italic envuelto en Markdown").toContain("*charlie*")
    },
  },
  strike: {
    entry: shortcut("x", "KeyX", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(markTypes(w.json()), "strike aplicado en Rich").toContain("strike")
    },
    markdown: async (w) => {
      await w.selectMarkdownText("charlie")
      await w.enter()
      expect(w.markdownValue(), "strike envuelto en Markdown").toContain("~~charlie~~")
    },
  },
  highlight: {
    entry: shortcut("h", "KeyH", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="selection-popup"]'), {
        label: "popup de selección del highlight",
      })
      await clickSelectionPopupAction("Mark passage")
      expect(markTypes(w.json()), "highlight aplicado en Rich").toContain("highlight")
    },
    markdown: async (w) => {
      await w.selectMarkdownText("charlie")
      await w.enter()
      expect(w.markdownValue(), "highlight envuelto en Markdown").toContain("==charlie==")
    },
  },
  inlineCode: {
    entry: shortcut("e", "KeyE"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(markTypes(w.json()), "code aplicado en Rich").toContain("code")
    },
    markdown: async (w) => {
      await w.selectMarkdownText("charlie")
      await w.enter()
      expect(w.markdownValue(), "inline code envuelto en Markdown").toContain("`charlie`")
    },
  },
  codeBlock: {
    entry: shortcut("e", "KeyE", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(nodeTypes(w.json()), "codeBlock insertado en Rich").toContain("codeBlock")
    },
    markdown: async (w) => {
      // ODE-632: no hay rama Markdown. La red fija el no-op (la mudanza no
      // puede cambiarlo) y el `it.fails` de abajo documenta el efecto esperado.
      const before = w.markdownValue()
      await w.enter()
      expect(w.markdownValue(), "codeBlock no tiene rama en Markdown").toBe(before)
    },
  },
  link: {
    entry: shortcut("k", "KeyK", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      const url = await waitFor(
        () => document.querySelector<HTMLInputElement>('input[placeholder="https://example.com"]'),
        { label: "modal de link" },
      )
      await fillTextField(url, "example.com")
      await clickButton("Insert link")
      expect(
        markDetails(w.json()).some(
          (mark) => mark.type === "link" && mark.attrs.href === "https://example.com",
        ),
        "link aplicado a la selección en Rich",
      ).toBe(true)
    },
    markdown: async (w) => {
      await w.selectMarkdownText("bravo")
      await w.enter()
      const text = await waitFor(
        () => document.querySelector<HTMLInputElement>('input[placeholder="Selected text"]'),
        { label: "modal de link" },
      )
      await fillTextField(text, "sitio")
      const url = await waitFor(
        () => document.querySelector<HTMLInputElement>('input[placeholder="https://example.com"]'),
        { label: "campo URL del modal de link" },
      )
      await fillTextField(url, "https://example.com")
      await clickButton("Insert link")
      expect(w.markdownValue(), "link insertado en Markdown").toContain("[sitio](https://example.com)")
    },
  },

  /* --- Estructura (bloques) --- */
  paragraph: {
    entry: shortcut("0", "Digit0"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.press(shortcut("1", "Digit1"))
      expect(nodeTypes(w.json()), "control: el heading existe antes de ⌘0").toContain("heading")
      await w.enter()
      expect(nodeTypes(w.json()), "vuelve a paragraph").toContain("paragraph")
      expect(nodeTypes(w.json()), "y deja de ser heading").not.toContain("heading")
    },
    markdown: async (w) => {
      await w.appendMarkdown("\n# Titulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "el prefijo # se limpia").not.toContain("# Titulo ODE603")
      expect(w.markdownValue(), "el texto sigue").toContain("Titulo ODE603")
    },
  },
  heading1: {
    entry: shortcut("1", "Digit1"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(findNode(w.json(), "heading")?.attrs?.level, "heading nivel 1").toBe(1)
    },
    markdown: async (w) => {
      // Línea nueva y no la del chequeo de Rich: allí el bloque ya quedó
      // convertido a heading, y volver a aplicar el prefijo lo quitaría.
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de H1 en Markdown").toContain("# Titulo ODE603")
    },
  },
  heading2: {
    entry: shortcut("2", "Digit2"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(findNode(w.json(), "heading")?.attrs?.level, "heading nivel 2").toBe(2)
    },
    markdown: async (w) => {
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de H2 en Markdown").toContain("## Titulo ODE603")
    },
  },
  heading3: {
    entry: shortcut("3", "Digit3"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(findNode(w.json(), "heading")?.attrs?.level, "heading nivel 3").toBe(3)
    },
    markdown: async (w) => {
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de H3 en Markdown").toContain("### Titulo ODE603")
    },
  },
  bulletList: {
    entry: shortcut("l", "KeyL"),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(nodeTypes(w.json()), "bulletList insertado en Rich").toContain("bulletList")
    },
    markdown: async (w) => {
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de lista en Markdown").toContain("- Titulo ODE603")
    },
  },
  orderedList: {
    entry: shortcut("l", "KeyL", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(nodeTypes(w.json()), "orderedList insertado en Rich").toContain("orderedList")
    },
    markdown: async (w) => {
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de lista numerada en Markdown").toContain("1. Titulo ODE603")
    },
  },
  blockquote: {
    entry: shortcut("b", "KeyB", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      expect(nodeTypes(w.json()), "blockquote insertado en Rich").toContain("blockquote")
    },
    markdown: async (w) => {
      await w.appendMarkdown("\nTitulo ODE603")
      await w.selectMarkdownText("Titulo ODE603")
      await w.enter()
      expect(w.markdownValue(), "prefijo de cita en Markdown").toContain("> Titulo ODE603")
    },
  },

  /* --- Inserción --- */
  tipBlock: {
    entry: toolbarInsert("tipBlock"),
    rich: async (w) => {
      await w.enter()
      expect(nodeTypes(w.json()), "Tip insertado desde Insert en Rich").toContain("tip")
    },
    markdown: async (w) => {
      const before = JSON.stringify(w.json())
      await w.enter()
      expect(JSON.stringify(w.json()), "Tip no muta el documento desde Markdown").toBe(before)
    },
  },
  infoBlock: {
    entry: toolbarInsert("infoBlock"),
    rich: async (w) => {
      await w.enter()
      expect(nodeTypes(w.json()), "Info insertado desde Insert en Rich").toContain("info")
    },
    markdown: async (w) => {
      const before = JSON.stringify(w.json())
      await w.enter()
      expect(JSON.stringify(w.json()), "Info no muta el documento desde Markdown").toBe(before)
    },
  },
  cardBlock: {
    entry: toolbarInsert("cardBlock"),
    rich: async (w) => {
      await w.enter()
      expect(nodeTypes(w.json()), "Card insertado desde Insert en Rich").toContain("card")
    },
    markdown: async (w) => {
      const before = JSON.stringify(w.json())
      await w.enter()
      expect(JSON.stringify(w.json()), "Card no muta el documento desde Markdown").toBe(before)
    },
  },
  footnote: {
    entry: shortcut("a", "KeyA", { shift: true }),
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.enter()
      const note = await waitFor(
        () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add note text"]'),
        { label: "modal de footnote" },
      )
      await fillTextField(note, "Nota ODE-603 rich")
      await clickButton("Insert footnote")
      await waitFor(() => (findNode(w.json(), "annotationReference")?.attrs?.type === "footnote" ? true : null), {
        label: "referencia de footnote en Rich",
      })
      await waitFor(() => document.querySelector('[data-testid="editor-panel-notes"]'), {
        label: "la nota abre el panel de notas",
      })
      await w.waitForSaved(
        (record) => JSON.stringify(record.body_json).includes("Nota ODE-603 rich"),
        "la nota llega a lo guardado",
      )
    },
    markdown: async (w) => {
      await w.selectMarkdownText("charlie")
      await w.enter()
      const note = await waitFor(
        () => document.querySelector<HTMLTextAreaElement>('textarea[placeholder="Add note text"]'),
        { label: "modal de footnote" },
      )
      await fillTextField(note, "Nota ODE-603 markdown")
      await clickButton("Insert footnote")
      expect(w.markdownValue(), "la nota se añade al Markdown").toContain("Nota ODE-603 markdown")
      await w.waitForSaved(
        (record) => JSON.stringify(record.body_json).includes("Nota ODE-603 markdown"),
        "la nota llega a lo guardado",
      )
    },
  },
  table: {
    entry: shortcut("t", "KeyT"),
    rich: async (w) => {
      await w.enter()
      const cell = await waitFor(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="2 rows × 2 columns"]'),
        { label: "grilla del modal de tabla" },
      )
      await act(async () => {
        cell.click()
      })
      await flush(2)
      await waitFor(() => nodeTypes(w.json()).includes("table"), { label: "tabla insertada en Rich" })
      await w.waitForSaved(
        (record) => nodeTypes(asDoc(record.body_json)).includes("table"),
        "la tabla llega a lo guardado",
      )
    },
    markdown: async (w) => {
      await w.enter()
      const cell = await waitFor(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="2 rows × 2 columns"]'),
        { label: "grilla del modal de tabla" },
      )
      await act(async () => {
        cell.click()
      })
      await flush(2)
      // La tabla nueva queda al final del textarea; el chequeo de Rich ya
      // pudo dejar una tabla serializada arriba, así que no basta un "contains".
      await waitFor(() => w.markdownValue().trimEnd().endsWith("| Cell | Cell |"), {
        label: "tabla GFM al final del textarea",
      })
      await w.waitForSaved(
        (record) => nodeTypes(asDoc(record.body_json)).includes("table"),
        "la tabla llega a lo guardado",
      )
    },
  },
  image: {
    entry: shortcut("i", "KeyI", { shift: true }),
    rich: async (w) => {
      installImageUploadNetwork()
      await w.enter()
      await submitLocalImageModal("Subida rich")
      await waitFor(() => imageSources(w.json()).includes(UPLOADED_URL), {
        label: "imagen insertada en Rich",
      })
    },
    markdown: async (w) => {
      installImageUploadNetwork()
      await w.enter()
      await submitLocalImageModal("Subida markdown")
      await waitFor(() => w.markdownValue().includes(`![Subida markdown](${UPLOADED_URL})`), {
        label: "imagen insertada en Markdown",
      })
    },
  },
  horizontalRule: {
    entry: shortcut("-", "Minus", { shift: true }),
    rich: async (w) => {
      await w.enter()
      expect(nodeTypes(w.json()), "horizontalRule insertado en Rich").toContain("horizontalRule")
    },
    markdown: async (w) => {
      // ODE-632: ver el `it.fails` de la familia.
      const before = w.markdownValue()
      await w.enter()
      expect(w.markdownValue(), "horizontalRule no tiene rama en Markdown").toBe(before)
    },
  },

  /* --- Navegación global --- */
  goDesk: {
    entry: shortcut("1", "Digit1", { alt: true }),
    rich: navigatesTo("/desk"),
    markdown: navigatesTo("/desk"),
  },
  goWorkspace: {
    entry: shortcut("2", "Digit2", { alt: true }),
    rich: navigatesTo("/workspace"),
    markdown: navigatesTo("/workspace"),
  },
  goStudio: {
    entry: shortcut("3", "Digit3", { alt: true }),
    rich: navigatesTo("/write"),
    markdown: navigatesTo("/write"),
  },
  search: {
    entry: shortcut("k", "KeyK"),
    rich: emitsOpenSearch(),
    markdown: emitsOpenSearch(),
  },
  nextTab: {
    entry: shortcut("]", "BracketRight", { shift: true }),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => activeTabWritingId() === writingB, { label: "pasa a la pestaña siguiente" })
    },
    markdown: async (w) => {
      // La pasada de Rich dejó B activa; ⌘⇧] desde Markdown debe seguir
      // rotando (B → A). El control fija de dónde parte la transición.
      expect(activeTabWritingId(), "control: Rich dejó la pestaña B activa").toBe(writingB)
      await w.enter()
      await waitFor(() => activeTabWritingId() === writingA, {
        label: "rota a la pestaña siguiente desde Markdown",
      })
    },
  },
  prevTab: {
    entry: shortcut("[", "BracketLeft", { shift: true }),
    setup: async () => {
      await clickEditorTab(writingB)
      await flush(2)
    },
    rich: async (w) => {
      await w.enter()
      await waitFor(() => activeTabWritingId() === writingA, { label: "vuelve a la pestaña anterior" })
    },
    markdown: async (w) => {
      // La pasada de Rich dejó A activa; ⌘⇧[ desde Markdown debe rotar en
      // sentido contrario y envolver (A → B).
      expect(activeTabWritingId(), "control: Rich dejó la pestaña A activa").toBe(writingA)
      await w.enter()
      await waitFor(() => activeTabWritingId() === writingB, {
        label: "rota a la pestaña anterior desde Markdown",
      })
    },
  },

  /* --- Anotar / Voz / Documento --- */
  addNote: {
    entry: shortcut("n", "KeyN", { shift: true }),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="editor-panel-notes"]'), { label: "panel de notas" })
    },
    markdown: reopensPanelFromMarkdown("editor-panel-notes", "el panel de notas"),
  },
  voiceNote: {
    entry: shortcut("r", "KeyR", { alt: true }),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="editor-panel-notes"]'), { label: "panel de notas" })
    },
    markdown: reopensPanelFromMarkdown("editor-panel-notes", "el panel de notas"),
  },
  documentProperties: {
    entry: shortcut("p", "KeyP", { alt: true }),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="editor-panel-properties"]'), {
        label: "panel de propiedades",
      })
    },
    markdown: togglesPanelOffFromMarkdown("editor-panel-properties", "el panel de propiedades"),
  },
  corrections: {
    entry: shortcut("s", "KeyS", { alt: true }),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="editor-panel-corrections"]'), {
        label: "panel de gramática",
      })
    },
    markdown: togglesPanelOffFromMarkdown("editor-panel-corrections", "el panel de gramática"),
  },

  /* --- Editor / Vista --- */
  find: {
    entry: shortcut("f", "KeyF"),
    rich: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('input[aria-label="Find text"]'), { label: "panel de find" })
    },
    markdown: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('input[aria-label="Find text"]'), {
        label: "panel de find en Markdown",
      })
    },
  },
  replace: {
    entry: shortcut("f", "KeyF", { alt: true }),
    rich: async (w) => {
      await w.enter()
      const input = await waitFor(() => document.querySelector<HTMLInputElement>('input[aria-label="Replace text"]'), {
        label: "campo de replace",
      })
      await advance(50)
      await waitFor(() => (document.activeElement === input ? input : null), {
        label: "el foco entra al campo de replace",
      })
    },
    markdown: async (w) => {
      await w.enter()
      await waitFor(() => document.querySelector('input[aria-label="Replace text"]'), {
        label: "campo de replace en Markdown",
      })
    },
  },
  focusMode: {
    entry: shortcut("f", "KeyF", { shift: true }),
    // Activar el foco esconde la status bar (el botón real de cambio de modo),
    // así que cada modo necesita su propio montaje para poder cambiar de modo.
    freshMountPerMode: true,
    rich: focusModeTurnsOn,
    markdown: focusModeTurnsOn,
  },
  toggleSidebar: {
    entry: shortcut("\\", "Backslash"),
    rich: async (w) => {
      await w.enter()
      await waitFor(
        () => (document.cookie.includes("odessay-sidebar-mode=expanded") ? true : null),
        { label: "la preferencia del sidebar queda persistida" },
      )
    },
    markdown: async (w) => {
      expect(document.cookie, "control: Rich dejó el sidebar expandido").toContain(
        "odessay-sidebar-mode=expanded",
      )
      await w.enter()
      await waitFor(
        () => (document.cookie.includes("odessay-sidebar-mode=collapsed") ? true : null),
        { label: "el sidebar vuelve a collapsed desde Markdown" },
      )
    },
  },
  shortcutHelp: {
    entry: shortcut("/", "Slash"),
    rich: async (w) => {
      await w.enter()
      const modal = await waitFor(() => document.querySelector('[data-testid="display-modal"]'), {
        label: "modal de atajos",
      })
      expect(modal.textContent, "el modal es el de atajos").toContain("Keyboard shortcuts")
    },
    markdown: async (w) => {
      const modal = document.querySelector('[data-testid="display-modal"]')
      expect(modal, "control: Rich abrió el modal de atajos").toBeTruthy()
      const close = modal!.querySelector<HTMLButtonElement>('[aria-label="Close"]')
      if (!close) throw new Error("El modal de atajos no tiene botón de cierre")
      await act(async () => {
        close.click()
      })
      await waitFor(() => (document.querySelector('[data-testid="display-modal"]') ? null : true), {
        label: "el modal de atajos se cierra",
      })
      await w.enter()
      const reopened = await waitFor(() => document.querySelector('[data-testid="display-modal"]'), {
        label: "el modal de atajos se reabre desde Markdown",
      })
      expect(reopened.textContent, "el modal reabierto es el de atajos").toContain("Keyboard shortcuts")
    },
  },
  newWriting: {
    entry: shortcut("n", "KeyN"),
    runtime: "desktop",
    rich: async (w) => {
      const tabsBefore = getEditorSessionState().session.tabs.length
      await w.enter()
      await waitFor(() => getEditorSessionState().session.tabs.length === tabsBefore + 1, {
        label: "se abre una pestaña nueva",
      })
      const { session } = getEditorSessionState()
      expect(session.active_tab_id, "la pestaña nueva queda activa").toBe(EDITOR_DRAFT_TAB_ID)
    },
    markdown: async (w) => {
      // La pasada de Rich dejó la pestaña borrador activa. ⌘N otra vez en
      // Markdown reutiliza esa pestaña (no duplica) y rota su identidad
      // efímera: ese cambio de identidad es el efecto observable del comando.
      const draftBefore = getEditorSessionState().session.tabs.find(
        (tab) => tab.id === EDITOR_DRAFT_TAB_ID,
      )
      expect(draftBefore, "control: Rich dejó la pestaña borrador abierta").toBeTruthy()
      const tabsBefore = getEditorSessionState().session.tabs.length
      await w.enter()
      await waitFor(
        () => {
          const { session } = getEditorSessionState()
          const draft = session.tabs.find((tab) => tab.id === EDITOR_DRAFT_TAB_ID)
          return session.active_tab_id === EDITOR_DRAFT_TAB_ID &&
            draft?.draft_writing_id !== draftBefore?.draft_writing_id
            ? draft
            : null
        },
        { label: "⌘N desde Markdown abre un borrador nuevo" },
      )
      expect(getEditorSessionState().session.tabs.length, "reutiliza la pestaña borrador").toBe(tabsBefore)
    },
  },
  settings: {
    entry: shortcut(",", "Comma"),
    rich: navigatesTo("/settings"),
    markdown: navigatesTo("/settings"),
  },

  /* --- Solo menú nativo (desktop) --- */
  clearStyles: {
    entry: menu("clearStyles"),
    runtime: "desktop",
    rich: async (w) => {
      await w.selectRichText("bravo")
      await w.press(shortcut("b", "KeyB"))
      expect(markTypes(w.json()), "control: la marca existe antes de limpiar").toContain("bold")
      await w.enter()
      expect(markTypes(w.json()), "clearStyles quita las marcas").not.toContain("bold")
    },
    markdown: async (w) => {
      // ODE-632: ver el `it.fails` de la familia.
      const before = w.markdownValue()
      await w.enter()
      expect(w.markdownValue(), "clearStyles no tiene rama en Markdown").toBe(before)
    },
  },
  copyAsMarkdown: {
    entry: menu("copyAsMarkdown"),
    runtime: "desktop",
    rich: async (w) => {
      await w.enter()
      await waitFor(() => clipboardWrites.length > 0, { label: "el Markdown llega al portapapeles" })
      expect(clipboardWrites.at(-1), "el portapapeles lleva el documento").toContain(TEXT_A)
    },
    markdown: async (w) => {
      // ODE-632: ver el `it.fails` de la familia.
      const writesBefore = clipboardWrites.length
      await w.enter()
      await flush(2)
      expect(clipboardWrites.length, "copyAsMarkdown no tiene rama en Markdown").toBe(writesBefore)
    },
  },
  copyAsHtml: {
    entry: menu("copyAsHtml"),
    runtime: "desktop",
    rich: async (w) => {
      await w.enter()
      await waitFor(() => clipboardWrites.length > 0, { label: "el HTML llega al portapapeles" })
      expect(clipboardWrites.at(-1), "el portapapeles lleva el HTML").toContain("<p>")
    },
    markdown: async (w) => {
      // ODE-632: ver el `it.fails` de la familia.
      const writesBefore = clipboardWrites.length
      await w.enter()
      await flush(2)
      expect(clipboardWrites.length, "copyAsHtml no tiene rama en Markdown").toBe(writesBefore)
    },
  },
  date: {
    entry: menu("date"),
    runtime: "desktop",
    rich: async (w) => {
      await w.enter()
      await waitFor(() => (w.text().includes(todayIsoDate()) ? true : null), {
        label: "la fecha se inserta en Rich",
      })
    },
    markdown: async (w) => {
      // ODE-632: ver el `it.fails` de la familia.
      const before = w.markdownValue()
      await w.enter()
      expect(w.markdownValue(), "date no tiene rama en Markdown").toBe(before)
    },
  },
  toggleTopbar: {
    entry: menu("toggleTopbar"),
    runtime: "desktop",
    rich: async (w) => {
      expect(document.querySelector('[data-testid="editor-topbar"]'), "control: la topbar existe").toBeTruthy()
      await w.enter()
      await waitFor(() => (document.querySelector('[data-testid="editor-topbar"]') ? null : true), {
        label: "la topbar se oculta",
      })
    },
    markdown: async (w) => {
      expect(
        document.querySelector('[data-testid="editor-topbar"]'),
        "control: Rich ocultó la topbar",
      ).toBeFalsy()
      await w.enter()
      await waitFor(() => document.querySelector('[data-testid="editor-topbar"]'), {
        label: "la topbar vuelve desde Markdown",
      })
    },
  },
  toggleTabBar: {
    entry: menu("toggleTabBar"),
    runtime: "desktop",
    rich: async (w) => {
      expect(document.querySelector("[data-editor-tab-id]"), "control: la barra de pestañas existe").toBeTruthy()
      await w.enter()
      await waitFor(() => (document.querySelector("[data-editor-tab-id]") ? null : true), {
        label: "la barra de pestañas se oculta",
      })
    },
    markdown: async (w) => {
      expect(
        document.querySelector("[data-editor-tab-id]"),
        "control: Rich ocultó la barra de pestañas",
      ).toBeFalsy()
      await w.enter()
      await waitFor(() => document.querySelector("[data-editor-tab-id]"), {
        label: "la barra de pestañas vuelve desde Markdown",
      })
    },
  },
} satisfies Record<EditorShortcutAction, CommandCase>

const COMMAND_ENTRIES = Object.entries(COMMAND_CASES) as Array<[EditorShortcutAction, CommandCase]>

/** Todo caso corre en ambos modos, en este orden. */
const COMMAND_MODES: readonly CommandMode[] = ["rich", "markdown"]

/* ------------------------------------------------------------------ *
 * Pruebas
 * ------------------------------------------------------------------ */

describe("ODE-603 — la red cubre la lista real de acciones", () => {
  it("cada acción que la ayuda de atajos enumera tiene su fila en la tabla", () => {
    // Control de completitud en runtime contra una lista de producción (la
    // ayuda no incluye las 6 acciones solo-menú, que el `satisfies` de tsc sí
    // exige). Si una acción nueva entra en la ayuda sin fila, esto se pone rojo.
    const listed = new Set(
      EDITOR_SHORTCUT_HELP_SECTIONS.flatMap((section) => section.items.map((item) => item.action)),
    )
    const missing = [...listed].filter((action) => !(action in COMMAND_CASES))
    expect(missing, "acciones de la ayuda sin caso en la red").toEqual([])
  })
})

describe("ODE-603 — red de comandos de la shell", () => {
  it.each(COMMAND_ENTRIES)(
    "%s",
    async (action, testCase) => {
      let commandWorld: CommandWorld | null = null

      for (const mode of COMMAND_MODES) {
        if (!commandWorld || testCase.freshMountPerMode) {
          if (commandWorld) {
            await mounted?.unmount()
            mounted = null
          }
          commandWorld =
            testCase.runtime === "desktop"
              ? await mountDesktopCommandWorld(action, testCase)
              : await mountWebCommandWorld(action, testCase)
          if (testCase.setup) {
            await testCase.setup(commandWorld)
          }
        }

        await commandWorld.setMode(mode)
        await testCase[mode](commandWorld)
      }

      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

/**
 * Bugs vigentes que la red encontró (ODE-632): comandos de documento que
 * existen en Rich y no tienen rama en Markdown. Entran por su entrada real en
 * modo Markdown y afirman el efecto que debería existir; hoy no existe, así
 * que van con `it.fails`. Cuando se arreglen, pasan a `it` y la tabla de
 * arriba —que fija el no-op actual— se actualiza en el mismo cambio.
 *
 * Los cuatro de menú nativo van en desktop porque su única entrada real es el
 * menú de la app.
 */
type KnownMarkdownGap = {
  action: EditorShortcutAction
  runtime?: "desktop"
  check: CommandCheck
}

const KNOWN_MARKDOWN_GAPS: KnownMarkdownGap[] = [
  {
    action: "codeBlock",
    check: async (w) => {
      await w.enter()
      expect(w.markdownValue(), "⌘⇧E debería insertar un bloque de código").toContain("```")
    },
  },
  {
    action: "horizontalRule",
    check: async (w) => {
      await w.enter()
      expect(w.markdownValue(), "⌘⇧- debería insertar una regla horizontal").toContain("---")
    },
  },
  {
    action: "clearStyles",
    runtime: "desktop",
    check: async (w) => {
      await w.selectMarkdownText("bravo")
      await w.press(shortcut("b", "KeyB"))
      expect(w.markdownValue(), "control: la marca existe antes de limpiar").toContain("**bravo**")
      await w.enter()
      expect(w.markdownValue(), "clearStyles debería limpiar la marca en Markdown").not.toContain("**bravo**")
    },
  },
  {
    action: "copyAsMarkdown",
    runtime: "desktop",
    check: async (w) => {
      await w.enter()
      expect(clipboardWrites.length, "copyAsMarkdown debería copiar también en Markdown").toBeGreaterThan(0)
    },
  },
  {
    action: "copyAsHtml",
    runtime: "desktop",
    check: async (w) => {
      await w.enter()
      expect(clipboardWrites.length, "copyAsHtml debería copiar también en Markdown").toBeGreaterThan(0)
    },
  },
  {
    action: "date",
    runtime: "desktop",
    check: async (w) => {
      await w.enter()
      expect(w.markdownValue(), "date debería insertar la fecha en Markdown").toContain(todayIsoDate())
    },
  },
]

describe("ODE-632 — comandos sin rama Markdown (bug vigente)", () => {
  it.fails.each(KNOWN_MARKDOWN_GAPS)(
    "$action",
    async (gap) => {
      const commandWorld =
        gap.runtime === "desktop"
          ? await mountDesktopCommandWorld(gap.action, COMMAND_CASES[gap.action])
          : await mountWebCommandWorld(gap.action, COMMAND_CASES[gap.action])
      await commandWorld.setMode("markdown")
      await gap.check(commandWorld)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-603 — handleBackupLocalImage por la shell (desktop)", () => {
  it(
    "el botón real de la imagen local abre el modal y 'Back up and replace' sustituye el src y lo persiste",
    async () => {
      const commandWorld = await mountDesktopCommandWorld("image", COMMAND_CASES.image)

      // La imagen local entra como entra el usuario: por el origen Markdown y
      // de vuelta a Rich, donde vive el node view con su botón de respaldo.
      await commandWorld.setMode("markdown")
      await commandWorld.appendMarkdown("\n![Foto local](foto-local.png)")
      await commandWorld.setMode("rich")

      const backupButton = await waitFor(
        () => document.querySelector<HTMLButtonElement>('button[aria-label="Back up image online"]'),
        { label: "botón de respaldo del node view" },
      )
      await act(async () => {
        backupButton.click()
      })
      const dialog = await waitFor(
        () => document.querySelector('[data-testid="backup-local-image-dialog"]'),
        { label: "modal de respaldo" },
      )
      expect(dialog.textContent, "el modal muestra el src local").toContain("foto-local.png")

      await clickButton("Back up and replace")
      await waitFor(() => (desktopAssetCalls.uploads.length === 1 ? true : null), {
        label: "la subida salió al boundary",
      })
      expect(desktopAssetCalls.uploads[0]?.writingId, "la subida va al documento activo").toBe(writingA)
      expect(desktopAssetCalls.uploads[0]?.fileName, "la subida lleva el archivo local").toBe("foto-local.png")

      await waitFor(() => (imageSources(commandWorld.json()).includes(ONLINE_BACKUP_URL) ? true : null), {
        label: "el src local se sustituye por el URL online",
      })
      await waitForAsync(
        async () => {
          const files = await readWorkspaceMarkdown()
          return files.some((file) => file.contents.includes(ONLINE_BACKUP_URL)) ? true : null
        },
        { label: "el .md del documento lleva el URL online", timeoutMs: 20_000 },
      )

      assertNoUnhandledErrors()
    },
    DESKTOP_TEST_TIMEOUT_MS,
  )
})
