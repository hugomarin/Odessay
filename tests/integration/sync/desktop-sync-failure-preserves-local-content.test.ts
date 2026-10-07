/** @vitest-environment happy-dom */
/**
 * SYNC-03 desktop — un sync fallido conserva el contenido local, con el
 * catálogo de comportamiento real (no mocks).
 *
 * Cadena real: `createDesktopDraft` / `DesktopDocumentService.saveWriting`
 * (el camino de producción del editor; no se siembra la cola a mano) →
 * `SqliteDocumentCatalog` real (la clase de
 * `lib/services/desktop/sqlite-document-catalog.ts`) → `desktopCatalogSyncService`
 * real → la cola durable `sync_mutations` y `documents.sync_status`. Solo se
 * doblan dos fronteras: Supabase (red, `fake-supabase-server.ts`, con fallo
 * one-shot, fallo permanente y retención de la próxima respuesta) y el
 * decodificado IPC de Tauri (`tauri-commands`, vía los dobles de
 * `real-desktop-doubles.ts`, que reproducen el SQL de `index.rs` que leyeron:
 * supersede 700-716/1455-1462, listado 1482-1518 y proyección de estado
 * 1409-1443). El `.md` real en un fs temporal es la autoridad del cuerpo: el
 * flush lo relee en el momento de enviar (`desktop-catalog-sync-service.ts:349-356`).
 *
 * En desktop **no existe el estado `syncing`**: la fila del catálogo solo
 * puede estar `local-only`, `pending`, `failed` o `synced` (el catálogo no
 * persiste un "write in flight"; ver
 * `workflow/context/features/odessay-desktop-document-catalog.md` § Modelo de
 * estados). El estado real de "mutación en vuelo" es **`pending`**: lo escribe
 * el enqueue/dual-write del guardado y se mantiene durante todo el flush hasta
 * que `catalog_update_mutation_status` proyecta el resultado. Lo que SYNC-03
 * exige en desktop es que tras el fallo la fila no quede atascada en ese
 * `pending` en vuelo: pasa a `failed` con reintento agendado (reintentable) o
 * sin reintento (terminal, `attempt_count >= MAX_SYNC_ATTEMPTS = 10`).
 *
 * El mock de `sync-service-factory` es el mismo montaje que
 * `sync-multiple-saves-before-flush.test.ts` (web) y el resto de las pruebas
 * desktop: evita que cada guardado agende el flush por debounce. La prueba
 * conduce `flushPending()` — el método público que producción invoca desde el
 * debounce, el retry ticker y el wakeup — y afirma después de que el flush
 * termina (el evento de completitud), no después de agendarlo.
 *
 * Casos:
 * 1. Fallo reintentable: con la respuesta de Supabase retenida se observa el
 *    control positivo de la ventana en vuelo (la fila es `pending`); al
 *    fallar, el `.md` queda byte a byte, la metadata local (título, estado,
 *    versión) intacta, la fila pasa a `failed` y la mutación queda accionable
 *    con `next_retry_at` futuro. Nada llegó a la nube.
 * 2. Recuperación (requisito 3): un guardado posterior al fallo se encola,
 *    supera a la mutación fallida y el siguiente flush lo sube; la fila acaba
 *    `synced` con la cola accionable vacía. Es también el control positivo del
 *    caso 1: en éxito la fila sí llega a `synced`.
 * 3. Fallo terminal por el camino real: 10 intentos (no se siembra
 *    `attemptCount`; cada flush explícito con el reloj avanzado más allá del
 *    backoff máximo). Tras el 10º la fila queda `failed` sin reintento, la
 *    mutación ya no se vuelve a listar ni a intentar, el `.md` y la metadata
 *    siguen intactos, y el documento sigue editable y guardable: un guardado
 *    posterior se sube.
 *
 * El hueco de ODE-644 (un fallo en vuelo revive la mutación superada por un
 * guardado más nuevo y deja el estado de la fila inconsistente) está
 * caracterizado en
 * `tests/integration/sync/desktop-sync-multiple-saves-before-flush.test.ts`;
 * su arreglo (guard de fila accionable + `NOT EXISTS`, en Rust y en el doble)
 * llegó en ODE-644 PR1. Este archivo no lo redescubre: aquí no hay guardado
 * concurrente, una sola mutación por documento.
 */
import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

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
import { fakeSupabase, fakeSupabaseClient } from "../documents/support/fake-supabase-server"

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for the desktop SYNC-03 proof and was not expected to be called`)
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

vi.mock("@/lib/services/desktop/runtime-detection", () => ({
  isDesktopRuntime: () => true,
}))

vi.mock("@/lib/supabase/desktop-client", () => ({
  createDesktopClient: () => fakeSupabaseClient,
}))

// Igual que el montaje del resto de las pruebas desktop: agendar un flush real
// no aporta al invariante (la cola durable ya quedó escrita por el guardado) y
// haría no determinista la ventana de "flush en vuelo".
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
const { SqliteDocumentCatalog } = await import("@/lib/services/desktop/sqlite-document-catalog")

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const timestamp = (version: number) => `2026-09-30T12:00:${String(version).padStart(2, "0")}.000Z`

/** Espejo de `MAX_SYNC_ATTEMPTS` (`desktop-catalog-sync-service.ts:51`) y de `index.rs:7`. */
const MAX_SYNC_ATTEMPTS = 10

let baseDir: string
let dbPath: string
let catalog: InstanceType<typeof SqliteDocumentCatalog>

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "odessay-sync-03-desktop-"))
  configureRealDesktopDoubles(baseDir)
  dbPath = join(baseDir, "config", "desktop-index.sqlite3")
  catalog = new SqliteDocumentCatalog(dbPath)
})

afterAll(() => {
  rmSync(baseDir, { recursive: true, force: true })
})

afterEach(async () => {
  await desktopCatalogSyncService.stop()
  resetCatalogDoubles()
  resetSettingsStoreDouble()
  fakeSupabase.reset()
  // La configuración y el disco se rehacen por prueba; el root queda.
  rmSync(join(baseDir, "data"), { recursive: true, force: true })
  rmSync(join(baseDir, "config"), { recursive: true, force: true })
})

/** Filas accionables de la cola durable para un documento (pending o failed). */
function actionableMutations(writingId: string) {
  return catalogMutationsDouble(dbPath).filter(
    (mutation) => mutation.documentId === writingId && (mutation.status === "pending" || mutation.status === "failed"),
  )
}

/**
 * La única mutación accionable del documento en esta prueba (no hay guardados
 * concurrentes; las anteriores quedan `synced` por el supersede).
 */
function currentMutation(writingId: string) {
  const rows = actionableMutations(writingId)
  expect(rows, "precondición: una sola mutación accionable para el documento").toHaveLength(1)
  return rows[0]
}

/** Writes de escritura que Supabase aplicó de verdad (los probes de UPDATE 0 filas no cuentan). */
function appliedCloudWrites(table: string) {
  return fakeSupabase.received.filter((write) => write.table === table && write.error === null && write.matched > 0)
}

async function createMaterializedDraft(initialText: string) {
  const draft = await createDesktopDraft({
    title: "Carta ODE-612",
    initialBodyJson: doc(initialText),
    authorId: "user-1",
  })
  expect(draft.error).toBeNull()
  const writingId = draft.data!.id
  const record = await catalog.getById(writingId)
  expect(record?.binding?.canonicalPath).toBeTruthy()
  return { writingId, canonicalPath: record!.binding!.canonicalPath }
}

/** Guardado real del editor: relee el documento abierto y manda el cuerpo nuevo. */
async function saveFromEditor(writingId: string, text: string, version: number, status?: string) {
  const service = await getDocumentService()
  const opened = await service.openWriting(writingId)
  expect(opened.error).toBeNull()
  const current = opened.data!
  const record = {
    ...current,
    content: { ...current.content, richText: doc(text), plainText: text },
    status: (status ?? current.status) as typeof current.status,
    version,
    updatedAt: timestamp(version),
  }
  const saved = await service.saveWriting({ writing: record })
  expect(saved.error).toBeNull()
  return saved.data!
}

describe("SYNC-03 desktop — el fallo de sync conserva el contenido local", () => {
  it("un fallo reintentable deja la fila 'failed' (no atascada en 'pending'), el .md byte a byte y la metadata intactos", async () => {
    const { writingId, canonicalPath } = await createMaterializedDraft("Versión 1.")
    await saveFromEditor(writingId, "Versión 2.", 2, "review")

    const beforeBytes = await readFile(canonicalPath, "utf8")
    expect(beforeBytes, "el .md real tiene la v2 antes del flush").toContain("Versión 2.")
    const beforeRow = await catalog.getById(writingId)
    expect(beforeRow?.syncStatus, "precondición: la mutación en vuelo deja la fila 'pending'").toBe("pending")
    expect(actionableMutations(writingId), "precondición: la v2 está en la cola").toHaveLength(1)

    // Ventana en vuelo real: la respuesta de Supabase queda retenida y el
    // write fallará al soltarse. La fila sigue en su único estado "en vuelo".
    const hold = fakeSupabase.holdNextWrite()
    fakeSupabase.failNextWrite({ message: "network down", code: "503" })
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started
    expect(
      (await catalog.getById(writingId))?.syncStatus,
      "control positivo: mientras el write está en vuelo la fila es 'pending'",
    ).toBe("pending")

    hold.release()
    await flushing

    // Evento de completitud: el flush terminó y proyectó el fallo.
    const mutation = currentMutation(writingId)
    expect(mutation.status).toBe("failed")
    expect(mutation.attemptCount).toBe(1)
    expect(mutation.nextRetryAt, "reintentable: con backoff futuro").toBeGreaterThan(Date.now())
    expect(mutation.lastError).toContain("network down")

    const afterRow = await catalog.getById(writingId)
    expect(
      afterRow?.syncStatus,
      "la fila no queda atascada en su estado de mutación en vuelo ('pending')",
    ).toBe("failed")
    expect(afterRow?.title, "el título local no cambia").toBe(beforeRow?.title)
    expect(afterRow?.status, "el estado local no cambia").toBe("review")
    expect(afterRow?.artifactType).toBe(beforeRow?.artifactType)
    expect(afterRow?.visibility).toBe(beforeRow?.visibility)
    expect(afterRow?.version, "la versión local no cambia").toBe(beforeRow?.version)
    expect(afterRow?.binding?.canonicalPath).toBe(canonicalPath)

    expect(await readFile(canonicalPath, "utf8"), "el .md queda intacto byte a byte").toBe(beforeBytes)
    expect(appliedCloudWrites("writings"), "nada llegó a la nube").toHaveLength(0)
    expect(fakeSupabase.row("writings", writingId)).toBeNull()
  })

  it("un guardado posterior al fallo reintentable se sube", async () => {
    const { writingId } = await createMaterializedDraft("Versión 1.")
    await saveFromEditor(writingId, "Versión 2.", 2)

    fakeSupabase.failNextWrite({ message: "network down", code: "503" })
    const failedFlush = await desktopCatalogSyncService.flushPending()
    expect(failedFlush.data?.failedMutations).toHaveLength(1)
    expect((await catalog.getById(writingId))?.syncStatus).toBe("failed")
    expect(appliedCloudWrites("writings"), "la nube sigue sin el documento").toHaveLength(0)

    // Guardado posterior por el camino real del editor; la mutación nueva
    // supersede a la fallida en la misma transacción (index.rs:700-716).
    await saveFromEditor(writingId, "Versión 3.", 3, "review")
    const queued = actionableMutations(writingId)
    expect(queued, "solo la v3 queda accionable").toHaveLength(1)
    expect(JSON.parse(queued[0].payloadJson).version).toBe(3)

    // Supabase acepta: el siguiente flush sube la versión nueva.
    const recovered = await desktopCatalogSyncService.flushPending()
    expect(recovered.error).toBeNull()
    expect(recovered.data?.failedMutations).toEqual([])
    expect(fakeSupabase.row("writings", writingId), "control positivo: en éxito la fila llega a la nube").toMatchObject({
      body_text: "Versión 3.",
      version: 3,
      status: "review",
    })
    expect((await catalog.getById(writingId))?.syncStatus, "y la fila local queda 'synced'").toBe("synced")
    expect(actionableMutations(writingId), "cola accionable vacía").toHaveLength(0)
  })

  it("el fallo terminal (10 intentos por el camino real) deja la fila 'failed', el contenido intacto y el documento guardable", async () => {
    const { writingId, canonicalPath } = await createMaterializedDraft("Versión 1.")
    await saveFromEditor(writingId, "Versión 2.", 2, "review")

    const beforeBytes = await readFile(canonicalPath, "utf8")
    const beforeRow = await catalog.getById(writingId)

    // Sin sembrar `attemptCount`: el presupuesto se agota por el camino real,
    // avanzando el reloj más allá del backoff máximo (5 min) entre flush y
    // flush explícito (el único que incluye `failed`, junto con el retry tick).
    fakeSupabase.failAllWrites({ message: "network down", code: "503" })
    const realNow = Date.now.bind(Date)
    let offset = 0
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + offset)
    try {
      for (let attempt = 1; attempt <= MAX_SYNC_ATTEMPTS - 1; attempt += 1) {
        offset += 10 * 60_000
        const result = await desktopCatalogSyncService.flushPending()
        expect(result.data?.failedMutations, `intento ${attempt}`).toHaveLength(1)
        // El contenido nunca se toca, ni siquiera a mitad de la cadena.
        expect(await readFile(canonicalPath, "utf8"), `el .md sigue intacto tras el intento ${attempt}`).toBe(beforeBytes)
      }
      const ninth = currentMutation(writingId)
      expect(ninth.attemptCount).toBe(MAX_SYNC_ATTEMPTS - 1)
      expect(ninth.nextRetryAt, "tras 9 intentos la mutación sigue siendo reintentable").not.toBeNull()

      offset += 10 * 60_000
      const terminalFlush = await desktopCatalogSyncService.flushPending()
      expect(terminalFlush.data?.failedMutations, "el 10º intento agota el presupuesto").toHaveLength(1)
    } finally {
      spy.mockRestore()
    }

    const terminal = currentMutation(writingId)
    expect(terminal.status).toBe("failed")
    expect(terminal.attemptCount).toBe(MAX_SYNC_ATTEMPTS)
    expect(terminal.nextRetryAt, "terminal: sin reintento agendado").toBeNull()

    const afterRow = await catalog.getById(writingId)
    expect(afterRow?.syncStatus, "la fila no queda atascada en 'pending'").toBe("failed")
    expect(afterRow?.title).toBe(beforeRow?.title)
    expect(afterRow?.status).toBe("review")
    expect(afterRow?.version).toBe(beforeRow?.version)
    expect(await readFile(canonicalPath, "utf8"), "el .md queda intacto byte a byte").toBe(beforeBytes)

    // Ya terminal, ningún flush posterior la vuelve a listar ni a intentar
    // (el listado de Rust la excluye con attempt_count >= MAX_SYNC_ATTEMPTS).
    const writesBefore = fakeSupabase.received.length
    const idle = await desktopCatalogSyncService.flushPending()
    expect(idle.data?.processedMutations).toBe(0)
    expect(fakeSupabase.received.length, "sin writes nuevos").toBe(writesBefore)
    expect(currentMutation(writingId).attemptCount).toBe(MAX_SYNC_ATTEMPTS)

    // El documento sigue editable y guardable: un guardado posterior se sube.
    fakeSupabase.clearFailures()
    await saveFromEditor(writingId, "Versión 3.", 3, "review")
    const recovered = await desktopCatalogSyncService.flushPending()
    expect(recovered.data?.failedMutations).toEqual([])
    expect(fakeSupabase.row("writings", writingId), "control positivo: en éxito la fila llega a la nube").toMatchObject({
      body_text: "Versión 3.",
      version: 3,
      status: "review",
    })
    expect((await catalog.getById(writingId))?.syncStatus).toBe("synced")
    expect(actionableMutations(writingId), "cola accionable vacía").toEqual([])
  })
})
