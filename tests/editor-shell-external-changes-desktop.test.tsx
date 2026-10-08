/**
 * @vitest-environment happy-dom
 *
 * ODE-599 — la red del corte 3b: la reacción de la shell a cambios externos
 * del documento abierto (WATCH-07, avisos de borrado y de movimiento) y la
 * guardia de cierre de ventana, probadas A TRAVÉS de la shell montada.
 *
 * Properties:
 *   1. WATCH-07 limpio: un cambio externo del contenido llega a la shell y el
 *      editor muestra la versión nueva sin intervención y sin escribir al disco.
 *   2. WATCH-07 sucio: con una edición pendiente, aparece el banner de
 *      conflicto; ninguna escritura pisa la edición externa sin elección, ni
 *      se intenta siquiera mientras el conflicto sigue abierto, y cada botón
 *      deja disco y editor en el estado prometido.
 *   3. Borrado y movimiento externos: aparece el aviso, una vez por evento, y
 *      la pestaña conserva la identidad del documento.
 *   4. Un cambio de pestaña entre el evento y su resolución no aplica el
 *      cambio de A sobre el documento B.
 *   5. Cerrar la ventana espera el guardado pendiente: el texto tecleado justo
 *      antes de cerrar llega al disco antes de `destroy()`.
 *
 * Runtime: **desktop** (el watcher, el catálogo SQLite y la ventana nativa
 * solo existen ahí).
 *
 * Camino de producción: el archivo cambia en el disco real → el watcher
 * nativo entrega el evento (`plugin:fs|watch`, doblado: es transporte del SO)
 * → la supresión de auto-escrituras real → el WorkspaceReconciler real
 * (`ensureWorkspaceReconciler`, el mismo singleton que monta
 * `DesktopAppShell`) → `workspace_sync` sobre el disco real → `reconcileRoot`
 * → `SqliteDocumentCatalog.applyReconcileTransaction` → `CatalogChange` con
 * razón `bulk` → la suscripción de la shell → `resolveExternalContentChange`
 * → editor/banner. El documento se abre por el menú nativo con el opener
 * unificado real, que registra su carpeta como BindingRoot; la shell no se
 * siembra por dentro.
 *
 * Orden de producción: el reconciliador arranca ANTES del Open File, como en
 * `DesktopAppShell` al abrir la app. El opener refresca el watcher tras
 * registrar la carpeta (ODE-628), así que la cadena llega a la shell sin
 * reiniciar el reconciliador.
 *
 * ODE-638: el caso de la guarda retiene la lectura del catálogo del evento
 * externo y el rAF del tecleo, de modo que la decisión de conflicto ve la
 * edición local antes de su hand-off a `PersistenceCoordinator`; el trabajo
 * agendado se drena después y la espera cruza el debounce durable completo
 * (150 ms + 4 s). El observable es el contador de intentos de `write_file`
 * del doble canónico, más la ausencia de `Saving...`/`Needs attention`; «Keep
 * my version» es el control positivo.
 *
 * Completion events: el texto del `.md` en el disco real y el DOM (editor,
 * banner, aviso). Nunca "se llamó a X".
 *
 * Dobles que NO son del SO, declarados: ninguno nuevo. Los comandos del
 * catálogo y de `workspace_sync` son los espejos de `real-desktop-doubles.ts`
 * (canonical owner); esta prueba activa los dos del reconciliador con
 * `tauriCommandsDouble({ withReconciler: true })`.
 *
 * Gap conocido del harness: `tauri-commands` está doblado entero, así que la
 * marca de auto-escritura (`markOdessaySelfWritePath`) nunca se pone. No
 * cambia estas pruebas —los cambios que emiten son externos— pero ninguna
 * prueba aquí demuestra la supresión de los eventos propios.
 *
 * Mutation tests (ODE-599, en vivo, antes del movimiento): quitar el banner,
 * forzar la recarga en sucio y resolver la guardia sin esperar ponen en rojo
 * la prueba correspondiente. Ver el PR.
 */
import { mkdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

import { act } from "react"
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
vi.mock("@tauri-apps/api/window", async () =>
  (await import("./support/editor-shell-doubles")).tauriWindowDouble(),
)
vi.mock("@tauri-apps/plugin-dialog", async () =>
  (await import("./support/editor-shell-doubles")).tauriDialogDouble(),
)
vi.mock("@/lib/services/desktop/runtime-detection", async () =>
  (await import("./support/editor-shell-doubles")).runtimeDetectionDouble(),
)
vi.mock("@tauri-apps/plugin-shell", () => ({ open: vi.fn(async () => {}) }))
vi.mock("@/lib/services/ai-service-factory", async () =>
  (await import("./support/editor-shell-doubles")).aiServiceDouble(),
)
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble({ withReconciler: true }),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  assertNoUnhandledErrors,
  emitFsWatchEvent,
  emitTauriEvent,
  flush,
  holdAnimationFrames,
  mountEditorShell,
  pointerClick,
  requestWindowClose,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
} = await import("./support/editor-shell-harness")
const { world } = await import("./support/editor-shell-doubles")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const {
  doubleRaceNextWriteFile,
  holdCatalogReads,
  holdWriteFile,
  tauriOpenFileDouble,
  writeFileCalls,
} = await import("./integration/documents/support/real-desktop-doubles")
const { open: tauriShellOpen } = await import("@tauri-apps/plugin-shell")
const { disposeWorkspaceReconciler, ensureWorkspaceReconciler } = await import(
  "@/lib/services/desktop/desktop-workspace-reconciler"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")

const TEST_TIMEOUT_MS = 60_000

const CONFLICT_BANNER = "This file changed outside Artifact Studio while you had unsaved edits here"
const RELOADED_NOTICE = "Updated externally"
const DELETED_NOTICE = "This file was removed outside Artifact Studio"
const MOVED_NOTICE = "This file moved outside Artifact Studio"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let alerts: string[] = []

beforeAll(() => {
  createDesktopWorkspace("odessay-external-changes-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  vi.mocked(tauriShellOpen).mockClear()
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
  world.tauriInvoke = async (command, args) => {
    if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
    if (command === "set_editor_menu_availability") return undefined
    throw new Error(`Comando nativo no previsto en esta prueba: ${command}`)
  }
  // Una carpeta fuera de todo BindingRoot pide consentimiento (ODE-375): se
  // acepta, como haría el usuario.
  vi.spyOn(window, "confirm").mockReturnValue(true)
  alerts = []
  window.alert = (message?: unknown) => {
    alerts.push(String(message))
  }
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
  // El reconciliador es un singleton de módulo, como en la app: se desmonta
  // entre pruebas para que el siguiente arranque lea las raíces de esa prueba.
  await disposeWorkspaceReconciler()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
})

/* ------------------------------------------------------------------ *
 * Escenario
 * ------------------------------------------------------------------ */

function documentsFolder() {
  const folder = join(desktopWorkspaceRoot(), "Documentos")
  mkdirSync(folder, { recursive: true })
  return folder
}

/** Escribe un `.md` real en la carpeta del workspace temporal y devuelve su ruta. */
function writeMarkdownFile(title: string, body: string) {
  const path = join(documentsFolder(), `${title}.md`)
  writeFileSync(path, `${body}\n`)
  return path
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id) ?? null
}

function editorText() {
  return mounted!.editor().getText()
}

function bannerText() {
  return mounted!.container.textContent ?? ""
}

function markdownSource() {
  return mounted!.container.querySelector<HTMLTextAreaElement>('textarea[aria-label="Markdown source"]')
}

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

async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
}

/** "Open File" del menú nativo, eligiendo `path` en el diálogo. Devuelve la identidad abierta. */
async function openFromNativeMenu(path: string, body: string) {
  world.openDialogResult = path
  await emitTauriEvent("menu:open-file")
  await flush(5)
  await waitFor(() => alerts.length > 0 || editorText().includes(body), {
    label: `documento abierto: ${body}`,
    timeoutMs: 15_000,
  })
  if (alerts.length > 0) throw new Error(`El opener no abrió ${path}: ${alerts.join(" | ")}`)
  await flush(3)
  const writingId = activeTab()?.writing_id
  if (!writingId) throw new Error(`${path} abrió sin identidad`)
  // La primera lectura del catálogo siembra la línea base del hash; un cambio
  // anterior a ella no sería "externo" para la shell.
  await advance(50)
  return writingId
}

/**
 * Arranca el reconciliador real como `DesktopAppShell`: al abrir la app, ANTES
 * de cualquier Open File. Así la prueba recorre el orden de producción; un
 * arranque posterior al registro del BindingRoot sería un reinicio de la app,
 * no la sesión en la que el usuario abrió el archivo (NON_PRODUCTION_PATH).
 */
async function startReconciler() {
  await ensureWorkspaceReconciler()
  // El arranque proyecta una primera pasada; que asiente antes de abrir.
  await advance(100)
}

/** ¿Hay un watcher nativo vivo que cubra `folder`? */
function watcherCovers(folder: string) {
  return world.fsWatchers.some(
    (watcher) =>
      !watcher.closed && watcher.paths.some((path) => folder.startsWith(path) || path.startsWith(folder)),
  )
}

/**
 * Tras el Open File, espera a que el watcher nativo cubra la carpeta del
 * BindingRoot externo recién registrado, sin reiniciar el reconciliador.
 */
async function waitForWatcherOnDocuments() {
  const folder = documentsFolder()
  await waitFor(() => watcherCovers(folder), {
    label: "watcher nativo sobre la carpeta de documentos",
    timeoutMs: 10_000,
  })
  await advance(100)
}

/** Espera a que el reconciliador (coalesce de 250ms) proyecte y la shell reaccione. */
async function waitForShell<T>(predicate: () => T | null | undefined | false, label: string) {
  return waitFor(predicate, { label, timeoutMs: 10_000 })
}

async function readDisk(path: string) {
  return readFile(path, "utf8")
}

function writesTo(path: string) {
  return writeFileCalls().filter((call) => call.path === path)
}

function findButton(label: string) {
  return Array.from(mounted!.container.querySelectorAll("button")).find(
    (candidate) => (candidate.textContent ?? "").trim() === label,
  )
}

/** Pulsa un botón del banner (los `Button` escuchan `click`, no el gesto de puntero de las pestañas). */
async function clickButton(label: string) {
  const button = findButton(label)
  if (!button) throw new Error(`No hay botón "${label}"`)
  await act(async () => {
    button.click()
  })
  await flush(3)
}

/** La etiqueta de guardado que la barra de estado renderiza ahora mismo. */
function saveStateLabel() {
  return (
    mounted!.container
      .querySelector<HTMLElement>('[data-testid="editor-statusbar"] p[aria-live="polite"]')
      ?.textContent?.trim() ?? ""
  )
}

/**
 * Registra cada etiqueta de guardado distinta que la shell commitea, para
 * probar que una ausencia ("nunca apareció Saving/Needs attention") no se
 * apoya en una lectura que cayó entre dos transiciones.
 */
function trackSaveStateLabels() {
  const seen = new Set<string>()
  seen.add(saveStateLabel())
  world.onShellCommit = () => {
    seen.add(saveStateLabel())
  }
  return () => [...seen]
}

async function beginKeptVersionDoubleRace(input: {
  fileTitle: string
  conflictId: string
  secondExternalContent: string
  keepBesideFails?: boolean
}) {
  const path = writeMarkdownFile(input.fileTitle, "ODE593 base.")
  await startReconciler()
  await mountLoaded()
  await openFromNativeMenu(path, "ODE593 base.")
  await waitForWatcherOnDocuments()

  const race = doubleRaceNextWriteFile((candidate) => candidate === path, {
    conflictId: input.conflictId,
    secondExternalContent: input.secondExternalContent,
    keepBesideFails: input.keepBesideFails,
  })
  await typeInEditor(" ODE593-LOCAL")
  await race.started

  // The double has verified the baseline hash and is held in Rust's atomic
  // commit window; deliver the competing filesystem edit before releasing it.
  writeFileSync(path, "ODE593 external 1.\n")
  await emitFsWatchEvent([path])
  await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "banner WATCH-07 durante la carrera")
  race.release()

  const noticeText = input.keepBesideFails ? "The other version couldn't be saved." : `.conflict-${input.conflictId}`
  await waitForShell(() => bannerText().includes(noticeText), "aviso ODE-593 en el banner")
  return {
    path,
    keptPath: `${path}.conflict-${input.conflictId}`,
    tmpPath: `${path}.tmp`,
  }
}

/** Cuenta los commits de la shell en que el aviso pasa de ausente a presente. */
function countNoticeAppearances(text: string) {
  let visible = bannerText().includes(text)
  let appearances = 0
  world.onShellCommit = () => {
    const now = bannerText().includes(text)
    if (now && !visible) appearances += 1
    visible = now
  }
  return () => appearances
}

/** Cuenta las lecturas de la fila de `writingId` en el catálogo real. */
async function countCatalogReads(writingId: string) {
  const catalog = await getDocumentCatalog()
  const getById = vi.spyOn(catalog, "getById")
  return () => getById.mock.calls.filter(([id]) => id === writingId).length
}

/** Suscripciones vivas al catálogo real (patrón de `trackSyncListeners`). */
async function trackCatalogSubscriptions() {
  const catalog = await getDocumentCatalog()
  let live = 0
  const original = catalog.subscribe.bind(catalog)
  vi.spyOn(catalog, "subscribe").mockImplementation((listener) => {
    live += 1
    const unsubscribe = original(listener)
    return () => {
      live -= 1
      unsubscribe()
    }
  })
  return () => live
}

/* ------------------------------------------------------------------ *
 * Pruebas
 * ------------------------------------------------------------------ */

describe("ODE-599 — la shell reacciona a cambios externos del documento abierto", () => {
  // Estas seis encontraron ODE-628 al seguir el orden de producción: el
  // BindingRoot externo de un Open File no tenía watcher hasta reiniciar. Eran
  // `it.fails`; con el fix pasaron a `it` sin tocar el cuerpo.
  it(
    "WATCH-07 limpio: recarga sola el contenido externo y no escribe al disco",
    async () => {
      const subscriptions = await trackCatalogSubscriptions()
      const path = writeMarkdownFile("Carta limpia", "ODE599 version original.")
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 version original.")
      await waitForWatcherOnDocuments()
      const liveSubscriptions = subscriptions()
      expect(liveSubscriptions, "control positivo: la shell escucha el catálogo").toBeGreaterThan(0)

      const reads = await countCatalogReads(writingId)
      const writesBefore = writesTo(path).length
      const appearances = countNoticeAppearances(RELOADED_NOTICE)
      writeFileSync(path, "ODE599 version externa.\n")
      await emitFsWatchEvent([path])

      await waitForShell(() => editorText().includes("ODE599 version externa."), "el editor muestra la versión externa")
      await waitForShell(() => bannerText().includes(RELOADED_NOTICE), "aviso de recarga")
      expect(editorText()).not.toContain("ODE599 version original.")
      expect(bannerText(), "sin conflicto: no había edición local").not.toContain(CONFLICT_BANNER)
      expect(activeTab()?.writing_id, "misma identidad").toBe(writingId)

      // Más allá de cualquier debounce de guardado: la recarga no escribe.
      await advance(800)
      expect(await readDisk(path)).toBe("ODE599 version externa.\n")
      expect(writesTo(path).length, "la recarga no dispara ninguna escritura").toBe(writesBefore)
      expect(appearances(), "un aviso por evento").toBe(1)
      // Una lectura por consumidor del evento: la suscripción del documento
      // activo y el refresco de pestañas de `useWorkspaceTabs` (ver el caso de
      // borrado). Un montaje doble de la suscripción lo subiría a tres.
      expect(reads(), "una lectura por consumidor y evento").toBe(2)
      expect(subscriptions(), "el evento no suma suscripciones").toBe(liveSubscriptions)
      world.onShellCommit = null
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "WATCH-07 sucio: banner de conflicto, ninguna escritura pisa la externa, y «Keep my version» escribe la del usuario",
    async () => {
      const path = writeMarkdownFile("Carta sucia", "ODE599 base sucia.")
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 base sucia.")
      await waitForWatcherOnDocuments()

      // Una edición local en vuelo: el guardado llega al disco lento y queda
      // retenido, así que hay edición pendiente cuando llega el cambio externo.
      const held = holdWriteFile((candidate) => candidate === path)
      await typeInEditor(" ODE599-LOCAL")
      await held.started
      expect(editorText()).toContain("ODE599-LOCAL")

      writeFileSync(path, "ODE599 externa sucia.\n")
      await emitFsWatchEvent([path])
      await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "banner de conflicto")
      expect(findButton("Reload external"), "acción: cargar la externa").toBeTruthy()
      expect(findButton("Keep my version"), "acción: conservar la mía").toBeTruthy()
      expect(editorText(), "nunca se recarga sobre la edición local").toContain("ODE599-LOCAL")

      // El guardado que ya estaba en vuelo llega tarde: la guardia de hash lo
      // rechaza. Control positivo: la escritura con el texto del usuario sí
      // llegó al disco (al doble), así que la ausencia es de la guardia.
      held.release()
      await advance(800)
      expect(
        writesTo(path).some((call) => call.content.includes("ODE599-LOCAL")),
        "control positivo: la app intentó escribir la edición local",
      ).toBe(true)
      expect(await readDisk(path), "sin elección, el disco conserva la externa").toBe("ODE599 externa sucia.\n")
      expect(bannerText(), "el conflicto sigue abierto hasta elegir").toContain(CONFLICT_BANNER)

      // Más tecleo mientras el conflicto sigue abierto no guarda. La espera
      // cruza el debounce durable de desktop (150 ms + 4 s): con la guarda de
      // la shell no hay ni un intento de escritura nuevo que el disco pueda
      // enmascarar.
      const writesUnderConflict = writesTo(path).length
      await typeInEditor(" ODE599-MAS")
      await advance(4_500)
      expect(await readDisk(path), "el autosave queda en pausa").toBe("ODE599 externa sucia.\n")
      expect(
        writesTo(path).length,
        "la guarda de la shell frena el intento, no solo el hash del coordinator",
      ).toBe(writesUnderConflict)

      await clickButton("Keep my version")
      await waitForShellDisk(path, "ODE599-MAS")
      const saved = await readDisk(path)
      expect(saved, "«Keep my version» escribe la versión del usuario").toContain("ODE599-LOCAL")
      expect(saved).toContain("ODE599-MAS")
      expect(saved).not.toContain("ODE599 externa sucia.")
      expect(bannerText()).not.toContain(CONFLICT_BANNER)
      expect(activeTab()?.writing_id).toBe(writingId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "WATCH-07 sucio: la guarda no intenta persistir mientras el conflicto está sin decidir",
    async () => {
      const path = writeMarkdownFile("Carta guardada", "ODE638 base.")
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE638 base.")
      await waitForWatcherOnDocuments()

      const writesBefore = writesTo(path).length
      const initialSaveState = saveStateLabel()
      expect(initialSaveState, "control positivo: la barra de estado está montada").not.toBe("")
      const labels = trackSaveStateLabels()

      // El cambio externo llega y su lectura de la fila queda retenida: la
      // decisión de conflicto todavía no corrió cuando el usuario teclea.
      const gate = holdCatalogReads((idOrPath) => idOrPath === writingId)
      writeFileSync(path, "ODE638 externa.\n")
      await emitFsWatchEvent([path])
      await waitForShell(() => gate.hits() > 0, "lectura de la fila retenida")

      // El trabajo diferido del tecleo (rAF → debounce de 150 ms) sigue en
      // cola: el hand-off a `PersistenceCoordinator` no ocurrió aún, así que
      // la decisión marca el conflicto con la edición todavía sin persistir.
      const frames = holdAnimationFrames()
      await typeInEditor(" ODE638-LOCAL")
      gate.release()
      await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "banner de conflicto")

      // Se drena el trabajo agendado. Con la guarda, el hand-off se rechaza;
      // sin ella, agenda un guardado que dispara en el debounce durable.
      await frames.flush()
      frames.restore()

      // Más tecleo y el debounce durable completo (150 ms + 4 s).
      await typeInEditor(" ODE638-MAS")
      await advance(4_500)

      expect(writesTo(path).length, "la guarda evita incluso intentar escribir").toBe(writesBefore)
      expect(await readDisk(path), "el disco conserva la versión externa").toBe("ODE638 externa.\n")
      expect(editorText(), "el editor conserva su copia local").toContain("ODE638-LOCAL")
      expect(editorText()).toContain("ODE638-MAS")
      expect(bannerText(), "el aviso sigue abierto").toContain(CONFLICT_BANNER)
      expect(findButton("Reload external"), "acción: cargar la externa").toBeTruthy()
      expect(findButton("Keep my version"), "acción: conservar la mía").toBeTruthy()
      expect(labels(), "ninguna transición a Saving ni Needs attention").toEqual([initialSaveState])
      expect(bannerText()).not.toContain("Saving...")
      expect(bannerText()).not.toContain("Needs attention")

      // Control positivo: la decisión explícita sí recorre el guardado entero.
      await clickButton("Keep my version")
      await waitForShellDisk(path, "ODE638-MAS")
      const saved = await readDisk(path)
      expect(saved, "«Keep my version» escribe la versión del usuario").toContain("ODE638-LOCAL")
      expect(saved).toContain("ODE638-MAS")
      expect(saved).not.toContain("ODE638 externa.")
      expect(writesTo(path).length, "la elección explícita sí escribe").toBeGreaterThan(writesBefore)
      expect(bannerText()).not.toContain(CONFLICT_BANNER)
      expect(activeTab()?.writing_id).toBe(writingId)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-593: conserva y muestra la segunda versión externa, y Finder abre su carpeta",
    async () => {
      const { path, keptPath } = await beginKeptVersionDoubleRace({
        fileTitle: "Letter; draft",
        conflictId: "5930cafe",
        secondExternalContent: "ODE593 external 2.\n",
      })
      const keptName = "Letter; draft.md.conflict-5930cafe"

      expect(editorText(), "la edición del usuario permanece en el editor hasta que la elige").toContain("ODE593-LOCAL")
      expect(await readDisk(path), "el destino conserva la primera versión externa, sin la edición del usuario").toBe(
        "ODE593 external 1.\n",
      )
      expect(await readDisk(keptPath), "el archivo conservado contiene la segunda edición externa").toBe(
        "ODE593 external 2.\n",
      )
      expect(await readDisk(path)).not.toContain("ODE593-LOCAL")
      expect(bannerText()).toContain(CONFLICT_BANNER)
      expect(bannerText()).toContain(
        `This file was changed outside Artifact Studio. The other version was kept as ${keptName}.`,
      )

      const statusElements = Array.from(mounted!.container.querySelectorAll<HTMLElement>('[role="status"]'))
      const conflictBanner = statusElements.find((element) => element.textContent?.includes(CONFLICT_BANNER))
      const statusLine = statusElements.find((element) =>
        element.textContent?.startsWith("This file was changed outside Artifact Studio."),
      )
      expect(conflictBanner?.getAttribute("aria-live"), "el banner actual anuncia el cambio").toBe("polite")
      expect(statusLine?.getAttribute("aria-live"), "la línea nueva anuncia el archivo conservado").toBe("polite")
      expect(findButton("Show in Finder"), "control positivo: la ruta conservada tiene acción Finder").toBeTruthy()

      const name = Array.from(mounted!.container.querySelectorAll<HTMLElement>("[title]")).find(
        (element) => element.textContent === keptName && element.title === keptPath,
      )
      expect(name?.classList.contains("font-medium")).toBe(true)
      expect(name?.title, "la ruta completa queda en title").toBe(keptPath)

      await clickButton("Show in Finder")
      expect(vi.mocked(tauriShellOpen)).toHaveBeenCalledWith(documentsFolder())
      expect(bannerText(), "revelar la carpeta no resuelve el conflicto").toContain(keptName)

      await clickButton("Keep my version")
      await waitForShell(() => !bannerText().includes(CONFLICT_BANNER), "banner y línea retirados al conservar mi versión")
      expect(bannerText()).not.toContain(keptName)
      await waitForShellDisk(path, "ODE593-LOCAL")
      expect(await readDisk(path), "la edición del usuario solo llega al disco después de elegirla").toContain("ODE593-LOCAL")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-593: retira el aviso del documento anterior cuando otro documento entra en conflicto",
    async () => {
      const { keptPath } = await beginKeptVersionDoubleRace({
        fileTitle: "Carta A con copia",
        conflictId: "5930abca",
        secondExternalContent: "ODE593 A external 2.\n",
      })
      const keptName = keptPath.split(/[\\/]/).pop()!

      expect(bannerText(), "control positivo: A muestra su aviso conservado").toContain(keptName)

      const pathB = writeMarkdownFile("Carta B con conflicto propio", "ODE593 B base.")
      const writingIdB = await openFromNativeMenu(pathB, "ODE593 B base.")
      await waitForWatcherOnDocuments()
      expect(activeTab()?.writing_id).toBe(writingIdB)

      const held = holdWriteFile((candidate) => candidate === pathB)
      await typeInEditor(" ODE593-B-LOCAL")
      await held.started
      writeFileSync(pathB, "ODE593 B external.\n")
      await emitFsWatchEvent([pathB])
      await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "conflicto propio del documento B")

      held.release()
      await advance(800)
      expect(await readDisk(pathB), "el conflicto de B conserva su versión externa").toBe("ODE593 B external.\n")
      expect(editorText()).toContain("ODE593-B-LOCAL")
      expect(bannerText()).toContain(CONFLICT_BANNER)
      expect(bannerText(), "el aviso conservado de A no aparece dentro del conflicto de B").not.toContain(keptName)

      await clickButton("Reload external")
      await waitForShell(() => !bannerText().includes(CONFLICT_BANNER), "conflicto de B retirado")
      expect(bannerText()).not.toContain(keptName)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-593: informa si keep_beside no conserva la otra versión y no ofrece Finder",
    async () => {
      const { path, tmpPath } = await beginKeptVersionDoubleRace({
        fileTitle: "Carta fallo de conservación",
        conflictId: "5930bad0",
        secondExternalContent: "ODE593 external 2.\n",
        keepBesideFails: true,
      })

      expect(editorText(), "la edición del usuario permanece en el editor tras el rechazo").toContain("ODE593-LOCAL")
      expect(await readDisk(path), "el destino conserva la primera versión externa tras el fallo").toBe(
        "ODE593 external 1.\n",
      )
      expect(await readDisk(tmpPath), "la segunda versión externa permanece en el temporal tras el fallo de keep_beside").toBe(
        "ODE593 external 2.\n",
      )
      expect(await readDisk(path)).not.toContain("ODE593-LOCAL")
      expect(bannerText()).toContain(
        "This file was changed outside Artifact Studio. The other version couldn't be saved.",
      )
      expect(findButton("Show in Finder"), "el fallo no proporciona una ruta conservada junto al destino").toBeFalsy()

      await clickButton("Reload external")
      await waitForShell(() => !bannerText().includes(CONFLICT_BANNER), "banner y línea retirados al recargar")
      expect(bannerText()).not.toContain("The other version couldn't be saved.")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "WATCH-07 sucio: «Reload external» descarta la edición local y no escribe",
    async () => {
      const path = writeMarkdownFile("Carta recarga", "ODE599 base recarga.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE599 base recarga.")
      await waitForWatcherOnDocuments()

      const held = holdWriteFile((candidate) => candidate === path)
      await typeInEditor(" ODE599-DESCARTAR")
      await held.started
      writeFileSync(path, "ODE599 externa recarga.\n")
      await emitFsWatchEvent([path])
      await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "banner de conflicto")
      held.release()
      await advance(300)

      const writesBefore = writesTo(path).length
      await clickButton("Reload external")
      await waitForShell(() => editorText().includes("ODE599 externa recarga."), "el editor carga la externa")
      expect(editorText(), "la edición local se descarta").not.toContain("ODE599-DESCARTAR")
      expect(bannerText()).not.toContain(CONFLICT_BANNER)
      expect(bannerText()).toContain(RELOADED_NOTICE)

      await advance(800)
      expect(await readDisk(path), "cargar la externa no reescribe el disco").toBe("ODE599 externa recarga.\n")
      expect(writesTo(path).length, "ninguna escritura tras elegir la externa").toBe(writesBefore)

      // Control positivo: la shell vuelve a guardar con normalidad sobre la externa.
      await typeInEditor(" ODE599-DESPUES")
      await waitForShellDisk(path, "ODE599-DESPUES")
      expect(await readDisk(path)).toContain("ODE599 externa recarga.")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "borrado externo: aviso una vez, el contenido sigue abierto y la pestaña conserva la identidad",
    async () => {
      const path = writeMarkdownFile("Carta borrada", "ODE599 cuerpo borrado.")
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 cuerpo borrado.")
      await waitForWatcherOnDocuments()
      const tabsBefore = getEditorSessionState().session.tabs.filter((tab) => tab.writing_id === writingId).length
      expect(tabsBefore, "control positivo: una pestaña para el documento").toBe(1)

      const reads = await countCatalogReads(writingId)
      const appearances = countNoticeAppearances(DELETED_NOTICE)
      unlinkSync(path)
      await emitFsWatchEvent([path], { remove: { kind: "file" } })
      await waitForShell(() => bannerText().includes(DELETED_NOTICE), "aviso de borrado")

      expect(editorText(), "el contenido sigue abierto").toContain("ODE599 cuerpo borrado.")
      expect(activeTab()?.writing_id, "misma identidad").toBe(writingId)
      expect(getEditorSessionState().session.tabs.filter((tab) => tab.writing_id === writingId).length).toBe(1)
      await advance(300)
      expect(appearances(), "un aviso por evento").toBe(1)
      // Dos consumidores del mismo evento, una lectura cada uno: la suscripción
      // del documento activo (la que mueve el corte 3b) y el refresco de estado
      // de pestañas de `useWorkspaceTabs`. Una tercera sería un montaje doble.
      expect(reads(), "una lectura por consumidor y evento").toBe(2)
      const record = await (await getDocumentCatalog()).getById(writingId)
      expect(record?.id, "la fila del catálogo es la misma").toBe(writingId)
      expect(record?.localPresent, "el catálogo registra la ausencia").toBe(false)
      world.onShellCommit = null
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "movimiento externo: aviso con la ruta nueva, una vez, y la misma identidad",
    async () => {
      const path = writeMarkdownFile("Carta movida", "ODE599 cuerpo movido.")
      await startReconciler()
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 cuerpo movido.")
      await waitForWatcherOnDocuments()

      const appearances = countNoticeAppearances(MOVED_NOTICE)
      const nextPath = join(documentsFolder(), "Carta renombrada.md")
      renameSync(path, nextPath)
      await emitFsWatchEvent([path, nextPath], { modify: { kind: "rename", mode: "both" } })
      await waitForShell(() => bannerText().includes(MOVED_NOTICE), "aviso de movimiento")

      expect(bannerText(), "el aviso nombra la ruta nueva").toContain(nextPath)
      expect(activeTab()?.writing_id, "misma identidad").toBe(writingId)
      expect(editorText()).toContain("ODE599 cuerpo movido.")
      const record = await (await getDocumentCatalog()).getById(writingId)
      expect(record?.binding?.canonicalPath, "el catálogo sigue al archivo").toBe(nextPath)
      await advance(300)
      expect(appearances(), "un aviso por evento").toBe(1)

      // La identidad sigue viva: lo que se teclea ahora va a la ruta nueva.
      await typeInEditor(" ODE599-TRAS-MOVER")
      await waitForShellDisk(nextPath, "ODE599-TRAS-MOVER")
      world.onShellCommit = null
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un cambio de pestaña entre el evento y su resolución no aplica el cambio de A sobre B",
    async () => {
      const pathA = writeMarkdownFile("Carta A", "ODE599 cuerpo A.")
      const pathB = writeMarkdownFile("Carta B", "ODE599 cuerpo B.")
      await startReconciler()
      await mountLoaded()
      const writingA = await openFromNativeMenu(pathA, "ODE599 cuerpo A.")
      const writingB = await openFromNativeMenu(pathB, "ODE599 cuerpo B.")
      await waitForWatcherOnDocuments()

      // Volver a A con el gesto real de la pestaña.
      const tabA = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingA)!
      await pointerClick(document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabA.id}"]`)!)
      await waitForShell(() => activeTab()?.writing_id === writingA && editorText().includes("ODE599 cuerpo A."), "A activo")
      await advance(100)

      // La lectura de la fila de A que dispara el evento queda retenida: el
      // evento llegó, su resolución todavía no.
      const gate = holdCatalogReads((idOrPath) => idOrPath === writingA)
      writeFileSync(pathA, "ODE599 externa A.\n")
      await emitFsWatchEvent([pathA])
      await waitForShell(() => gate.hits() > 0, "control positivo: la shell leyó la fila de A tras el evento")

      const tabB = getEditorSessionState().session.tabs.find((tab) => tab.writing_id === writingB)!
      await pointerClick(document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabB.id}"]`)!)
      await waitForShell(() => activeTab()?.writing_id === writingB && editorText().includes("ODE599 cuerpo B."), "B activo")

      gate.release()
      await advance(800)
      expect(activeTab()?.writing_id).toBe(writingB)
      expect(editorText(), "B conserva su contenido").toContain("ODE599 cuerpo B.")
      expect(editorText(), "el contenido externo de A no aterriza en B").not.toContain("ODE599 externa A.")
      expect(bannerText()).not.toContain(CONFLICT_BANNER)
      expect(bannerText(), "ningún aviso de A sobre B").not.toContain(RELOADED_NOTICE)
      // La ruta canónica que la shell sigue es la de B: un manejador rezagado de
      // A la compararía con la de A y anunciaría un "movimiento" falso.
      expect(bannerText(), "ningún movimiento falso de B hacia la ruta de A").not.toContain(MOVED_NOTICE)
      expect(bannerText()).not.toContain(pathA)
      expect(await readDisk(pathB), "el disco de B intacto").toBe("ODE599 cuerpo B.\n")
      expect(await readDisk(pathA), "el disco de A conserva la externa").toBe("ODE599 externa A.\n")

      // Control positivo: al volver a A, la shell muestra la versión externa.
      await pointerClick(document.querySelector<HTMLElement>(`[data-editor-tab-id="${tabA.id}"]`)!)
      await waitForShell(() => editorText().includes("ODE599 externa A."), "A muestra la externa al volver")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-540 — Source conserva su señal dirty cuando falla el autosave", () => {
  it(
    "no recarga sobre Source pendiente después de fallar la conversión de debounce",
    async () => {
      const path = writeMarkdownFile("Source dirty", "ODE540-DIRTY-BASE.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE540-DIRTY-BASE.")
      await waitForWatcherOnDocuments()

      const writingId = activeTab()?.writing_id
      if (!writingId) throw new Error("El documento Source no tiene identidad")
      await clickButton("Markdown")
      await typeInMarkdown(" ODE540-DIRTY-SOURCE")
      const writesBefore = writesTo(path).length

      // Dejar 100 ms hasta el debounce real de 800 ms; la falla única cae
      // dentro del parser desktop y el resto del flujo conserva sus seams.
      await advance(700)
      const domFailure = installOneShotDomAllocationFailure()
      await advance(1_000)
      domFailure.restore()
      expect(domFailure.didFail(), "la conversión desktop alcanzó el boundary DOM").toBe(true)
      expect(markdownSource()?.value).toContain("ODE540-DIRTY-SOURCE")
      expect(editorText()).not.toContain("ODE540-DIRTY-SOURCE")
      expect(bannerText()).toContain("Your Source text is still here and remains unsaved")

      // El intento fallido no envió snapshot al owner. Esperar más que el
      // debounce durable detecta cualquier fallback que consiguiera escribir.
      await advance(4_500)
      expect(writesTo(path).length, "no hay persistencia del respaldo").toBe(writesBefore)
      expect(await readDisk(path)).toBe("ODE540-DIRTY-BASE.\n")

      writeFileSync(path, "ODE540-EXTERNAL-AFTER-FAILURE.\n")
      await emitFsWatchEvent([path])
      await waitForShell(() => bannerText().includes(CONFLICT_BANNER), "la señal dirty protege el Source local")

      expect(activeTab()?.writing_id).toBe(writingId)
      expect(markdownSource()?.value, "el evento externo no reemplaza Source").toContain("ODE540-DIRTY-SOURCE")
      expect(editorText(), "Rich conserva el último snapshot confirmado").not.toContain("ODE540-EXTERNAL-AFTER-FAILURE")
      expect(await readDisk(path), "no se escribe encima de la versión externa").toBe(
        "ODE540-EXTERNAL-AFTER-FAILURE.\n",
      )
      expect(writesTo(path).length).toBe(writesBefore)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-540 — el cierre advierte cuando Source no se pudo convertir", () => {
  it(
    "cierra sin preguntar cuando no hay cambios Source sin guardar",
    async () => {
      const path = writeMarkdownFile("Source clean close", "ODE540-CLEAN-CLOSE.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE540-CLEAN-CLOSE.")

      const close = requestWindowClose()
      expect(close.prevented(), "el guard sigue siendo dueño del cierre").toBe(true)
      await act(async () => {
        await close.settled
      })

      expect(world.windowDestroyCalls, "el documento limpio cierra normalmente").toBe(1)
      expect(document.body.querySelector('[role="alertdialog"]'), "sin dirty no aparece una confirmación").toBeNull()
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "cancela el cierre por defecto y permite cerrar solo tras confirmar la pérdida de Source",
    async () => {
      const path = writeMarkdownFile("Source failed close", "ODE540-EXIT-BASE.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE540-EXIT-BASE.")
      await waitForWatcherOnDocuments()
      await clickButton("Markdown")
      await typeInMarkdown(" ODE540-EXIT-SOURCE")

      await advance(700)
      const domFailure = installOneShotDomAllocationFailure()
      await advance(1_000)
      domFailure.restore()
      expect(domFailure.didFail(), "la conversión falló en el parser desktop real").toBe(true)
      expect(markdownSource()?.value).toContain("ODE540-EXIT-SOURCE")
      expect(bannerText()).toContain("Your Source text is still here and remains unsaved")

      const firstClose = requestWindowClose()
      expect(firstClose.prevented()).toBe(true)
      const firstWarning = await waitFor(
        () => document.body.querySelector<HTMLElement>('[role="alertdialog"][aria-label="Unsaved Source changes"]'),
        { label: "confirmación de cierre para Source sin guardar", timeoutMs: 1_000 },
      )
      if (!firstWarning) throw new Error("No apareció la confirmación de cierre de Source")
      expect(firstWarning.textContent).toContain(
        "You have unsaved changes in Source that couldn't be converted. Close anyway?",
      )
      const keepEditing = Array.from(firstWarning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Keep editing",
      )
      const closeAnyway = Array.from(firstWarning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Close anyway",
      )
      expect(keepEditing, "Keep editing está disponible").toBeTruthy()
      expect(closeAnyway, "Close anyway está disponible").toBeTruthy()
      expect(document.activeElement, "Keep editing es la acción predeterminada").toBe(keepEditing)

      await act(async () => keepEditing!.click())
      await act(async () => {
        await firstClose.settled
      })
      expect(world.windowDestroyCalls, "Keep editing cancela el cierre").toBe(0)
      expect(markdownSource()?.value).toContain("ODE540-EXIT-SOURCE")

      const secondClose = requestWindowClose()
      const secondWarning = await waitFor(
        () => document.body.querySelector<HTMLElement>('[role="alertdialog"][aria-label="Unsaved Source changes"]'),
        { label: "segunda confirmación de cierre de Source", timeoutMs: 1_000 },
      )
      if (!secondWarning) throw new Error("No volvió a aparecer la confirmación de cierre")
      const confirmClose = Array.from(secondWarning.querySelectorAll<HTMLButtonElement>("button")).find(
        (button) => button.textContent?.trim() === "Close anyway",
      )
      if (!confirmClose) throw new Error('No está la acción "Close anyway"')
      await act(async () => confirmClose.click())
      await act(async () => {
        await secondClose.settled
      })

      expect(world.windowDestroyCalls, "Close anyway permite salir tras aviso explícito").toBe(1)
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-627 — regresión: un autosave rechazado por CONFLICT antes del evento", () => {
  // Regresión de ODE-627 (encontrado por esta red, arreglado en el
  // PersistenceCoordinator: un guardado fallido conserva la marca de contenido
  // sin confirmar). Era `it.fails`; pasó a `it` sin tocar el cuerpo. Con
  // ODE-628 arreglado usa el orden de producción, como las demás.
  //
  // Secuencia: el usuario teclea; el archivo cambia fuera justo antes del
  // autosave desktop (DESKTOP_PERSISTENCE_DEBOUNCE_MS = 4s); la guardia de hash
  // rechaza bien ese guardado (CONFLICT); el evento del watcher llega después
  // (300ms de delay + 250ms de coalesce). Antes del fix la shell veía el
  // documento limpio y recargaba la externa: el texto tecleado se perdía sin banner.
  it(
    "la edición local rechazada sigue contando como sucia: banner de conflicto, sin recarga",
    async () => {
      const path = writeMarkdownFile("Carta rechazada", "ODE599 base rechazada.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE599 base rechazada.")
      await waitForWatcherOnDocuments()

      await typeInEditor(" ODE627-LOCAL")
      await advance(3_700)
      writeFileSync(path, "ODE599 externa rechazada.\n")
      // Control positivo: el autosave se intentó con el texto del usuario y la
      // guardia lo rechazó — el disco sigue con la externa.
      await waitForShell(
        () => writesTo(path).some((call) => call.content.includes("ODE627-LOCAL")),
        "el autosave intentó escribir la edición local",
      )
      await advance(300)
      expect(await readDisk(path)).toBe("ODE599 externa rechazada.\n")

      await emitFsWatchEvent([path])
      await advance(1_500)
      expect(editorText(), "la edición local no se pierde").toContain("ODE627-LOCAL")
      expect(bannerText(), "el usuario elige").toContain(CONFLICT_BANNER)
    },
    TEST_TIMEOUT_MS,
  )
})

describe("ODE-599 — cerrar la ventana espera el guardado pendiente", () => {
  it(
    "el texto tecleado justo antes de cerrar llega al disco antes de destroy()",
    async () => {
      const path = writeMarkdownFile("Carta cierre", "ODE599 cuerpo cierre.")
      await startReconciler()
      await mountLoaded()
      await openFromNativeMenu(path, "ODE599 cuerpo cierre.")
      await waitForShell(() => world.windowCloseHandler, "la shell registró la guardia de cierre")

      const held = holdWriteFile((candidate) => candidate === path)
      await typeInEditor(" ODE599-ANTES-DE-CERRAR")
      // Sin esperar al debounce: el usuario cierra en el acto.
      const close = requestWindowClose()
      await held.started
      await advance(300)
      expect(close.prevented(), "la app retiene el cierre").toBe(true)
      expect(world.windowDestroyCalls, "no cierra con el guardado en vuelo").toBe(0)
      expect(await readDisk(path)).not.toContain("ODE599-ANTES-DE-CERRAR")

      held.release()
      await act(async () => {
        await close.settled
      })
      expect(world.windowDestroyCalls, "cierra una vez asentado").toBe(1)
      expect(await readDisk(path), "el texto llegó al disco").toContain("ODE599-ANTES-DE-CERRAR")
      assertNoUnhandledErrors()
    },
    TEST_TIMEOUT_MS,
  )
})

async function waitForShellDisk(path: string, needle: string, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if ((await readDisk(path)).includes(needle)) return
    await advance(100)
  }
  throw new Error(`${path} nunca contuvo ${JSON.stringify(needle)}: ${JSON.stringify(await readDisk(path))}`)
}
