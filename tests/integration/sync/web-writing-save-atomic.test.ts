/**
 * ODE-589 — Un guardado web nunca escribe la fila a partir de una lectura
 * vieja.
 *
 * `webDocumentService` leía la fila (`writings.get`) y la escribía entera
 * después (`enqueueWritingUpsert` → `writings.save`), en dos transacciones de
 * IndexedDB. Lo que otro escritor confirmara entre las dos se perdía:
 *
 * - `saveWriting` copiaba el `lifecycle` de su lectura. Si el worker de sync
 *   hacía rollback de `syncing` en la ventana, el guardado devolvía
 *   `syncing` y la fila se quedaba atascada ahí (lo que ODE-553 existe para
 *   evitar).
 * - `updateWritingMetadata` y `renameWriting` escribían el cuerpo de su
 *   lectura: un guardado del editor en la ventana volvía al cuerpo anterior.
 *
 * Real `webDocumentService` → real `localDB` (fake-indexeddb) → real
 * `SyncWorker`. Solo se doblan la red (`upsertWriting`) y el agendador del
 * flush (para que el worker corra cuando la prueba lo decide). La ventana se
 * abre de forma determinista en el primer acceso del servicio a la fila, sea
 * por `writings.get` (después de leer) o por `writings.update` (antes de la
 * transacción), así que la prueba no depende de cómo lo implemente el
 * servicio. `state.injected` es el control positivo.
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/sync/sync-service-factory", () => ({
  getSyncService: () => ({ scheduleFlush: async () => ({ data: undefined, error: null }) }),
}))

const { createEntityKey, localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
const { SyncWorker } = await import("@/lib/sync/worker")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting
type WritingRecord = import("@/lib/services/contracts/document-service").WritingRecord

const WRITING_ID = "writing-ode589"

const doc = (text: string) => ({ type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text }] }] })

const makeLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: WRITING_ID,
  title: "Carta",
  body_json: doc("Primera versión."),
  body_text: "Primera versión.",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:00.000Z",
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

function heldTransport() {
  let fail!: () => void
  const released = new Promise<void>((resolve) => {
    fail = resolve
  })
  const started = { value: false }
  return {
    started,
    fail,
    transport: {
      upsertWriting: vi.fn(async () => {
        started.value = true
        await released
        throw new Error("network down")
      }),
      deleteWriting: vi.fn(async () => undefined),
      upsertCollection: vi.fn(async () => undefined),
      deleteCollection: vi.fn(async () => undefined),
      setWritingCollections: vi.fn(async () => undefined),
    },
  }
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
  setLocalDBScope(`ode-589-${crypto.randomUUID()}`)
})

describe("ODE-589 — los guardados web no escriben a partir de una lectura vieja", () => {
  it("saveWriting no deja el lifecycle atascado en syncing si el worker hace rollback en la ventana", async () => {
    const original = makeLocalWriting()
    await localDB.writings.save(original)
    await localDB.syncQueue.enqueue({
      id: "mutation-ode589",
      entity_kind: "writing",
      entity_id: WRITING_ID,
      entity_key: createEntityKey("writing", WRITING_ID),
      operation: "upsert",
      payload: {
        body_json: original.body_json,
        body_text: original.body_text,
        status: "draft",
        artifact_type: "general",
        visibility: "private",
        version: 1,
        updated_at: original.updated_at,
      },
      created_at: 1,
      attempts: 0,
    })

    // Un intento de sync en vuelo: el worker ya marcó la fila `syncing` y la
    // red todavía no respondió.
    const network = heldTransport()
    const worker = new SyncWorker({ localDb: localDB, isOnline: () => true, transport: network.transport })
    const flushing = worker.flush()
    await until(() => network.started.value, "el intento remoto empezó")
    expect((await localDB.writings.get(WRITING_ID))?.lifecycle, "precondición: intento en vuelo").toBe("syncing")

    // El editor guarda. En la ventana del guardado, la red falla y el worker
    // devuelve la fila a su lifecycle estable.
    const state = armWindow(async () => {
      network.fail()
      await flushing
    })
    const result = await webDocumentService.saveWriting({ writing: editorRecord("Texto del editor.", 2) })

    expect(result.error).toBeNull()
    expect(state.injected, "control positivo: el rollback entró en la ventana").toBe(true)
    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text, "el cuerpo del guardado del editor").toBe("Texto del editor.")
    expect(row?.lifecycle, "no se queda atascado en syncing").toBe("server-confirmed")
  })

  it.each([
    [
      "updateWritingMetadata",
      () =>
        webDocumentService.updateWritingMetadata({
          writingId: WRITING_ID,
          status: "review",
          version: 2,
          updatedAt: "2026-09-25T00:00:05.000Z",
        }),
      (row: LocalWriting | null) => {
        expect(row?.status, "y el cambio de metadatos").toBe("review")
        expect(row?.version, "encima del guardado del editor (v2), no por detrás").toBe(3)
      },
    ],
    [
      "renameWriting",
      () =>
        webDocumentService.renameWriting({
          writingId: WRITING_ID,
          title: "Carta a Marta",
          updatedAt: "2026-09-25T00:00:05.000Z",
        }),
      (row: LocalWriting | null) => {
        expect(row?.title, "y el título nuevo").toBe("Carta a Marta")
        expect(row?.version, "renombrar conserva la versión del guardado del editor").toBe(2)
      },
    ],
  ] as const)(
    "%s no devuelve el cuerpo anterior sobre un guardado del editor en la ventana",
    async (_name, change, expectChange) => {
      await localDB.writings.save(makeLocalWriting())
      // Un guardado del editor confirma un cuerpo más nuevo en la ventana.
      const state = armWindow(async () => {
        const saved = await webDocumentService.saveWriting({ writing: editorRecord("Versión más nueva.", 2) })
        expect(saved.error).toBeNull()
      })

      const result = await change()

      expect(result.error).toBeNull()
      expect(state.injected, "control positivo: el guardado entró en la ventana").toBe(true)
      const row = await localDB.writings.get(WRITING_ID)
      expect(row?.body_text, "el cuerpo del guardado del editor").toBe("Versión más nueva.")
      expectChange(row)
    },
  )
})
