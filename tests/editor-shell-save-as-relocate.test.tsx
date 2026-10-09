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
vi.mock("@/lib/services/desktop/tauri-commands", async () =>
  (await import("./support/editor-shell-desktop-doubles")).tauriCommandsDouble(),
)
vi.mock("@/lib/sync/sync-service-factory", async () =>
  (await import("./support/editor-shell-desktop-doubles")).syncServiceDouble(),
)

const {
  advance,
  capturePersistenceCoordinators,
  clickNewArtifact,
  dispatchPointerClick,
  emitTauriEvent,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
  world,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, desktopWorkspaceRoot, destroyDesktopWorkspace, readWorkspaceMarkdown, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { localDB } = await import("@/lib/local-db")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")
const { getDesktopWritingCanonicalPath, getDocumentService } = await import("@/lib/services/document-service-factory")
const { holdCatalogReads, holdRelocateFile, holdWriteFile, workspaceManifestIdsDouble, writeFileCalls } = await import(
  "./integration/documents/support/real-desktop-doubles"
)

const TEST_TIMEOUT_MS = 60_000
const BODY = "ODE574-CUERPO-DE-LA-CARTA"
const FAILURE_NOTICE = "couldn't be moved to the chosen folder"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let activeCoordinatorCapture: ReturnType<typeof capturePersistenceCoordinators> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-save-as-relocate-")
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
  await mounted?.unmount()
  mounted = null
  activeCoordinatorCapture?.stop()
  activeCoordinatorCapture = null
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

async function exists(path: string) {
  return stat(path).then(() => true).catch(() => false)
}

/**
 * Crea un documento real con contenido y devuelve su `.md` y su título. Actúa
 * determinísticamente antes de que cargue la sesión (ODE-577): retiene la
 * lectura, monta, abre el borrador y escribe, suelta y deja asentar el replay.
 * La shell adopta el borrador recién materializado sin reapertura por ruta:
 * "Save As" actúa sobre el documento que la propia shell ya adoptó.
 */
async function createDocument(options: { captureCoordinator?: boolean } = {}) {
  const coordinatorCapture = options.captureCoordinator ? capturePersistenceCoordinators() : null
  if (coordinatorCapture) activeCoordinatorCapture = coordinatorCapture
  const hold = holdSessionRead()
  mounted = await mountEditorShell()
  await hold.started
  expect(getEditorSessionState().loaded, "pre-carga: la sesión todavía no cargó").toBe(false)
  await flush(3)
  await clickNewArtifact(mounted.container)
  await typeInEditor(BODY)
  hold.release()
  await waitFor(() => getEditorSessionState().loaded, { label: "replay asentado tras pre-carga" })
  await advance(1_000)
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
  return { file, title: tab!.title, writingId: created!, coordinatorCapture }
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

  it.fails(
    "ODE-693: una edición durante el relocate espera el commit y conserva UUID y ruta canónica",
    async () => {
      const { file, writingId, coordinatorCapture } = await createDocument({ captureCoordinator: true })
      const destinationRoot = join(desktopWorkspaceRoot(), "destino-en-vuelo")
      const moved = join(destinationRoot, "Movido.md")
      const marker = "ODE693-DURANTE-RELOCATE"
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")
      let heldReads: ReturnType<typeof holdCatalogReads> | null = null
      let writesBeforeRelease = 0

      try {
        await heldMove.started
        heldReads = holdCatalogReads((idOrPath) => idOrPath === writingId)
        writesBeforeRelease = writeFileCalls().length
        expect(await exists(file.path), "el punto after-move observa el source ausente").toBe(false)

        await typeInEditor(` ${marker}`)
        await advance(6_000)
        expect(
          writeFileCalls().slice(writesBeforeRelease).filter((write) => write.content.includes(marker)),
          "ningún save empieza mientras el catálogo aún apunta al source",
        ).toHaveLength(0)
        expect(heldReads.hits(), "el save no resuelve el UUID a path antes de que termine relocate").toBe(0)
      } finally {
        heldMove.release()
        heldReads?.release()
        await saveAs
        await waitFor(() => activeTab()?.title === "Movido", {
          label: "completion del relocate retenido",
          timeoutMs: 15_000,
        })
      }

      expect(await coordinatorCapture!.settle(), "el save del editor termina tras el completion event").toBe(true)
      const saved = await waitForMarkdownContaining(marker)
      expect(saved.path, "los bytes nuevos quedan en el destino canónico").toBe(moved)
      expect(await exists(file.path), "la ruta anterior no reaparece").toBe(false)
      expect(activeTab()?.writing_id, "la pestaña conserva el UUID").toBe(writingId)
      expect(workspaceManifestIdsDouble(destinationRoot).get("Movido.md"), "el manifest conserva el UUID").toBe(writingId)
      expect(await getDesktopWritingCanonicalPath(writingId!), "el catálogo apunta al path final").toBe(moved)
      expect(activeTab()?.save_state, "la pestaña no queda en error").not.toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "ODE-693: un fallo antes del move libera la espera y el save escribe en el source",
    async () => {
      const { file, writingId, coordinatorCapture } = await createDocument({ captureCoordinator: true })
      const requestedPath = join(desktopWorkspaceRoot(), "destino-fallido", "NoMovido.md")
      const marker = "ODE693-TRAS-FALLO"
      world.saveDialogResult = requestedPath
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === requestedPath,
        { stage: "before-move", error: new Error("simulated relocate failure") },
      )
      const saveAs = emitTauriEvent("menu:save-as")
      let writesBeforeRelease = 0

      try {
        await heldMove.started
        writesBeforeRelease = writeFileCalls().length
        await typeInEditor(` ${marker}`)
        await advance(6_000)
        expect(
          writeFileCalls().slice(writesBeforeRelease).filter((write) => write.content.includes(marker)),
          "el save espera a que se confirme el fallo pre-move",
        ).toHaveLength(0)
      } finally {
        heldMove.release()
        await saveAs
      }

      await waitFor(() => mounted!.container.textContent?.includes(FAILURE_NOTICE), {
        label: "aviso del relocate fallido",
        timeoutMs: 15_000,
      })
      expect(await coordinatorCapture!.settle(), "el waiter termina aunque relocate falle").toBe(true)
      const saved = await waitForMarkdownContaining(marker)
      expect(saved.path, "el save liberado sigue en la ruta original").toBe(file.path)
      expect(await exists(requestedPath), "el fallo no deja un destino con bytes").toBe(false)
      expect(await getDesktopWritingCanonicalPath(writingId!), "el binding permanece en source").toBe(file.path)
      expect(activeTab()?.writing_id, "la identidad se conserva tras el fallo").toBe(writingId)
      expect(activeTab()?.save_state, "el save liberado recupera la pestaña").not.toBe("error")
    },
    TEST_TIMEOUT_MS,
  )

  it.fails(
    "ODE-693: cerrar durante un save que espera relocate termina settle y no deja waiters",
    async () => {
      const { file, writingId, coordinatorCapture } = await createDocument({ captureCoordinator: true })
      const destinationRoot = join(desktopWorkspaceRoot(), "destino-y-cierre")
      const moved = join(destinationRoot, "Movido.md")
      const marker = "ODE693-CIERRE"
      world.saveDialogResult = moved
      const heldMove = holdRelocateFile(
        (source, requested) => source === file.path && requested === moved,
        { stage: "after-move" },
      )
      const saveAs = emitTauriEvent("menu:save-as")

      try {
        await heldMove.started
        await typeInEditor(` ${marker}`)
        await advance(6_000)
        let settleFinished = false
        const settling = coordinatorCapture!.settle().then((result) => {
          settleFinished = true
          return result
        })
        await flush()
        expect(settleFinished, "settle espera el save retenido por relocate").toBe(false)

        const tab = activeTab()
        const tabElement = tab && mounted!.container.querySelector<HTMLElement>(`[data-editor-tab-id="${tab.id}"]`)
        const close = tabElement?.querySelector<HTMLElement>('[aria-label^="Close "]')
        expect(close, "el cierre usa el botón real de la pestaña").toBeTruthy()
        dispatchPointerClick(close!)
        await flush()
        expect(
          getEditorSessionState().session.tabs.some((candidate) => candidate.writing_id === writingId),
          "la pestaña sigue abierta mientras settle espera la escritura",
        ).toBe(true)
      } finally {
        heldMove.release()
        await saveAs
      }

      expect(await coordinatorCapture!.settle(), "settle termina después del completion event").toBe(true)
      await waitFor(
        () => !getEditorSessionState().session.tabs.some((candidate) => candidate.writing_id === writingId),
        { label: "cierre de pestaña después del save", timeoutMs: 15_000 },
      )
      const saved = await waitForMarkdownContaining(marker)
      expect(saved.path, "el último contenido llega al destino").toBe(moved)
      expect(await exists(file.path), "el cierre no restaura la ruta vieja").toBe(false)
      expect(workspaceManifestIdsDouble(destinationRoot).get("Movido.md"), "el binding mantiene el UUID").toBe(writingId)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "ODE-693: un save con binding resuelto reintenta en destino dentro del tope",
    async () => {
      const { file, writingId } = await createDocument()
      const service = await getDocumentService()
      const opened = await service.openWriting(writingId)
      expect(opened.data, "el save directo parte del UUID abierto").not.toBeNull()
      const source = (await readWorkspaceMarkdown()).find((entry) => entry.path === file.path)
      expect(source, "el source canónico está en disco antes de la carrera").toBeDefined()
      const { computeMarkdownContentHash } = await import("@/lib/content-hash")
      const expectedContentHash = await computeMarkdownContentHash(source!.contents)
      const retryContent = structuredClone(opened.data!)
      const richText = (retryContent.content.richText ?? { type: "doc", content: [] }) as {
        type: string
        content?: unknown[]
      }
      richText.content = [
        ...(richText.content ?? []),
        { type: "paragraph", content: [{ type: "text", text: "ODE693-RETRY-POST-COMMIT" }] },
      ]
      retryContent.content.richText = richText
      retryContent.content.plainText += "\nODE693-RETRY-POST-COMMIT"

      const moved = join(desktopWorkspaceRoot(), "destino-reintento", "Movido.md")
      world.saveDialogResult = moved
      const heldSave = holdWriteFile((path) => path === file.path)
      const heldMove = holdRelocateFile(
        (sourcePath, requested) => sourcePath === file.path && requested === moved,
        { stage: "after-move" },
      )
      const writesBeforeSave = writeFileCalls().length
      const save = service.saveWriting({ writing: retryContent, expectedContentHash })
      let saveAs: Promise<void> | null = null
      let saveSettled = false
      const trackedSave = save.then((result) => {
        saveSettled = true
        return result
      })

      try {
        await heldSave.started
        saveAs = emitTauriEvent("menu:save-as")
        await heldMove.started
        expect(await exists(file.path), "el move físico precede el commit de catálogo").toBe(false)
        heldSave.release()
        await flush()
        expect(saveSettled, "el conflicto espera al commit de relocate").toBe(false)
        heldMove.release()
        await saveAs
        const saved = await trackedSave
        expect(saved.error, "el retry usa el binding ya resuelto").toBeNull()
      } finally {
        heldSave.release()
        heldMove.release()
        if (saveAs) await saveAs
        await trackedSave
      }

      const retryAttempts = writeFileCalls()
        .slice(writesBeforeSave)
        .filter((write) => write.content.includes("ODE693-RETRY-POST-COMMIT"))
      expect(retryAttempts[0]?.path, "el primer intento usa el binding resuelto antes del move").toBe(file.path)
      expect(retryAttempts.some((write) => write.path === moved), "el retry usa el path post-commit").toBe(true)
      expect(retryAttempts.length, "el retry permanece dentro del límite de tres intentos").toBeLessThanOrEqual(3)
      const saved = await waitForMarkdownContaining("ODE693-RETRY-POST-COMMIT")
      expect(saved.path, "los bytes canónicos terminan en destino").toBe(moved)
      expect(await exists(file.path), "el source no reaparece tras el retry").toBe(false)
      expect(activeTab()?.writing_id, "el UUID del documento no cambia").toBe(writingId)
      expect(await getDesktopWritingCanonicalPath(writingId), "el catálogo conserva el mismo UUID en destino").toBe(moved)
    },
    TEST_TIMEOUT_MS,
  )
})
