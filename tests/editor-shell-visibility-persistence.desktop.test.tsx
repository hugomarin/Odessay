/**
 * @vitest-environment happy-dom
 *
 * SHARE-05 (ODE-617, PR-A) — en desktop, el cambio de visibilidad hecho desde
 * el panel de propiedades de la shell montada persiste en el catálogo local
 * (la autoridad de metadata del runtime) y sale explícito en la mutación
 * durable que el servicio de sync vacía a la nube; una sesión nueva lo
 * conserva.
 *
 * Por qué existe: SHARE-05 estaba en NONE. En desktop la visibilidad NO vive
 * en el `.md`: vive en `visibility_cache` del catálogo
 * (`document-service-factory.ts:271`), y el payload que viaja a Supabase es la
 * mutación de `sync_mutations` (`document-service-factory.ts:295-303`), que
 * `desktopCatalogSyncService` aplica con `payload.visibility ?? "private"`.
 * El camino real que alcanza `onVisibilityChange` sin selector en la UI es el
 * guardia del panel: un documento `private` con destinatarios se fuerza a
 * `shared` (`properties-panel.tsx:274-281`). Ese estado es exactamente el que
 * el cliente desktop puede crear y persistir (hallazgo F1b de ODE-616).
 *
 * Camino de producción: "New Artifact" real, escritura real, `.md` real en un
 * fs temporal; el INSERT se confirma con el snapshot de la nube (el servicio
 * de sync es el boundary doblado, como en el resto del harness desktop) y el
 * documento se reabre por ruta → botón real "Properties panel" → pestaña real
 * "Share" → `WritingSharesSection` lista destinatarios (Supabase/auth y la
 * ruta web son fronteras externas: se doblan con el cliente mínimo y
 * `world.network`) → el guardia aplica `shared` → guardado real →
 * `SqliteDocumentCatalog` real → mutación durable en la cola del doble de
 * `catalog_dual_write` (espejo del SQL de `index.rs`).
 *
 * Evento de completitud: la fila del catálogo quedó en `shared` y la última
 * mutación accionable lleva `payloadJson.visibility === "shared"`. Es el mismo
 * payload que consume PR-B (la mitad Supabase local), que aquí queda como
 * costura declarada.
 *
 * Mutación (BUILD): quitar `visibility` de `toRemotePayload`
 * (`lib/sync/queue.ts`) pone en rojo el caso web. La variante desktop va a la
 * Guía de review: quitar `visibility: record.visibility` del `payloadJson` de
 * `document-service-factory.ts:295-303` deja este test en rojo; y quitar el
 * `?? "private"` de `desktop-catalog-sync-service.ts:320` haría que una
 * mutación sin el campo se aplicara como privada en la nube, que es el fallo
 * silencioso del issue.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
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
vi.mock("@/lib/runtime/detect", async () =>
  (await import("./support/editor-shell-doubles")).tauriRuntimeDetectDouble(),
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
// Auth de Supabase es frontera externa: el servicio de desktop sharing pide
// un Bearer token antes de llamar a la ruta web. Lo demás del cliente
// (tablas) no se usa en esta cadena y revienta si alguien lo intenta.
vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({
    auth: {
      getSession: async () => ({
        data: { session: { access_token: "ode-617-test-token", user: { id: "user-1" } } },
        error: null,
      }),
    },
    from: () => {
      throw new Error("Supabase directo fuera del alcance de la prueba ODE-617-A")
    },
  }),
}))

const {
  advance,
  clickNewArtifact,
  flush,
  mountEditorShell,
  resetEditorShellWorld,
  typeInEditor,
  waitFor,
  waitForAsync,
  waitForMarkdownContaining,
} = await import("./support/editor-shell-harness")
const { createDesktopWorkspace, destroyDesktopWorkspace, desktopWorkspaceRoot, resetDesktopWorkspace } =
  await import("./support/editor-shell-desktop-doubles")
const { catalogMutationsDouble } = await import(
  "./integration/documents/support/real-desktop-doubles"
)
const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
const { getEditorSessionState } = await import("@/lib/stores/editor-session-store")
const { world } = await import("./support/editor-shell-doubles")
const { act } = await import("react")

const TEST_TIMEOUT_MS = 90_000
const TEXT = "El documento desktop que el panel lleva a compartido."
const RELOAD_EDIT = " ODE617-DESKTOP-TRAS-RECARGA"
const APP_URL = "https://app.odessay.test"

let mounted: Awaited<ReturnType<typeof mountEditorShell>> | null = null
let dbPath = ""

const SHARE_RECIPIENT = {
  userId: "reader-1",
  username: "lectora",
  displayName: "Lectora",
  canRespond: false,
  sharedAt: "2026-09-21T00:00:00.000Z",
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  })
}

/** Frontera externa: el token y las rutas web del servicio de sharing desktop. */
function installSharingNetwork() {
  const fallback = world.network
  world.network = async (url, init) => {
    const method = (init?.method ?? "GET").toUpperCase()
    if (url.endsWith("/shares") && method === "GET") {
      return jsonResponse({ data: [SHARE_RECIPIENT], error: null })
    }
    if (url.endsWith("/share-test-link")) {
      return jsonResponse({
        data: { active: false, token: null, link: null, createdAt: null },
        error: null,
      })
    }
    return fallback(url, init)
  }
}

beforeAll(() => {
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ode617-test.supabase.co")
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY", "ode617-public-test-key")
  vi.stubEnv("NEXT_PUBLIC_APP_URL", APP_URL)
  createDesktopWorkspace("odessay-visibility-persistence-")
  dbPath = join(desktopWorkspaceRoot(), "config", "desktop-index.sqlite3")
})

afterAll(() => {
  destroyDesktopWorkspace()
  vi.unstubAllEnvs()
})

beforeEach(() => {
  resetDesktopWorkspace()
  resetEditorShellWorld({ isDesktop: true })
  installSharingNetwork()
})

afterEach(async () => {
  await mounted?.unmount()
  mounted = null
})

/** Monta la shell y espera a que cargue la sesión (carrera de arranque, ODE-574). */
async function mountLoaded() {
  mounted = await mountEditorShell()
  await waitFor(() => getEditorSessionState().loaded, { label: "sesión cargada" })
  await flush(3)
}

/**
 * El efecto del servicio de sync (boundary doblado) al confirmar el INSERT: el
 * snapshot con la cuenta dueña. Con eso la fila deja de ser local-only y el
 * documento se hidrata `server-confirmed` (el panel monta la sección de
 * shares). Mismo helper que `editor-shell-export-delivery-desktop`.
 */
async function confirmInCloud(writingId: string) {
  const catalog = (await getDocumentCatalog()) as Awaited<ReturnType<typeof getDocumentCatalog>> & {
    applyCloudSnapshots: (snapshots: unknown[]) => Promise<void>
  }
  const record = await catalog.getById(writingId)
  if (!record) throw new Error(`Sin fila de catálogo para ${writingId}`)
  await act(async () => {
    await catalog.applyCloudSnapshots([
      {
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
      },
    ])
  })
  await flush(3)
}

async function reopen(writingId: string, key: string) {
  await mounted!.render({ key, writingId })
  await waitFor(() => mounted!.editor().getText().includes(TEXT), {
    label: "documento abierto por ruta",
  })
  await flush(3)
}

/** Crea un documento real, lo confirma en la nube y lo reabre por ruta. */
async function createConfirmedDocument() {
  await mountLoaded()
  await clickNewArtifact(mounted!.container)
  await typeInEditor(TEXT)
  await advance(6_000)
  await waitForMarkdownContaining(TEXT)
  const writingId = await waitFor(
    () => getEditorSessionState().session.tabs.find((tab) => tab.writing_id)?.writing_id ?? null,
    { label: "documento materializado", timeoutMs: 15_000 },
  )
  await confirmInCloud(writingId)
  await reopen(writingId, `${writingId}:cloud`)
  return writingId
}

/** Abre el panel de propiedades con su botón real y entra a la pestaña Share. */
async function openShareTab() {
  const propertiesButton = await waitFor(
    () => document.querySelector<HTMLButtonElement>('button[aria-label="Properties panel"]'),
    { label: 'botón "Properties panel"' },
  )
  propertiesButton.click()
  await flush(2)

  const shareTab = await waitFor(
    () =>
      Array.from(
        document.querySelectorAll<HTMLElement>(
          '[data-testid="editor-right-panel-tabs"] [role="tab"]',
        ),
      ).find((tab) => (tab.textContent ?? "").trim() === "Share") ?? null,
    { label: "pestaña Share" },
  )
  shareTab.click()
  await flush(2)
}

/** La última mutación accionable del documento (la que el flush vaciaría). */
function latestActionableMutation(writingId: string) {
  const actionable = catalogMutationsDouble(dbPath).filter(
    (mutation) =>
      mutation.documentId === writingId &&
      (mutation.status === "pending" || mutation.status === "failed"),
  )
  return actionable.sort((left, right) => left.createdAt - right.createdAt).at(-1) ?? null
}

function mutationPayload(mutation: { payloadJson: string } | null) {
  if (!mutation) throw new Error("Sin mutación accionable para el documento")
  return JSON.parse(mutation.payloadJson) as Record<string, unknown>
}

describe("ODE-617 desktop — la visibilidad persiste en el catálogo y sale en la mutación", () => {
  it(
    "el guardia del panel fuerza shared: queda en la fila del catálogo y en el payload durable; una sesión nueva lo conserva",
    async () => {
      const writingId = await createConfirmedDocument()

      // Control positivo del punto de partida: privado, sin shares en el panel
      // y con la mutación de materialización accionable.
      const before = await (await getDocumentCatalog()).getById(writingId)
      expect(before?.visibility).toBe("private")

      await openShareTab()

      // El guardia del panel fuerza shared vía onVisibilityChange; el guardado
      // real (debounce de desktop de 4s) deja la fila del catálogo en shared.
      const changed = await waitForAsync(
        async () => {
          const record = await (await getDocumentCatalog()).getById(writingId)
          return record?.visibility === "shared" ? record : null
        },
        { label: "fila del catálogo en shared", timeoutMs: 30_000 },
      )
      expect(changed.syncStatus, "la fila queda pendiente de nube").toBe("pending")

      // El payload que el servicio de sync vaciaría lleva la visibilidad
      // explícita (misma costura que consume PR-B).
      const payload = mutationPayload(latestActionableMutation(writingId))
      expect(payload.visibility, "la mutación durable lleva shared explícito").toBe("shared")
      expect(payload.title, "es la mutación del documento").toBeTruthy()
      const versionBeforeReload = payload.version
      expect(versionBeforeReload, "la mutación lleva la versión avanzada").toEqual(expect.any(Number))

      // Recarga: sesión nueva sobre la misma fila local. La shell hidrata la
      // visibilidad del catálogo y el siguiente guardado la vuelve a llevar.
      await mounted!.unmount()
      mounted = null
      await reopenAfterRemount(writingId)
      expect(
        (await (await getDocumentCatalog()).getById(writingId))?.visibility,
        "la recarga lee shared del catálogo local",
      ).toBe("shared")

      await typeInEditor(RELOAD_EDIT)
      await advance(6_000)
      await waitForMarkdownContaining(RELOAD_EDIT.trim())
      const afterReload = mutationPayload(latestActionableMutation(writingId))
      expect(afterReload.visibility, "el payload posterior a la recarga lleva shared").toBe("shared")
      expect(
        afterReload.version as number,
        "la versión avanzó con el guardado posterior a la recarga",
      ).toBeGreaterThan(versionBeforeReload as number)
    },
    TEST_TIMEOUT_MS,
  )
})

/** Remonta la shell como una sesión nueva y espera la hidratación del documento. */
async function reopenAfterRemount(writingId: string) {
  mounted = await mountEditorShell({ key: `reload:${writingId}`, writingId })
  await waitFor(() => mounted!.editor().getText().includes(TEXT), {
    label: "documento reabierto en sesión nueva",
    timeoutMs: 15_000,
  })
  await flush(3)
}
