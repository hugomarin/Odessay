/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-401/ODE-402 — "Guardar como" en desktop mueve el documento; no
 * lo copia.
 *
 * Property: cuando el usuario elige otra ruta con "Save As" (menú nativo), el
 * `.md` del documento se MUEVE ahí. Si el traslado sale bien, la pestaña toma
 * el nombre final (con sufijo si la ruta elegida ya existía) y no hay aviso.
 * Si falla, nada cambia: el título sigue siendo el del documento, no aparece
 * ninguna copia en el destino, el archivo original conserva el contenido y el
 * aviso muestra la ruta original, no la elegida.
 *
 * Reescrita sobre el harness en ODE-574, desde
 * `tests/editor-save-to-disk-relocate.test.tsx`, que montaba la shell con un
 * editor de cartón y ~40 dobles, incluido el propio servicio de traslado.
 * Aquí el traslado es el de producción (`relocateDesktopWriting`) sobre el fs
 * real del directorio temporal.
 *
 * Camino de producción: "New Artifact" real, escritura real, evento nativo
 * `menu:save-as` a través del bus de menú real, diálogo nativo doblado
 * (`world.saveDialogResult`) y traslado real en disco. El fallo es uno real:
 * la carpeta elegida es, en disco, un archivo, así que no se puede crear.
 *
 * Mutation test (ODE-574): adoptar la ruta elegida aunque el traslado falle
 * pone en rojo el caso de fallo; ignorar la ruta final devuelta por el
 * traslado (el sufijo de colisión) pone en rojo el de éxito.
 *
 * Fase 12 (R07): que el traslado vuelva a escribir su propia copia del
 * contenido (en vez de mover los bytes ya guardados por el camino canónico)
 * deja obsoleto el hash de referencia del coordinador: todo autosave posterior
 * falla con CONFLICT en silencio. Pone en rojo el caso "después del traslado".
 */
import { mkdir, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

const writeAheadTestControl = vi.hoisted(() => ({
  failNextSettingsWrite: null as string | null,
  missingCatalogId: null as string | null,
}))

vi.mock("@tiptap/react", async (importOriginal) => {
  const { createTiptapCaptureModule } = await import("./support/editor-shell-doubles")
  return createTiptapCaptureModule(await importOriginal<Record<string, unknown>>())
})
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
vi.mock("@/lib/editor/persistence-coordinator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/editor/persistence-coordinator")>()
  const { recordPersistenceCoordinator } = await import("./support/persistence-coordinator-capture")
  return {
    ...actual,
    createPersistenceCoordinator: (...args: Parameters<typeof actual.createPersistenceCoordinator>) => {
      const coordinator = actual.createPersistenceCoordinator(...args)
      recordPersistenceCoordinator(coordinator)
      return coordinator
    },
  }
})
vi.mock("@tauri-apps/api/path", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriPathDouble(),
)
vi.mock("@/lib/services/desktop/tauri-commands", async () => {
  const [{ tauriCommandsDouble }, { tauriWorkspaceSyncInvokeDouble }] = await Promise.all([
    import("./support/editor-shell-desktop-doubles"),
    import("./integration/documents/support/real-desktop-doubles"),
  ])
  const commands = tauriCommandsDouble({
    withReconciler: true,
  })
  const settingsWrite = commands.tauriSettingsWrite
  const catalogGetById = commands.tauriCatalogGetById
  return {
    ...commands,
    tauriWorkspaceSync: async (...args: Parameters<typeof commands.tauriWorkspaceSync>) =>
      args[3]?.mintUnbound === false
        ? tauriWorkspaceSyncInvokeDouble(args[0], args[1], args[2])
        : commands.tauriWorkspaceSync(...args),
    tauriSettingsWrite: async (...args: Parameters<typeof settingsWrite>) => {
      const message = writeAheadTestControl.failNextSettingsWrite
      if (message) {
        writeAheadTestControl.failNextSettingsWrite = null
        throw new Error(message)
      }
      return settingsWrite(...args)
    },
    tauriCatalogGetById: async (...args: Parameters<typeof catalogGetById>) =>
      writeAheadTestControl.missingCatalogId === args[1]
        ? null
        : catalogGetById(...args),
  }
})
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  capturePersistenceCoordinators,
  closeEditorTab,
  clickNewArtifact,
  dispatchPointerClick,
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForAsync,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const {
  catalogMutationsDouble,
  failNextDualWrite,
  failWorkspaceSyncMatching,
  holdRelocateFile,
  holdWriteFile,
  workspaceManifestIdsDouble,
  writeFileCalls,
} = await import("./integration/documents/support/real-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { localDB } = await import("@/lib/local-db")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 60_000
const BODY = "ODE574-CUERPO-DE-LA-CARTA"
const FAILURE_NOTICE = "couldn't be moved to the chosen folder"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let coordinatorCaptures: Array<ReturnType<typeof capturePersistenceCoordinators>> = []

beforeAll(() => {
  createDesktopWorkspace("odessay-save-as-relocate-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(async () => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  writeAheadTestControl.failNextSettingsWrite = null
  writeAheadTestControl.missingCatalogId = null
  // La sesión persistida vive en fake-indexeddb, que el harness no limpia.
  await writeEditorSession(createEmptyEditorSession())
})

afterEach(async () => {
  vi.restoreAllMocks()
  await mounted?.unmount()
  mounted = null
  for (const capture of coordinatorCaptures) capture.stop()
  coordinatorCaptures = []
  const { disposeWorkspaceReconciler } = await import("@/lib/services/desktop/desktop-workspace-reconciler")
  await disposeWorkspaceReconciler()
})

/**
 * Retiene la lectura de la sesión persistida para actuar determinísticamente
 * antes de que cargue (ODE-577). Sin esto, la lectura (rápida en
 * fake-indexeddb) suele completar durante el montaje y el test actúa tras la
 * carga sin ejercitar la ventana pre-carga.
 */
function holdSessionRead() {
  const original = localDB.editorSessions.get.bind(localDB.editorSessions)
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  let arrived!: () => void
  const started = new Promise<void>((resolve) => {
    arrived = resolve
  })
  vi.spyOn(localDB.editorSessions, "get").mockImplementation(async (id: string) => {
    const value = await original(id)
    arrived()
    await gate
    return value
  })
  return { release, started }
}

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

async function watchDesktopSaves() {
  const { getDocumentService } = await import("@/lib/services/document-service-factory")
  const service = await getDocumentService()
  const saveWriting = service.saveWriting.bind(service)
  let pending = 0
  vi.spyOn(service, "saveWriting").mockImplementation(async (input) => {
    pending += 1
    try {
      return await saveWriting(input)
    } finally {
      pending -= 1
    }
  })
  const waitForIdle = async (label: string) => {
    await waitFor(() => pending === 0, { label, timeoutMs: 15_000 })
  }
  return {
    pending: () => pending,
    waitForIdle,
  }
}

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

async function within<T>(promise: Promise<T>, label: string, timeoutMs = 15_000): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`Timed out after ${timeoutMs}ms waiting for ${label}`)), timeoutMs)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function readCatalogMutations() {
  const { appConfigDir, join: tauriJoin } = await import("@tauri-apps/api/path")
  const dbPath = await tauriJoin(await appConfigDir(), "desktop-index.sqlite3")
  return catalogMutationsDouble(dbPath)
}

async function pendingRelocationRepairs() {
  const [{ appConfigDir }, { DesktopSettingsService }] = await Promise.all([
    import("@tauri-apps/api/path"),
    import("@/lib/services/desktop/desktop-settings-service"),
  ])
  return new DesktopSettingsService(await appConfigDir()).getPendingRelocationRepairs()
}

async function expectRelocatedIdentity(file: { path: string }, moved: string, writingId: string, marker: string) {
  const rootPath = dirname(moved)
  const relativePath = moved.slice(rootPath.length + 1)
  const saved = await waitForMarkdownContaining(marker)
  const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")
  const mutations = await readCatalogMutations()

  expect(saved.path, "los bytes nuevos están en el archivo canónico de destino").toBe(moved)
  expect(await exists(file.path), "la ruta vieja no reaparece").toBe(false)
  expect(await getDesktopWritingCanonicalPath(writingId), "el catálogo señala la ruta de destino").toBe(moved)
  expect(workspaceManifestIdsDouble(rootPath).get(relativePath), "el manifiesto conserva el mismo UUID").toBe(writingId)
  expect(
    mutations.some((mutation) => mutation.documentId === writingId && mutation.operation === "upsert"),
    "la sincronización queda encolada para el mismo documento",
  ).toBe(true)
  expect(activeTab()?.writing_id, "la pestaña conserva el UUID del documento").toBe(writingId)
}

/**
 * Crea un documento real con contenido y devuelve su `.md` y su título. Actúa
 * determinísticamente antes de que cargue la sesión (ODE-577): retiene la
 * lectura, monta, abre el borrador y escribe, suelta y deja asentar el replay.
 * La shell adopta el borrador recién materializado sin reapertura por ruta:
 * "Save As" actúa sobre el documento que la propia shell ya adoptó.
 */
async function createDocument({ captureCoordinator = false }: { captureCoordinator?: boolean } = {}) {
  const coordinatorCapture = captureCoordinator ? capturePersistenceCoordinators() : null
  if (coordinatorCapture) coordinatorCaptures.push(coordinatorCapture)
  const hold = holdSessionRead()
  mounted = await mountEditorShell()
  await hold.started
  expect(getEditorSessionState().loaded, "pre-carga: la sesión todavía no cargó").toBe(false)
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(BODY)
  hold.release()
  await waitFor(() => getEditorSessionState().loaded, { label: "replay asentado tras pre-carga" })
  await advance(6_000)
  const file = await waitForMarkdownContaining(BODY)
  const created = await waitFor(
    () => {
      const current = activeTab()
      return current?.writing_id && current.writing_id !== EDITOR_DRAFT_TAB_ID ? current.writing_id : null
    },
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  const tab = await waitFor(() => (activeTab()?.writing_id === created ? activeTab() : null), {
    label: "pestaña del documento activa",
  })
  return { file, title: tab!.title, coordinatorCapture }
}

describe("ODE-574 — Save As mueve el documento (ODE-401/ODE-402)", () => {
  it(
    "si el traslado falla: mismo título, nada en el destino y el aviso muestra la ruta original",
    async () => {
      const { file, title } = await createDocument()

      // La "carpeta" elegida es un archivo: el traslado no puede crearla.
      const blocker = join(desktopWorkspaceRoot(), "no-es-carpeta")
      await writeFile(blocker, "")
      const chosen = join(blocker, "Renamed.md")
      world.saveDialogResult = chosen

      await emitTauriEvent("menu:save-as")
      await waitFor(() => mounted!.container.textContent?.includes(FAILURE_NOTICE), {
        label: "aviso de traslado fallido",
        timeoutMs: 15_000,
      })

      expect(activeTab()?.title, "el título sigue siendo el del documento").toBe(title)
      expect(await exists(chosen), "no queda copia en el destino").toBe(false)
      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path), "el documento sigue donde estaba").toEqual([file.path])
      expect(files[0].contents).toContain(BODY)
      const text = mounted!.container.textContent ?? ""
      expect(text, "el aviso muestra la ruta original").toContain(file.path)
      expect(text, "y no la elegida").not.toContain(chosen)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "si el traslado sale bien: la pestaña toma el nombre final, con sufijo de colisión, y no hay aviso",
    async () => {
      const { file } = await createDocument()

      // Ya hay un "Renamed.md" en la carpeta elegida: el traslado debe sufijar.
      const chosenDir = join(desktopWorkspaceRoot(), "elegida")
      await mkdir(chosenDir, { recursive: true })
      await writeFile(join(chosenDir, "Renamed.md"), "ocupado")
      world.saveDialogResult = join(chosenDir, "Renamed.md")

      await emitTauriEvent("menu:save-as")
      await waitFor(() => activeTab()?.title === "Renamed 2", {
        label: "título del nombre final",
        timeoutMs: 15_000,
      })

      const moved = join(chosenDir, "Renamed 2.md")
      const files = await readWorkspaceMarkdown()
      expect(files.find((entry) => entry.path === moved)?.contents, "el documento está en su ruta final").toContain(BODY)
      expect(await exists(file.path), "movido, no copiado: el original ya no está").toBe(false)
      expect(files.find((entry) => entry.path === join(chosenDir, "Renamed.md"))?.contents, "el ocupante no se toca").toBe(
        "ocupado",
      )
      expect(mounted!.container.textContent ?? "").not.toContain(FAILURE_NOTICE)
    },
    TEST_TIMEOUT_MS,
  )
  it(
    "después del traslado, una edición pendiente y las siguientes se guardan en la ruta nueva",
    async () => {
      await createDocument()
      const chosenDir = join(desktopWorkspaceRoot(), "destino-autosave")
      await mkdir(chosenDir, { recursive: true })
      world.saveDialogResult = join(chosenDir, "Movido.md")

      // Edición todavía en cola cuando el usuario elige "Save As".
      await typeInEditor(" R07-ANTES-DEL-TRASLADO")
      await emitTauriEvent("menu:save-as")
      await waitFor(() => activeTab()?.title === "Movido", { label: "traslado adoptado", timeoutMs: 15_000 })
      const moved = join(chosenDir, "Movido.md")
      const movedContents = async () =>
        (await readWorkspaceMarkdown()).find((entry) => entry.path === moved)?.contents ?? ""
      expect(await movedContents(), "el traslado lleva la edición en cola").toContain("R07-ANTES-DEL-TRASLADO")

      // Edición posterior: el autosave debe llegar al archivo movido.
      await typeInEditor(" R07-DESPUES-DEL-TRASLADO")
      await advance(6_000)
      await waitForMarkdownContaining("R07-DESPUES-DEL-TRASLADO")
      expect(await movedContents()).toContain("R07-DESPUES-DEL-TRASLADO")
      expect(activeTab()?.save_state, "sin estado de error tras el traslado").not.toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: una edición durante el relocate espera el commit y solo se escribe en el destino",
    async () => {
      const { file } = await createDocument()
      const saves = await watchDesktopSaves()
      const moved = join(desktopWorkspaceRoot(), "destino-en-vuelo", "Movido.md")
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      let writesBeforeRelease = 0
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move físico")
        writesBeforeRelease = writeFileCalls().length
        expect(await exists(file.path), "el move físico ya ocurrió mientras el catálogo sigue pendiente").toBe(false)

        await typeInEditor(" ODE693-DURANTE-RELOCATE")
        await advance(6_000)
        expect(
          writeFileCalls().slice(writesBeforeRelease),
          "ningún save empieza contra la ruta anterior mientras el catálogo está en commit",
        ).toHaveLength(0)
        expect(saves.pending(), "el save del editor está esperando la operación de ruta").toBeGreaterThan(0)
      } finally {
        heldMove.release()
        await within(saveAs, "completion event de Save As")
        await waitFor(() => activeTab()?.title === "Movido", {
          label: "Save As termina de confirmar el relocate",
          timeoutMs: 15_000,
        }).catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          throw new Error(`${message}; title=${activeTab()?.title}; saveState=${activeTab()?.save_state}`)
        })
      }

      await advance(6_000)
      const saved = await waitForMarkdownContaining("ODE693-DURANTE-RELOCATE")
      await saves.waitForIdle("completion del save en vuelo")
      const writes = writeFileCalls()
        .slice(writesBeforeRelease)
        .filter((write) => write.content.includes("ODE693-DURANTE-RELOCATE"))
      expect(saved.path, "los bytes nuevos están en el archivo canónico de destino").toBe(moved)
      expect(await exists(file.path), "la ruta vieja no reaparece").toBe(false)
      expect(writes.length, "el save alcanzó el filesystem").toBeGreaterThan(0)
      expect(writes.length, "el retry del save permanece acotado").toBeLessThanOrEqual(3)
      expect(writes.map((write) => write.path), "el UUID se resuelve a la ruta canónica").toEqual(
        Array.from({ length: writes.length }, () => moved),
      )
      expect(activeTab()?.save_state, "la pestaña conserva un estado recuperable").not.toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: el intent durable precede al move y se borra después del commit completo",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "intent-write-ahead", "Movido.md")
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "before-move" },
      )
      world.saveDialogResult = moved
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move antes de mutar el filesystem")
        const pending = await pendingRelocationRepairs()
        expect(pending, "el intent ya es durable cuando comienza el move físico").toHaveLength(1)
        expect(pending[0]?.documentId).toBe(writingId)
        expect(pending[0]?.targetPath).toBe(moved)
        expect(await exists(file.path), "el source permanece en su sitio hasta liberar el move").toBe(true)
        expect(await exists(moved), "todavía no existe el destino retenido").toBe(false)
      } finally {
        heldMove.release()
        await within(saveAs, "completion event del relocate con intent durable")
      }

      await expectRelocatedIdentity(file, moved, writingId!, BODY)
      expect(await pendingRelocationRepairs(), "el commit de manifiesto y catálogo borra el intent").toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: si falla la escritura durable del intent, Save As no mueve ni cambia el documento",
    async () => {
      const { file, title } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "intent-write-fails", "NoMovido.md")
      world.saveDialogResult = moved
      writeAheadTestControl.failNextSettingsWrite = "simulated durable intent write failure"

      await within(emitTauriEvent("menu:save-as"), "completion event tras el fallo del intent")

      expect(writeAheadTestControl.failNextSettingsWrite, "la escritura del intent alcanzó el boundary durable").toBeNull()
      expect(await exists(file.path), "el fallo del intent aborta antes del move físico").toBe(true)
      expect(await exists(moved), "no queda ningún destino tras el fallo del intent").toBe(false)
      expect(activeTab()?.writing_id, "la pestaña conserva el UUID").toBe(writingId)
      expect(activeTab()?.title, "la pestaña conserva el título").toBe(title)
      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")
      expect(await getDesktopWritingCanonicalPath(writingId!), "el catálogo conserva el binding original").toBe(file.path)
      const files = await readWorkspaceMarkdown()
      expect(files.map((entry) => entry.path), "el catálogo de archivos sigue viendo solo el source").toEqual([file.path])
      expect(files[0]?.contents).toContain(BODY)
      expect(await pendingRelocationRepairs(), "no se conserva un intent cuya escritura falló").toHaveLength(0)
      await waitFor(() => mounted!.container.textContent?.includes(FAILURE_NOTICE), {
        label: "el fallo recuperable de Save As se informa sin cerrar la pestaña",
        timeoutMs: 15_000,
      })
      expect(activeTab()?.save_state, "el fallo del intent no deja la pestaña en error").not.toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: sin fila de catálogo descarta con evidencia o mantiene una valla antes de acuñar",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento mantiene identidad en el manifest de origen").toBeTruthy()
      const sourceRootPath = dirname(file.path)
      const sourceRelativePath = file.path.slice(sourceRootPath.length + 1)
      expect(workspaceManifestIdsDouble(sourceRootPath).get(sourceRelativePath)).toBe(writingId)

      const targetPath = join(desktopWorkspaceRoot(), "orphan-intent", "Movido.md")
      const targetRootPath = dirname(targetPath)
      const now = new Date().toISOString()
      const [{ appConfigDir }, { DesktopSettingsService }] = await Promise.all([
        import("@tauri-apps/api/path"),
        import("@/lib/services/desktop/desktop-settings-service"),
      ])
      const settings = new DesktopSettingsService(await appConfigDir())
      await settings.upsertPendingRelocationRepair({
        documentId: writingId!,
        sourceRootPath,
        sourcePath: file.path,
        targetPath,
        targetRootPath,
        targetRelativePath: targetPath.slice(targetRootPath.length + 1),
        selectedPaths: [targetPath.slice(targetRootPath.length + 1)],
        settingsRoot: null,
        registerExternalRoot: true,
        consentedAt: now,
        createdAt: now,
        syncMutationId: globalThis.crypto.randomUUID(),
        mutationCreatedAt: Date.now(),
      })
      writeAheadTestControl.missingCatalogId = writingId!

      const { recoverPendingDesktopRelocationsAtStartup } = await import(
        "@/lib/services/document-service-factory"
      )
      await recoverPendingDesktopRelocationsAtStartup()

      expect(await pendingRelocationRepairs(), "la evidencia del mismo UUID en source y la ausencia del destino permiten limpiar el intent obsoleto").toHaveLength(0)
      expect(workspaceManifestIdsDouble(sourceRootPath).get(sourceRelativePath), "la identidad original sigue durable en manifest").toBe(writingId)
      expect(await exists(file.path), "el archivo original sigue en su sitio").toBe(true)
      expect(await exists(targetPath), "no se materializó el destino del intent obsoleto").toBe(false)

      // If the destination exists but its catalog row is still missing, the
      // durable UUID claim is unresolved. Startup must retain and report it,
      // and must fence the generic reconciler before it can mint an id.
      await mkdir(targetRootPath, { recursive: true })
      await new DesktopSettingsService(await appConfigDir()).upsertBindingRoot({
        id: "ode693-orphan-destination-root",
        rootPath: targetRootPath,
        kind: "external",
        visibleAsWorkspace: false,
        selectedPaths: [],
        consentedAt: now,
        createdAt: now,
      })
      const source = (await readWorkspaceMarkdown()).find((entry) => entry.path === file.path)
      expect(source, "los bytes de source siguen disponibles para el fixture").toBeDefined()
      await writeFile(targetPath, source!.contents)
      await settings.upsertPendingRelocationRepair({
        documentId: writingId!,
        sourceRootPath,
        sourcePath: file.path,
        targetPath,
        targetRootPath,
        targetRelativePath: targetPath.slice(targetRootPath.length + 1),
        selectedPaths: [targetPath.slice(targetRootPath.length + 1)],
        settingsRoot: null,
        registerExternalRoot: true,
        consentedAt: now,
        createdAt: now,
        syncMutationId: globalThis.crypto.randomUUID(),
        mutationCreatedAt: Date.now(),
      })
      const errorLog = vi.spyOn(console, "error").mockImplementation(() => {})
      await recoverPendingDesktopRelocationsAtStartup()
      expect(await pendingRelocationRepairs(), "el intent con destino presente conserva la identidad reclamada").toHaveLength(1)
      expect(errorLog).toHaveBeenCalledWith(expect.stringContaining("preserving its intent as an identity fence"))

      const { disposeWorkspaceReconciler, ensureWorkspaceReconciler } = await import(
        "@/lib/services/desktop/desktop-workspace-reconciler"
      )
      await disposeWorkspaceReconciler()
      expect(await ensureWorkspaceReconciler(), "un intent no reparable detiene el scan antes del mint").toBeNull()
      expect(workspaceManifestIdsDouble(targetRootPath).get("Movido.md"), "el archivo ambiguo sigue sin una segunda identidad").toBeUndefined()
      expect(await pendingRelocationRepairs(), "la valla durable sobrevive al arranque bloqueado").toHaveLength(1)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: un manifiesto con otra identidad queda para reconciler/Open Document",
    async () => {
      const { file, title } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento de origen conserva identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "identidad-ambigua", "Movido.md")
      const rootPath = dirname(moved)
      const relativePath = moved.slice(rootPath.length + 1)
      const conflictingId = "69300000-0000-4000-8000-000000000001"
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move con identidad ambigua")
        const { tauriWorkspaceSync } = await import("@/lib/services/desktop/tauri-commands")
        await tauriWorkspaceSync(rootPath, [relativePath], { [relativePath]: conflictingId })
      } finally {
        heldMove.release()
        await within(saveAs, "completion event con identidad ambigua")
      }

      await waitFor(() => mounted!.container.textContent?.includes(FAILURE_NOTICE), {
        label: "ambigüedad desviada al flujo reconciler/Open Document",
        timeoutMs: 15_000,
      })
      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")
      expect(activeTab()?.title, "la UI de error existente conserva el documento sin resolver").toBe(title)
      expect(activeTab()?.writing_id, "no se adopta una identidad nueva en la pestaña").toBe(writingId)
      expect(await exists(file.path), "el archivo movido no recrea la ruta original").toBe(false)
      expect(await exists(moved), "el archivo físico queda disponible para abrirse por ruta").toBe(true)
      expect(workspaceManifestIdsDouble(rootPath).get(relativePath), "el manifest conflictivo conserva su UUID").toBe(
        conflictingId,
      )
      expect(await getDesktopWritingCanonicalPath(writingId!), "el catálogo no finge que el move ambiguo se resolvió").toBe(
        file.path,
      )
      expect(await getDesktopWritingCanonicalPath(conflictingId), "no se acuña una segunda fila de catálogo").toBeNull()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: el paso 4 falla tras el move y el retry termina con el mismo UUID en destino",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "paso-4-retry", "Movido.md")
      const rootPath = dirname(moved)
      const relativePath = moved.slice(rootPath.length + 1)
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move del paso 4")
        expect(await exists(moved), "el evento after-move observa el archivo ya escrito en destino").toBe(true)
        expect(await exists(file.path), "el evento after-move observa la ruta anterior ausente").toBe(false)
        failWorkspaceSyncMatching(
          (call) => call.rootPath === rootPath && call.documentIds?.[relativePath] === writingId,
          1,
          async () => { throw new Error("simulated step 4 manifest failure") },
        )
        await typeInEditor(" ODE693-STEP-4-RETRY")
        await advance(6_000)
      } finally {
        heldMove.release()
        await within(saveAs, "completion event tras el retry del paso 4")
      }

      await waitFor(() => activeTab()?.title === "Movido", { label: "completion event del retry del paso 4", timeoutMs: 15_000 })
      await advance(6_000)
      await expectRelocatedIdentity(file, moved, writingId!, "ODE693-STEP-4-RETRY")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: el paso 5 falla tras el move y el retry encola sync con el mismo UUID",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "paso-5-retry", "Movido.md")
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move del paso 5")
        failNextDualWrite(async () => { throw new Error("simulated step 5 catalog failure") })
      } finally {
        heldMove.release()
        await within(saveAs, "completion event tras el retry del paso 5")
      }

      await waitFor(() => activeTab()?.title === "Movido", { label: "completion event del retry del paso 5", timeoutMs: 15_000 })
      await expectRelocatedIdentity(file, moved, writingId!, BODY)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: al agotar el retry deja aviso y repara en el siguiente save sin cambiar de UUID",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "retry-agotado-save", "Movido.md")
      const rootPath = dirname(moved)
      const relativePath = moved.slice(rootPath.length + 1)
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move con retry agotado")
        failWorkspaceSyncMatching(
          (call) => call.rootPath === rootPath && call.documentIds?.[relativePath] === writingId,
          3,
          async () => { throw new Error("simulated persistent step 4 failure") },
        )
      } finally {
        heldMove.release()
        await within(saveAs, "completion event con reparación pendiente")
      }

      await waitFor(() => activeTab()?.title === "Movido", { label: "completion event con reparación pendiente", timeoutMs: 15_000 })
      expect(activeTab()?.title, "la pestaña sigue la ubicación física de destino").toBe("Movido")
      expect(await exists(file.path), "la ubicación original se mantiene ausente").toBe(false)
      await waitFor(() => mounted!.container.textContent?.includes("Saved to the new location, but the app couldn't update its index. It will retry."), {
        label: "aviso de reparación pendiente", timeoutMs: 15_000,
      })
      expect(workspaceManifestIdsDouble(rootPath).get(relativePath), "el fallo deja repair durable para el manifiesto").not.toBe(
        writingId,
      )
      expect(activeTab()?.writing_id).toBe(writingId)

      await typeInEditor(" ODE693-NEXT-SAVE-REPAIR")
      await advance(6_000)
      await expectRelocatedIdentity(file, moved, writingId!, "ODE693-NEXT-SAVE-REPAIR")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: al reabrir, el reconciler repara el manifiesto y catálogo sin acuñar identidad",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const moved = join(desktopWorkspaceRoot(), "retry-agotado-reopen", "Movido.md")
      const rootPath = dirname(moved)
      const relativePath = moved.slice(rootPath.length + 1)
      // Model a folder the user had already registered before this Save As.
      // This keeps the later identical-copy positive control inside the
      // reconciler's selected scope after restart.
      await mkdir(rootPath, { recursive: true })
      const [{ appConfigDir }, { DesktopSettingsService }] = await Promise.all([
        import("@tauri-apps/api/path"),
        import("@/lib/services/desktop/desktop-settings-service"),
      ])
      const now = new Date().toISOString()
      await new DesktopSettingsService(await appConfigDir()).upsertBindingRoot({
        id: "ode693-reopen-binding-root",
        rootPath,
        kind: "external",
        visibleAsWorkspace: false,
        selectedPaths: [],
        consentedAt: now,
        createdAt: now,
      })
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move antes de reabrir")
        failWorkspaceSyncMatching(
          (call) => call.rootPath === rootPath && call.documentIds?.[relativePath] === writingId,
          3,
          async () => { throw new Error("simulated persistent step 4 failure before restart") },
        )
      } finally {
        heldMove.release()
        await within(saveAs, "completion event que conserva la reparación pendiente")
      }

      await waitFor(() => activeTab()?.title === "Movido", { label: "completion event antes de reabrir", timeoutMs: 15_000 })
      expect(activeTab()?.title, "la pestaña sigue el archivo tras el move físico").toBe("Movido")
      expect(workspaceManifestIdsDouble(rootPath).get(relativePath)).not.toBe(writingId)
      expect((await pendingRelocationRepairs()).map((repair) => repair.documentId), "el intent sobrevive al reinicio").toContain(writingId)
      const { disposeWorkspaceReconciler, refreshWorkspaceReconcilerRoots } = await import(
        "@/lib/services/desktop/desktop-workspace-reconciler"
      )
      await disposeWorkspaceReconciler()
      const duplicatePath = join(rootPath, "Identical copy.md")
      await writeFile(duplicatePath, BODY)
      await refreshWorkspaceReconcilerRoots()

      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")
      await waitForAsync(
        async () =>
          (await getDesktopWritingCanonicalPath(writingId!)) === moved &&
          workspaceManifestIdsDouble(rootPath).get(relativePath) === writingId,
        { label: "la reparación pendiente converge durante el nuevo arranque", timeoutMs: 15_000 },
      )
      expect(activeTab()?.writing_id, "la pestaña abierta conserva su identidad").toBe(writingId)
      expect(await exists(file.path), "el archivo original sigue ausente").toBe(false)
      expect(workspaceManifestIdsDouble(rootPath).get(relativePath), "la reparación conserva el UUID del destino antes de escanear archivos nuevos").toBe(writingId)
      expect(workspaceManifestIdsDouble(rootPath).get("Identical copy.md"), "el archivo externo sí recibe su propia identidad").toBeTruthy()
      expect(workspaceManifestIdsDouble(rootPath).get("Identical copy.md"), "el control positivo no reutiliza el UUID del relocate").not.toBe(writingId)
      expect(await pendingRelocationRepairs(), "el arranque consume el intent después del commit").toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: si el relocate falla, libera el save y conserva la ruta original recuperable",
    async () => {
      const { file, coordinatorCapture } = await createDocument({ captureCoordinator: true })
      const saves = await watchDesktopSaves()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const requestedPath = join(desktopWorkspaceRoot(), "destino-fallido", "NoMovido.md")
      world.saveDialogResult = requestedPath
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === requestedPath,
        { stage: "before-move", error: new Error("simulated relocate failure") },
      )
      let writesBeforeRelease = 0
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move fallido")
        writesBeforeRelease = writeFileCalls().length
        await typeInEditor(" ODE693-TRAS-FALLO")
        await advance(6_000)
        expect(
          writeFileCalls().slice(writesBeforeRelease),
          "el save espera mientras el resultado del relocate sigue pendiente",
        ).toHaveLength(0)
        expect(saves.pending(), "el save espera la resolución del relocate").toBeGreaterThan(0)
      } finally {
        heldMove.release()
        await within(saveAs, "completion event del relocate fallido")
        await within(saves.waitForIdle("completion del save liberado tras el error"), "settle del save fallido")
      }

      await advance(6_000)
      const original = await waitForMarkdownContaining("ODE693-TRAS-FALLO")
      await within(saves.waitForIdle("completion del save recuperado en la ruta original"), "save recuperado")
      expect(original.path, "el save vuelve a la ruta original después del error").toBe(file.path)
      expect(await exists(requestedPath), "el fallo no deja un archivo destino").toBe(false)
      expect(activeTab()?.writing_id, "la pestaña conserva su UUID").toBe(writingId)
      expect(activeTab()?.save_state, "la pestaña no queda en error tras el save recuperado").not.toBe("error")
      await within(closeEditorTab(writingId!), "cierre después del fallo y save recuperado")
      await within(
        waitFor(() => !getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingId), {
          label: "la pestaña cierra después de un relocate fallido",
        }),
        "cierre de pestaña tras fallo",
      )
      expect(saves.pending(), "ningún waiter de save sigue vivo tras el fallo y el cierre").toBe(0)
      expect(await within(coordinatorCapture!.settle(), "settle de todos los coordinators tras el fallo")).toBe(true)
      coordinatorCapture!.stop()
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: cerrar durante un save que espera relocate permite terminar y cerrar la pestaña",
    async () => {
      const { file } = await createDocument()
      const saves = await watchDesktopSaves()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const requestedPath = join(desktopWorkspaceRoot(), "destino-y-cierre", "Movido.md")
      world.saveDialogResult = requestedPath
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === requestedPath,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await within(heldMove.started, "inicio del move con pestaña en cierre")
        await typeInEditor(" ODE693-CIERRE")
        await advance(6_000)

        const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id === writingId)
        expect(tab, "el documento sigue montado antes del gesto de cierre").toBeDefined()
        const close = document.querySelector<HTMLElement>(
          `[data-editor-tab-id="${tab!.id}"] [aria-label^="Close "]`,
        )
        expect(close, "el botón real de cierre está en el DOM").toBeTruthy()
        dispatchPointerClick(close!)
        await flush(3)
        expect(
          getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingId),
          "la pestaña sigue viva mientras su save espera",
        ).toBe(true)
        expect(saves.pending(), "el save sigue esperando el relocate antes del cierre").toBeGreaterThan(0)
      } finally {
        heldMove.release()
        await within(saveAs, "completion event con save esperando el cierre")
      }

      await advance(6_000)
      const saved = await waitForMarkdownContaining("ODE693-CIERRE")
      await saves.waitForIdle("completion del save antes del cierre final")
      expect(saved.path, "el save termina en el destino incluso al cerrar").toBe(requestedPath)
      const stillOpen = getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingId)
      if (stillOpen) await closeEditorTab(writingId!)
      await waitFor(() => !getEditorSessionState().session.tabs.some((tab) => tab.writing_id === writingId), {
        label: "la pestaña puede cerrarse después del completion event",
      })
      expect(await exists(file.path), "la ruta anterior no reaparece después del cierre").toBe(false)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: el relocate conserva el UUID y enlaza el catálogo a la ruta final",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const requestedPath = join(desktopWorkspaceRoot(), "destino-identidad", "Misma-identidad.md")
      world.saveDialogResult = requestedPath

      await emitTauriEvent("menu:save-as")
      await waitFor(() => activeTab()?.title === "Misma-identidad", {
        label: "Save As confirma el relocate",
        timeoutMs: 15_000,
      })

      const { getDesktopWritingCanonicalPath } = await import("@/lib/services/document-service-factory")
      const saved = await waitForMarkdownContaining(BODY)
      expect(saved.path).toBe(requestedPath)
      expect(activeTab()?.writing_id).toBe(writingId)
      expect(await getDesktopWritingCanonicalPath(writingId!)).toBe(requestedPath)
      expect(await exists(file.path)).toBe(false)
      expect(await pendingRelocationRepairs(), "un commit completo no deja un intent pendiente").toHaveLength(0)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: un save con binding ya resuelto espera el commit y reintenta dentro del tope",
    async () => {
      const { file } = await createDocument()
      const writingId = activeTab()?.writing_id
      expect(writingId, "el documento ya tiene identidad estable").toBeTruthy()
      const requestedPath = join(desktopWorkspaceRoot(), "destino-reintento", "Movido.md")
      world.saveDialogResult = requestedPath

      const service = await import("@/lib/services/document-service-factory").then(({ getDocumentService }) =>
        getDocumentService(),
      )
      const opened = await service.openWriting(writingId!)
      expect(opened.error, "el save parte del documento real ya abierto").toBeNull()
      expect(opened.data).not.toBeNull()
      const source = (await readWorkspaceMarkdown()).find((entry) => entry.path === file.path)
      expect(source, "el source canónico está en disco antes de la carrera").toBeDefined()
      const { computeMarkdownContentHash } = await import("@/lib/content-hash")
      const expectedContentHash = await computeMarkdownContentHash(source!.contents)
      const retryContent = structuredClone(opened.data!)
      const body = retryContent.content.richText as { content?: unknown[] }
      body.content = [
        ...(body.content ?? []),
        { type: "paragraph", content: [{ type: "text", text: "ODE693-RETRY-POST-COMMIT" }] },
      ]
      retryContent.content.plainText += "\nODE693-RETRY-POST-COMMIT"
      const heldSave = holdWriteFile((path) => path === file.path)
      const heldMove = holdRelocateFile(
        (sourcePath, requested) => sourcePath === file.path && requested === requestedPath,
        { stage: "after-move" },
      )
      let moveStarted = false
      void heldMove.started.then(() => { moveStarted = true })
      const writesBeforeSave = writeFileCalls().length
      const save = service.saveWriting({ writing: retryContent, expectedContentHash })
      let saveAs: Promise<unknown> | null = null
      let saveSettled = false
      let saveAsSettled = false
      void save.then(() => { saveSettled = true }, () => { saveSettled = true })

      try {
        await waitFor(
          () => writeFileCalls().slice(writesBeforeSave).some((write) => write.path === file.path),
          { label: "el save previo al relocate alcanza el write del filesystem", timeoutMs: 8_000 },
        )
        await within(heldSave.started, "inicio del write retenido")
        saveAs = emitTauriEvent("menu:save-as")
        void saveAs.then(() => { saveAsSettled = true }, () => { saveAsSettled = true })
        await waitFor(() => moveStarted, {
          label: "el relocate mueve el source antes del commit",
          timeoutMs: 15_000,
        })
        expect(await exists(file.path), "el movimiento físico deja el source ausente antes del commit").toBe(false)
        heldSave.release()

        heldMove.release()
        await waitFor(() => saveSettled && saveAsSettled, {
          label: "save y relocate terminan después del commit",
          timeoutMs: 20_000,
        })
        const [saved] = await Promise.all([
          within(save, "save directo después del commit"),
          within(saveAs, "Save As después del commit"),
        ])
        expect(saved.error, "el save en vuelo se recupera después del retry canónico").toBeNull()
      } finally {
        heldSave.release()
        heldMove.release()
        if (saveAs) await within(saveAs, "Save As de la carrera de retry")
        await within(save, "save de la carrera de retry")
      }

      const retryAttempts = writeFileCalls()
        .slice(writesBeforeSave)
        .filter((write) => write.content.includes("ODE693-RETRY-POST-COMMIT"))
      expect(retryAttempts[0]?.path, "el save en vuelo llegó con la ruta que resolvió antes del move").toBe(file.path)
      expect(retryAttempts.some((write) => write.path === requestedPath), "el retry escribió en la ruta post-commit").toBe(true)
      expect(retryAttempts.length, "el retry sigue dentro del presupuesto de tres intentos").toBeLessThanOrEqual(3)
      const saved = await waitForMarkdownContaining("ODE693-RETRY-POST-COMMIT")
      expect(saved.path, "los bytes canónicos terminan en destino").toBe(requestedPath)
      expect(await exists(file.path), "la ruta vieja no reaparece al final del retry").toBe(false)
    },
    TEST_TIMEOUT_MS,
  )
})
