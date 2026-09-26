/**
 * ODE-583 — Tocar el `lifecycle` de un documento durante el sync nunca pisa
 * un guardado local más nuevo.
 *
 * El worker marca la fila como `syncing` antes del intento remoto y la
 * devuelve a su valor estable si el intento falla (SYNC-03, ODE-553). Las dos
 * cosas se hacían leyendo la fila y escribiéndola entera después, en dos
 * transacciones de IndexedDB. Un guardado del autor que se confirmara entre
 * esa lectura y esa escritura se perdía: la escritura devolvía el cuerpo, la
 * versión y la marca local de la lectura anterior.
 *
 * Real SyncWorker.flush() → real localDB (fake-indexeddb). Solo la red
 * (`upsertWriting`) se dobla para simular el fallo. Para abrir la ventana de
 * forma determinista, el `localDb` que recibe el worker es el real envuelto:
 * en el acceso a la fila que corresponde a cada caso, antes de devolverle el
 * control al worker, se confirma un guardado real más nuevo. El envoltorio
 * cubre las dos formas de acceder a la fila (`writings.get` y la transición
 * condicional `writings.transitionLifecycle`), así que la prueba no depende de
 * cómo lo implemente el worker.
 */
import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { createEntityKey, localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting, WritingLifecycle } from "@/lib/local-db/schema"
import type { RemoteWritingRecord } from "@/lib/sync/remote-bootstrap"
import { SyncWorker } from "@/lib/sync/worker"

const WRITING_ID = "writing-ode583"

const makeLocalWriting = (lifecycle: WritingLifecycle): LocalWriting => ({
  id: WRITING_ID,
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Primera versión." }] }] },
  body_text: "Primera versión.",
  status: "draft",
  visibility: "private",
  version: 1,
  sync_status: lifecycle === "server-confirmed" ? "synced" : "pending",
  lifecycle,
  created_at: "2026-09-25T00:00:00.000Z",
  updated_at: "2026-09-25T00:00:00.000Z",
  local_updated_at: 1_000,
})

/** El guardado del autor que llega en la ventana: cuerpo, versión y marca nuevos. */
const newerSaveOf = (row: LocalWriting): LocalWriting => ({
  ...row,
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Versión más nueva." }] }] },
  body_text: "Versión más nueva.",
  version: row.version + 1,
  local_updated_at: 2_000,
})

const enqueueMutationFor = (writing: LocalWriting) =>
  localDB.syncQueue.enqueue({
    id: "mutation-ode583",
    entity_kind: "writing",
    entity_id: WRITING_ID,
    entity_key: createEntityKey("writing", WRITING_ID),
    operation: "upsert",
    payload: {
      body_json: writing.body_json,
      body_text: writing.body_text,
      status: "draft",
      artifact_type: "general",
      visibility: "private",
      version: writing.version,
      updated_at: writing.updated_at,
    },
    created_at: 1,
    attempts: 0,
  })

/**
 * `localDb` real con una única inyección: cuando `armed` es verdadero, el
 * siguiente acceso del worker a la fila confirma antes un guardado más nuevo.
 * Con `get`, la inyección ocurre DESPUÉS de leer (la ventana entre leer y
 * escribir); con la transición condicional, justo antes de delegar en ella.
 */
function localDbWithSaveInWindow() {
  const writings = localDB.writings
  const state = { armed: false, injected: false }
  const inject = async () => {
    state.armed = false
    const current = await writings.get(WRITING_ID)
    await writings.save(newerSaveOf(current!))
    state.injected = true
  }
  const wrapped: typeof localDB.writings = {
    ...writings,
    get: async (id) => {
      const row = await writings.get(id)
      if (state.armed && id === WRITING_ID) await inject()
      return row
    },
    transitionLifecycle: async (id, transition) => {
      if (state.armed && id === WRITING_ID) await inject()
      return writings.transitionLifecycle(id, transition)
    },
  }
  return { localDb: { ...localDB, writings: wrapped } as typeof localDB, state }
}

const transport = (onUpsert: () => void) => ({
  upsertWriting: vi.fn(async () => {
    onUpsert()
    throw new Error("network down")
  }),
  deleteWriting: vi.fn(async () => undefined),
  upsertCollection: vi.fn(async () => undefined),
  deleteCollection: vi.fn(async () => undefined),
  setWritingCollections: vi.fn(async () => undefined),
})

beforeEach(() => {
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  })
  setLocalDBScope(`ode-583-${crypto.randomUUID()}`)
})

async function expectNewerSaveKept(lifecycle: WritingLifecycle) {
  const row = await localDB.writings.get(WRITING_ID)
  expect(row?.body_text, "el cuerpo del guardado más nuevo").toBe("Versión más nueva.")
  expect(row?.version, "su versión").toBe(2)
  expect(row?.local_updated_at, "su marca local").toBe(2_000)
  expect(row?.lifecycle, "y el lifecycle vuelve a su valor estable").toBe(lifecycle)
}

describe("ODE-583 — el lifecycle del sync no pisa un guardado más nuevo", () => {
  it.each(["local-only", "server-confirmed"] as const)(
    "rollback tras un fallo con un guardado en la ventana (%s)",
    async (lifecycle) => {
      const original = makeLocalWriting(lifecycle)
      await localDB.writings.save(original)
      await enqueueMutationFor(original)
      const { localDb, state } = localDbWithSaveInWindow()
      // La inyección se arma cuando la red ya falló: el siguiente acceso a la
      // fila es el del rollback.
      const worker = new SyncWorker({ localDb, isOnline: () => true, transport: transport(() => { state.armed = true }) })

      await worker.flush()

      expect(state.injected, "control positivo: el guardado entró en la ventana").toBe(true)
      await expectNewerSaveKept(lifecycle)
    },
  )

  it("marca syncing antes del intento con un guardado en la ventana", async () => {
    const original = makeLocalWriting("local-only")
    await localDB.writings.save(original)
    await enqueueMutationFor(original)
    const { localDb, state } = localDbWithSaveInWindow()
    // Armada desde el principio: el primer acceso a la fila es el que la
    // marca como syncing antes de ir a la red.
    state.armed = true
    const worker = new SyncWorker({ localDb, isOnline: () => true, transport: transport(() => {}) })

    await worker.flush()

    expect(state.injected, "control positivo: el guardado entró en la ventana").toBe(true)
    await expectNewerSaveKept("local-only")
  })

  it("un éxito remoto no devuelve el cuerpo enviado sobre un guardado hecho durante la petición", async () => {
    const original = makeLocalWriting("local-only")
    await localDB.writings.save(original)
    await enqueueMutationFor(original)
    const worker = new SyncWorker({
      localDb: localDB,
      isOnline: () => true,
      transport: {
        // El servidor confirma lo que se le envió (versión 1, cuerpo
        // original), pero mientras la petición estaba en vuelo el autor guardó
        // una versión más nueva.
        upsertWriting: vi.fn(async () => {
          const current = await localDB.writings.get(WRITING_ID)
          await localDB.writings.save(newerSaveOf(current!))
          return {
            id: WRITING_ID,
            author_id: "author-1",
            title: null,
            slug: null,
            status: "draft" as const,
            artifact_type: "general",
            visibility: "private" as const,
            parent_id: null,
            correspondence_id: null,
            version: 1,
            sync_status: "synced",
            deleted_at: null,
            created_at: original.created_at,
            updated_at: "2026-09-25T00:00:01.000Z",
            body_json: original.body_json,
            body_text: original.body_text,
          } satisfies RemoteWritingRecord
        }),
        deleteWriting: vi.fn(async () => undefined),
        upsertCollection: vi.fn(async () => undefined),
        deleteCollection: vi.fn(async () => undefined),
        setWritingCollections: vi.fn(async () => undefined),
      },
    })

    await worker.flush()

    const row = await localDB.writings.get(WRITING_ID)
    expect(row?.body_text, "el cuerpo del guardado hecho durante la petición").toBe("Versión más nueva.")
    expect(row?.version, "su versión").toBe(2)
    expect(row?.lifecycle, "el documento ya existe en el servidor").toBe("server-confirmed")
  })
})
