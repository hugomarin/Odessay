/**
 * ODE-667 — DELETE remoto ya ausente: éxito idempotente owner-scoped.
 *
 * Entry points reales: `webDocumentService.saveWriting` / `deleteWriting` (los
 * que usa el editor en web) encolan las mutaciones sobre el `localDB` real;
 * el `SyncWorker` real hace el flush con su transporte de producción, enrutado
 * por `createRouteFetch` al handler real `DELETE /api/writings/[id]`, que es el
 * owner de la autorización y la semántica HTTP. Postgres es la instancia
 * Supabase local real (service role para el handler, admin del harness para
 * leer el estado canónico). Lo único doblado es la frontera externa de red: el
 * `fetch` del worker entra directo al handler en vez de salir a un servidor.
 *
 * Bug real (it.fails): el handler respondía 404 cuando la fila no existía
 * (p. ej. un writing local-only borrado antes de su primer upsert) y el
 * SyncWorker trata todo non-2xx como reintentable. La mutación quedaba
 * reintentándose hasta agotar los 10 intentos y marcarse terminalmente
 * fallida, sin que el borrado remoto hubiera nada que completar.
 *
 * Evento de completitud: la promesa de `worker.flush()` resuelve después de
 * que el handler real commiteó en Postgres. Recién ahí se afirma el resultado
 * canónico: la cola local (mutación consumida, sin reintentos), la fila
 * remota y las filas de `writing_shares`.
 *
 * Escenarios:
 * - (A) crear local-only → encolar delete → flush antes de cualquier upsert:
 *   la ausencia remota converge como éxito idempotente sin consumir intentos.
 * - (B) respuesta perdida tras un delete ya aplicado y replay de la misma
 *   mutación: converge sin duplicar ni corromper la fila (y el cleanup del
 *   dueño sí corre).
 * - (C) fila de otra cuenta: el DELETE del owner no la muta ni limpia sus
 *   shares, y su respuesta es indistinguible de la de un ID inexistente; el
 *   dueño real sí puede borrarla (control positivo).
 */
import "fake-indexeddb/auto"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cleanupUsers,
  readRow,
  readRows,
  seedShare,
  seedUsers,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { SyncWorker } = await import("@/lib/sync/worker")
const { DELETE, PATCH } = await import("@/app/api/writings/[id]/route")

type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord

const originalFetch = globalThis.fetch
const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)
const timestamp = (seconds: number) => `2026-10-03T00:${String(seconds).padStart(2, "0")}:00.000Z`
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let stranger!: SeedUser

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "stranger"])
  ;[owner, stranger] = users
})

afterAll(async () => {
  await cleanupUsers(users)
})

beforeEach(() => {
  setLocalDBScope(`ode-667-${crypto.randomUUID()}`)
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

/** Lo que el editor manda a `saveWriting` para un borrador nuevo en web. */
function editorRecord(id: string, text: string, version = 1): WritingRecord {
  return {
    id,
    authorId: null,
    title: "ODE-667 borrador",
    content: { richText: doc(text), markdown: null, plainText: text, canonicalSource: "rich-text" },
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version,
    deletedAt: null,
    createdAt: timestamp(0),
    updatedAt: timestamp(version),
  }
}

const deletePayload = () => ({
  version: 2,
  updated_at: timestamp(2),
  deleted_at: timestamp(2),
})

const deleteWritingLocally = (writingId: string) =>
  webDocumentService.deleteWriting({
    writingId,
    version: deletePayload().version,
    updatedAt: deletePayload().updated_at,
    deletedAt: deletePayload().deleted_at,
  })

const runDelete = (request: Request, id: string) =>
  DELETE(request, { params: Promise.resolve({ id }) })

/** Como `seedWriting`, pero con el UUID que la prueba necesita (colisión de identidad). */
async function seedRemoteWritingWithId(id: string, authorId: string, title: string): Promise<void> {
  const { error } = await admin.from("writings").insert({
    id,
    author_id: authorId,
    title,
    visibility: "private",
    status: "draft",
    version: 1,
  })
  if (error) throw new Error(`[ode-667] seedRemoteWritingWithId falló: ${error.message}`)
}

type CapturedResponse = { status: number; body: unknown }

/** Handler real con captura de la respuesta que ve el worker. */
function capturingDelete(id: string, captured: CapturedResponse[]) {
  return async (request: Request) => {
    const response = await runDelete(request, id)
    captured.push({ status: response.status, body: await response.clone().json() })
    return response
  }
}

const patchRoute = (id: string) => (request: Request) => PATCH(request, { params: Promise.resolve({ id }) })

/**
 * Router de fetch para el SyncWorker real: `/api/...` entra al handler real
 * con el Bearer del usuario; `127.0.0.1:54321` (Postgres/GoTrue del stack
 * local) usa el fetch original, para que los clientes que se construyen dentro
 * del handler no se recursen.
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

const makeWorker = () => new SyncWorker({ localDb: localDB, isOnline: () => true })

/** Re-encola la mutación actual con `next_retry_at` a 0, como un tick real del reloj. */
const makeMutationImmediatelyDue = async (writingId: string) => {
  const current = await localDB.syncQueue.getCurrentForWriting(writingId)
  if (current) {
    await localDB.syncQueue.enqueue({ ...current, next_retry_at: 0 })
  }
}

describe("ODE-667 — DELETE remoto ya ausente converge como éxito idempotente", () => {
  it(
    "borrar un writing local-only antes de cualquier upsert converge sin consumir reintentos hasta fallar",
    async () => {
      const writingId = randomUUID()

      // 1. Crear local-only (entry real del editor web): el body queda en
      // `localDB` y el upsert remoto se encola.
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Borrador que nunca llegó a la nube."),
      })
      expect(saved.error, "el guardado local-only entra").toBeNull()
      expect(await readRow(admin, "writings", writingId), "la nube todavía no tiene la fila").toBeNull()
      expect(
        (await localDB.syncQueue.getCurrentForWriting(writingId))?.operation,
        "precondición: hay un upsert encolado",
      ).toBe("upsert")

      // 2. El autor borra antes de que el upsert remoto ocurra: la cola
      // reemplaza el upsert por el delete (dedup por entity_key).
      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error, "el borrado local entra").toBeNull()
      expect(
        (await localDB.syncQueue.getCurrentForWriting(writingId))?.operation,
        "el delete reemplazó al upsert pendiente",
      ).toBe("delete")

      // 3. Flush real: SyncWorker → DELETE real → Postgres real.
      const captured: CapturedResponse[] = []
      installRoutedFetch({ [`/api/writings/${writingId}`]: capturingDelete(writingId, captured) }, owner)
      await makeWorker().flush()

      // Evento de completitud consumido; resultado canónico.
      expect(captured, "el handler real recibió el delete").toHaveLength(1)
      expect(captured[0]?.status, "la ausencia remota es un éxito idempotente").toBe(200)
      expect(captured[0]?.body, "sin error de envelope").toEqual({ data: null, error: null })

      expect(
        await localDB.syncQueue.getCurrentForWriting(writingId),
        "la mutación se consumió; no quedó reintentándose hacia el fallo terminal",
      ).toBeNull()
      expect(
        (await localDB.writings.get(writingId))?.sync_status,
        "la fila local sigue borrada, no marcada fallida",
      ).toBe("deleted")
      expect(await readRow(admin, "writings", writingId), "la nube no materializa una fila").toBeNull()
    },
  )

  it(
    "una respuesta perdida tras un delete aplicado converge en el replay de la misma mutación",
    async () => {
      const writingId = randomUUID()

      // Secuencia real previa: crear local-only y subir el upsert (control
      // positivo de que la fila remota existe de verdad).
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Carta que sí llegó a la nube."),
      })
      expect(saved.error).toBeNull()
      installRoutedFetch({ [`/api/writings/${writingId}`]: patchRoute(writingId) }, owner)
      const worker = makeWorker()
      await worker.flush()

      const afterUpsert = await readRow<{ deleted_at: string | null }>(admin, "writings", writingId)
      expect(afterUpsert?.deleted_at, "el upsert real creó la fila viva").toBeNull()
      expect(await localDB.syncQueue.getCurrentForWriting(writingId), "el upsert se consumió").toBeNull()

      // El dueño comparte el writing y después lo borra.
      const ownerClient = await createUserClient(owner)
      await seedShare(ownerClient, { writingId, sharedWithId: stranger.id })
      expect(await readRows(admin, "writing_shares", "writing_id", writingId)).toHaveLength(1)

      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error).toBeNull()

      // Primera vuelta: el handler aplica el delete, pero la respuesta se
      // pierde en la red (frontera externa simulada: el fetch rechaza).
      let loseResponse = true
      installRoutedFetch(
        {
          [`/api/writings/${writingId}`]: async (request: Request) => {
            const response = await runDelete(request, writingId)
            if (loseResponse) {
              loseResponse = false
              throw new Error("respuesta perdida en tránsito")
            }
            return response
          },
        },
        owner,
      )
      await worker.flush()

      const afterLost = await readRow<Record<string, unknown>>(admin, "writings", writingId)
      expect(afterLost?.deleted_at, "el delete sí se aplicó en la nube").not.toBeNull()
      const pending = await localDB.syncQueue.getCurrentForWriting(writingId)
      expect(pending, "la respuesta perdida deja la mutación en cola").not.toBeNull()
      expect(pending?.attempts, "el fallo de red consume un intento (política de retry intacta)").toBe(1)

      // Replay de la misma mutación: ya está aplicada; el worker la consume
      // sin duplicar ni corromper la fila.
      await makeMutationImmediatelyDue(writingId)
      installRoutedFetch({ [`/api/writings/${writingId}`]: (request) => runDelete(request, writingId) }, owner)
      await worker.flush()

      expect(
        await localDB.syncQueue.getCurrentForWriting(writingId),
        "el replay converge y la mutación se consume",
      ).toBeNull()
      const afterReplay = await readRow<Record<string, unknown>>(admin, "writings", writingId)
      expect(afterReplay?.deleted_at, "el replay conserva el tombstone ya aplicado").toBe(afterLost?.deleted_at)
      expect(afterReplay?.version, "sin regresión ni doble aplicación de versión").toBe(afterLost?.version)
      expect(afterReplay?.body_text, "el cuerpo del documento no se corrompe").toBe(afterLost?.body_text)
      expect(afterReplay?.id, "una sola fila para la identidad").toBe(writingId)
      expect(
        await readRows(admin, "writing_shares", "writing_id", writingId),
        "el cleanup del dueño sí corrió al confirmarse su fila",
      ).toHaveLength(0)
    },
  )

  it(
    "el delete de una fila ajena no la muta ni limpia sus shares, y es indistinguible de un ID inexistente",
    async () => {
      const writingId = randomUUID()
      const missingId = randomUUID()

      // La fila ajena existe remotamente con el UUID que el owner va a usar,
      // y con un share del dueño real hacia ella.
      await seedRemoteWritingWithId(writingId, stranger.id, `ODE-667 ajena ${runId}`)
      const strangerClient = await createUserClient(stranger)
      await seedShare(strangerClient, { writingId, sharedWithId: owner.id })
      const before = await readRow<Record<string, unknown>>(admin, "writings", writingId)
      expect(before?.deleted_at, "control positivo: la fila ajena está viva").toBeNull()

      // El owner tiene un writing local-only con el mismo UUID (colisión) y lo
      // borra: la mutación sale con SU bearer contra el handler real.
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Colisión de UUID del owner."),
      })
      expect(saved.error).toBeNull()
      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error).toBeNull()

      const captured: CapturedResponse[] = []
      installRoutedFetch({ [`/api/writings/${writingId}`]: capturingDelete(writingId, captured) }, owner)
      await makeWorker().flush()

      // Éxito idempotente indistinguible: la mutación del owner se consume.
      expect(captured[0]?.status, "el delete ajeno no es un error de transporte").toBe(200)
      expect(await localDB.syncQueue.getCurrentForWriting(writingId), "la mutación del owner se consumió").toBeNull()

      // La fila ajena y su share quedan intactos.
      expect(await readRow(admin, "writings", writingId), "la fila ajena no se muta").toEqual(before)
      expect(
        await readRows(admin, "writing_shares", "writing_id", writingId),
        "el share ajeno no se limpia",
      ).toHaveLength(1)

      // El mismo owner, contra un ID inexistente, recibe una respuesta
      // idéntica: inexistente y ajena son indistinguibles.
      const missingCaptured: CapturedResponse[] = []
      const missingFetch = createRouteFetch(
        { [`/api/writings/${missingId}`]: capturingDelete(missingId, missingCaptured) },
        { as: owner },
      )
      const missingResponse = await missingFetch(
        new Request(`http://harness.test/api/writings/${missingId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deletePayload()),
        }),
      )
      expect(missingResponse.status).toBe(200)
      expect(missingCaptured[0]?.body, "misma respuesta para inexistente y ajena").toEqual(captured[0]?.body)

      // Control positivo: el dueño real sí puede borrar su fila, y su cleanup
      // de shares corre con la fila propia confirmada.
      const strangerFetch = createRouteFetch(
        { [`/api/writings/${writingId}`]: (request) => runDelete(request, writingId) },
        { as: stranger },
      )
      const ownerResponse = await strangerFetch(
        new Request(`http://harness.test/api/writings/${writingId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deletePayload()),
        }),
      )
      expect(ownerResponse.status, "el dueño real sí borra su fila").toBe(200)
      const ownerBody = (await ownerResponse.json()) as { data: { id: string } | null }
      expect(ownerBody.data?.id, "el dueño recibe su fila borrada").toBe(writingId)
      expect(
        (await readRow<{ deleted_at: string | null }>(admin, "writings", writingId))?.deleted_at,
        "con el dueño real la fila queda tombstoned",
      ).not.toBeNull()
      expect(
        await readRows(admin, "writing_shares", "writing_id", writingId),
        "y su share sí se limpia",
      ).toHaveLength(0)
    },
  )
})
