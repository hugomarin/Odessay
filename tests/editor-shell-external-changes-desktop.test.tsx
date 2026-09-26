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
 *      conflicto; ninguna escritura pisa la edición externa sin elección, y
 *      cada botón deja disco y editor en el estado prometido.
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
const { holdCatalogReads, holdWriteFile, tauriOpenFileDouble, writeFileCalls } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
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
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "http://127.0.0.1:1")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY", "harness-anon-key")
  world.tauriInvoke = async (command, args) => {
    if (command === "open_file") return tauriOpenFileDouble(String(args?.path))
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
 * Arranca el reconciliador real, como `DesktopAppShell` al abrir la app, y
 * espera a que el watcher nativo cubra la carpeta de los documentos.
 */
async function startReconciler() {
  await ensureWorkspaceReconciler()
  const folder = documentsFolder()
  await waitFor(
    () => world.fsWatchers.some((watcher) => !watcher.closed && watcher.paths.some((path) => folder.startsWith(path) || path.startsWith(folder))),
    { label: "watcher nativo sobre la carpeta de documentos", timeoutMs: 10_000 },
  )
  // El arranque proyecta una primera pasada; que asiente antes del cambio.
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
  it(
    "WATCH-07 limpio: recarga sola el contenido externo y no escribe al disco",
    async () => {
      const subscriptions = await trackCatalogSubscriptions()
      const path = writeMarkdownFile("Carta limpia", "ODE599 version original.")
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 version original.")
      await startReconciler()
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
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 base sucia.")
      await startReconciler()

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

      // Más tecleo mientras el conflicto sigue abierto no guarda.
      await typeInEditor(" ODE599-MAS")
      await advance(800)
      expect(await readDisk(path), "el autosave queda en pausa").toBe("ODE599 externa sucia.\n")

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
    "WATCH-07 sucio: «Reload external» descarta la edición local y no escribe",
    async () => {
      const path = writeMarkdownFile("Carta recarga", "ODE599 base recarga.")
      await mountLoaded()
      await openFromNativeMenu(path, "ODE599 base recarga.")
      await startReconciler()

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
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 cuerpo borrado.")
      await startReconciler()
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
      await mountLoaded()
      const writingId = await openFromNativeMenu(path, "ODE599 cuerpo movido.")
      await startReconciler()

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
      await mountLoaded()
      const writingA = await openFromNativeMenu(pathA, "ODE599 cuerpo A.")
      const writingB = await openFromNativeMenu(pathB, "ODE599 cuerpo B.")
      await startReconciler()

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

describe("ODE-627 — caracterización: un autosave rechazado por CONFLICT antes del evento", () => {
  // BUG CONOCIDO, encontrado por esta red: ODE-627. Se deja como `it.fails`
  // para que el comportamiento correcto quede escrito y la red avise en cuanto
  // cambie. Al arreglar ODE-627 pasa a `it` sin tocar el cuerpo.
  //
  // Secuencia: el usuario teclea; el archivo cambia fuera justo antes del
  // autosave desktop (DESKTOP_PERSISTENCE_DEBOUNCE_MS = 4s); la guardia de hash
  // rechaza bien ese guardado (CONFLICT); el evento del watcher llega después
  // (300ms de delay + 250ms de coalesce). Hoy la shell ve el documento limpio
  // y recarga la externa: el texto tecleado se pierde sin banner.
  it.fails(
    "la edición local rechazada sigue contando como sucia: banner de conflicto, sin recarga",
    async () => {
      const path = writeMarkdownFile("Carta rechazada", "ODE599 base rechazada.")
      await mountLoaded()
      await openFromNativeMenu(path, "ODE599 base rechazada.")
      await startReconciler()

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
