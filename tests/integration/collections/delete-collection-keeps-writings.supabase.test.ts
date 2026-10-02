/**
 * COL-06 web (ODE-618, PR2) — borrar una colección no borra ni corrompe sus
 * documentos; contrato de respuesta (ODE-660) — el DELETE informa si borró.
 *
 * Entry point: el handler real `DELETE` de `app/api/collections/[id]/route.ts`,
 * el owner de la operación en web (el worker de sync lo llama en producción).
 * La colección se crea por el handler real `PATCH /api/collections/[id]` (el
 * upsert que manda `lib/sync/worker.ts`); los documentos y sus filas de unión
 * se siembran con los helpers del harness (bajo RLS como dueño), porque ni la
 * escritura ni la asignación modifican la propiedad bajo prueba, que es la
 * cascada del DELETE. Lo único doblado es el transporte de sesión
 * (`@/lib/supabase/server#createClient` → cliente real del usuario vía
 * `serverClientAs`): RLS y Postgres son reales contra la instancia local.
 *
 * Evento de completitud: la promesa del handler resuelve después de que
 * PostgREST commitea el DELETE; recién ahí se afirman las filas canónicas
 * (`writings`, `collections`, `writing_collections`) leídas por el admin.
 *
 * ODE-660: el DELETE cuenta lo que borró y responde 200 con
 * `{ data: { id, deleted } }` — `deleted:false` tanto si la colección no
 * existía como si es ajena, sin distinguir "no existe" de "no es tuya". Un
 * segundo DELETE del dueño también responde `deleted:false`: la cola de sync
 * lo trata como éxito (la prueba del worker vive en `tests/sync-worker.test.ts`).
 * El caso del extraño afirma las dos cosas: el cuerpo de la respuesta y que
 * "nada cambió" (filas y cuerpos); el borrado del dueño es el control
 * positivo, y el PATCH ajeno un control de no-2xx con la fila intacta.
 *
 * `ODE618_RUN_ID` fija el tag del run (y con él el email `owner_<runId>`) para
 * el mutation test del trigger `zz_mutation_ode618_<runId>`, que se acota al
 * dueño del run. En una corrida normal el tag es aleatorio.
 */
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

import { DELETE, PATCH } from "@/app/api/collections/[id]/route"
import { GET } from "@/app/api/writings/[id]/collections/route"
import {
  cleanupUsers,
  readRow,
  readRows,
  seedMembership,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"

const sessionState = vi.hoisted(() => ({
  user: null as { accessToken: string; refreshToken: string } | null,
}))

vi.mock("@/lib/supabase/server", async () => {
  const { serverClientAs } = await import("../../support/supabase-local/session")
  return {
    createClient: async () => serverClientAs(sessionState.user),
  }
})

const runId = (process.env.ODE618_RUN_ID ?? randomUUID().replace(/[^a-z0-9]/g, "")).replace(/[^a-z0-9]/g, "").slice(0, 8)

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

const jsonRequest = (url: string, method: string, body: unknown) =>
  new Request(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  })

/** Crea una colección por el handler real (el upsert que manda el worker). */
async function createCollection(name: string): Promise<string> {
  const id = randomUUID()
  const response = await PATCH(
    jsonRequest(`http://localhost/api/collections/${id}`, "PATCH", {
      name,
      description: null,
      visibility: "private",
      updated_at: new Date().toISOString(),
    }),
    { params: Promise.resolve({ id }) },
  )
  expect(response.status, `PATCH real de la colección ${name}`).toBe(200)
  return id
}

const deleteCollection = (id: string) =>
  DELETE(new Request(`http://localhost/api/collections/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  })

const readWriting = (id: string) => readRow<Record<string, unknown>>(admin, "writings", id)
const readMemberships = (collectionId: string) =>
  readRows<{ writing_id: string; collection_id: string }>(
    admin,
    "writing_collections",
    "collection_id",
    collectionId,
  )

/**
 * Escenario base: dos documentos del dueño, una colección principal con los
 * dos y una secundaria solo con el primero. El segundo es el documento cuya
 * única colección se borra.
 */
async function setupScenario() {
  const firstWritingId = await seedWriting(admin, { authorId: owner.id, title: "COL-06 uno" })
  const secondWritingId = await seedWriting(admin, { authorId: owner.id, title: "COL-06 dos" })
  const principalId = await createCollection("Principal")
  const secondaryId = await createCollection("Secundaria")
  // Las filas de unión se siembran bajo RLS como dueño (helper del harness): la
  // asignación no modifica la propiedad bajo prueba, que es la cascada del
  // DELETE. El entry real del DELETE sí es el handler.
  const ownerClient = await createUserClient(owner)
  await seedMembership(ownerClient, { writingId: firstWritingId, collectionId: principalId })
  await seedMembership(ownerClient, { writingId: firstWritingId, collectionId: secondaryId })
  await seedMembership(ownerClient, { writingId: secondWritingId, collectionId: principalId })
  return { firstWritingId, secondWritingId, principalId, secondaryId }
}

describe("COL-06 web — borrar una colección no toca sus documentos", () => {
  it.fails("los documentos, sus cuerpos y su metadata sobreviven, y solo desaparecen las filas de unión de la colección borrada", async () => {
    sessionState.user = owner
    const { firstWritingId, secondWritingId, principalId, secondaryId } = await setupScenario()

    // Control positivo de alcanzabilidad: antes del borrado los dos documentos
    // existen y las tres asignaciones (2 a la principal, 1 a la secundaria)
    // están en la DB.
    const beforeFirst = await readWriting(firstWritingId)
    const beforeSecond = await readWriting(secondWritingId)
    expect(beforeFirst, "el primer documento existe antes del borrado").not.toBeNull()
    expect(beforeSecond, "el segundo documento existe antes del borrado").not.toBeNull()
    expect((await readMemberships(principalId)).map((row) => row.writing_id).sort()).toEqual(
      [firstWritingId, secondWritingId].sort(),
    )
    expect((await readMemberships(secondaryId)).map((row) => row.writing_id)).toEqual([firstWritingId])

    const response = await deleteCollection(principalId)
    expect(response.status, "DELETE real de la colección del dueño").toBe(200)
    expect(await response.json(), "el dueño sí borró la colección").toEqual({
      data: { id: principalId, deleted: true },
      error: null,
    })

    // Resultado canónico 1: los dos documentos siguen ahí, byte a byte de fila
    // (cuerpo y metadata incluidos); nada los tocó.
    expect(await readWriting(firstWritingId), "el primer documento sobrevive intacto").toEqual(beforeFirst)
    expect(await readWriting(secondWritingId), "el segundo documento sobrevive intacto").toEqual(beforeSecond)

    // Resultado canónico 2: solo se fueron las filas de unión de la colección
    // borrada; la asignación a la colección viva queda igual y la colección ya
    // no existe.
    expect(await readMemberships(principalId), "no quedan filas de la colección borrada").toHaveLength(0)
    expect(
      (await readMemberships(secondaryId)).map((row) => row.writing_id),
      "la asignación a la colección viva no se toca",
    ).toEqual([firstWritingId])
    expect(await readRow(admin, "collections", principalId), "la colección borrada ya no existe").toBeNull()

    // El camino de lectura real de la app sigue resolviendo las asignaciones
    // vivas: el documento que también estaba en la otra colección la conserva,
    // y el que perdió su única colección queda sin ninguna.
    const listCollectionIds = async (writingId: string) => {
      const listResponse = await GET(
        new Request(`http://localhost/api/writings/${writingId}/collections`),
        { params: Promise.resolve({ id: writingId }) },
      )
      const listBody = (await listResponse.json()) as { data: { collection_id: string }[] }
      expect(listResponse.status).toBe(200)
      return listBody.data.map((row) => row.collection_id)
    }
    expect(await listCollectionIds(firstWritingId), "el documento sigue en la otra colección").toEqual([secondaryId])
    expect(await listCollectionIds(secondWritingId), "el documento sin colección viva queda sin asignaciones").toEqual(
      [],
    )
  })

  it.fails("el intento de un usuario ajeno no borra la colección ni toca sus documentos (y el dueño sí puede borrarla)", async () => {
    sessionState.user = owner
    const { firstWritingId, secondWritingId, principalId, secondaryId } = await setupScenario()

    const beforeFirst = await readWriting(firstWritingId)
    const beforeSecond = await readWriting(secondWritingId)
    const beforeCollection = await readRow(admin, "collections", principalId)
    expect(beforeCollection).not.toBeNull()
    expect(await readMemberships(principalId)).toHaveLength(2)

    sessionState.user = stranger
    const response = await deleteCollection(principalId)
    expect(response).toBeInstanceOf(Response)
    expect(response.status, "el DELETE ajeno no es un error de transporte").toBe(200)
    expect(await response.json(), "el extraño no borró nada").toEqual({
      data: { id: principalId, deleted: false },
      error: null,
    })

    // Nada cambió: la colección, los tres documentos y las tres asignaciones
    // están como antes.
    expect(await readRow(admin, "collections", principalId), "la colección sigue viva").toEqual(beforeCollection)
    expect(await readWriting(firstWritingId), "el primer documento no se tocó").toEqual(beforeFirst)
    expect(await readWriting(secondWritingId), "el segundo documento no se tocó").toEqual(beforeSecond)
    expect((await readMemberships(principalId)).map((row) => row.writing_id).sort()).toEqual(
      [firstWritingId, secondWritingId].sort(),
    )
    expect((await readMemberships(secondaryId)).map((row) => row.writing_id)).toEqual([firstWritingId])

    // Control positivo: el mismo setup sí es borrable por el dueño; sin esto,
    // el no-op del extraño podría deberse a un escenario muerto.
    sessionState.user = owner
    const ownerResponse = await deleteCollection(principalId)
    expect(ownerResponse.status).toBe(200)
    expect(await ownerResponse.json(), "el control del dueño sí borró").toEqual({
      data: { id: principalId, deleted: true },
      error: null,
    })
    expect(await readRow(admin, "collections", principalId)).toBeNull()
    expect(await readMemberships(principalId)).toHaveLength(0)
    expect(await readWriting(firstWritingId), "y el documento sigue vivo").not.toBeNull()
  })

  it.fails("un segundo DELETE del dueño responde deleted:false (idempotente para la cola de sync)", async () => {
    sessionState.user = owner
    const collectionId = await createCollection("Idempotente")
    expect(await readRow(admin, "collections", collectionId)).not.toBeNull()

    const firstResponse = await deleteCollection(collectionId)
    expect(firstResponse.status).toBe(200)
    expect(await firstResponse.json(), "el primer DELETE borró la fila").toEqual({
      data: { id: collectionId, deleted: true },
      error: null,
    })
    expect(await readRow(admin, "collections", collectionId)).toBeNull()

    // El segundo DELETE ya no encuentra fila (la respuesta del primero se
    // perdió o el cliente repite): no es un error, es deleted:false.
    const secondResponse = await deleteCollection(collectionId)
    expect(secondResponse.status, "el segundo DELETE no es un error de transporte").toBe(200)
    expect(await secondResponse.json(), "la segunda vez no había nada que borrar").toEqual({
      data: { id: collectionId, deleted: false },
      error: null,
    })
    expect(await readRow(admin, "collections", collectionId)).toBeNull()
  })

  it("el PATCH de un extraño no es 2xx y deja la fila intacta (control de ODE-660)", async () => {
    sessionState.user = owner
    const collectionId = await createCollection("PATCH ajena")
    const before = await readRow<Record<string, unknown>>(admin, "collections", collectionId)
    expect(before).not.toBeNull()

    sessionState.user = stranger
    const strangerResponse = await PATCH(
      jsonRequest(`http://localhost/api/collections/${collectionId}`, "PATCH", {
        name: "PATCH ajena robada",
        description: null,
        visibility: "private",
        updated_at: new Date().toISOString(),
      }),
      { params: Promise.resolve({ id: collectionId }) },
    )
    expect(strangerResponse.status, "el PATCH ajeno no es 2xx").toBeGreaterThanOrEqual(400)
    expect(await readRow(admin, "collections", collectionId), "la fila ajena queda intacta").toEqual(before)

    // Control positivo: el dueño sí puede editar la misma colección; sin esto,
    // el no-op ajeno podría deberse a un PATCH muerto para todos.
    sessionState.user = owner
    const ownerResponse = await PATCH(
      jsonRequest(`http://localhost/api/collections/${collectionId}`, "PATCH", {
        name: "PATCH del dueño",
        description: null,
        visibility: "private",
        updated_at: new Date().toISOString(),
      }),
      { params: Promise.resolve({ id: collectionId }) },
    )
    expect(ownerResponse.status, "el PATCH del dueño sí pasa").toBe(200)
    expect(await readRow(admin, "collections", collectionId)).not.toEqual(before)
  })
})
