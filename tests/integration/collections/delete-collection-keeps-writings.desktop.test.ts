/** @vitest-environment happy-dom */
/**
 * COL-06 desktop (ODE-618, PR1) — borrar una colección no borra ni corrompe sus
 * documentos.
 *
 * Entry point: `deleteLocalCollection` de `lib/queries/desk-catalog-source.ts`,
 * el puerto real que usa `collections-view.tsx` para el gesto de borrar; debajo
 * corre `deleteDesktopCollection` (servicio real) y el comando real de catálogo
 * doblado por transporte. La secuencia de producción es la real: los documentos
 * se materializan con `createDesktopDraft` (`.md` reales en un fs temporal y
 * binding en el catálogo), las colecciones se crean con `createLocalCollection`
 * y se asignan con `setLocalWritingCollections`; no se siembra estado interno.
 *
 * Evento de completitud: la promesa de `deleteLocalCollection` resuelve después
 * de que el comando de catálogo commitea la transacción (soft-delete de la
 * colección + mutación de metadata encolada). Se afirma sobre el resultado
 * canónico: filas del catálogo, bytes de cada `.md` y el join de la vista
 * (`loadCollectionState` / `buildCollectionSummaries`).
 *
 * Fronteras dobladas: solo el transporte Tauri (`tauri-commands`, vía los
 * dobles de `real-desktop-doubles.ts`) y la red de sync (`sync-service-factory`
 * no agenda flush, igual que el resto de las pruebas desktop). Los seams
 * internos están conectados de verdad.
 *
 * F6 (las relaciones de la colección borrada sobreviven, así que un documento
 * cuya única colección se borró desaparece de la vista Collections) se
 * caracteriza aquí como `it.fails` y lo arregla ODE-618 PR1b. COL-06 queda en
 * `PARTIAL_INTEGRATION` con dos seams nombrados: web (PR2) y F6 (PR1b).
 */
import "fake-indexeddb/auto"
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import {
  catalogMetadataMutationsDouble,
  configureRealDesktopDoubles,
  resetCatalogDoubles,
  resetSettingsStoreDouble,
  tauriCatalogDeleteCollectionDouble,
  tauriCatalogDualWriteDouble,
  tauriCatalogGetByIdDouble,
  tauriCatalogListCollectionSnapshotDouble,
  tauriCatalogListDouble,
  tauriCatalogListPendingMetadataMutationsDouble,
  tauriCatalogReplaceWritingCollectionsDouble,
  tauriCatalogResolvePathDouble,
  tauriCatalogSaveCollectionDouble,
  tauriCatalogUpdateMetadataMutationStatusDouble,
  tauriCatalogDetachLocalFileDouble,
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

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(
      `real-desktop-doubles: "${name}" is out of scope for the COL-06 desktop proof and was not expected to be called`,
    )
  })
}

vi.mock("@tauri-apps/api/path", () => tauriPathModuleDouble)

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
  tauriCatalogBulkDualWrite: unimplemented("tauriCatalogBulkDualWrite"),
  tauriCatalogGetById: tauriCatalogGetByIdDouble,
  tauriCatalogResolvePath: tauriCatalogResolvePathDouble,
  tauriCatalogList: tauriCatalogListDouble,
  tauriCatalogDetachLocalFile: tauriCatalogDetachLocalFileDouble,
  tauriCatalogHydrateExcerpts: vi.fn(async () => []),
  tauriCatalogApplyReconcile: unimplemented("tauriCatalogApplyReconcile"),
  tauriCatalogApplyCloudSnapshots: unimplemented("tauriCatalogApplyCloudSnapshots"),
  tauriCatalogApplyWorkspaceRemoval: unimplemented("tauriCatalogApplyWorkspaceRemoval"),
  tauriCatalogActivateBindingRoot: unimplemented("tauriCatalogActivateBindingRoot"),
  tauriCatalogCountBindingRootDocuments: unimplemented("tauriCatalogCountBindingRootDocuments"),
  tauriCatalogListBindingRootDocuments: unimplemented("tauriCatalogListBindingRootDocuments"),
  tauriCatalogListRetiredBindingRoots: unimplemented("tauriCatalogListRetiredBindingRoots"),
  tauriCatalogReactivateBindingRoot: unimplemented("tauriCatalogReactivateBindingRoot"),
  tauriCatalogEnqueueMutation: unimplemented("tauriCatalogEnqueueMutation"),
  tauriCatalogListPendingMutations: unimplemented("tauriCatalogListPendingMutations"),
  tauriCatalogUpdateMutationStatus: unimplemented("tauriCatalogUpdateMutationStatus"),
  tauriCatalogPruneSyncedMutations: unimplemented("tauriCatalogPruneSyncedMutations"),
  tauriCatalogPurgeDocument: unimplemented("tauriCatalogPurgeDocument"),
  tauriCatalogListPendingMetadataMutations: tauriCatalogListPendingMetadataMutationsDouble,
  tauriCatalogUpdateMetadataMutationStatus: tauriCatalogUpdateMetadataMutationStatusDouble,
  tauriCatalogApplyCollectionSnapshot: unimplemented("tauriCatalogApplyCollectionSnapshot"),
  tauriCatalogListCollectionSnapshot: tauriCatalogListCollectionSnapshotDouble,
  tauriCatalogSaveCollection: tauriCatalogSaveCollectionDouble,
  tauriCatalogDeleteCollection: tauriCatalogDeleteCollectionDouble,
  tauriCatalogReplaceWritingCollections: tauriCatalogReplaceWritingCollectionsDouble,
  tauriSettingsRead: tauriSettingsReadDouble,
  tauriSettingsWrite: tauriSettingsWriteDouble,
  tauriSettingsDelete: tauriSettingsDeleteDouble,
  tauriSettingsListKeys: unimplemented("tauriSettingsListKeys"),
  tauriKeychainWrite: unimplemented("tauriKeychainWrite"),
  tauriKeychainRead: unimplemented("tauriKeychainRead"),
  tauriKeychainDelete: unimplemented("tauriKeychainDelete"),
}))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => ({}),
}))

// Igual que el resto de las pruebas desktop: agendar el flush por debounce no
// aporta al invariante (el soft-delete y la cola durable ya quedaron escritas)
// y haría no determinista el estado intermedio.
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft } = await import("@/lib/services/document-service-factory")
const { SqliteDocumentCatalog } = await import("@/lib/services/desktop/sqlite-document-catalog")
const {
  createLocalCollection,
  deleteLocalCollection,
  loadCollectionState,
  loadDeskCatalogData,
  setLocalWritingCollections,
} = await import("@/lib/queries/desk-catalog-source")
const { buildCollectionSummaries } = await import("@/lib/collections/collections")

const docBody = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

let baseDir: string
let dbPath: string
let catalog: InstanceType<typeof SqliteDocumentCatalog>

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "odessay-col-06-desktop-"))
  configureRealDesktopDoubles(baseDir)
  dbPath = join(baseDir, "config", "desktop-index.sqlite3")
  catalog = new SqliteDocumentCatalog(dbPath)
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

afterEach(() => {
  resetCatalogDoubles()
  resetSettingsStoreDouble()
  // La configuración y el disco se rehacen por prueba; el root queda.
  rmSync(join(baseDir, "data"), { recursive: true, force: true })
  rmSync(join(baseDir, "config"), { recursive: true, force: true })
})

/** Materializa un documento real (`.md` en disco + binding en el catálogo). */
async function createMaterializedDocument(text: string) {
  const draft = await createDesktopDraft({
    title: "Documento COL-06",
    initialBodyJson: docBody(text),
    authorId: "user-ode-618",
  })
  expect(draft.error).toBeNull()
  const writingId = draft.data!.id
  const record = await catalog.getById(writingId)
  expect(record?.binding?.canonicalPath).toBeTruthy()
  return {
    writingId,
    canonicalPath: record!.binding!.canonicalPath,
    contentHash: record!.binding!.contentHash,
  }
}

/**
 * Escenario base: dos documentos materializados, una colección compartida
 * (`principal`, que se borra) y otra solo para el primero (`secundaria`).
 * El primero queda en las dos; el segundo solo en la que se borra.
 */
async function setupCollectionScenario() {
  const first = await createMaterializedDocument("# Uno\n\nCuerpo del documento uno.\n")
  const second = await createMaterializedDocument("# Dos\n\nCuerpo del documento dos.\n")
  const principal = await createLocalCollection({ ownerId: "user-ode-618", name: "Principal" })
  const secondary = await createLocalCollection({ ownerId: "user-ode-618", name: "Secundaria" })
  await setLocalWritingCollections(first.writingId, [principal.id, secondary.id])
  await setLocalWritingCollections(second.writingId, [principal.id])
  return { first, second, principal, secondary }
}

describe("COL-06 desktop — borrar una colección no toca sus documentos", () => {
  it("los documentos, sus bindings y los bytes de cada `.md` sobreviven al borrado", async () => {
    const { first, second, principal, secondary } = await setupCollectionScenario()

    // Control positivo de alcanzabilidad: antes del borrado hay dos documentos
    // ligados a `.md` reales y dos colecciones, y el `.md` del segundo existe.
    const beforeFirst = await catalog.getById(first.writingId)
    const beforeSecond = await catalog.getById(second.writingId)
    expect(beforeFirst?.binding?.canonicalPath).toBe(first.canonicalPath)
    expect(beforeSecond?.binding?.canonicalPath).toBe(second.canonicalPath)
    const firstBytes = await readFile(first.canonicalPath)
    const secondBytes = await readFile(second.canonicalPath)
    expect(firstBytes.byteLength).toBeGreaterThan(0)
    const beforeState = await loadCollectionState()
    expect(beforeState.collections.map((collection) => collection.id).sort()).toEqual(
      [principal.id, secondary.id].sort(),
    )
    expect(
      beforeState.writingCollections.filter((row) => row.collection_id === principal.id),
      "control positivo: las dos asignaciones a la colección que se borra existen",
    ).toHaveLength(2)

    await deleteLocalCollection(principal)

    // Resultado canónico 1: las filas del catálogo siguen ahí, con el mismo
    // binding y hash; los bytes de cada `.md` no cambian.
    const afterFirst = await catalog.getById(first.writingId)
    const afterSecond = await catalog.getById(second.writingId)
    expect(afterFirst, "el primer documento sobrevive").not.toBeNull()
    expect(afterSecond, "el segundo documento sobrevive").not.toBeNull()
    expect(afterFirst?.localPresent).toBe(true)
    expect(afterSecond?.localPresent).toBe(true)
    expect(afterFirst?.binding?.canonicalPath).toBe(first.canonicalPath)
    expect(afterSecond?.binding?.canonicalPath).toBe(second.canonicalPath)
    expect(afterFirst?.binding?.contentHash).toBe(first.contentHash)
    expect(afterSecond?.binding?.contentHash).toBe(second.contentHash)
    expect(await readFile(first.canonicalPath)).toEqual(firstBytes)
    expect(await readFile(second.canonicalPath)).toEqual(secondBytes)

    // Resultado canónico 2: la colección borrada sale del listado y la otra
    // conserva su asignación; el join de la vista no pierde ningún documento.
    const { collections, writingCollections } = await loadCollectionState()
    expect(collections.map((collection) => collection.id)).not.toContain(principal.id)
    expect(collections.map((collection) => collection.id)).toContain(secondary.id)
    expect(
      writingCollections.filter((row) => row.collection_id === secondary.id),
      "la asignación a la colección viva no se toca",
    ).toEqual([
      expect.objectContaining({ writing_id: first.writingId, collection_id: secondary.id }),
    ])

    // Control de que el comando hizo su trabajo: la mutación de delete quedó en
    // la cola durable de metadata.
    expect(
      catalogMetadataMutationsDouble(dbPath).filter(
        (mutation) =>
          mutation.entityId === principal.id && mutation.operation === "delete" && mutation.status === "pending",
      ),
      "el borrado encoló su mutación de metadata",
    ).toHaveLength(1)

    // El join de la vista sigue resolviendo el documento en la colección viva.
    const { writings } = await loadDeskCatalogData()
    const summaries = buildCollectionSummaries(collections, writings, writingCollections)
    const secondarySummary = summaries.find((summary) => summary.id === secondary.id)
    expect(secondarySummary?.writingsCount, "Secundaria conserva su documento").toBe(1)
  })

  it("borrar la colección de un documento sin otra asignación no borra el documento ni su `.md`", async () => {
    const { second, principal } = await setupCollectionScenario()
    const beforeBytes = await readFile(second.canonicalPath)

    await deleteLocalCollection(principal)

    const after = await catalog.getById(second.writingId)
    expect(after, "el documento sin otra colección sobrevive").not.toBeNull()
    expect(after?.localPresent).toBe(true)
    expect(after?.binding?.canonicalPath).toBe(second.canonicalPath)
    expect(await readFile(second.canonicalPath)).toEqual(beforeBytes)

    const { collections } = await loadCollectionState()
    expect(collections.map((collection) => collection.id)).not.toContain(principal.id)
  })

  it("el comando de catálogo deja la colección soft-deleted y su metadata encolada", async () => {
    const { principal } = await setupCollectionScenario()

    await deleteLocalCollection(principal)

    const snapshot = await tauriCatalogListCollectionSnapshotDouble(dbPath)
    expect(snapshot.collections.map((collection) => collection.id)).not.toContain(principal.id)
    const deleted = catalogMetadataMutationsDouble(dbPath).find(
      (mutation) => mutation.entityId === principal.id && mutation.operation === "delete",
    )
    expect(deleted?.status).toBe("pending")
  })
})
