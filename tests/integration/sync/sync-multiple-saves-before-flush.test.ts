/**
 * SYNC-05 — Varios guardados locales antes de sincronizar: lo que llega a la
 * nube es la última versión completa, no una intermedia ni una mezcla.
 *
 * Cadena real: `webDocumentService.saveWriting` / `updateWritingMetadata` (el
 * camino de producción, no se escribe en la cola a mano) → `localDB` real
 * sobre `fake-indexeddb` → `SyncWorker` real → solo el transporte de red se
 * dobla, por un servidor fake en memoria que aplica la última escritura
 * recibida y devuelve el eco del registro de la API.
 *
 * Comportamiento documentado (requisito 1): la cola deduplica por `entity_key`
 * (`lib/local-db/index.ts:1074-1095`) y conserva solo la última mutación de la
 * entidad, así que las versiones intermedias **no se envían**. La prueba
 * afirma esa ausencia sobre lo que registra el servidor fake, con control
 * positivo: cada guardado intermedio sí encoló su propia mutación (con su
 * cuerpo) antes de ser reemplazada, así que el efecto era alcanzable. Si el
 * transporte llegara a ver una intermedia, el fake la registraría y la última
 * escritura ganaría en su estado final.
 *
 * El mock de `sync-service-factory` es el mismo montaje que
 * `web-writing-save-atomic.test.ts` (:27-29): evita que el Worker singleton
 * agende un flush real por cada guardado; la prueba conduce `flush()` cuando
 * lo decide. El montaje del que sale esta prueba es el de
 * `web-writing-save-atomic.test.ts` / `sync-lifecycle-transition-atomic.test.ts`.
 *
 * Evento de completitud: el flush termina (`await worker.flush()`), y solo
 * entonces se afirma sobre la fila de `localDB` y sobre lo recibido por el
 * servidor fake — no sobre `toHaveBeenCalled`.
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { SyncWorker } = await import("@/lib/sync/worker")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type SyncMutation = import("@/lib/local-db/schema").SyncMutation
type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord
type RemoteWritingRecord = import("@/lib/sync/remote-bootstrap").RemoteWritingRecord

const WRITING_ID = "writing-ode611"
const SERVER_CREATED_AT = "2026-09-25T00:00:00.000Z"

type WritingPayload = Extract<SyncMutation, { entity_kind: "writing" }>["payload"]

const timestamp = (seconds: number) => `2026-09-25T00:00:${String(seconds).padStart(2, "0")}.000Z`

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

const makeLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: WRITING_ID,
  title: "Carta",
  body_json: doc("Primera versión."),
  body_text: "Primera versión.",
  status: "draft",
  artifact_type: "general",
  visibility: "private",
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  created_at: timestamp(0),
  updated_at: timestamp(1),
  local_updated_at: 1_000,
  ...overrides,
})

/** Lo que el editor manda a `saveWriting`: el documento con cuerpo nuevo. */
const editorRecord = (
  text: string,
  version: number,
  overrides: Partial<WritingRecord> = {},
): WritingRecord => ({
  id: WRITING_ID,
  authorId: null,
  title: "Carta",
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
  ...overrides,
})

/**
 * Servidor fake: el PATCH sustituye la fila (la última escritura gana) y su
 * respuesta es el eco que `worker.processMutation` aplica a la fila local.
 * `holdFirst` retiene la primera respuesta para poder guardar durante el flush.
 */
function fakeServer({ holdFirst = false } = {}) {
  const received: WritingPayload[] = []
  const document = { current: null as RemoteWritingRecord | null }
  const started = { value: false }
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  const upsertWriting = vi.fn(async (writingId: string, payload: WritingPayload) => {
    if (holdFirst && !started.value) {
      started.value = true
      await gate
    }
    received.push(payload)
    document.current = {
      id: writingId,
      author_id: payload.author_id ?? "",
      title: payload.title ?? null,
      slug: payload.slug ?? null,
      status: payload.status,
      artifact_type: payload.artifact_type,
      visibility: payload.visibility,
      parent_id: payload.parent_id ?? null,
      correspondence_id: payload.correspondence_id ?? null,
      version: payload.version,
      sync_status: "synced",
      deleted_at: payload.deleted_at ?? null,
      created_at: SERVER_CREATED_AT,
      updated_at: payload.updated_at,
      content_hash: payload.content_hash ?? null,
      content_updated_at: payload.content_updated_at ?? payload.updated_at,
      metadata_updated_at: payload.metadata_updated_at ?? payload.updated_at,
      body_json: payload.body_json,
      body_text: payload.body_text,
    }
    return document.current
  })

  return {
    received,
    document,
    started,
    release,
    transport: {
      upsertWriting,
      deleteWriting: vi.fn(async () => undefined),
      upsertCollection: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
      setWritingCollections: vi.fn(async () => undefined),
    },
  }
}

const currentWritingPayload = async () => {
  const mutation = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
  return mutation?.entity_kind === "writing" ? mutation.payload : null
}

async function until(predicate: () => boolean | Promise<boolean>, label: string) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (await predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timeout esperando: ${label}`)
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
  })
  setLocalDBScope(`ode-611-${crypto.randomUUID()}`)
})

describe("SYNC-05 — varios guardados antes del flush: la última versión gana", () => {
  it("tres guardados con una metadata entre medio: a la nube solo llega la versión 3 completa", async () => {
    await localDB.writings.save(makeLocalWriting())
    const server = fakeServer()
    const worker = new SyncWorker({ localDb: localDB, isOnline: () => true, transport: server.transport })

    const save1 = await webDocumentService.saveWriting({ writing: editorRecord("Versión 1.", 2) })
    expect(save1.error).toBeNull()
    expect(
      (await currentWritingPayload())?.body_text,
      "control positivo: el guardado 1 encoló su propio cuerpo",
    ).toBe("Versión 1.")

    const meta = await webDocumentService.updateWritingMetadata({
      writingId: WRITING_ID,
      status: "review",
      version: 3,
      updatedAt: timestamp(3),
    })
    expect(meta.error).toBeNull()
    const afterMeta = await currentWritingPayload()
    expect(afterMeta?.body_text, "la mutación de metadata lleva el cuerpo que había").toBe("Versión 1.")
    expect(afterMeta?.status, "y la metadata nueva").toBe("review")

    const save2 = await webDocumentService.saveWriting({
      writing: editorRecord("Versión 2.", 4, { status: "review" }),
    })
    expect(save2.error).toBeNull()
    expect((await localDB.writings.get(WRITING_ID))?.status, "el guardado conserva la metadata final").toBe(
      "review",
    )
    expect(
      (await currentWritingPayload())?.body_text,
      "control positivo: el guardado 2 reemplazó a la mutación anterior",
    ).toBe("Versión 2.")

    const save3 = await webDocumentService.saveWriting({
      writing: editorRecord("Versión 3.", 5, { status: "review" }),
    })
    expect(save3.error).toBeNull()

    // Antes del flush la cola solo conserva la última mutación, con cuerpo y
    // metadata de la misma versión de la fila.
    const queued = await currentWritingPayload()
    expect(queued?.body_text).toBe("Versión 3.")
    expect(queued?.status).toBe("review")
    expect(queued?.version).toBe(5)

    await worker.flush()

    // Lo que llegó a la nube: una sola escritura, la última versión completa.
    expect(
      server.received.map((payload) => payload.body_text),
      "sin versiones intermedias en el servidor fake",
    ).toEqual(["Versión 3."])
    const sent = server.received[0]
    expect(sent.body_json, "cuerpo 3").toEqual(doc("Versión 3."))
    expect(sent.status, "metadata final").toBe("review")
    expect(sent.artifact_type, "metadata final").toBe("general")
    expect(sent.version, "versión final").toBe(5)
    expect(sent.updated_at).toBe(timestamp(5))
    expect(server.document.current?.body_text, "la última escritura gana en el servidor fake").toBe(
      "Versión 3.",
    )

    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text).toBe("Versión 3.")
    expect(row?.status).toBe("review")
    expect(row?.version).toBe(5)
    expect(row?.sync_status, "la fila queda confirmada").toBe("synced")
    expect(row?.lifecycle).toBe("server-confirmed")
    expect(await localDB.syncQueue.getCurrentForWriting(WRITING_ID), "y la cola vacía").toBeNull()
  })

  it("un guardado durante un flush en vuelo queda pending con su versión y el siguiente flush la envía", async () => {
    await localDB.writings.save(makeLocalWriting())
    const server = fakeServer({ holdFirst: true })
    const worker = new SyncWorker({ localDb: localDB, isOnline: () => true, transport: server.transport })

    // Dos guardados reales dejan la v3 en la cola antes del flush.
    expect((await webDocumentService.saveWriting({ writing: editorRecord("Versión 2.", 2) })).error).toBeNull()
    expect((await webDocumentService.saveWriting({ writing: editorRecord("Versión 3.", 3) })).error).toBeNull()
    expect((await currentWritingPayload())?.body_text, "precondición: la cola tiene la v3").toBe("Versión 3.")

    // El transporte retiene la respuesta: la v3 está en vuelo.
    const flushing = worker.flush()
    await until(() => server.started.value, "el intento remoto empezó")
    expect((await localDB.writings.get(WRITING_ID))?.lifecycle, "precondición: intento en vuelo").toBe("syncing")

    // El editor guarda la v4 mientras la v3 está en la nube.
    const save4 = await webDocumentService.saveWriting({ writing: editorRecord("Versión 4.", 4) })
    expect(save4.error).toBeNull()

    server.release()
    await flushing

    // Evento de completitud del primer flush: la v4 sobrevive y sigue pendiente.
    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text, "el cuerpo guardado durante el vuelo").toBe("Versión 4.")
    expect(row?.version).toBe(4)
    expect(row?.sync_status, "todavía pendiente de subir").toBe("pending")
    expect(row?.lifecycle, "el documento ya existe en el servidor").toBe("server-confirmed")
    expect(
      (await currentWritingPayload())?.body_text,
      "la cola conserva la mutación nueva, no la vieja",
    ).toBe("Versión 4.")
    expect(
      server.received.map((payload) => payload.body_text),
      "el primer flush envió la v3, no la v4",
    ).toEqual(["Versión 3."])

    await worker.flush()

    expect(
      server.received.map((payload) => payload.body_text),
      "el siguiente flush envía la v4",
    ).toEqual(["Versión 3.", "Versión 4."])
    expect(server.document.current?.body_text, "el servidor queda en la última versión").toBe("Versión 4.")

    const finalRow = await localDB.writings.get(WRITING_ID)
    expect(finalRow?.body_text).toBe("Versión 4.")
    expect(finalRow?.version).toBe(4)
    expect(finalRow?.sync_status).toBe("synced")
    expect(finalRow?.lifecycle).toBe("server-confirmed")
    expect(await localDB.syncQueue.getCurrentForWriting(WRITING_ID), "cola vacía").toBeNull()
  })
})
