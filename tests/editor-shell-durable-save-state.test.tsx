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
const { emitSyncStatusChange } = await import("@/lib/sync/events")
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
  await clickNewArtifact(mounted!.container)
  await typeInEditor(text)
  await advance(6_000)
  await waitForMarkdownContaining(text)
  const created = await waitFor(
    () => {
      const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.writing_id)
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

      await waitFor(() => activeTab()?.save_state === "saved", { label: "pestaña en Saved", timeoutMs: 10_000 })
      expect(activeTab()?.has_pending_sync).toBe(false)
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

      await waitFor(() => activeTab()?.save_state === "saved", { label: "pestaña en Saved", timeoutMs: 10_000 })
      expect(activeTab()?.writing_id).toBeTruthy()
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

      // Con la confirmación durable, el mismo evento sí converge.
      confirmCatalogUpsertSyncedDouble(writingId)
      await act(async () => {
        emitSyncStatusChange({ writingId, status: "synced" })
      })
      await waitFor(() => activeTab()?.save_state === "saved", { label: "pestaña en Saved", timeoutMs: 10_000 })
    },
    TEST_TIMEOUT_MS,
  )
})
