/**
 * ODE-673 — capability proof for SHARE-01 and SHARE-02.
 *
 * Entry point: the production POST/DELETE handlers for
 * `/api/writings/[id]/shares`, called with real Bearer tokens issued by local
 * GoTrue. The handlers, SharingService, local Postgres writes, recipient
 * reading page, incoming-share route, RPC, and import route remain real.
 *
 * The app admin-client factory is wired to a real local service-role client;
 * the page/list cookie-session factory is wired to a real authenticated local
 * client. These replace only environment/session plumbing. The route's
 * Bearer-auth branch is not mocked. The desktop caller uses this same route,
 * but `callWebRoute` transport is outside this proof and remains an explicit
 * boundary.
 *
 * Completion is asserted from the canonical `writings` and `writing_shares`
 * rows and from the recipient's observable consumer responses, not handler
 * call counts. The service-role mutation path bypasses RLS, so route ownership
 * is enforced by `verifyWritingOwnership`; consumer reads still exercise
 * local RLS and `can_read_writing`.
 */
import { randomUUID } from "node:crypto"
import type { ReactElement } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

const adminHolder = vi.hoisted(() => ({ client: null as SupabaseClient | null }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminHolder.client) {
      throw new Error("[ODE-673] createAdminClient sin cliente Supabase local")
    }
    return adminHolder.client
  },
}))

import SharedReadingPage from "@/app/(reading)/shared/[id]/page"
import { GET as sharedWritingsGet } from "@/app/api/shared/writings/route"
import { DELETE as sharesDelete, POST as sharesPost } from "@/app/api/writings/[id]/shares/route"
import { POST as importPost } from "@/app/api/writings/import/route"
import { createClient } from "@/lib/supabase/server"
import {
  cleanupUsers,
  readRow,
  readRows,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"
import { expectNotFound, serverClientAs } from "../../support/supabase-local/session"

const runId = randomUUID().replace(/[^a-z0-9]/gi, "").slice(0, 8).toLowerCase()

type ShareRow = { id: string; writing_id: string; shared_with_id: string }
type WritingRow = { id: string; visibility: "private" | "shared" | "public" }
type SharedReadingProps = { writing: { id: string } }

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let recipient!: SeedUser
let stranger!: SeedUser
let otherRecipient!: SeedUser
let ungrantedRecipient!: SeedUser
let writingId = ""
let failedInsertWritingId = ""

const createClientMock = createClient as unknown as {
  mockImplementation: (impl: () => Promise<SupabaseClient>) => void
}

async function actAs(user: SeedUser | null): Promise<void> {
  const client = await serverClientAs(user)
  createClientMock.mockImplementation(async () => client)
}

const pageParams = (id: string) => ({ params: Promise.resolve({ id }) })

function pageWritingId(element: unknown): string {
  if (!element || typeof element !== "object" || !("props" in element)) {
    throw new Error("[ODE-673] /shared no devolvió un elemento")
  }
  return (element as ReactElement<SharedReadingProps>).props.writing.id
}

function routeContext(id: string): Parameters<typeof sharesPost>[1] {
  return { params: Promise.resolve({ id }) }
}

function shareRequest(
  id: string,
  method: "POST" | "DELETE",
  as: SeedUser | null,
  sharedWithId?: string,
): Request {
  const headers = new Headers({ "content-type": "application/json" })
  if (as) headers.set("authorization", `Bearer ${as.accessToken}`)

  return new Request(`http://harness.test/api/writings/${id}/shares`, {
    method,
    headers,
    body: JSON.stringify(sharedWithId ? { shared_with_id: sharedWithId } : {}),
  })
}

async function postShare(as: SeedUser | null, id: string, sharedWithId: string): Promise<Response> {
  // Keep the cookie fallback anonymous so an authenticated route case can
  // succeed only through its real local Bearer token.
  await actAs(null)
  return sharesPost(shareRequest(id, "POST", as, sharedWithId), routeContext(id))
}

async function deleteShare(as: SeedUser | null, id: string, sharedWithId: string): Promise<Response> {
  // Keep the cookie fallback anonymous so an authenticated route case can
  // succeed only through its real local Bearer token.
  await actAs(null)
  return sharesDelete(shareRequest(id, "DELETE", as, sharedWithId), routeContext(id))
}

async function shareRows(id: string): Promise<ShareRow[]> {
  return readRows<ShareRow>(admin, "writing_shares", "writing_id", id)
}

async function incomingIds(as: SeedUser): Promise<string[]> {
  await actAs(as)
  const fetchRoute = createRouteFetch({
    "/api/shared/writings": () => sharedWritingsGet(),
  })
  const response = await fetchRoute("http://harness.test/api/shared/writings")
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: Array<{ id: string }> }
  return body.data.map((writing) => writing.id)
}

async function rpcIncomingIds(as: SeedUser): Promise<string[]> {
  const client = await createUserClient(as)
  const { data, error } = await client.rpc("list_incoming_shared_writings")
  expect(error).toBeNull()
  return ((data ?? []) as Array<{ id: string }>).map((writing) => writing.id)
}

async function importShared(as: SeedUser, id: string): Promise<Response> {
  const fetchRoute = createRouteFetch({ "/api/writings/import": importPost }, { as })
  return fetchRoute("http://harness.test/api/writings/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ source: "shared", writingId: id }),
  })
}

async function expectNoAccess(as: SeedUser, id: string): Promise<void> {
  await actAs(as)
  await expectNotFound(() => SharedReadingPage(pageParams(id)))
  expect(await incomingIds(as)).not.toContain(id)
  expect(await rpcIncomingIds(as)).not.toContain(id)
  expect((await importShared(as, id)).status).toBe(403)
}

async function expectCanRead(as: SeedUser, id: string): Promise<void> {
  await actAs(as)
  expect(pageWritingId(await SharedReadingPage(pageParams(id)))).toBe(id)
  expect(await incomingIds(as)).toContain(id)
  expect(await rpcIncomingIds(as)).toContain(id)
}

beforeAll(async () => {
  admin = createLocalAdminClient()
  adminHolder.client = admin
  users = await seedUsers(runId, ["owner", "recipient", "stranger", "other", "ungranted"])
  ;[owner, recipient, stranger, otherRecipient, ungrantedRecipient] = users

  writingId = await seedWriting(admin, {
    authorId: owner.id,
    title: `ODE-673 activation ${runId}`,
    visibility: "private",
  })
  failedInsertWritingId = await seedWriting(admin, {
    authorId: owner.id,
    title: `ODE-673 failed insert ${runId}`,
    visibility: "private",
  })
})

afterAll(async () => {
  await cleanupUsers(users)
})

describe("ODE-673 — activar y revocar shares por las rutas de producción", () => {
  it("responde 401 sin sesión y 400 con un id inválido en POST y DELETE", async () => {
    await actAs(null)
    expect((await postShare(null, writingId, recipient.id)).status).toBe(401)
    expect((await deleteShare(null, writingId, recipient.id)).status).toBe(401)

    expect((await postShare(owner, "not-a-uuid", recipient.id)).status).toBe(400)
    expect((await deleteShare(owner, "not-a-uuid", recipient.id)).status).toBe(400)
    expect(await shareRows(writingId)).toEqual([])
  })

  it("activa el grant y lo hace observable por el destinatario", async () => {
    const initialWriting = await readRow<WritingRow>(admin, "writings", writingId)
    expect(initialWriting?.visibility).toBe("private")
    await expectNoAccess(recipient, writingId)

    const response = await postShare(owner, writingId, recipient.id)
    expect(response.status).toBe(201)
    const responseBody = (await response.json()) as { data: { username: string }; error: null }
    expect(responseBody.error).toBeNull()
    expect(responseBody.data.username).toBe(recipient.username)

    const activeWriting = await readRow<WritingRow>(admin, "writings", writingId)
    expect(activeWriting?.visibility).toBe("shared")
    expect((await shareRows(writingId)).map((row) => row.shared_with_id)).toEqual([recipient.id])
    await expectCanRead(recipient, writingId)

    const imported = await importShared(recipient, writingId)
    expect(imported.status).toBe(201)
    const importedBody = (await imported.json()) as { id: string }
    const importedWriting = await readRow<{ id: string; author_id: string; title: string }>(
      admin,
      "writings",
      importedBody.id,
    )
    expect(importedWriting).toMatchObject({ author_id: recipient.id, title: `Copy of ODE-673 activation ${runId}` })

    const secondGrant = await postShare(owner, writingId, otherRecipient.id)
    expect(secondGrant.status).toBe(201)
    expect((await shareRows(writingId)).map((row) => row.shared_with_id).sort()).toEqual(
      [recipient.id, otherRecipient.id].sort(),
    )
    await expectCanRead(otherRecipient, writingId)
  })

  it("rechaza el duplicado con 409 y conserva una sola fila", async () => {
    const duplicate = await postShare(owner, writingId, recipient.id)
    expect(duplicate.status).toBe(409)
    expect(((await duplicate.json()) as { error: { code: string } }).error.code).toBe("ALREADY_SHARED")
    expect((await shareRows(writingId)).filter((row) => row.shared_with_id === recipient.id)).toHaveLength(1)
  })

  it("solo el dueño puede activar: un extraño recibe 403 y no crea un grant", async () => {
    const response = await postShare(stranger, writingId, ungrantedRecipient.id)
    expect(response.status).toBe(403)
    expect((await shareRows(writingId)).map((row) => row.shared_with_id).sort()).toEqual(
      [recipient.id, otherRecipient.id].sort(),
    )
    await expectNoAccess(stranger, writingId)
  })

  it("solo el dueño puede revocar: extraño y destinatario no alteran el grant ajeno", async () => {
    const strangerRevoke = await deleteShare(stranger, writingId, recipient.id)
    expect(strangerRevoke.status).toBe(403)
    expect((await shareRows(writingId)).map((row) => row.shared_with_id).sort()).toEqual(
      [recipient.id, otherRecipient.id].sort(),
    )

    const recipientRevoke = await deleteShare(recipient, writingId, otherRecipient.id)
    expect(recipientRevoke.status).toBe(403)
    expect((await shareRows(writingId)).map((row) => row.shared_with_id).sort()).toEqual(
      [recipient.id, otherRecipient.id].sort(),
    )
    await expectCanRead(recipient, writingId)
    await expectCanRead(otherRecipient, writingId)
  })

  it("el DELETE del dueño quita solo el destinatario seleccionado y corta su acceso", async () => {
    expect((await shareRows(writingId)).map((row) => row.shared_with_id).sort()).toEqual(
      [recipient.id, otherRecipient.id].sort(),
    )

    const revoked = await deleteShare(owner, writingId, recipient.id)
    expect(revoked.status).toBe(204)
    expect((await shareRows(writingId)).map((row) => row.shared_with_id)).toEqual([otherRecipient.id])
    expect((await readRow<WritingRow>(admin, "writings", writingId))?.visibility).toBe("shared")
    await expectNoAccess(recipient, writingId)
    await expectCanRead(otherRecipient, writingId)

    expect((await deleteShare(owner, writingId, otherRecipient.id)).status).toBe(204)
    expect(await shareRows(writingId)).toEqual([])
    // Revocation removes grants; it intentionally does not demote visibility.
    expect((await readRow<WritingRow>(admin, "writings", writingId))?.visibility).toBe("shared")
    expect((await deleteShare(owner, writingId, otherRecipient.id)).status).toBe(204)
    await expectNoAccess(otherRecipient, writingId)
  })

  it("un INSERT fallido devuelve 5xx y no concede acceso aunque visibility ya sea shared", async () => {
    const nonexistentProfileId = randomUUID()
    const failed = await postShare(owner, failedInsertWritingId, nonexistentProfileId)
    expect(failed.status).toBe(500)
    expect(((await failed.json()) as { error: { code: string } }).error.code).toBe("DB_ERROR")
    expect(await shareRows(failedInsertWritingId)).toEqual([])
    // UPDATE visibility precedes INSERT in the service; the absent grant must
    // still keep every non-owner consumer closed after this partial failure.
    expect((await readRow<WritingRow>(admin, "writings", failedInsertWritingId))?.visibility).toBe("shared")
    await expectNoAccess(stranger, failedInsertWritingId)
  })
})
