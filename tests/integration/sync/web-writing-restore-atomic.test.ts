/**
 * ODE-592 — Un restore web nunca escribe la fila a partir de una lectura
 * vieja.
 *
 * `restoreWriting` hacía `fetch` → `writings.get` → `writings.save` en dos
 * transacciones de IndexedDB. Lo que otro escritor confirmara entre el `get`
 * y el `save` se perdía: un guardado del editor en la ventana volvía al
 * cuerpo anterior.
 *
 * El fix aplica los campos del restore sobre la fila ACTUAL con
 * `writings.update` (una transacción). A propósito no usa
 * `enqueueWritingUpdate`: ese helper marca `pending` y encola un `upsert`,
 * semántica opuesta a un restore ya confirmado por el servidor (`synced` +
 * limpiar la cola con `deleteForEntity`).
 *
 * Real `webDocumentService` → real `localDB` (fake-indexeddb). Solo se doblan
 * la red (`fetch` del endpoint lifecycle) y el agendador del flush. La ventana
 * se abre en el primer acceso del servicio a la fila (`get` o `update`), así
 * que la prueba no depende de la implementación. `state.injected` es el
 * control positivo.
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord

const WRITING_ID = "writing-ode592"

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

const makeArchivedWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: WRITING_ID,
  title: "Carta",
  body_json: doc("Versión archivada."),
  body_text: "Versión archivada.",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: "2026-09-25T01:00:00.000Z",
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T01:00:00.000Z",
  local_updated_at: 1_000,
  ...overrides,
})

/** Lo que el editor manda a `saveWriting`: el documento con cuerpo nuevo. */
const editorRecord = (text: string, version: number): WritingRecord => ({
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
  createdAt: "2026-09-25T00:00:00.000Z",
  updatedAt: `2026-09-25T00:00:0${version}.000Z`,
})

const restorePayload = (version: number) => ({
  author_id: null,
  title: "Carta",
  slug: null,
  status: "draft",
  artifact_type: "general",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version,
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:05.000Z",
})

function stubRestoreFetch(version: number, status = 200) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
    data: status === 200 ? restorePayload(version) : null,
    error: status === 200 ? null : { message: "Restore failed" },
  }), { status, headers: { "Content-Type": "application/json" } })))
}

/**
 * Arma una única inyección en el siguiente acceso del servicio a la fila:
 * después de `get`, o antes de la transacción de `update`.
 */
function armWindow(inject: () => Promise<void>) {
  const state = { armed: true, injected: false }
  const fire = async () => {
    state.armed = false
    await inject()
    state.injected = true
  }
  const get = localDB.writings.get
  const update = localDB.writings.update
  vi.spyOn(localDB.writings, "get").mockImplementation(async (id) => {
    const row = await get(id)
    if (state.armed && id === WRITING_ID) await fire()
    return row
  })
  vi.spyOn(localDB.writings, "update").mockImplementation(async (id, updater) => {
    if (state.armed && id === WRITING_ID) await fire()
    return update(id, updater)
  })
  return state
}

beforeEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
  })
  setLocalDBScope(`ode-592-${crypto.randomUUID()}`)
})

describe("ODE-592 — el restore web no escribe a partir de una lectura vieja", () => {
  it("conserva el cuerpo de un guardado del editor que confirma en la ventana", async () => {
    await localDB.writings.save(makeArchivedWriting())
    stubRestoreFetch(5)
    // Un guardado del editor confirma un cuerpo más nuevo en la ventana.
    const state = armWindow(async () => {
      const saved = await webDocumentService.saveWriting({ writing: editorRecord("Versión más nueva.", 2) })
      expect(saved.error).toBeNull()
    })

    const result = await webDocumentService.restoreWriting({
      writingId: WRITING_ID,
      version: 1,
      updatedAt: "2026-09-25T00:00:05.000Z",
    })

    expect(result.error).toBeNull()
    expect(state.injected, "control positivo: el guardado entró en la ventana").toBe(true)
    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text, "el cuerpo del guardado del editor").toBe("Versión más nueva.")
    expect(row?.deleted_at, "el restore desarchiva").toBeNull()
    expect(row?.sync_status, "restore confirmado: synced, no pending").toBe("synced")
    expect(row?.lifecycle).toBe("server-confirmed")
    expect(row?.version, "la versión del servidor").toBe(5)
    // La cola se limpió antes de la ventana: lo único encolado es la
    // mutación del guardado del editor, no una del restore.
    const queued = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(queued?.operation, "la mutación del guardado sobrevive").toBe("upsert")
    expect(queued?.entity_kind === "writing" && queued.payload.body_text).toBe("Versión más nueva.")
  })

  it("sin ventana, el restore limpia la cola y no encola nada propio", async () => {
    await localDB.writings.save(makeArchivedWriting({ sync_status: "pending" }))
    await webDocumentService.saveWriting({ writing: editorRecord("Pendiente.", 1) })
    expect(await localDB.syncQueue.getCurrentForWriting(WRITING_ID)).not.toBeNull()
    stubRestoreFetch(5)

    const result = await webDocumentService.restoreWriting({
      writingId: WRITING_ID,
      version: 1,
      updatedAt: "2026-09-25T00:00:05.000Z",
    })

    expect(result.error).toBeNull()
    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.sync_status).toBe("synced")
    expect(row?.lifecycle).toBe("server-confirmed")
    expect(await localDB.syncQueue.getCurrentForWriting(WRITING_ID)).toBeNull()
  })

  it("un guardado que confirma después de la escritura del restore conserva su mutación en la cola", async () => {
    await localDB.writings.save(makeArchivedWriting())
    stubRestoreFetch(5)
    // La ventana se abre DESPUÉS de que la transacción de `update` confirma:
    // si el restore limpiara la cola en ese momento, borraría la mutación de
    // este guardado y su cuerpo nunca subiría al servidor.
    const state = { injected: false }
    const update = localDB.writings.update
    vi.spyOn(localDB.writings, "update").mockImplementation(async (id, updater) => {
      const written = await update(id, updater)
      if (!state.injected && id === WRITING_ID) {
        state.injected = true
        const saved = await webDocumentService.saveWriting({ writing: editorRecord("Versión posterior.", 6) })
        expect(saved.error).toBeNull()
      }
      return written
    })

    const result = await webDocumentService.restoreWriting({
      writingId: WRITING_ID,
      version: 1,
      updatedAt: "2026-09-25T00:00:05.000Z",
    })

    expect(result.error).toBeNull()
    expect(state.injected, "control positivo: el guardado entró en la ventana").toBe(true)
    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text).toBe("Versión posterior.")
    const queued = await localDB.syncQueue.getCurrentForWriting(WRITING_ID)
    expect(queued, "la mutación del guardado sigue en la cola").not.toBeNull()
  })

  it("sin fila local devuelve el registro sintético sin escribir ni encolar", async () => {
    stubRestoreFetch(2)

    const result = await webDocumentService.restoreWriting({
      writingId: WRITING_ID,
      version: 1,
      updatedAt: "2026-09-25T00:00:05.000Z",
    })

    expect(result.error).toBeNull()
    expect(result.data).toMatchObject({ id: WRITING_ID, version: 2, deletedAt: null, lifecycle: "server-confirmed" })
    expect(await localDB.writings.get(WRITING_ID), "no se escribe nada").toBeNull()
    expect(await localDB.syncQueue.getCurrentForWriting(WRITING_ID), "no se encola nada").toBeNull()
  })

  it.each([
    ["NOT_FOUND", 404, false],
    ["CONFLICT", 409, false],
    ["UNAVAILABLE", 500, true],
  ] as const)("%s mapea el estado %s del servidor", async (code, status, retryable) => {
    stubRestoreFetch(0, status)

    const result = await webDocumentService.restoreWriting({
      writingId: WRITING_ID,
      version: 1,
      updatedAt: "2026-09-25T00:00:05.000Z",
    })

    expect(result.data).toBeNull()
    expect(result.error).toMatchObject({ code, retryable })
  })
})
