/**
 * ODE-617 PR-B — SHARE-05 contra Supabase local (ODE-616 PR1/PR2).
 *
 * Requirement 2 (matriz por runtime) + Requirement 3 (recarga desde la nube en
 * desktop), ejecutados contra la instancia Supabase local real: DB real, RLS
 * real, service role real. La cadena de guardado es la de producción en cada
 * runtime; solo se doblan las fronteras externas ya declaradas por el harness:
 * la sesión de servidor (boundary de cookies), el transporte IPC de Tauri
 * (`real-desktop-doubles.ts`) y —solo en web— el transporte de red del
 * `SyncWorker`, que se enruta al handler real por `createRouteFetch`.
 *
 * Filas de la matriz:
 * - Web sin shares, público → privado: la fila en la DB queda `private`, el
 *   PATCH lleva `visibility: "private"` explícito y el extraño pierde
 *   `/[username]/[slug]` (control positivo antes: lo leía sin sesión).
 * - Web con shares, shared → privado: el guardrail del PATCH
 *   (`app/api/writings/[id]/route.ts:135-149`) lo devuelve como `shared`; el
 *   invitado conserva `/shared/[id]` y el listado.
 * - Desktop con shares, shared → privado: el sync de desktop escribe bajo RLS
 *   (`payload.visibility`), sin el guardrail web, así que crea el estado
 *   privado-con-share (F1b de ODE-616). El invitado pierde `/shared/[id]`,
 *   `GET /api/shared/writings` y la RPC `list_incoming_shared_writings`.
 * - Desktop, recarga desde la nube: `hydrateWritings` refleja la visibilidad
 *   remota cambiada por otra sesión (web real) y **no** revierte un cambio
 *   local pendiente (D-4; la guarda canónica vive en Rust,
 *   `src-tauri/tests/cloud_snapshot_keeps_pending_metadata.rs`).
 *
 * Evento de completitud: la fila en la DB local (`readRow`/admin), la respuesta
 * del handler, las props de la página real y las filas de la RPC.
 *
 * Trampas del harness: los clientes de supabase-js capturan `globalThis.fetch`
 * al construirse; el router de web hace pass-through al fetch original para
 * `127.0.0.1:54321` (admin y user clients siguen siendo reales).
 */
import "fake-indexeddb/auto"
import { randomUUID } from "node:crypto"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Window as HappyWindow } from "happy-dom"
import type { ReactElement } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  catalogMutationsDouble,
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogBulkDualWriteDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogEnqueueMutationDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListDouble,
  tauriCatalogListPendingMetadataMutationsDouble,
  tauriCatalogListPendingMutationsDouble,
  tauriCatalogPruneSyncedMutationsDouble,
  tauriCatalogPurgeDocumentDouble,
  tauriCatalogResolvePathDouble,
  tauriCatalogUpdateMetadataMutationStatusDouble,
  tauriCatalogUpdateMutationStatusDouble,
  tauriCreateFileDouble,
  tauriListRecentFilesDouble,
  tauriOpenFileDouble,
  tauriPathModuleDouble,
  tauriSettingsDeleteDouble,
  tauriSettingsReadDouble,
  tauriSettingsWriteDouble,
  tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFileDouble,
  tauriWriteFileDouble,
} from "../documents/support/real-desktop-doubles"
import {
  SEED_WRITING_BODY,
  cleanupUsers,
  readRow,
  seedShare,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"
import { expectNotFound, serverClientAs } from "../../support/supabase-local/session"

type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord
type Catalog = import("@/lib/services/desktop/sqlite-document-catalog").SqliteDocumentCatalog

// El servicio de sync singleton agenda su propio flush por debounce; las
// pruebas conducen el flush cuando lo deciden (mismo montaje que las pruebas
// canónicas de sync web y desktop).
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for the SHARE-05 proof and was not expected to be called`)
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)
vi.mock("@/lib/services/desktop/runtime-detection", () => ({ isDesktopRuntime: () => true }))
vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => desktopClient,
}))
vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriCreateFile: tauriCreateFileDouble,
  tauriWriteFile: tauriWriteFileDouble,
  tauriOpenFile: tauriOpenFileDouble,
  tauriListRecentFiles: tauriListRecentFilesDouble,
  tauriRenameFile: unimplemented("tauriRenameFile"),
  tauriRelocateFile: unimplemented("tauriRelocateFile"),
  tauriWriteBinaryFile: unimplemented("tauriWriteBinaryFile"),
  tauriResolveAssetPath: unimplemented("tauriResolveAssetPath"),
  tauriReadLocalImageAsset: unimplemented("tauriReadLocalImageAsset"),
  tauriWorkspaceCreate: unimplemented("tauriWorkspaceCreate"),
  tauriWorkspaceInspect: unimplemented("tauriWorkspaceInspect"),
  tauriWorkspaceRepairManifestBindings: unimplemented("tauriWorkspaceRepairManifestBindings"),
  tauriWorkspaceSync: tauriWorkspaceSyncDouble,
  tauriWorkspaceTouchFile: tauriWorkspaceTouchFileDouble,
  tauriComputeContentHash: unimplemented("tauriComputeContentHash"),
  tauriCatalogDualWrite: tauriCatalogDualWriteDouble,
  tauriCatalogBulkDualWrite: tauriCatalogBulkDualWriteDouble,
  tauriCatalogGetById: tauriCatalogGetByIdDouble,
  tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogDetachLocalFile: unimplemented("tauriCatalogDetachLocalFile"),
  tauriCatalogHydrateExcerpts: vi.fn(async () => []),
  tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
  tauriCatalogApplyCloudSnapshots: tauriCatalogApplyCloudSnapshotsDouble,
  tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
  tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
  tauriCatalogEnqueueMutation: tauriCatalogEnqueueMutationDouble,
  tauriCatalogListPendingMutations: tauriCatalogListPendingMutationsDouble,
  tauriCatalogUpdateMutationStatus: tauriCatalogUpdateMutationStatusDouble,
  tauriCatalogPruneSyncedMutations: tauriCatalogPruneSyncedMutationsDouble,
  tauriCatalogPurgeDocument: tauriCatalogPurgeDocumentDouble,
  tauriCatalogListPendingMetadataMutations: tauriCatalogListPendingMetadataMutationsDouble,
  tauriCatalogUpdateMetadataMutationStatus: tauriCatalogUpdateMetadataMutationStatusDouble,
  tauriCatalogApplyCollectionSnapshot: unimplemented("tauriCatalogApplyCollectionSnapshot"),
  tauriCatalogListCollectionSnapshot: unimplemented("tauriCatalogListCollectionSnapshot"),
  tauriCatalogSaveCollection: unimplemented("tauriCatalogSaveCollection"),
  tauriCatalogDeleteCollection: unimplemented("tauriCatalogDeleteCollection"),
  tauriCatalogReplaceWritingCollections: unimplemented("tauriCatalogReplaceWritingCollections"),
  tauriSettingsRead: tauriSettingsReadDouble,
  tauriSettingsWrite: tauriSettingsWriteDouble,
  tauriSettingsDelete: tauriSettingsDeleteDouble,
  tauriSettingsListKeys: unimplemented("tauriSettingsListKeys"),
  tauriKeychainWrite: unimplemented("tauriKeychainWrite"),
  tauriKeychainRead: unimplemented("tauriKeychainRead"),
  tauriKeychainDelete: unimplemented("tauriKeychainDelete"),
}))

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { SyncWorker } = await import("@/lib/sync/worker")
const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
const { SqliteDocumentCatalog } = await import("@/lib/services/desktop/sqlite-document-catalog")
const SharedReadingPage = (await import("@/app/(reading)/shared/[id]/page")).default
const PublicWritingPage = (await import("@/app/[username]/[slug]/page")).default
const { GET: getWriting, PATCH: patchWriting } = await import("@/app/api/writings/[id]/route")
const { GET: sharedWritingsGet } = await import("@/app/api/shared/writings/route")
const { createClient: createServerClientMock } = await import("@/lib/supabase/server")

const createClientMock = createServerClientMock as unknown as {
  mockImplementation: (impl: () => Promise<SupabaseClient>) => void
}

const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)
const timestamp = (seconds: number) => `2026-10-01T00:${String(seconds).padStart(2, "0")}:00.000Z`
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const pageParams = (id: string) => ({ params: Promise.resolve({ id }) })

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let viewer!: SeedUser
let stranger!: SeedUser
let ownerClient!: SupabaseClient
let desktopClient!: SupabaseClient
let baseDir = ""
let catalog: Catalog

const originalFetch = globalThis.fetch

// El harness corre en node (trampa 1: el entorno happy-dom completo choca con
// las costuras de red del stack local). El motor canónico de documentos de
// desktop sí necesita DOM para el round-trip markdown → TipTap →
// (`@tiptap/core` usa `window.DOMParser`); se le presta solo esa frontera con
// un `Window` de happy-dom, sin reemplazar fetch/Request/Response.
const dom = new HappyWindow()

async function actAs(user: SeedUser | null): Promise<void> {
  const client = await serverClientAs(user)
  createClientMock.mockImplementation(async () => client)
}

type ReadingElementProps = { writing: { id: string } }

function readingProps(element: unknown): ReadingElementProps {
  if (!element || typeof element !== "object" || !("props" in element)) {
    throw new Error("[sharing] la página no devolvió un elemento")
  }
  return (element as ReactElement<ReadingElementProps>).props
}

async function incomingIds(as: SeedUser | null): Promise<string[]> {
  await actAs(as)
  const fetchRoute = createRouteFetch({ "/api/shared/writings": sharedWritingsGet })
  const response = await fetchRoute("http://harness.test/api/shared/writings")
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: Array<{ id: string }> }
  return body.data.map((item) => item.id)
}

async function rpcIncomingIds(as: SeedUser): Promise<string[]> {
  const client = await createUserClient(as)
  const { data, error } = await client.rpc("list_incoming_shared_writings")
  expect(error).toBeNull()
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
}

/**
 * Router de fetch para el SyncWorker real: `/api/...` entra al handler real
 * con el Bearer del usuario; `127.0.0.1:54321` usa el fetch original (los
 * clientes que se construyen dentro del handler no se recursan).
 */
function installRoutedFetch(
  routes: Record<string, (request: Request) => Promise<Response> | Response>,
  as: SeedUser | null,
): void {
  const routeFetch = createRouteFetch(routes, { as })
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === "string" ? new URL(input, "http://harness.test").toString() : input, init)
    const url = new URL(request.url)
    if (url.origin === "http://127.0.0.1:54321") return originalFetch(request)
    return routeFetch(request)
  })
}

/** PATCH real con captura del body enviado y de la respuesta del servidor. */
function patchRouteWithCapture(id: string, sent: string[], received: Array<Record<string, unknown>>) {
  return async (request: Request) => {
    sent.push(await request.clone().text())
    const response = await patchWriting(request, { params: Promise.resolve({ id }) })
    received.push((await response.clone().json()) as Record<string, unknown>)
    return response
  }
}

async function ownerReadWriting(id: string): Promise<Record<string, unknown>> {
  const fetchRoute = createRouteFetch(
    { [`/api/writings/${id}`]: (request) => getWriting(request, { params: Promise.resolve({ id }) }) },
    { as: owner },
  )
  const response = await fetchRoute(`http://harness.test/api/writings/${id}`)
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: Record<string, unknown> }
  return body.data
}

function webRecordFrom(local: LocalWriting, overrides: Partial<WritingRecord> = {}): WritingRecord {
  return {
    id: local.id,
    authorId: local.author_id ?? null,
    title: local.title ?? null,
    content: { richText: local.body_json, markdown: null, plainText: local.body_text, canonicalSource: "rich-text" },
    slug: local.slug ?? null,
    status: local.status,
    artifactType: local.artifact_type ?? "general",
    visibility: local.visibility,
    parentId: local.parent_id ?? null,
    correspondenceId: local.correspondence_id ?? null,
    version: local.version + 1,
    deletedAt: null,
    createdAt: local.created_at,
    updatedAt: timestamp(local.version + 1),
    ...overrides,
  }
}

async function seedLocalWriting(input: {
  id: string
  title: string
  visibility: LocalWriting["visibility"]
}): Promise<LocalWriting> {
  const row: LocalWriting = {
    id: input.id,
    title: input.title,
    body_json: SEED_WRITING_BODY,
    body_text: "ODE-616 harness",
    status: "draft",
    artifact_type: "general",
    visibility: input.visibility,
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: timestamp(0),
    updated_at: timestamp(1),
    local_updated_at: 1_000,
  }
  await localDB.writings.save(row)
  return (await localDB.writings.get(input.id)) ?? row
}

async function createDesktopDoc(title: string): Promise<string> {
  const draft = await createDesktopDraft({
    title,
    initialBodyJson: doc("Cuerpo SHARE-05"),
    authorId: owner.id,
    visibility: "private",
  })
  expect(draft.error).toBeNull()
  const writingId = draft.data!.id
  expect((await catalog.getById(writingId))?.binding?.canonicalPath).toBeTruthy()
  return writingId
}

async function saveDesktopVisibility(writingId: string, visibility: WritingRecord["visibility"]): Promise<void> {
  const service = await getDocumentService()
  const opened = await service.openWriting(writingId)
  expect(opened.error).toBeNull()
  const current = opened.data!
  const saved = await service.saveWriting({
    writing: { ...current, visibility, version: current.version + 1, updatedAt: new Date().toISOString() },
  })
  expect(saved.error).toBeNull()
}

async function flushDesktop(): Promise<void> {
  const result = await desktopCatalogSyncService.flushPending()
  if (result.data?.failedMutations.length) {
    const rows = catalogMutationsDouble(join(baseDir, "config", "desktop-index.sqlite3"))
    const failed = rows.filter((mutation) => result.data!.failedMutations.includes(mutation.id))
    throw new Error(`[sharing] flush desktop falló: ${failed.map((mutation) => mutation.lastError).join("; ")}`)
  }
  expect(result.error).toBeNull()
}

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "viewer", "stranger"])
  ;[owner, viewer, stranger] = users
  ownerClient = await createUserClient(owner)
  desktopClient = ownerClient

  baseDir = mkdtempSync(join(tmpdir(), "odessay-share-05-"))
  configureRealDesktopDoubles(baseDir)
  catalog = new SqliteDocumentCatalog(join(baseDir, "config", "desktop-index.sqlite3"))
})

afterAll(async () => {
  await cleanupUsers(users)
  rmSync(baseDir, { recursive: true, force: true })
})

beforeEach(() => {
  setLocalDBScope(`ode-617-${crypto.randomUUID()}`)
  const domGlobals = {
    document: dom.document,
    DOMParser: dom.DOMParser,
    Node: dom.Node,
    Element: dom.Element,
    HTMLElement: dom.HTMLElement,
    Text: dom.Text,
    DocumentFragment: dom.DocumentFragment,
  }
  for (const [name, value] of Object.entries(domGlobals)) vi.stubGlobal(name, value)
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
    ...domGlobals,
  })
})

afterEach(() => {
  resetCatalogDoubles()
  resetSettingsStoreDouble()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  rmSync(join(baseDir, "data"), { recursive: true, force: true })
  rmSync(join(baseDir, "config"), { recursive: true, force: true })
})

describe("Requirement 2 — Web", () => {
  it("de público a privado: el PATCH lleva la visibilidad explícita, la DB queda private y el extraño pierde la ruta pública", async () => {
    const title = `Web publico ${runId}`
    const id = await seedWriting(admin, { authorId: owner.id, title, visibility: "public" })
    const slug = (await readRow<{ slug: string | null }>(admin, "writings", id))?.slug ?? ""
    expect(slug).not.toBe("")

    // Control positivo: sin sesión, el público se sirve desde la ruta pública.
    await actAs(null)
    const before = readingProps(
      await PublicWritingPage({ params: Promise.resolve({ username: owner.username, slug }) }),
    )
    expect(before.writing.id).toBe(id)

    const local = await seedLocalWriting({ id, title, visibility: "public" })
    const sent: string[] = []
    const received: Array<Record<string, unknown>> = []
    installRoutedFetch({ [`/api/writings/${id}`]: patchRouteWithCapture(id, sent, received) }, owner)
    const worker = new SyncWorker({ localDb: localDB, isOnline: () => true })

    const saved = await webDocumentService.saveWriting({
      writing: webRecordFrom(local, { visibility: "private" }),
    })
    expect(saved.error).toBeNull()
    await worker.flush()

    // Evento de completitud: el body enviado, la respuesta del handler y la fila
    // canónica en la DB local.
    expect(sent).toHaveLength(1)
    expect(JSON.parse(sent[0]), "el payload lleva la visibilidad explícita").toMatchObject({
      visibility: "private",
    })
    expect((received[0]?.data as { visibility?: string } | undefined)?.visibility).toBe("private")
    expect((await readRow<{ visibility: string }>(admin, "writings", id))?.visibility).toBe("private")
    expect(await ownerReadWriting(id)).toMatchObject({ id, visibility: "private" })

    // Sesión nueva (otro cliente, sin estado local): el acceso sigue a la fila.
    await actAs(stranger)
    await expectNotFound(() =>
      PublicWritingPage({ params: Promise.resolve({ username: owner.username, slug }) }),
    )
    await actAs(owner)
    expect(readingProps(await SharedReadingPage(pageParams(id))).writing.id).toBe(id)
  })

  it("de shared a privado con shares: el servidor conserva shared y el invitado no pierde el acceso", async () => {
    const title = `Web compartido ${runId}`
    const id = await seedWriting(admin, { authorId: owner.id, title, visibility: "shared" })
    await seedShare(ownerClient, { writingId: id, sharedWithId: viewer.id })

    // Control positivo: el invitado ya lo lee y el listado lo incluye.
    await actAs(viewer)
    expect(readingProps(await SharedReadingPage(pageParams(id))).writing.id).toBe(id)
    expect(await incomingIds(viewer)).toContain(id)

    const local = await seedLocalWriting({ id, title, visibility: "shared" })
    const sent: string[] = []
    const received: Array<Record<string, unknown>> = []
    installRoutedFetch({ [`/api/writings/${id}`]: patchRouteWithCapture(id, sent, received) }, owner)
    const worker = new SyncWorker({ localDb: localDB, isOnline: () => true })

    const saved = await webDocumentService.saveWriting({
      writing: webRecordFrom(local, { visibility: "private" }),
    })
    expect(saved.error).toBeNull()
    await worker.flush()

    // El guardrail del servidor conserva "shared" aunque el payload pida
    // "private": la DB y el eco local dicen shared.
    expect(JSON.parse(sent[0])).toMatchObject({ visibility: "private" })
    expect((received[0]?.data as { visibility?: string } | undefined)?.visibility).toBe("shared")
    expect((await readRow<{ visibility: string }>(admin, "writings", id))?.visibility).toBe("shared")
    expect((await localDB.writings.get(id))?.visibility).toBe("shared")

    // El invitado conserva el acceso.
    await actAs(viewer)
    expect(readingProps(await SharedReadingPage(pageParams(id))).writing.id).toBe(id)
    expect(await incomingIds(viewer)).toContain(id)
  })
})

describe("Requirement 2 — Desktop", () => {
  it("de shared a privado con shares: el invitado pierde /shared, el listado y la RPC", async () => {
    const writingId = await createDesktopDoc(`Desktop compartido ${runId}`)
    await flushDesktop()
    await saveDesktopVisibility(writingId, "shared")
    await flushDesktop()
    await seedShare(ownerClient, { writingId, sharedWithId: viewer.id })

    // Control positivo: el invitado ya lo lee, el listado y la RPC lo incluyen.
    await actAs(viewer)
    expect(readingProps(await SharedReadingPage(pageParams(writingId))).writing.id).toBe(writingId)
    expect(await incomingIds(viewer)).toContain(writingId)
    expect(await rpcIncomingIds(viewer)).toContain(writingId)

    // El cambio real de desktop: save bajo RLS, sin el guardrail web (F1b).
    await saveDesktopVisibility(writingId, "private")
    await flushDesktop()

    // Fila en la DB local.
    expect((await readRow<{ visibility: string }>(admin, "writings", writingId))?.visibility).toBe(
      "private",
    )

    await actAs(viewer)
    await expectNotFound(() => SharedReadingPage(pageParams(writingId)))
    expect(await incomingIds(viewer)).not.toContain(writingId)
    expect(await rpcIncomingIds(viewer)).not.toContain(writingId)

    // El dueño conserva el acceso (control).
    await actAs(owner)
    expect(readingProps(await SharedReadingPage(pageParams(writingId))).writing.id).toBe(writingId)
  })
})

describe("Requirement 3 — Desktop, recarga desde la nube", () => {
  it("hydrateWritings refleja la visibilidad remota y no revierte un cambio local pendiente", async () => {
    const writingId = await createDesktopDoc(`Desktop recarga ${runId}`)
    await flushDesktop()
    expect((await readRow<{ visibility: string }>(admin, "writings", writingId))?.visibility).toBe(
      "private",
    )

    // Otra sesión (el PATCH web real del dueño) cambia la visibilidad en la nube.
    const cloud = await readRow<Record<string, unknown>>(admin, "writings", writingId)
    expect(cloud).not.toBeNull()
    const nextVersion = Number(cloud?.version ?? 1) + 1
    const fetchRoute = createRouteFetch(
      {
        [`/api/writings/${writingId}`]: (request) =>
          patchWriting(request, { params: Promise.resolve({ id: writingId }) }),
      },
      { as: owner },
    )
    const response = await fetchRoute(`http://harness.test/api/writings/${writingId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: cloud?.title ?? null,
        body_json: cloud?.body_json ?? doc("Cuerpo SHARE-05"),
        body_text: cloud?.body_text ?? "Cuerpo SHARE-05",
        slug: cloud?.slug ?? null,
        status: cloud?.status ?? "draft",
        artifact_type: cloud?.artifact_type ?? "general",
        visibility: "public",
        parent_id: cloud?.parent_id ?? null,
        correspondence_id: cloud?.correspondence_id ?? null,
        version: nextVersion,
        updated_at: timestamp(20),
      }),
    })
    expect(response.status).toBe(200)

    // Recarga: el documento local refleja la visibilidad remota.
    const hydrated = await desktopCatalogSyncService.hydrateWritings()
    expect(hydrated.error).toBeNull()
    const afterReload = await catalog.getById(writingId)
    expect(afterReload?.visibility).toBe("public")
    expect(afterReload?.syncStatus).toBe("synced")

    // Cambio local pendiente con la nube todavía pública.
    await saveDesktopVisibility(writingId, "private")
    expect((await catalog.getById(writingId))?.visibility).toBe("private")
    expect((await catalog.getById(writingId))?.syncStatus).toBe("pending")

    // La hidratación no puede revertir el valor pendiente (D-4).
    const conflictingHydration = await desktopCatalogSyncService.hydrateWritings()
    expect(conflictingHydration.error).toBeNull()
    const stillPending = await catalog.getById(writingId)
    expect(stillPending?.visibility, "el snapshot no pisa la visibilidad pendiente").toBe("private")
    expect(stillPending?.syncStatus, "la fila sigue pendiente").toBe("pending")
    expect(catalogMutationsDouble(join(baseDir, "config", "desktop-index.sqlite3")).filter(
      (mutation) => mutation.documentId === writingId && mutation.status === "pending",
    )).toHaveLength(1)

    // El flush sube el cambio y la recarga posterior lo confirma desde la nube.
    await flushDesktop()
    expect((await readRow<{ visibility: string }>(admin, "writings", writingId))?.visibility).toBe(
      "private",
    )
    const confirmedHydration = await desktopCatalogSyncService.hydrateWritings()
    expect(confirmedHydration.error).toBeNull()
    const confirmed = await catalog.getById(writingId)
    expect(confirmed?.visibility).toBe("private")
    expect(confirmed?.syncStatus).toBe("synced")
  })
})
