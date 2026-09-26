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
 * uno de fondo no lee el catálogo; y abrir documentos no suma listeners de
 * sync (una suscripción global, no una por pestaña).
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
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, resetDesktopWorkspace } = await import(
  "./support/editor-shell-desktop-doubles"
)
const { confirmCatalogUpsertSyncedDouble } = await import("./integration/documents/support/real-desktop-doubles")
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

  it(
    "coste por evento: una lectura puntual del catálogo, ningún escaneo, ningún listener por pestaña",
    async () => {
      const listeners = trackSyncListeners()
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

        // De fondo: sin lectura del catálogo, a lo sumo su pestaña.
        resetCounts()
        await emitSync(background, "syncing")
        expect(getById, "un evento de fondo no lee el catálogo").not.toHaveBeenCalled()
        expect(list).not.toHaveBeenCalled()
        expect(updateTab.mock.calls.length, "a lo sumo un update, el de su pestaña").toBeLessThanOrEqual(1)
        expect(barSaveState(), "la barra sigue siendo la del documento activo").toBe("saved")
      } finally {
        listeners.restore()
      }
    },
    TEST_TIMEOUT_MS,
  )
})
