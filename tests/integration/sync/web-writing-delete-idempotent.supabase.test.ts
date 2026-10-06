/**
 * ODE-667 — DELETE remoto ya ausente: éxito idempotente owner-scoped.
 *
 * Entry points reales: `webDocumentService.saveWriting` / `deleteWriting` (los
 * que usa el editor en web) encolan las mutaciones sobre el `localDB` real a
 * través de `lib/sync/queue.ts`, que llama al `getSyncService()` real. Su
 * `scheduleFlush()` es el `webSyncService` de producción: programa al
 * `SyncWorker` singleton real (`getSyncWorker().schedule(0)`) y el timer
 * dispara su `flush()`. El test no construye ningún worker ni sustituye el
 * scheduler: controla el tiempo con fake timers de vitest (solo `setTimeout`/
 * `clearTimeout`) y avanza el timer que el propio scheduler registró. El
 * worker usa su transporte de producción, enrutado por `createRouteFetch` al
 * handler real `DELETE /api/writings/[id]`, que es el owner de la autorización
 * y la semántica HTTP. Postgres es la instancia Supabase local real (service
 * role para el handler, admin del harness para leer el estado canónico). Lo
 * único doblado es la frontera externa: el `fetch` de red (entra directo al
 * handler) y el runtime de navegador (`window` y `navigator.onLine`, como en
 * el navegador real).
 *
 * Bug real (it.fails): el handler respondía 404 cuando la fila no existía
 * (p. ej. un writing local-only borrado antes de su primer upsert) y el
 * SyncWorker trata todo non-2xx como reintentable. La mutación quedaba
 * reintentándose hasta agotar los 10 intentos y marcarse terminalmente
 * fallida, sin que el borrado remoto hubiera nada que completar.
 *
 * Evento de completitud: `SyncWorker.flush()` emite la métrica `sync.flush`
 * (rama de producción de `lib/observability/sync-metrics.ts`) después de
 * aplicar la mutación y de que el handler commiteó en Postgres. La prueba
 * registra ese sink de producción y solo tras la métrica del flush disparado
 * por el scheduler afirma el resultado canónico: la cola sin la mutación ni
 * reintentos pendientes, la fila local y la fila remota. El `trigger` de la
 * métrica delata el camino real (`auth` para `schedule(0)`, `debounce` para el
 * tick de retry del worker).
 *
 * Escenarios:
 * - (A) crear local-only → encolar delete → flush del scheduler antes de
 *   cualquier upsert: la ausencia remota converge como éxito idempotente sin
 *   consumir intentos.
 * - (B) respuesta perdida tras un delete ya aplicado y replay de la misma
 *   mutación en el tick de retry real del worker: converge sin duplicar ni
 *   corromper la fila (y el cleanup del dueño sí corre).
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
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"
import { getTestLinkEmail } from "@/lib/sharing/test-link"

const { serverCreateClient } = vi.hoisted(() => ({ serverCreateClient: vi.fn() }))
vi.mock("@/lib/supabase/server", () => ({ createClient: serverCreateClient }))

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { setSyncMetricSink } = await import("@/lib/observability/sync-metrics")
const { DELETE, PATCH } = await import("@/app/api/writings/[id]/route")
const { POST: restoreWriting } = await import("@/app/api/writings/[id]/lifecycle/route")
const { getPreviewWritingFromTestLink } = await import("@/lib/sharing/test-link-access")

type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord
type SyncFlushMetric = import("@/lib/observability/sync-metrics").SyncFlushMetric

const originalFetch = globalThis.fetch
const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)
const timestamp = (seconds: number) => `2026-10-03T00:${String(seconds).padStart(2, "0")}:00.000Z`
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let stranger!: SeedUser
let ownerClient: SupabaseClient

/**
 * Completitud real del flush: `SyncWorker.flush()` emite `sync.flush` al
 * terminar, después de `markSynced` y de que el handler commiteó. El sink es
 * una salida de producción (`setSyncMetricSink`); la prueba solo lo observa.
 */
const flushMetrics: SyncFlushMetric[] = []
const flushCompletions: Array<() => void> = []

/** Avanza el timer que el scheduler real registró y espera el flush completo. */
async function runScheduledFlush(advanceMs = 0): Promise<void> {
  const completed = new Promise<void>((resolve) => {
    flushCompletions.push(resolve)
  })
  await vi.advanceTimersByTimeAsync(advanceMs)
  await completed
}

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "stranger"])
  ;[owner, stranger] = users
  ownerClient = await createUserClient(owner)
  serverCreateClient.mockResolvedValue(ownerClient)
})

afterAll(async () => {
  await cleanupUsers(users)
})

beforeEach(() => {
  // El scheduler de producción corre sobre `window.setTimeout`; se controla
  // con fake timers para disparar el flush determinísticamente. Se limitan a
  // `setTimeout`/`clearTimeout` para no interferir con fake-indexeddb.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  vi.stubGlobal("navigator", { onLine: true })
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
  })
  setLocalDBScope(`ode-667-${crypto.randomUUID()}`)
  flushMetrics.length = 0
  flushCompletions.length = 0
  setSyncMetricSink((metric) => {
    if (metric.type !== "sync.flush") return
    flushMetrics.push(metric)
    flushCompletions.shift()?.()
  })
})

afterEach(() => {
  setSyncMetricSink(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
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

async function seedPreviewInvitation(writingId: string, token: string): Promise<string> {
  const { error } = await admin.rpc("rotate_test_preview_link", {
    p_inviter_id: owner.id,
    p_writing_id: writingId,
    p_token: token,
  })
  if (error) throw new Error(`[ode-674] rotate_test_preview_link falló: ${error.message}`)
  const { data, error: readError } = await admin.from("invitations").select("id").eq("token", token).single()
  if (readError || !data) throw new Error(`[ode-674] no se encontró la invitación creada: ${readError?.message ?? "sin fila"}`)
  return data.id
}

async function seedInvitation(input: {
  writingId: string
  email: string
  status: "pending" | "accepted"
}): Promise<string> {
  const { data, error } = await admin
    .from("invitations")
    .insert({
      inviter_id: owner.id,
      writing_id: input.writingId,
      email: input.email,
      token: randomUUID(),
      status: input.status,
      accepted_at: input.status === "accepted" ? new Date().toISOString() : null,
    })
    .select("id")
    .single()
  if (error || !data) throw new Error(`[ode-674] seed de invitación falló: ${error?.message ?? "sin fila"}`)
  return data.id
}

async function restoreViaRoute(writingId: string, version: number): Promise<Response> {
  const path = `/api/writings/${writingId}/lifecycle`
  const restoreFetch = createRouteFetch(
    { [path]: (request) => restoreWriting(request, { params: Promise.resolve({ id: writingId }) }) },
    { as: owner },
  )
  return restoreFetch(
    new Request(`http://harness.test${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "restore", version, updated_at: new Date(Date.now() + 1_000).toISOString() }),
    }),
  )
}

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
      // `localDB` y el upsert remoto se encola; el scheduler real programa su
      // timer.
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
      // reemplaza el upsert por el delete (dedup por entity_key) y el timer
      // del scheduler queda reprogramado.
      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error, "el borrado local entra").toBeNull()
      expect(
        (await localDB.syncQueue.getCurrentForWriting(writingId))?.operation,
        "el delete reemplazó al upsert pendiente",
      ).toBe("delete")

      // 3. El timer del scheduler real dispara el flush del worker singleton:
      // SyncWorker → DELETE real → Postgres real.
      const captured: CapturedResponse[] = []
      installRoutedFetch({ [`/api/writings/${writingId}`]: capturingDelete(writingId, captured) }, owner)
      await runScheduledFlush()

      // Evento de completitud consumido; resultado canónico.
      expect(captured, "el handler real recibió el delete").toHaveLength(1)
      expect(captured[0]?.status, "la ausencia remota es un éxito idempotente").toBe(200)
      expect(captured[0]?.body, "sin error de envelope").toEqual({ data: null, error: null })
      expect(flushMetrics, "un solo flush, disparado por el scheduler de producción").toHaveLength(1)
      expect(flushMetrics[0]?.trigger, "schedule(0) real, no un flush a mano").toBe("auth")
      expect(flushMetrics[0]?.examined, "el flush examinó la mutación de delete").toBe(1)
      expect(flushMetrics[0]?.succeeded, "la consumió sin fallar").toBe(1)
      expect(flushMetrics[0]?.failed, "sin reintentos pendientes").toBe(0)

      expect(
        await localDB.syncQueue.getCurrentForWriting(writingId),
        "la mutación se consumió; no quedó reintentándose hacia el fallo terminal",
      ).toBeNull()
      expect(await localDB.syncQueue.getPending(), "la cola no conserva reintentos pendientes").toEqual([])
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

      // Secuencia real previa: crear local-only y subir el upsert con el
      // scheduler real (control positivo de que la fila remota existe).
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Carta que sí llegó a la nube."),
      })
      expect(saved.error).toBeNull()
      installRoutedFetch({ [`/api/writings/${writingId}`]: patchRoute(writingId) }, owner)
      await runScheduledFlush()

      const afterUpsert = await readRow<{ deleted_at: string | null }>(admin, "writings", writingId)
      expect(afterUpsert?.deleted_at, "el upsert real creó la fila viva").toBeNull()
      expect(await localDB.syncQueue.getCurrentForWriting(writingId), "el upsert se consumió").toBeNull()
      expect(flushMetrics).toHaveLength(1)
      expect(flushMetrics[0]?.succeeded, "el scheduler corrió el upsert").toBe(1)

      // El dueño comparte el writing y después lo borra.
      const ownerClient = await createUserClient(owner)
      await seedShare(ownerClient, { writingId, sharedWithId: stranger.id })
      expect(await readRows(admin, "writing_shares", "writing_id", writingId)).toHaveLength(1)

      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error).toBeNull()

      // Primera vuelta del delete: el handler aplica el delete, pero la
      // respuesta se pierde en la red (frontera externa simulada: el fetch
      // rechaza). El timer del scheduler real vuelve a disparar el flush.
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
      await runScheduledFlush()

      const afterLost = await readRow<Record<string, unknown>>(admin, "writings", writingId)
      expect(afterLost?.deleted_at, "el delete sí se aplicó en la nube").not.toBeNull()
      const pending = await localDB.syncQueue.getCurrentForWriting(writingId)
      expect(pending, "la respuesta perdida deja la mutación en cola").not.toBeNull()
      expect(pending?.attempts, "el fallo de red consume un intento (política de retry intacta)").toBe(1)
      expect(flushMetrics).toHaveLength(2)
      expect(flushMetrics[1]?.trigger, "el delete salió por el schedule(0) de producción").toBe("auth")
      expect(flushMetrics[1]?.failed, "el flush falló por la respuesta perdida").toBe(1)

      // Replay de la misma mutación: el fallo dejó el tick de retry del
      // worker (`schedule()` → debounce 1500). El reloj ya hizo due la
      // mutación (como en producción al vencer `next_retry_at`), así que ese
      // tick real la reintenta; ya está aplicada, el worker la consume sin
      // duplicar ni corromper la fila.
      await makeMutationImmediatelyDue(writingId)
      installRoutedFetch({ [`/api/writings/${writingId}`]: (request) => runDelete(request, writingId) }, owner)
      await runScheduledFlush(1500)

      expect(flushMetrics).toHaveLength(3)
      expect(flushMetrics[2]?.trigger, "el replay corre en el tick de retry del worker").toBe("debounce")
      expect(flushMetrics[2]?.succeeded, "el replay consumió la mutación").toBe(1)
      expect(
        await localDB.syncQueue.getCurrentForWriting(writingId),
        "el replay converge y la mutación se consume",
      ).toBeNull()
      expect(await localDB.syncQueue.getPending(), "sin reintentos pendientes").toEqual([])
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
      // borra: la mutación sale con SU bearer contra el handler real,
      // disparada por el scheduler real.
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Colisión de UUID del owner."),
      })
      expect(saved.error).toBeNull()
      const deleted = await deleteWritingLocally(writingId)
      expect(deleted.error).toBeNull()

      const captured: CapturedResponse[] = []
      installRoutedFetch({ [`/api/writings/${writingId}`]: capturingDelete(writingId, captured) }, owner)
      await runScheduledFlush()

      // Éxito idempotente indistinguible: la mutación del owner se consume.
      expect(captured).toHaveLength(1)
      expect(captured[0]?.status, "el delete ajeno no es un error de transporte").toBe(200)
      expect(flushMetrics[0]?.succeeded, "el flush real consumió la mutación").toBe(1)
      expect(await localDB.syncQueue.getCurrentForWriting(writingId), "la mutación del owner se consumió").toBeNull()
      expect(await localDB.syncQueue.getPending(), "sin reintentos pendientes").toEqual([])

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

  it(
    "el DELETE web expira solo la invitación UX pendiente del writing y el retry no reactiva el token al restaurar",
    async () => {
      const writingId = randomUUID()
      const otherWritingId = await seedWriting(admin, { authorId: owner.id, title: `ODE-674 otro ${runId}` })
      const token = `ode674web${randomUUID().replace(/-/g, "")}`
      const otherToken = `ode674other${randomUUID().replace(/-/g, "")}`

      // Producción crea primero el writing web local y lo confirma en cloud
      // por PATCH; el DELETE se ejecuta sobre una fila activa real.
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Writing del ciclo de invitación UX."),
      })
      expect(saved.error, "el writing entra por el servicio real de web").toBeNull()
      installRoutedFetch({ [`/api/writings/${writingId}`]: patchRoute(writingId) }, owner)
      await runScheduledFlush()
      expect(
        (await readRow<{ deleted_at: string | null }>(admin, "writings", writingId))?.deleted_at,
        "el PATCH real creó la fila activa",
      ).toBeNull()

      const uxInvitationId = await seedPreviewInvitation(writingId, token)
      const acceptedInvitationId = await seedInvitation({
        writingId,
        email: getTestLinkEmail(writingId),
        status: "accepted",
      })
      const nonUxInvitationId = await seedInvitation({
        writingId,
        email: `reader-${runId}@example.test`,
        status: "pending",
      })
      const otherUxInvitationId = await seedPreviewInvitation(otherWritingId, otherToken)
      const tokenBeforeDelete = await getPreviewWritingFromTestLink(token)
      expect(tokenBeforeDelete.state, "control positivo: el token real resuelve antes del delete").toBe("ok")

      const queuedDelete = await deleteWritingLocally(writingId)
      expect(queuedDelete.error, "el servicio real encoló el delete").toBeNull()

      // El primer DELETE del handler real confirma Postgres pero se pierde la
      // respuesta de red; el worker deja la mutación para su retry real.
      const deleteAttempts: CapturedResponse[] = []
      let loseFirstResponse = true
      installRoutedFetch(
        {
          [`/api/writings/${writingId}`]: async (request) => {
            const response = await runDelete(request, writingId)
            deleteAttempts.push({ status: response.status, body: await response.clone().json() })
            if (loseFirstResponse) {
              loseFirstResponse = false
              throw new Error("respuesta perdida después de confirmar el DELETE")
            }
            return response
          },
        },
        owner,
      )
      await runScheduledFlush()
      const uxAfterFirstDelete = await readRow<{ status: string }>(admin, "invitations", uxInvitationId)
      const writingAfterFirstDelete = await readRow<{ deleted_at: string | null }>(admin, "writings", writingId)

      // El retry se agenda por el SyncWorker real y vuelve a invocar el mismo
      // DELETE idempotente, con la mutación remota ya confirmada.
      await makeMutationImmediatelyDue(writingId)
      const retryResponses: CapturedResponse[] = []
      installRoutedFetch(
        {
          [`/api/writings/${writingId}`]: async (request) => {
            const response = await runDelete(request, writingId)
            retryResponses.push({ status: response.status, body: await response.clone().json() })
            return response
          },
        },
        owner,
      )
      await runScheduledFlush(1500)
      const uxAfterRetry = await readRow<{ status: string }>(admin, "invitations", uxInvitationId)
      const acceptedAfterRetry = await readRow<{ status: string }>(admin, "invitations", acceptedInvitationId)
      const nonUxAfterRetry = await readRow<{ status: string }>(admin, "invitations", nonUxInvitationId)
      const otherUxAfterRetry = await readRow<{ status: string }>(admin, "invitations", otherUxInvitationId)
      const retriedMutation = await localDB.syncQueue.getCurrentForWriting(writingId)

      // El restore usa la ruta pública real y un cliente autenticado contra la
      // instancia local. El token solo permanece revocado si la DB lo expiró.
      const archived = await readRow<{ version: number }>(admin, "writings", writingId)
      const restoreResponse = await restoreViaRoute(writingId, archived?.version ?? 0)
      const restoredBody = await restoreResponse.clone().json()
      const tokenAfterRestore = await getPreviewWritingFromTestLink(token)

      // ODE-667: un documento cloud ausente sigue convergiendo con 200.
      const missingId = randomUUID()
      const missingFetch = createRouteFetch(
        { [`/api/writings/${missingId}`]: (request) => runDelete(request, missingId) },
        { as: owner },
      )
      const missingResponse = await missingFetch(
        new Request(`http://harness.test/api/writings/${missingId}`, {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(deletePayload()),
        }),
      )

      expect(deleteAttempts.map(({ status }) => status), "el primer DELETE confirmó antes de perderse la respuesta").toEqual([200])
      expect(retryResponses.map(({ status }) => status), "el retry vuelve a recibir 200").toEqual([200])
      expect(flushMetrics[1]?.failed, "el primer flush refleja la respuesta de red perdida").toBe(1)
      expect(flushMetrics[2]?.trigger, "el retry ocurrió en el tick real del worker").toBe("debounce")
      expect(flushMetrics[2]?.succeeded, "el retry consumió la mutación durable").toBe(1)
      expect(retriedMutation, "no quedó un retry pendiente").toBeNull()
      expect(writingAfterFirstDelete?.deleted_at, "el primer DELETE confirmó el soft delete").not.toBeNull()
      expect(uxAfterFirstDelete?.status, "la pendiente UX se expira al confirmar el DELETE").toBe("expired")
      expect(uxAfterRetry?.status, "el retry conserva la expiración").toBe("expired")
      expect(acceptedAfterRetry?.status, "la invitación aceptada no cambia").toBe("accepted")
      expect(nonUxAfterRetry?.status, "la invitación ajena al preview no cambia").toBe("pending")
      expect(otherUxAfterRetry?.status, "la UX de otro writing no cambia").toBe("pending")
      expect(restoreResponse.status, "el restore real vuelve a activar el writing").toBe(200)
      expect(restoredBody.data?.deleted_at, "el lifecycle route restauró el writing").toBeNull()
      expect(tokenAfterRestore.state, "el token expirado no se reactiva con restore").toBe("revoked")
      expect(missingResponse.status, "un writing ausente mantiene la respuesta idempotente").toBe(200)
    },
  )

  it(
    "el soft delete directo de desktop expira solo la UX pendiente y su reintento no revive el token",
    async () => {
      const writingId = await seedWriting(admin, { authorId: owner.id, title: `ODE-674 desktop ${runId}` })
      const otherWritingId = await seedWriting(admin, { authorId: owner.id, title: `ODE-674 desktop otro ${runId}` })
      const token = `ode674desktop${randomUUID().replace(/-/g, "")}`
      const otherToken = `ode674desktopother${randomUUID().replace(/-/g, "")}`
      const uxInvitationId = await seedPreviewInvitation(writingId, token)
      const acceptedInvitationId = await seedInvitation({
        writingId,
        email: getTestLinkEmail(writingId),
        status: "accepted",
      })
      const nonUxInvitationId = await seedInvitation({
        writingId,
        email: `desktop-reader-${runId}@example.test`,
        status: "pending",
      })
      const otherUxInvitationId = await seedPreviewInvitation(otherWritingId, otherToken)
      const tokenBeforeDelete = await getPreviewWritingFromTestLink(token)
      expect(tokenBeforeDelete.state, "control positivo: el token de desktop resuelve al inicio").toBe("ok")

      const deletedAt = new Date().toISOString()
      const softDeleteFromDesktopClient = () => ownerClient
        .from("writings")
        .update({ deleted_at: deletedAt, updated_at: deletedAt, version: 2 }, { count: "exact" })
        .eq("id", writingId)
        .eq("author_id", owner.id)
      const firstDelete = await softDeleteFromDesktopClient()
      const uxAfterFirstDelete = await readRow<{ status: string }>(admin, "invitations", uxInvitationId)
      const retryDelete = await softDeleteFromDesktopClient()
      const uxAfterRetry = await readRow<{ status: string }>(admin, "invitations", uxInvitationId)
      const acceptedAfterRetry = await readRow<{ status: string }>(admin, "invitations", acceptedInvitationId)
      const nonUxAfterRetry = await readRow<{ status: string }>(admin, "invitations", nonUxInvitationId)
      const otherUxAfterRetry = await readRow<{ status: string }>(admin, "invitations", otherUxInvitationId)
      const archived = await readRow<{ version: number }>(admin, "writings", writingId)
      const restoreResponse = await restoreViaRoute(writingId, archived?.version ?? 0)
      const restoredBody = await restoreResponse.clone().json()
      const tokenAfterRestore = await getPreviewWritingFromTestLink(token)

      expect(firstDelete.error, "el cliente usuario de desktop confirmó el soft delete").toBeNull()
      expect(firstDelete.count, "el delete afectó la fila cloud del owner").toBe(1)
      expect(retryDelete.error, "el replay directo del cliente es idempotente").toBeNull()
      expect(retryDelete.count, "el replay siguió matcheando la fila soft-deleted").toBe(1)
      expect(uxAfterFirstDelete?.status, "la pendiente UX se expira en el primer UPDATE").toBe("expired")
      expect(uxAfterRetry?.status, "el retry no revierte la expiración").toBe("expired")
      expect(acceptedAfterRetry?.status, "la invitación aceptada no cambia").toBe("accepted")
      expect(nonUxAfterRetry?.status, "la invitación no UX no cambia").toBe("pending")
      expect(otherUxAfterRetry?.status, "la UX asociada a otro writing no cambia").toBe("pending")
      expect(restoreResponse.status, "el lifecycle route real restaura el writing").toBe(200)
      expect(restoredBody.data?.deleted_at, "el writing quedó restaurado").toBeNull()
      expect(tokenAfterRestore.state, "el restore no reactiva el token expirado").toBe("revoked")
    },
  )
})
