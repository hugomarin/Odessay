/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-542 — El estado de guardado converge desde el catálogo durable.
 *
 * Property: en desktop, el indicador de guardado (y el `save_state` de la
 * pestaña) llega a "Saved" cuando el catálogo durable dice `synced`, aunque el
 * evento efímero `synced` se pierda. Y un evento `synced` nunca muestra
 * "Saved" si el catálogo durable no lo confirma.
 *
 * Por qué existe: la suscripción a los eventos de sync filtraba por un
 * `currentWritingId` capturado. Durante la materialización o la hidratación,
 * el `synced` podía llegar en la ventana de re-suscripción y perderse, y nada
 * volvía a leer el estado durable: la UI se quedaba en "Saving…" hasta cambiar
 * de pestaña. Tras un update confirmado, en producción la ÚNICA señal es ese
 * evento (el INSERT confirmado emite además `cloud-snapshot`).
 *
 * Camino de producción: "New Artifact" real, escritura real, guardado real a
 * `.md` y catálogo real (`SqliteDocumentCatalog`) sobre los dobles de sus
 * comandos nativos. El servicio de sync de desktop es el boundary doblado;
 * sus efectos se reproducen tal como los escribe en SQLite:
 * `confirmCatalogUpsertSyncedDouble` (confirmar la mutación, sin evento de
 * catálogo) y `applyCloudSnapshots` del catálogo real (emite `cloud-snapshot`).
 *
 * Mutation test (ODE-542): no reconciliar en `cloud-snapshot` pone en rojo el
 * caso 1; mapear el evento `synced` directamente a "Saved", el caso 3. Los dos
 * están en rojo contra el código anterior.
 *
 * El caso 2 (materialización) es red de NO REGRESIÓN, no prueba de este
 * cambio: ya pasaba antes, porque materializar hidrata (ODE-570) y la
 * hidratación lee el estado durable. Por eso la shell no reconcilia aparte al
 * materializar.
 *
 * ODE-579 — paridad y coste. Cada caso afirma la status bar y la pestaña
 * contra el MISMO snapshot terminal (la fila real del catálogo proyectada con
 * `mapCatalogRecordToSaveState`), no solo el `save_state` de la pestaña. Y el
 * caso 4 mide el trabajo por evento que declara el contrato de rendimiento de
 * ODE-542: un evento del documento activo hace UNA lectura puntual
 * (`getById`) y a lo sumo un update de pestaña, nunca un `list` del catálogo;
 * uno de fondo no lee el catálogo salvo en `synced`, que relee su propia fila
 * (ODE-590); y abrir documentos no suma listeners de sync (una suscripción
 * global, no una por pestaña).
 *
 * ODE-604 — paridad en ERROR. ODE-579 probó la paridad barra/pestaña en
 * éxito; el caso 5 la prueba cuando la escritura local falla (el comando
 * nativo `write_file` rechaza, como un disco lleno o una base bloqueada): las
 * dos muestran "Needs attention", el contenido sigue en el editor, y el
 * reintento (el siguiente guardado, que es cómo la shell reintenta: no hay
 * botón) las devuelve juntas al estado durable, y a "Saved" cuando la nube
 * confirma. La proyección pura vive en
 * `tests/editor-save-state-reconciliation.test.ts`.
 *
 * Mutation test (ODE-604): que el efecto que publica el estado de la pestaña
 * activa (`publishTabState` en `editor-shell.tsx`) no propague `"error"` pone
 * en rojo el caso 5 (la barra dice "Needs attention" y la pestaña no). Quitar
 * solo el `updateTabSaveState(... "error")` del `onError` del coordinador NO
 * lo pone en rojo, y es correcto: para la pestaña ACTIVA el error llega por
 * los dos caminos; el del `onError` es el que cubre una pestaña de fondo.
 *
 * ODE-590 — la pestaña de fondo y el mismo contrato durable. Un evento
 * `synced` de un documento de fondo es una invalidación como la del activo:
 * relee la fila de ESE documento (`getCatalogRecord` +
 * `reconcileSaveStateFromDurable`) antes de proyectar "Saved". Coste aceptado:
 * 1 `getById` O(1) por evento `synced` de fondo, 0 `list`; un burst de N
 * pestañas que emiten en el mismo flush produce N lecturas puntuales
 * (N ≤ pestañas abiertas): no se coalesce, y esa decisión queda registrada en
 * la Guía de review del issue. Los demás lifecycle statuses de fondo
 * (`syncing`, `offline`) no leen el catálogo: no dicen "Saved".
 *
 * Carrera (ODE-590): si la pestaña pasa a activa con la lectura de fondo en
 * vuelo, el resultado de fondo se descarta —la reconciliación del activo
 * manda— y no pisa el estado que esa transición ya calculó.
 *
 * Mutation test (ODE-590): proyectar el evento sin releer la fila —volver al
 * `mapSyncLifecycleToSaveState` directo en la rama de fondo— pone en rojo el
 * caso de la pestaña de fondo y la pata `synced` del caso de coste. Quitar la
 * valla de "pasó a activa" pone en rojo el caso de carrera.
 *
 * Fuera de esta prueba, con motivo: que una razón de catálogo que no es de
 * reconciliación (`content`, `excerpt`…) no promueva un "Saved" falso con un
 * guardado en vuelo. Reproducirlo exige que el catálogo emita esa razón
 * mientras la fila aún describe el guardado anterior, y el harness no tiene un
 * camino de producción para esa ventana sin forzar el emisor privado del
 * catálogo.
 */
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
  clickEditorTab,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForHydrationReady,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { confirmCatalogUpsertSyncedDouble, failNextWriteFile } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
const { readWorkspaceMarkdown } = await import("./support/editor-shell-desktop-doubles")
const { createDesktopDraft: createProductionDesktopDraft } = await import("@/lib/services/document-service-factory")
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const sessionStore = await import("@/lib/stores/editor-session-store")
const { emitSyncStatusChange, SYNC_STATUS_EVENT_NAME } = await import("@/lib/sync/events")
const { mapCatalogRecordToSaveState } = await import("@/components/editor/save-state")
const { act } = await import("react")

const TEST_TIMEOUT_MS = 60_000

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null

beforeAll(() => {
  createDesktopWorkspace("odessay-durable-save-state-")
})

afterAll(() => {
  destroyDesktopWorkspace()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

function activeTab() {
  const { session } = getEditorSessionState()
  return session.tabs.find((tab) => tab.id === session.active_tab_id)
}

const SAVE_STATE_BY_LABEL: Record<string, string> = {
  Saved: "saved",
  "Saving...": "saving",
  "Saved locally": "saved-local",
  "Needs attention": "error",
}

/** Lo que muestra la status bar, traducido a `EditorSaveState`. */
function barSaveState() {
  const label = mounted?.container
    .querySelector('[data-testid="editor-statusbar"] [aria-live="polite"]')
    ?.textContent?.trim()
  if (label === undefined) return null
  return SAVE_STATE_BY_LABEL[label] ?? `desconocido: ${label}`
}

/**
 * Barra y pestaña convergen al estado que proyecta la fila REAL del catálogo
 * durable, y coinciden entre sí.
 */
async function expectBarAndTabMatchDurable(writingId: string, expected: string) {
  const record = await (await getDocumentCatalog()).getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  expect(mapCatalogRecordToSaveState(record, true), "el snapshot durable terminal").toBe(expected)
  await waitFor(() => activeTab()?.save_state === expected && barSaveState() === expected, {
    label: `barra y pestaña en ${expected}`,
    timeoutMs: 10_000,
  })
  expect(barSaveState(), "la barra dice lo mismo que la pestaña").toBe(activeTab()?.save_state)
  expect(activeTab()?.has_pending_sync).toBe(expected !== "saved")
}

/** Listeners de sync vivos en `window` (altas menos bajas). */
function trackSyncListeners() {
  const add = vi.spyOn(window, "addEventListener")
  const remove = vi.spyOn(window, "removeEventListener")
  const count = (spy: typeof add | typeof remove) =>
    spy.mock.calls.filter(([type]) => type === SYNC_STATUS_EVENT_NAME).length
  return {
    live: () => count(add) - count(remove),
    restore: () => {
      add.mockRestore()
      remove.mockRestore()
    },
  }
}

async function emitSync(writingId: string, status: "synced" | "syncing") {
  await act(async () => {
    emitSyncStatusChange({ writingId, status })
  })
  await flush(5)
  await advance(50)
  await flush(5)
}

/** Monta la shell y espera a que cargue la sesión (ver ODE-574, carrera de arranque). */
async function mountLoaded(props: Parameters<typeof mountEditorShell>[0] = {}) {
  mounted = await mountEditorShell(props)
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
  return mounted
}

/**
 * Deja abierto un documento real, guardado en disco y pendiente de nube.
 * Online, ese estado se muestra como "Saving…" (`saving`, con
 * `has_pending_sync`): el `.md` ya es durable, pero la nube no lo confirmó
 * (ODE-461).
 *
 * El documento se crea y después se ABRE POR RUTA (remontaje por `key`, como
 * una entrada desde Desk). No se usa el documento tal como queda tras
 * materializarse, porque bajo carga la shell a veces no lo adopta (hallazgo
 * de ODE-574: `onMaterialized` con `isSourceDraftActive: false`). Esa carrera
 * es un bug aparte; aquí volvería intermitente una prueba que es sobre otra
 * cosa.
 */
async function openSavedLocally(text: string) {
  const alreadyOpen = new Set(getEditorSessionState().session.tabs.map((tab) => tab.writing_id).filter(Boolean))
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(6_000)
  await waitForMarkdownContaining(text)
  const created = await waitFor(
    () => {
      const tab = getEditorSessionState().session.tabs.find(
        (candidate) => candidate.writing_id && !alreadyOpen.has(candidate.writing_id),
      )
      return tab?.writing_id ?? null
    },
    { label: "documento materializado en el store", timeoutMs: 15_000 },
  )

  await mounted!.render({ key: created, writingId: created })
  await waitFor(() => mounted!.editor().getText().includes(text), { label: "documento abierto por ruta" })
  await waitFor(
    () => {
      const current = activeTab()
      return current?.writing_id === created && current.save_state === "saving" && current.has_pending_sync
    },
    { label: "documento en disco, nube pendiente", timeoutMs: 15_000 },
  )
  return created
}

/** Lo que el servicio de sync aplica tras confirmar un INSERT: el snapshot de la nube. */
async function applyCloudSnapshotFor(writingId: string) {
  const catalog = (await getDocumentCatalog()) as Awaited<ReturnType<typeof getDocumentCatalog>> & {
    applyCloudSnapshots: (snapshots: unknown[]) => Promise<void>
  }
  const record = await catalog.getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  const snapshot = {
    id: record.id,
    cloudPresent: true,
    cloudAccountId: "cloud-account",
    syncStatus: record.syncStatus,
    title: record.title,
    slug: record.slug,
    status: record.status,
    artifactType: record.artifactType,
    visibility: record.visibility,
    version: record.version,
    deletedAt: record.deletedAt,
    createdAt: record.createdAt,
    modifiedAt: record.modifiedAt,
  }
  await act(async () => {
    await catalog.applyCloudSnapshots([snapshot])
  })
  await flush(5)
}

describe("ODE-542 — el estado de guardado converge desde el catálogo durable", () => {
  it(
    "sin evento `synced`: el snapshot de la nube lleva la pestaña a Saved",
    async () => {
      await mountLoaded()
      const writingId = await openSavedLocally("ODE542-SIN-EVENTO")

      // El servicio de sync confirma el INSERT: marca la fila synced en SQLite
      // (sin evento de catálogo) y aplica el snapshot. El evento efímero
      // `synced` se pierde: no se emite.
      confirmCatalogUpsertSyncedDouble(writingId)
      await applyCloudSnapshotFor(writingId)

      await expectBarAndTabMatchDurable(writingId, "saved")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "no regresión: al materializar un borrador cuyo sync ya terminó, Saved sin ningún evento",
    async () => {
      // Flush rápido: cuando la shell se entera del UUID definitivo, el
      // catálogo durable ya dice synced para él.
      const fastFlushDraft: typeof createProductionDesktopDraft = async (options) => {
        const result = await createProductionDesktopDraft(options)
        if (result.data) confirmCatalogUpsertSyncedDouble(result.data.id)
        return result
      }
      await mountLoaded({ createDesktopDraftOverride: fastFlushDraft })
      await clickNewArtifact(mounted!.container)
      await typeInEditor("ODE542-MATERIALIZADO")
      await advance(6_000)
      await waitForMarkdownContaining("ODE542-MATERIALIZADO")

      const writingId = await waitFor(() => activeTab()?.writing_id ?? null, { label: "borrador materializado" })
      await expectBarAndTabMatchDurable(writingId, "saved")
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "un evento `synced` sin confirmación durable no muestra Saved",
    async () => {
      await mountLoaded()
      const writingId = await openSavedLocally("ODE542-EVENTO-SIN-DURABLE")

      // El catálogo durable sigue en pending: el evento no basta.
      await act(async () => {
        emitSyncStatusChange({ writingId, status: "synced" })
      })
      await flush(5)
      await advance(50)
      expect(activeTab()?.save_state, "sin confirmación durable no hay Saved").toBe("saving")
      expect(barSaveState(), "ni en la barra").toBe("saving")

      // Con la confirmación durable, el mismo evento sí converge.
      confirmCatalogUpsertSyncedDouble(writingId)
      await act(async () => {
        emitSyncStatusChange({ writingId, status: "synced" })
      })
      await expectBarAndTabMatchDurable(writingId, "saved")
    },
    TEST_TIMEOUT_MS,
  )

  // ODE-590: la pestaña de fondo es un consumidor del mismo contrato durable.
  // Un `synced` sin fila confirmada no la pone en "Saved"; con la fila
  // `synced`, sí. Era `it.fails` (la proyección optimista la dejaba en
  // "Saved"); pasó a `it` sin tocar el cuerpo.
  it(
    "un evento `synced` de una pestaña de fondo sin confirmación durable no muestra Saved",
    async () => {
      await mountLoaded()
      const background = await openSavedLocally("ODE590-FONDO-EVENTO")
      await openSavedLocally("ODE590-ACTIVO")

      const backgroundTab = () =>
        getEditorSessionState().session.tabs.find((tab) => tab.writing_id === background)

      // Control positivo: la pestaña está abierta en estado no terminal.
      expect(backgroundTab()?.save_state, "la pestaña de fondo arranca en saving").toBe("saving")

      // La fila durable sigue en pending: el evento no basta.
      await emitSync(background, "synced")
      expect(backgroundTab()?.save_state, "sin confirmación durable la pestaña de fondo no dice Saved").toBe("saving")

      // Con la confirmación durable, el mismo evento la converge.
      confirmCatalogUpsertSyncedDouble(background)
      await emitSync(background, "synced")
      await waitFor(() => backgroundTab()?.save_state === "saved", { label: "pestaña de fondo en Saved" })
      expect(backgroundTab()?.has_pending_sync).toBe(false)
      // El documento activo no se toca: la barra sigue siendo la suya.
      expect(activeTab()?.writing_id, "el documento activo es otro").not.toBe(background)
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "coste por evento: una lectura puntual del catálogo, ningún escaneo, ningún listener por pestaña",
    async () => {
      const listeners = trackSyncListeners()
      let restoreCatalogSpies: (() => void) | null = null
      try {
        await mountLoaded()
        const listenersWithOneTab = listeners.live()
        const background = await openSavedLocally("ODE579-FONDO")
        const active = await openSavedLocally("ODE579-ACTIVO")
        expect(
          getEditorSessionState().session.tabs.filter((tab) => tab.writing_id).length,
          "control positivo: dos documentos abiertos en pestañas",
        ).toBeGreaterThanOrEqual(2)
        expect(listenersWithOneTab, "control positivo: la shell escucha los eventos de sync").toBeGreaterThan(0)
        expect(listeners.live(), "abrir documentos no suma listeners de sync").toBe(listenersWithOneTab)

        await flush(5)
        await advance(50)
        const catalog = await getDocumentCatalog()
        const getById = vi.spyOn(catalog, "getById")
        const list = vi.spyOn(catalog, "list")
        const updateTab = vi.spyOn(sessionStore, "updateTabSaveState")
        restoreCatalogSpies = () => {
          updateTab.mockRestore()
          list.mockRestore()
          getById.mockRestore()
        }
        const resetCounts = () => {
          getById.mockClear()
          list.mockClear()
          updateTab.mockClear()
        }

        // Activo, sin confirmación durable: una lectura, nada que actualizar.
        resetCounts()
        await emitSync(active, "synced")
        expect(getById.mock.calls, "una lectura puntual del documento activo").toEqual([[active]])
        expect(list, "sin escanear el catálogo").not.toHaveBeenCalled()
        expect(updateTab, "sin cambio durable no hay update").not.toHaveBeenCalled()
        expect(barSaveState()).toBe("saving")

        // Activo, con confirmación durable: una lectura, un update.
        confirmCatalogUpsertSyncedDouble(active)
        resetCounts()
        await emitSync(active, "synced")
        expect(getById.mock.calls, "una lectura puntual del documento activo").toEqual([[active]])
        expect(list, "sin escanear el catálogo").not.toHaveBeenCalled()
        expect(updateTab.mock.calls.map(([input]) => input), "un update de su pestaña").toEqual([
          { tabId: active, saveState: "saved", hasPendingSync: false },
        ])
        await expectBarAndTabMatchDurable(active, "saved")

        // Repetido: idempotente.
        resetCounts()
        await emitSync(active, "synced")
        expect(getById.mock.calls).toEqual([[active]])
        expect(list).not.toHaveBeenCalled()
        expect(updateTab, "un evento repetido no vuelve a escribir").not.toHaveBeenCalled()

        // De fondo, `syncing`: no es un estado terminal, no lee el catálogo; a
        // lo sumo actualiza su pestaña.
        resetCounts()
        await emitSync(background, "syncing")
        expect(getById, "un `syncing` de fondo no lee el catálogo").not.toHaveBeenCalled()
        expect(list).not.toHaveBeenCalled()
        expect(updateTab.mock.calls.length, "a lo sumo un update, el de su pestaña").toBeLessThanOrEqual(1)
        expect(barSaveState(), "la barra sigue siendo la del documento activo").toBe("saved")

        // De fondo, `synced`: relee la fila de ESE documento antes de
        // proyectar, una lectura puntual por evento. Burst de varias pestañas
        // de fondo: N eventos, N lecturas puntuales (N ≤ pestañas abiertas),
        // nunca un `list`.
        const backgroundTwo = await openSavedLocally("ODE590-COSTE-FONDO-2")
        const backgroundThree = await openSavedLocally("ODE590-COSTE-FONDO-3")
        // Una cuarta pestaña queda activa: las tres del burst son de fondo.
        await openSavedLocally("ODE590-COSTE-ACTIVO-2")
        await flush(5)
        await advance(50)
        resetCounts()
        await emitSync(background, "synced")
        await emitSync(backgroundTwo, "synced")
        await emitSync(backgroundThree, "synced")
        expect(getById.mock.calls, "una lectura puntual por evento `synced` de fondo").toEqual([
          [background],
          [backgroundTwo],
          [backgroundThree],
        ])
        expect(list, "sin escanear el catálogo").not.toHaveBeenCalled()
        expect(updateTab, "una fila pendiente no cambia la pestaña de fondo").not.toHaveBeenCalled()

        // Confirmada la fila de una del burst, su siguiente evento la
        // converge con una sola lectura y un solo update.
        confirmCatalogUpsertSyncedDouble(backgroundTwo)
        resetCounts()
        await emitSync(backgroundTwo, "synced")
        expect(getById.mock.calls, "una lectura puntual").toEqual([[backgroundTwo]])
        expect(list, "sin escanear el catálogo").not.toHaveBeenCalled()
        expect(updateTab.mock.calls.map(([input]) => input), "un update de su pestaña").toEqual([
          { tabId: backgroundTwo, saveState: "saved", hasPendingSync: false },
        ])
        await waitFor(
          () =>
            getEditorSessionState().session.tabs.find((tab) => tab.writing_id === backgroundTwo)?.save_state ===
            "saved",
          { label: "pestaña de fondo del burst en Saved" },
        )
      } finally {
        restoreCatalogSpies?.()
        listeners.restore()
      }
    },
    TEST_TIMEOUT_MS,
  )

  // ODE-590 — carrera de activación. Si la pestaña pasa a activa con la
  // lectura de fondo en vuelo, el resultado de fondo se descarta: la
  // reconciliación del activo (aquí, una proyección offline posterior) manda.
  // Mutation: quitar la valla `currentWritingIdRef` de la rama de fondo deja
  // que la lectura resuelva y pise "Saved locally" con "Saved".
  it(
    "carrera: la lectura de fondo en vuelo no pisa el estado que ya calculó el documento activo",
    async () => {
      await mountLoaded()
      const raced = await openSavedLocally("ODE590-CARRERA-FONDO")
      await openSavedLocally("ODE590-CARRERA-ACTIVO")

      const catalog = await getDocumentCatalog()
      const readRow = catalog.getById.bind(catalog)
      let releaseRead!: () => void
      const readGate = new Promise<void>((resolve) => {
        releaseRead = resolve
      })
      let held = false
      const getById = vi.spyOn(catalog, "getById").mockImplementation(async (id) => {
        if (id === raced && !held) {
          held = true
          await readGate
        }
        return readRow(id)
      })

      try {
        // La lectura de la fila de la pestaña de fondo queda en vuelo.
        await emitSync(raced, "synced")
        expect(held, "control positivo: la lectura de fondo quedó en vuelo").toBe(true)

        // La pestaña pasa a activa mientras la lectura sigue en vuelo.
        await clickEditorTab(raced)
        await waitForHydrationReady("el documento de fondo quedó activo")
        expect(activeTab()?.writing_id, "control positivo: la pestaña es la activa").toBe(raced)

        // Estado activo posterior, ajeno a esa lectura: sin conexión.
        await act(async () => {
          emitSyncStatusChange({ writingId: raced, status: "offline" })
        })
        await flush(5)
        await waitFor(() => activeTab()?.save_state === "saved-local" && barSaveState() === "saved-local", {
          label: "el estado activo dice Saved locally",
        })

        // La lectura en vuelo resuelve con la fila ya confirmada: si el
        // resultado de fondo se proyectara, pisaría el estado activo.
        confirmCatalogUpsertSyncedDouble(raced)
        releaseRead()
        await flush(5)
        await advance(50)
        await flush(5)
        expect(activeTab()?.save_state, "el resultado de fondo no pisa el estado activo").toBe("saved-local")
        expect(barSaveState(), "la barra sigue en Saved locally").toBe("saved-local")
      } finally {
        releaseRead()
        getById.mockRestore()
      }
    },
    TEST_TIMEOUT_MS,
  )

  it(
    "error de escritura: barra y pestaña en Needs attention a la vez; el reintento las devuelve juntas a Saved",
    async () => {
      await mountLoaded()
      const writingId = await openSavedLocally("ODE604-ERROR-BASE")
      const file = (await readWorkspaceMarkdown()).find((entry) => entry.contents.includes("ODE604-ERROR-BASE"))
      if (!file) throw new Error("Sin .md del documento")
      const errors = vi.spyOn(console, "error").mockImplementation(() => {})
      try {
        failNextWriteFile(
          (path) => path === file.path,
          () => {
            throw new Error("database is locked")
          },
        )
        await typeInEditor(" ODE604-FALLA")
        await advance(6_000)
        await waitFor(() => barSaveState() === "error" && activeTab()?.save_state === "error", {
          label: "barra y pestaña en Needs attention",
          timeoutMs: 10_000,
        })
        expect(
          errors.mock.calls.some(([message]) => message === "[editor:save] local save failed"),
          "control positivo: la escritura falló de verdad",
        ).toBe(true)
        const onDisk = (await readWorkspaceMarkdown()).find((entry) => entry.path === file.path)?.contents ?? ""
        expect(onDisk, "el disco conserva lo anterior").toContain("ODE604-ERROR-BASE")
        expect(onDisk, "sin la edición fallida").not.toContain("ODE604-FALLA")
        expect(mounted!.editor().getText(), "el contenido sigue en el editor").toContain("ODE604-FALLA")

        // Reintento: el siguiente guardado, con éxito.
        await typeInEditor(" ODE604-REINTENTO")
        await advance(6_000)
        const saved = await waitForMarkdownContaining("ODE604-REINTENTO")
        expect(saved.path, "al mismo archivo").toBe(file.path)
        expect(saved.contents, "el contenido nunca se pierde: lleva también la edición que falló").toContain(
          "ODE604-FALLA",
        )
        await expectBarAndTabMatchDurable(writingId, "saving")

        // La nube confirma: las dos a Saved.
        confirmCatalogUpsertSyncedDouble(writingId)
        await applyCloudSnapshotFor(writingId)
        await expectBarAndTabMatchDurable(writingId, "saved")
      } finally {
        errors.mockRestore()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
