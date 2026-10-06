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
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { setSyncMetricSink } = await import("@/lib/observability/sync-metrics")
const { DELETE, PATCH } = await import("@/app/api/writings/[id]/route")

type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord
type SyncFlushMetric = import("@/lib/observability/sync-metrics").SyncFlushMetric

const originalFetch = globalThis.fetch
const originalSetTimeout = globalThis.setTimeout.bind(globalThis)
const originalClearTimeout = globalThis.clearTimeout.bind(globalThis)
const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)
const timestamp = (seconds: number) => `2026-10-03T00:${String(seconds).padStart(2, "0")}:00.000Z`
const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let stranger!: SeedUser

/**
 * Completitud real del flush: `SyncWorker.flush()` emite `sync.flush` al
 * terminar, después de `markSynced` y de que el handler commiteó. El sink es
 * una salida de producción (`setSyncMetricSink`); la prueba solo lo observa.
 */
const flushMetrics: SyncFlushMetric[] = []
const flushCompletions: Array<() => void> = []
const flushMetricWaiters: Array<{
  description: string
  predicate: (metric: SyncFlushMetric) => boolean
  resolve: (metric: SyncFlushMetric) => void
  reject: (error: Error) => void
  timeoutId: ReturnType<typeof setTimeout>
}> = []

function waitForFlushMetric(
  description: string,
  predicate: (metric: SyncFlushMetric) => boolean,
  timeoutMs = 1500,
): Promise<SyncFlushMetric> {
  const existing = flushMetrics.find(predicate)
  if (existing) return Promise.resolve(existing)

  return new Promise<SyncFlushMetric>((resolve, reject) => {
    const waiter = {
      description,
      predicate,
      resolve,
      reject,
      timeoutId: originalSetTimeout(() => {
        const index = flushMetricWaiters.indexOf(waiter)
        if (index >= 0) flushMetricWaiters.splice(index, 1)
        reject(
          new Error(
            `[ODE-677] timed out waiting for ${description}; observed ${flushMetrics
              .map((metric) => `${metric.trigger}/${metric.overlapDetected ? "overlap" : "complete"}`)
              .join(", ") || "no sync.flush metrics"}`,
          ),
        )
      }, timeoutMs),
    }
    flushMetricWaiters.push(waiter)
  })
}

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
    for (let index = flushMetricWaiters.length - 1; index >= 0; index -= 1) {
      const waiter = flushMetricWaiters[index]
      if (!waiter?.predicate(metric)) continue
      flushMetricWaiters.splice(index, 1)
      originalClearTimeout(waiter.timeoutId)
      waiter.resolve(metric)
    }
  })
})

afterEach(() => {
  setSyncMetricSink(null)
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
  flushMetricWaiters.splice(0)
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
})

describe("ODE-677 — wakeup pendiente tras overlap del flush web", () => {
  it(
    "drena el delete encolado mientras el PATCH real sigue retenido, sin un evento ajeno",
    async () => {
      const writingId = randomUUID()
      const saved = await webDocumentService.saveWriting({
        writing: editorRecord(writingId, "Borrador que se elimina durante el primer upsert."),
      })
      expect(saved.error, "el upsert entra por el servicio real").toBeNull()
      expect(
        (await localDB.syncQueue.getCurrentForWriting(writingId))?.operation,
        "precondición: el upsert está en la cola durable real",
      ).toBe("upsert")

      let notifyPatchStarted!: () => void
      const patchStarted = new Promise<void>((resolve) => {
        notifyPatchStarted = resolve
      })
      let releasePatchResponse!: () => void
      const patchResponseGate = new Promise<void>((resolve) => {
        releasePatchResponse = resolve
      })
      let patchHasStarted = false
      const requests: Array<"PATCH" | "DELETE"> = []
      const capturedDeletes: CapturedResponse[] = []
      const upsertFlush = waitForFlushMetric(
        "the completed PATCH flush",
        (metric) => !metric.overlapDetected && metric.trigger === "auth" && metric.examined === 1,
      )
      const overlapFlush = waitForFlushMetric(
        "the overlapping schedule(0) flush",
        (metric) => metric.overlapDetected,
      )
      const deleteFlush = waitForFlushMetric(
        "the trailing pending_wakeup delete flush",
        (metric) => !metric.overlapDetected && metric.trigger === "pending_wakeup" && metric.succeeded === 1,
      )

      installRoutedFetch(
        {
          [`/api/writings/${writingId}`]: async (request) => {
            if (request.method === "PATCH") {
              requests.push("PATCH")
              const response = await patchRoute(writingId)(request)
              patchHasStarted = true
              notifyPatchStarted()
              await patchResponseGate
              return response
            }
            if (request.method === "DELETE") {
              requests.push("DELETE")
              return capturingDelete(writingId, capturedDeletes)(request)
            }
            return new Response(null, { status: 405 })
          },
        },
        owner,
      )

      try {
        // El timer pertenece a webSyncService.scheduleFlush() real. El PATCH
        // real ya hizo commit en Postgres cuando el deferred retiene su
        // respuesta; el SyncWorker sigue dentro de la request.
        await vi.advanceTimersByTimeAsync(0)
        await patchStarted
        expect(
          await readRow<{ deleted_at: string | null }>(admin, "writings", writingId),
          "PATCH real confirmó la fila viva antes de retener la respuesta",
        ).toMatchObject({ id: writingId, deleted_at: null })
        expect(flushMetrics, "el flush sigue en vuelo mientras la respuesta está retenida").toEqual([])

        const deleted = await deleteWritingLocally(writingId)
        expect(deleted.error, "el borrado local entra por el servicio real").toBeNull()
        expect(
          (await localDB.syncQueue.getCurrentForWriting(writingId))?.operation,
          "el delete real sustituye el upsert por entity_key",
        ).toBe("delete")

        // Solo avanza el schedule(0) que produjo el enqueue del delete. No se
        // llama flush manualmente ni se produce otro evento de aplicación.
        await vi.advanceTimersByTimeAsync(0)
        const overlap = await overlapFlush
        expect(overlap).toMatchObject({ trigger: "auth", overlapDetected: true, examined: 0 })
        expect(requests, "el delete aún no pudo adelantarse al PATCH en vuelo").toEqual(["PATCH"])

        releasePatchResponse()
        const [upsertMetric, trailingMetric] = await Promise.all([upsertFlush, deleteFlush])

        expect(upsertMetric).toMatchObject({ trigger: "auth", examined: 1, succeeded: 1, failed: 0 })
        expect(trailingMetric).toMatchObject({ trigger: "pending_wakeup", examined: 1, succeeded: 1, failed: 0 })
        expect(requests, "el único orden remoto es PATCH seguido por un DELETE").toEqual(["PATCH", "DELETE"])
        expect(capturedDeletes, "se envió exactamente un DELETE al handler real").toHaveLength(1)
        expect(capturedDeletes[0]?.status, "el DELETE real contra Supabase local fue aceptado").toBe(200)

        const cloudRow = await readRow<{ id: string; deleted_at: string | null }>(admin, "writings", writingId)
        expect(cloudRow?.id, "la identidad creada por PATCH se conserva").toBe(writingId)
        expect(cloudRow?.deleted_at, "DELETE dejó el tombstone en Postgres").not.toBeNull()
        expect(await localDB.syncQueue.getCurrentForWriting(writingId), "la mutación durable se consumió").toBeNull()
        expect(await localDB.syncQueue.getPending(), "no queda otra mutación pendiente").toEqual([])
        expect((await localDB.writings.get(writingId))?.sync_status, "la fila local continúa borrada").toBe("deleted")
        expect(
          flushMetrics.filter((metric) => metric.overlapDetected),
          "un trigger solapado solo registra la detección; no dispara una segunda request",
        ).toHaveLength(1)
      } finally {
        releasePatchResponse()
        if (patchHasStarted) await upsertFlush.catch(() => undefined)
        await deleteFlush.catch(() => undefined)
      }
    },
  )
})
