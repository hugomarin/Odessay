/** @vitest-environment happy-dom */
/**
 * SYNC-05 desktop — varios guardados locales antes de sincronizar: lo que llega
 * a la nube es la última versión completa, no una intermedia ni una mezcla; y
 * un guardado durante un flush en vuelo no se pierde en la cola (si el write en
 * vuelo falla, su metadata sí puede perderse en la nube: ODE-644, casos 4-5).
 *
 * Cadena real: `DesktopDocumentService.saveWriting` / `updateWritingMetadata`
 * (el camino de producción; `createDesktopDraft` materializa el documento, no
 * se siembra la cola a mano) → `SqliteDocumentCatalog` real (la clase de
 * `lib/services/desktop/sqlite-document-catalog.ts`) → `desktopCatalogSyncService`
 * real → `sync_mutations` y `documents.sync_status`. Solo se doblan dos
 * fronteras: Supabase (red, `fake-supabase-server.ts`) y el decodificado IPC de
 * Tauri (`tauri-commands`, vía los dobles de comportamiento de
 * `real-desktop-doubles.ts`, que reproducen el SQL de `index.rs` que leyeron:
 * supersede 700-716/1455-1462, listado 1482-1518 y proyección de estado
 * 1409-1443). El `.md` real en un fs temporal es la autoridad del cuerpo: el
 * flush lo relee en el momento de enviar (`desktop-catalog-sync-service.ts:349-356`).
 *
 * El mock de `sync-service-factory` es el mismo montaje que
 * `sync-multiple-saves-before-flush.test.ts` (web) y el resto de las pruebas
 * desktop: evita que cada guardado agende el flush por debounce. La prueba
 * conduce `flushPending()` — el método público que producción invoca desde el
 * debounce, el retry ticker y el wakeup — cuando lo decide, y afirma después
 * de que el flush termina.
 *
 * Casos:
 * 1. Tres guardados con cuerpos distintos y un cambio de metadata entre medio,
 *    antes del flush: la cola supersede y solo envía la última mutación; el
 *    cuerpo que llega sale del `.md` final. Control positivo por guardado: cada
 *    intermedio sí encoló su mutación antes de ser reemplazado.
 * 2. Un guardado durante un flush en vuelo (respuesta de Supabase retenida)
 *    sobrevive en la cola y el siguiente flush lo envía.
 * 3. (it.fails, ODE-644) El riesgo del Recon: `catalog_update_mutation_status`
 *    no protege el estado previo de la mutación (`index.rs:1422-1424`). Con un
 *    guardado durante el flush, el éxito deja `documents.sync_status='synced'`
 *    aunque la v4 siga `pending`. El caso afirma el comportamiento correcto; el
 *    doble reproduce el SQL real, y la confirmación contra Rust/SQLite real es
 *    la costura TS→Rust de ODE-613.
 * 4. (it.fails, ODE-644) El mismo hueco en la rama de fallo: la mutación
 *    superada revive como `failed` accionable.
 * 5. (it.fails, ODE-644) El estado final de la nube en esa secuencia: la v3
 *    falla en vuelo, la v4 se guarda (status review) y sube bien, y el
 *    reintento de la v3 tras el backoff llega DESPUÉS y pisa la nube — la
 *    metadata de la v4 se pierde y la versión retrocede, en silencio. El caso
 *    afirma el estado correcto: la nube conserva la v4.
 * 6. Cobertura del orden del listado (`created_at ASC`, `index.rs:1516`): con
 *    la v3 revivida y la v4 accionables en el mismo flush, la vieja se procesa
 *    primero y la nueva la pisa; el orden inverso dejaría la nube en la vieja.
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
import { computeMarkdownContentHash } from "@/lib/content-hash"

function unimplemented(name: string) {
  return vi.fn(async () => {
    throw new Error(`real-desktop-doubles: "${name}" is out of scope for the desktop SYNC-05 proof and was not expected to be called`)
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

// Igual que el montaje web y que el resto de las pruebas desktop: agenda un
// flush real no aporta al invariante (la cola durable ya quedó escrita por el
// guardado) y haría no determinista la ventana de "flush en vuelo".
vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createDesktopDraft, getDocumentService } = await import("@/lib/services/document-service-factory")
const { desktopCatalogSyncService } = await import("@/lib/sync/desktop-catalog-sync-service")
const { SqliteDocumentCatalog } = await import("@/lib/services/desktop/sqlite-document-catalog")

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })
const timestamp = (version: number) => `2026-09-30T12:00:${String(version).padStart(2, "0")}.000Z`

let baseDir: string
let dbPath: string
let catalog: InstanceType<typeof SqliteDocumentCatalog>

beforeAll(() => {
  baseDir = mkdtempSync(join(tmpdir(), "odessay-sync-05-desktop-"))
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

/** Writes de escritura que Supabase aplicó de verdad (los probes de UPDATE 0 filas no cuentan). */
function appliedCloudWrites(table: string) {
  return fakeSupabase.received.filter((write) => write.table === table && write.error === null && write.matched > 0)
}

function cloudBodyTexts(table: string): string[] {
  return appliedCloudWrites(table).map((write) => {
    const payload = Array.isArray(write.payload) ? write.payload[0] : write.payload
    return String(payload.body_text ?? "")
  })
}

async function createMaterializedDraft(initialText: string) {
  const draft = await createDesktopDraft({
    title: "Carta ODE-611",
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

describe("SYNC-05 desktop — varios guardados antes del flush: la última versión gana", () => {
  it("tres guardados con una metadata entre medio: a la nube solo llega la versión final completa", async () => {
    const { writingId, canonicalPath } = await createMaterializedDraft("Versión 1.")
    const service = await getDocumentService()

    // Control positivo del punto de partida: el materializar el borrador ya
    // encoló su propia mutación, accionable y sin cuerpo en el payload (el
    // cuerpo vive en el `.md`, `document-service-factory.ts:289-303`).
    expect(actionableMutations(writingId), "el borrador materializado encoló su mutación").toHaveLength(1)

    await saveFromEditor(writingId, "Versión 2.", 2)
    const afterSave2 = actionableMutations(writingId)
    expect(afterSave2, "el guardado 2 reemplazó a la mutación del borrador").toHaveLength(1)
    const boundAfterSave2 = (await catalog.getById(writingId))!.binding!
    expect(
      JSON.parse(afterSave2[0].payloadJson).contentHash,
      "control positivo: la mutación del guardado 2 apuntaba al hash de la v2 en disco",
    ).toBe(boundAfterSave2.contentHash)
    expect(await readFile(canonicalPath, "utf8"), "control positivo: el .md real tiene la v2").toContain("Versión 2.")

    const meta = await service.updateWritingMetadata({
      writingId,
      status: "review",
      version: 3,
      updatedAt: timestamp(3),
    })
    expect(meta.error).toBeNull()
    const afterMeta = actionableMutations(writingId)
    expect(afterMeta, "la edición de metadata reemplazó a la mutación del guardado 2").toHaveLength(1)
    expect(
      JSON.parse(afterMeta[0].payloadJson).mutationKind,
      "control positivo: la intermedia era la mutación de metadata",
    ).toBe("metadata")

    await saveFromEditor(writingId, "Versión 3.", 4, "review")
    const queued = actionableMutations(writingId)
    expect(queued, "el guardado 3 reemplazó a la mutación de metadata").toHaveLength(1)
    const queuedPayload = JSON.parse(queued[0].payloadJson)
    const boundBeforeFlush = (await catalog.getById(writingId))!.binding!
    expect(queuedPayload.contentHash, "la cola apunta al hash del .md final").toBe(boundBeforeFlush.contentHash)
    expect(queuedPayload.status).toBe("review")
    expect(queuedPayload.version).toBe(4)

    // Antes del flush no llegó ninguna escritura aplicada a la nube.
    expect(appliedCloudWrites("writings"), "nada se envió antes del flush").toHaveLength(0)

    const result = await desktopCatalogSyncService.flushPending()
    expect(result.error).toBeNull()
    expect(result.data?.failedMutations).toEqual([])

    // Lo que llegó a la nube: una sola escritura efectiva, la última versión
    // completa. El UPDATE probe de 0 filas (la fila cloud aún no existía) no
    // aplica y no cuenta; el INSERT que sí aplica lleva cuerpo y metadata juntos.
    const applied = appliedCloudWrites("writings")
    expect(applied, "sin versiones intermedias en la nube").toHaveLength(1)
    expect(applied[0].kind).toBe("insert")
    const cloudRow = applied[0].payload as Record<string, unknown>
    expect(cloudRow.body_text, "el cuerpo sale del último .md").toBe("Versión 3.")
    expect(cloudRow.status, "la metadata final").toBe("review")
    expect(cloudRow.version, "la versión final").toBe(4)
    expect(cloudRow.content_hash, "el hash del .md final").toBe(
      await computeMarkdownContentHash(await readFile(canonicalPath, "utf8")),
    )

    expect(fakeSupabase.row("writings", writingId)?.body_text, "el servidor queda en la última versión").toBe(
      "Versión 3.",
    )
    const finalRecord = await catalog.getById(writingId)
    expect(finalRecord?.syncStatus, "la fila queda confirmada").toBe("synced")
    expect(actionableMutations(writingId), "y la cola accionable vacía").toHaveLength(0)
  })

  it("un guardado durante un flush en vuelo queda pendiente y el siguiente flush lo envía", async () => {
    const { writingId, canonicalPath } = await createMaterializedDraft("Versión 1.")

    await saveFromEditor(writingId, "Versión 3.", 3)
    expect(actionableMutations(writingId), "precondición: la v3 está en la cola").toHaveLength(1)

    // El transporte retiene la respuesta: la v3 está en vuelo.
    const hold = fakeSupabase.holdNextWrite()
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started

    // El editor guarda la v4 mientras la v3 está en la nube.
    await saveFromEditor(writingId, "Versión 4.", 4)
    const heldV3 = actionableMutations(writingId)
    expect(heldV3, "la v4 reemplazó a la v3 en la cola").toHaveLength(1)
    expect(
      JSON.parse(heldV3[0].payloadJson).contentHash,
      "la mutación accionable es la de la v4",
    ).toBe((await catalog.getById(writingId))!.binding!.contentHash)

    hold.release()
    await flushing

    // Evento de completitud del primer flush: la v4 sobrevive en la cola, su
    // cuerpo está en el `.md`, y la nube recibió la v3 que estaba en vuelo.
    expect(actionableMutations(writingId), "la v4 sigue accionable").toHaveLength(1)
    expect(JSON.parse(actionableMutations(writingId)[0].payloadJson).version).toBe(4)
    expect(await readFile(canonicalPath, "utf8"), "el disco tiene la v4").toContain("Versión 4.")
    expect(cloudBodyTexts("writings"), "el primer flush envió la v3, no la v4").toEqual(["Versión 3."])

    // El siguiente sync envía la v4: no se pierde.
    const second = await desktopCatalogSyncService.flushPending()
    expect(second.error).toBeNull()
    expect(second.data?.failedMutations).toEqual([])
    expect(cloudBodyTexts("writings"), "el siguiente flush envía la v4").toEqual(["Versión 3.", "Versión 4."])
    expect(fakeSupabase.row("writings", writingId)?.body_text, "la nube queda en la última versión").toBe(
      "Versión 4.",
    )
    expect(actionableMutations(writingId), "cola accionable vacía").toHaveLength(0)
    expect((await catalog.getById(writingId))?.syncStatus).toBe("synced")
  })

  // ODE-644 — el riesgo que el Recon dejó sin verificar para ODE-611:
  // `catalog_update_mutation_status` no protege el estado previo de la
  // mutación (`index.rs:1422-1424`). El doble reproduce ese SQL tal cual; la
  // prueba afirma el estado correcto (el documento sigue `pending` porque la
  // v4 no se ha subido) y falla contra la semántica real, que proyecta
  // `synced` desde la mutación vieja aunque exista una más nueva pendiente.
  // Se cierra con la costura TS→Rust/SQLite de ODE-613.
  it.fails("un guardado en vuelo no deja la fila en synced con su versión todavía pendiente (ODE-644)", async () => {
    const { writingId } = await createMaterializedDraft("Versión 1.")

    await saveFromEditor(writingId, "Versión 3.", 3)
    const hold = fakeSupabase.holdNextWrite()
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started

    await saveFromEditor(writingId, "Versión 4.", 4)
    hold.release()
    await flushing

    expect(actionableMutations(writingId), "la v4 sigue pendiente tras el flush").toHaveLength(1)
    expect(
      (await catalog.getById(writingId))?.syncStatus,
      "con la v4 pendiente, la fila no puede decir 'synced'",
    ).toBe("pending")
  })

  // ODE-644, la otra mitad del mismo hueco: si el write en vuelo falla después
  // de que la v4 lo superó, producción revive la mutación vieja como `failed`
  // accionable (`index.rs:1422-1424`) y marca el documento `failed`. El caso
  // afirma que una mutación superada no vuelve a la cola accionable.
  it.fails("un fallo en vuelo no revive una mutación ya superada (ODE-644)", async () => {
    const { writingId } = await createMaterializedDraft("Versión 1.")

    await saveFromEditor(writingId, "Versión 3.", 3)
    const v3Id = actionableMutations(writingId)[0].id

    fakeSupabase.failNextWrite({ message: "network down", code: "503" })
    const hold = fakeSupabase.holdNextWrite()
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started

    await saveFromEditor(writingId, "Versión 4.", 4)
    hold.release()
    await flushing

    const v3 = catalogMutationsDouble(dbPath).find((mutation) => mutation.id === v3Id)
    expect(v3?.status, "la mutación superada no revive como accionable").toBe("synced")
    expect(
      (await catalog.getById(writingId))?.syncStatus,
      "la fila sigue pendiente por la v4, no failed por la vieja",
    ).toBe("pending")
  })

  // ODE-644, el estado final de la nube en la secuencia completa: la v3 falla
  // en vuelo, la v4 (status review) se guarda y sube bien, y el reintento de la
  // v3 revivida, al vencer su backoff, llega DESPUÉS del flush de la v4. El
  // cuerpo del reintento sale del `.md` (v4), pero la metadata sale del payload
  // de la v3: la nube acaba en `{version: 3, status: "draft"}` — la metadata de
  // la v4 (el status del usuario) se pierde en la nube y la versión retrocede,
  // en silencio (la fila local queda `synced`). El caso afirma el estado
  // correcto: la nube conserva la v4.
  it.fails("el reintento de la v3 superada no pisa la nube tras el backoff (ODE-644)", async () => {
    const { writingId } = await createMaterializedDraft("Versión 1.")
    await saveFromEditor(writingId, "Versión 3.", 3, "draft")

    fakeSupabase.failNextWrite({ message: "network down", code: "503" })
    const hold = fakeSupabase.holdNextWrite()
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started

    await saveFromEditor(writingId, "Versión 4.", 4, "review")
    hold.release()
    await flushing // v3 -> failed con reintento a +2 s; la v4 sigue accionable

    const v4Queued = actionableMutations(writingId).filter(
      (mutation) => JSON.parse(mutation.payloadJson).version === 4,
    )
    expect(v4Queued, "la v4 sobrevive al fallo en vuelo de la v3").toHaveLength(1)

    const second = await desktopCatalogSyncService.flushPending()
    expect(second.error).toBeNull()
    expect(second.data?.failedMutations).toEqual([])
    expect(fakeSupabase.row("writings", writingId), "la v4 ya subió bien").toMatchObject({
      version: 4,
      status: "review",
      body_text: "Versión 4.",
    })

    // Vence el backoff de la v3 revivida: el siguiente flush la reintenta.
    const realNow = Date.now.bind(Date)
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10 * 60_000)
    try {
      await desktopCatalogSyncService.flushPending()
    } finally {
      spy.mockRestore()
    }

    const cloud = fakeSupabase.row("writings", writingId)
    expect(cloud?.version, "la nube conserva la versión 4, no retrocede a la 3").toBe(4)
    expect(cloud?.status, "y el status review de la v4, no el draft de la v3 superada").toBe("review")
    expect(cloud?.body_text).toBe("Versión 4.")
    expect(actionableMutations(writingId), "y la cola queda quieta").toHaveLength(0)
  })

  // Cobertura del orden del listado (`ORDER BY created_at ASC`, `index.rs:1516`),
  // que la mutación M4 de la Guía ya puede observar: si el backoff de la v3
  // vence antes del siguiente flush, la v3 revivida y la v4 son accionables en
  // el mismo listado. Procesar la vieja primero deja que la nueva la pise
  // (estado correcto); con el orden invertido la nube acabaría en la vieja.
  it("con la v3 revivida y la v4 accionables en el mismo flush, la nube acaba en la v4", async () => {
    const { writingId } = await createMaterializedDraft("Versión 1.")
    await saveFromEditor(writingId, "Versión 3.", 3, "draft")

    fakeSupabase.failNextWrite({ message: "network down", code: "503" })
    const hold = fakeSupabase.holdNextWrite()
    const flushing = desktopCatalogSyncService.flushPending()
    await hold.started

    await saveFromEditor(writingId, "Versión 4.", 4, "review")
    hold.release()
    await flushing // v3 -> failed con reintento a +2 s; la v4 pending

    const realNow = Date.now.bind(Date)
    const spy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + 10 * 60_000)
    try {
      const result = await desktopCatalogSyncService.flushPending()
      expect(result.error).toBeNull()
    } finally {
      spy.mockRestore()
    }

    expect(fakeSupabase.row("writings", writingId)?.version, "la más nueva se procesa después y gana").toBe(4)
    expect(fakeSupabase.row("writings", writingId)?.status).toBe("review")
    expect(fakeSupabase.row("writings", writingId)?.body_text).toBe("Versión 4.")
  })
})
