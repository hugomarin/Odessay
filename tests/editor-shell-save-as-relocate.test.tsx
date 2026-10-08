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
import { join } from "node:path"
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
  closeEditorTab,
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
const { holdRelocateFile, holdWriteFile, writeFileCalls } = await import("./integration/documents/support/real-desktop-doubles")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { EDITOR_DRAFT_TAB_ID, createEmptyEditorSession } = await import("@/lib/local-db/editor-sessions")
const { localDB } = await import("@/lib/local-db")
const { writeEditorSession } = await import("@/lib/editor/session-persistence")

const TEST_TIMEOUT_MS = 60_000
const BODY = "ODE574-CUERPO-DE-LA-CARTA"
const FAILURE_NOTICE = "couldn't be moved to the chosen folder"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

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

/**
 * Crea un documento real con contenido y devuelve su `.md` y su título. Actúa
 * determinísticamente antes de que cargue la sesión (ODE-577): retiene la
 * lectura, monta, abre el borrador y escribe, suelta y deja asentar el replay.
 * La shell adopta el borrador recién materializado sin reapertura por ruta:
 * "Save As" actúa sobre el documento que la propia shell ya adoptó.
 */
async function createDocument() {
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
  return { file, title: tab!.title }
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
        await heldMove.started
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
        await saveAs
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
    "ODE-693: si el relocate falla, libera el save y conserva la ruta original recuperable",
    async () => {
      const { file } = await createDocument()
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
        await heldMove.started
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
        await saveAs
        await saves.waitForIdle("completion del save liberado tras el error")
      }

      await advance(6_000)
      const original = await waitForMarkdownContaining("ODE693-TRAS-FALLO")
      await saves.waitForIdle("completion del save recuperado en la ruta original")
      expect(original.path, "el save vuelve a la ruta original después del error").toBe(file.path)
      expect(await exists(requestedPath), "el fallo no deja un archivo destino").toBe(false)
      expect(activeTab()?.writing_id, "la pestaña conserva su UUID").toBe(writingId)
      expect(activeTab()?.save_state, "la pestaña no queda en error tras el save recuperado").not.toBe("error")
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
        await heldMove.started
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
        await saveAs
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
        await heldSave.started
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
        const [saved] = await Promise.all([save, saveAs])
        expect(saved.error, "el save en vuelo se recupera después del retry canónico").toBeNull()
      } finally {
        heldSave.release()
        heldMove.release()
        if (saveAs) await saveAs
        await save
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
