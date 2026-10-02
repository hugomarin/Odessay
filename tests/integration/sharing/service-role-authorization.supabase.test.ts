/**
 * ODE-616 PR2 — proof service-role de SHARE-04.
 *
 * Los caminos que saltan RLS a propósito (`/shared/[id]`, `/api/writings/import`,
 * `listIncomingShares` vía `GET /api/shared/writings`, la RPC de desktop y
 * `listSharedWritingsForUser`) autorizan con el cliente admin y comprobaciones
 * escritas a mano. Esta suite ejecuta los entry points de producción contra la
 * instancia Supabase local real (harness de PR1): DB real, RLS real, service
 * role real. Solo se fakea la sesión (boundary externo) sustituyendo
 * `@/lib/supabase/server#createClient` por un cliente real del usuario; el
 * resto de las costuras del producto queda real.
 *
 * Regla de acceso (D-1, intersección):
 * - superficies (`/shared`, import): autor o (fila de share AND can_read_writing);
 * - listados: fila de share AND visibility in ('shared','public') AND autor <> viewer.
 *
 * Evento de completitud: la respuesta del handler (status/JSON), las props del
 * elemento devuelto por el server component y las filas devueltas por la RPC.
 *
 * Estado `private` con share viejo: lo crea el sync de desktop con un UPDATE
 * directo, fuera de este harness; se siembra con el cliente admin (F1). El
 * resto de las transiciones (crear share, revocar) se hacen por los caminos
 * reales: RLS como dueño y `createWebSharingService({userId}).revokeShare`.
 *
 * Mutación de BUILD (en vivo): quitar la comprobación `can_read_writing` de la
 * página y de import deja rojo el caso del invitado sobre un privado con share.
 * El resto de mutaciones va en la Guía de review.
 */
import { randomUUID } from "node:crypto"
import type { ReactElement } from "react"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

import { createClient } from "@/lib/supabase/server"
import SharedReadingPage, { generateMetadata } from "@/app/(reading)/shared/[id]/page"
import PublicWritingPage from "@/app/[username]/[slug]/page"
import { POST as importPost } from "@/app/api/writings/import/route"
import { GET as sharedWritingsGet } from "@/app/api/shared/writings/route"
import { listSharedWritingsForUser } from "@/lib/sharing/shared-writings"
import { createWebSharingService } from "@/lib/services/web-sharing-service"
import {
  cleanupUsers,
  readRow,
  seedShare,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient, createUserClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"
import { expectNotFound, expectRedirect, serverClientAs } from "../../support/supabase-local/session"

const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let viewer!: SeedUser
let stranger!: SeedUser
let owner2!: SeedUser
let ownerClient: SupabaseClient
let owner2Client: SupabaseClient
let viewerClient: SupabaseClient

let privateDoc = ""
let sharedDoc = ""
let sharedDocSlug = ""
let publicDoc = ""
let publicSharedDoc = ""
let publicSharedSlug: string | null = null
let legacyPrivateDoc = ""
let legacyPrivateSlug: string | null = null
let revokedDoc = ""
let publicSlug = ""
let notesSharedA = ""
let notesSharedB = ""
let notesOwn = ""
let notesSharedSlug = ""
let notesOwnSlug = ""

const createClientMock = createClient as unknown as {
  mockImplementation: (impl: () => Promise<SupabaseClient>) => void
}

async function actAs(user: SeedUser | null): Promise<void> {
  const client = await serverClientAs(user)
  createClientMock.mockImplementation(async () => client)
}

async function seedWritingWithShare(input: {
  title: string
  visibility: "private" | "shared" | "public"
  sharedWithId?: string
}): Promise<string> {
  const id = await seedWriting(admin, {
    authorId: owner.id,
    title: `${input.title} ${runId}`,
    visibility: input.visibility,
  })
  if (input.sharedWithId) {
    await seedShare(ownerClient, { writingId: id, sharedWithId: input.sharedWithId })
  }
  return id
}

type ReadingElementProps = {
  writing: { id: string }
  prevWritingId: string | null
  nextWritingId: string | null
  prevWritingHref: string | null
  nextWritingHref: string | null
  sequencePosition: number | null
  sequenceTotal: number | null
}

function readingProps(element: unknown): ReadingElementProps {
  if (!element || typeof element !== "object" || !("props" in element)) {
    throw new Error("[sharing] la página no devolvió un elemento")
  }
  return (element as ReactElement<ReadingElementProps>).props
}

const pageParams = (id: string) => ({ params: Promise.resolve({ id }) })

type PageOutcome =
  | { kind: "element"; props: ReadingElementProps }
  | { kind: "redirect"; digest: string }

async function pageOutcome(fn: () => Promise<unknown>): Promise<PageOutcome> {
  try {
    return { kind: "element", props: readingProps(await fn()) }
  } catch (error) {
    const digest = (error as { digest?: unknown })?.digest
    if (typeof digest === "string" && digest.includes("NEXT_REDIRECT")) {
      return { kind: "redirect", digest }
    }
    throw error
  }
}

/**
 * Abre `/shared/<identifier>` siguiendo el redirect canónico si lo hay: en
 * `main` la página redirige id → slug y tras ODE-659 slug → id. Un cliente real
 * sigue ese redirect, así que el proof lo sigue también y afirma sobre el
 * documento resuelto, no sobre la forma de la URL.
 */
async function openShared(identifier: string): Promise<ReadingElementProps> {
  const first = await pageOutcome(() => SharedReadingPage(pageParams(identifier)))
  if (first.kind === "element") return first.props
  const match = /\/shared\/([^;]+)/.exec(first.digest)
  if (!match) throw new Error(`[sharing] redirect inesperado: ${first.digest}`)
  return readingProps(await SharedReadingPage(pageParams(decodeURIComponent(match[1]))))
}

async function incomingIds(as: SeedUser | null): Promise<string[]> {
  await actAs(as)
  const fetchRoute = createRouteFetch({ "/api/shared/writings": sharedWritingsGet })
  const response = await fetchRoute("http://harness.test/api/shared/writings")
  expect(response.status).toBe(200)
  const body = (await response.json()) as { data: Array<{ id: string }> }
  return body.data.map((item) => item.id)
}

async function rpcIncomingIds(as: SeedUser): Promise<string[]> {
  const client = await createUserClient(as)
  const { data, error } = await client.rpc("list_incoming_shared_writings")
  expect(error).toBeNull()
  return ((data ?? []) as Array<{ id: string }>).map((row) => row.id)
}

async function postImport(as: SeedUser | null, writingId: string): Promise<Response> {
  await actAs(as)
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (as) headers.authorization = `Bearer ${as.accessToken}`
  const fetchRoute = createRouteFetch({ "/api/writings/import": importPost })
  return fetchRoute("http://harness.test/api/writings/import", {
    method: "POST",
    headers,
    body: JSON.stringify({ source: "shared", writingId }),
  })
}

const hrefFor = (id: string, slug: string | null) => [`/shared/${id}`, slug ? `/shared/${slug}` : null]

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "viewer", "stranger", "owner2"])
  ;[owner, viewer, stranger, owner2] = users
  ownerClient = await createUserClient(owner)
  owner2Client = await createUserClient(owner2)
  viewerClient = await createUserClient(viewer)

  privateDoc = await seedWritingWithShare({ title: "Privado", visibility: "private" })
  sharedDoc = await seedWritingWithShare({
    title: "Compartido",
    visibility: "shared",
    sharedWithId: viewer.id,
  })
  publicDoc = await seedWritingWithShare({ title: "Publico", visibility: "public" })
  publicSharedDoc = await seedWritingWithShare({
    title: "Publico compartido",
    visibility: "public",
    sharedWithId: viewer.id,
  })
  legacyPrivateDoc = await seedWritingWithShare({
    title: "Privado con share viejo",
    visibility: "private",
    sharedWithId: viewer.id,
  })
  revokedDoc = await seedWritingWithShare({
    title: "Compartido a revocar",
    visibility: "shared",
    sharedWithId: viewer.id,
  })

  const legacyRow = await readRow<{ slug: string | null }>(admin, "writings", legacyPrivateDoc)
  legacyPrivateSlug = legacyRow?.slug ?? null
  const publicSharedRow = await readRow<{ slug: string | null }>(admin, "writings", publicSharedDoc)
  publicSharedSlug = publicSharedRow?.slug ?? null
  const publicRow = await readRow<{ slug: string | null }>(admin, "writings", publicDoc)
  publicSlug = publicRow?.slug ?? ""
})

afterAll(async () => {
  await cleanupUsers(users)
})

describe("D-1 — superficies /shared/[id]", () => {
  it("el dueño abre su privado por id", async () => {
    await actAs(owner)
    expect((await openShared(privateDoc)).writing.id).toBe(privateDoc)
  })

  it("el invitado abre el compartido y el público con share", async () => {
    await actAs(viewer)
    expect((await openShared(sharedDoc)).writing.id).toBe(sharedDoc)
    expect((await openShared(publicSharedDoc)).writing.id).toBe(publicSharedDoc)
  })

  it("el invitado NO abre un privado con share viejo (F1)", async () => {
    await actAs(viewer)
    await expectNotFound(() => SharedReadingPage(pageParams(legacyPrivateDoc)))
  })

  it("el extraño no abre el compartido ajeno ni el público sin share", async () => {
    await actAs(stranger)
    await expectNotFound(() => SharedReadingPage(pageParams(sharedDoc)))
    await expectNotFound(() => SharedReadingPage(pageParams(publicDoc)))
  })

  it("el invitado no abre el privado sin share", async () => {
    await actAs(viewer)
    await expectNotFound(() => SharedReadingPage(pageParams(privateDoc)))
  })

  it("sin sesión redirige a login", async () => {
    await actAs(null)
    await expectRedirect(() => SharedReadingPage(pageParams(sharedDoc)), "/login")
  })
})

describe("F1c — secuencia anterior/siguiente", () => {
  it("la secuencia incluye el público con share (control positivo)", async () => {
    await actAs(viewer)
    const props = await openShared(sharedDoc)
    const expected = readHrefOptions(publicSharedDoc, publicSharedSlug)
    const hrefs = [props.prevWritingHref, props.nextWritingHref]
    expect(hrefs.some((href) => href !== null && expected.includes(href))).toBe(true)
  })

  it("la secuencia no incluye privados con share viejo", async () => {
    await actAs(viewer)
    const props = await openShared(publicSharedDoc)
    // sharedDoc + publicSharedDoc + revokedDoc; el privado con share viejo no.
    expect(props.sequenceTotal).toBe(3)
    expect([props.prevWritingId, props.nextWritingId]).not.toContain(legacyPrivateDoc)
    const legacyOptions = readHrefOptions(legacyPrivateDoc, legacyPrivateSlug)
    for (const option of legacyOptions) {
      expect([props.prevWritingHref, props.nextWritingHref]).not.toContain(option)
    }
  })

  it.fails("la secuencia excluye el escrito propio con fila de self-share (D-1 autor)", async () => {
    // `writing_shares_insert_author` deja que una persona cree una fila hacia
    // sí misma sobre un escrito propio. No es una fuga entre usuarios, pero si
    // esa fila entra en la secuencia incumple D-1 (`author_id <> viewer`).
    const ownDoc = await seedWriting(admin, {
      authorId: viewer.id,
      title: `Propio con self-share ${runId}`,
      visibility: "shared",
    })
    await seedShare(viewerClient, { writingId: ownDoc, sharedWithId: viewer.id })

    await actAs(viewer)
    const props = await openShared(publicSharedDoc)
    // sharedDoc + publicSharedDoc + revokedDoc; su propio escrito self-share no.
    expect(props.sequenceTotal).toBe(3)
    expect([props.prevWritingId, props.nextWritingId]).not.toContain(ownDoc)
  })
})

function readHrefOptions(id: string, slug: string | null): string[] {
  return hrefFor(id, slug).filter((value): value is string => value !== null)
}

describe("F2 — generateMetadata no revela el título sin acceso", () => {
  it("dueño e invitado leen el título real", async () => {
    await actAs(owner)
    const ownerMetadata = await generateMetadata(pageParams(privateDoc))
    expect(ownerMetadata.title).toBe(`Privado ${runId} — Artifact Studio`)

    await actAs(viewer)
    const viewerMetadata = await generateMetadata(pageParams(sharedDoc))
    expect(viewerMetadata.title).toBe(`Compartido ${runId} — Artifact Studio`)
  })

  it("el extraño recibe el título genérico para un compartido ajeno", async () => {
    await actAs(stranger)
    const metadata = await generateMetadata(pageParams(sharedDoc))
    expect(metadata.title).toBe("Reading — Artifact Studio")
  })

  it("sin sesión el título es genérico", async () => {
    await actAs(null)
    const metadata = await generateMetadata(pageParams(publicDoc))
    expect(metadata.title).toBe("Reading — Artifact Studio")
  })

  it("el invitado no ve el título de un privado con share viejo", async () => {
    await actAs(viewer)
    const metadata = await generateMetadata(pageParams(legacyPrivateDoc))
    expect(metadata.title).toBe("Reading — Artifact Studio")
  })
})

describe("Import /api/writings/import (rama shared)", () => {
  it("el dueño puede importar su propio documento", async () => {
    const response = await postImport(owner, privateDoc)
    expect(response.status).toBe(201)
    const body = (await response.json()) as { id: string }
    const copy = await readRow<{ author_id: string }>(admin, "writings", body.id)
    expect(copy?.author_id).toBe(owner.id)
  })

  it("el invitado importa el compartido", async () => {
    const response = await postImport(viewer, sharedDoc)
    expect(response.status).toBe(201)
  })

  it("el extraño no importa un compartido ajeno", async () => {
    const response = await postImport(stranger, sharedDoc)
    expect(response.status).toBe(403)
  })

  it("nadie importa un público ajeno sin share", async () => {
    const response = await postImport(viewer, publicDoc)
    expect(response.status).toBe(403)
  })

  it("el invitado no importa un privado con share viejo (F1)", async () => {
    const response = await postImport(viewer, legacyPrivateDoc)
    expect(response.status).toBe(403)
  })

  it("sin sesión responde 401 y un id inexistente 404", async () => {
    const unauthorized = await postImport(null, sharedDoc)
    expect(unauthorized.status).toBe(401)

    const missing = await postImport(viewer, randomUUID())
    expect(missing.status).toBe(404)
  })
})

describe("Listados — GET /api/shared/writings y RPC", () => {
  it("el público con share sigue listado (caso obligatorio) y el compartido también", async () => {
    const ids = await incomingIds(viewer)
    expect(ids).toContain(publicSharedDoc)
    expect(ids).toContain(sharedDoc)
  })

  it("el listado excluye el privado con share viejo", async () => {
    const ids = await incomingIds(viewer)
    expect(ids).not.toContain(legacyPrivateDoc)
  })

  it("sin sesión el listado responde 401", async () => {
    await actAs(null)
    const fetchRoute = createRouteFetch({ "/api/shared/writings": sharedWritingsGet })
    const response = await fetchRoute("http://harness.test/api/shared/writings")
    expect(response.status).toBe(401)
  })

  it("la RPC lista el compartido y el público con share (control positivo)", async () => {
    const ids = await rpcIncomingIds(viewer)
    expect(ids).toContain(sharedDoc)
    expect(ids).toContain(publicSharedDoc)
  })

  it("la RPC excluye el privado con share viejo", async () => {
    const ids = await rpcIncomingIds(viewer)
    expect(ids).not.toContain(legacyPrivateDoc)
  })

  it("listSharedWritingsForUser excluye el privado con share viejo (NON_PRODUCTION_PATH)", async () => {
    const items = await listSharedWritingsForUser(viewer.id)
    expect(items.map((item) => item.id)).not.toContain(legacyPrivateDoc)
  })
})

describe("Revocación — la fila quitada quita el acceso service-role", () => {
  it("revocar por el servicio real quita la lectura", async () => {
    const service = await createWebSharingService({ userId: owner.id })
    const revoked = await service.revokeShare({ writingId: revokedDoc, sharedWithUserId: viewer.id })
    expect(revoked.error).toBeNull()

    await actAs(viewer)
    await expectNotFound(() => SharedReadingPage(pageParams(revokedDoc)))

    const response = await postImport(viewer, revokedDoc)
    expect(response.status).toBe(403)

    const ids = await incomingIds(viewer)
    expect(ids).not.toContain(revokedDoc)

    const rpcIds = await rpcIncomingIds(viewer)
    expect(rpcIds).not.toContain(revokedDoc)
  })

  it("después de revocar, la metadata es genérica (F2)", async () => {
    await actAs(viewer)
    const metadata = await generateMetadata(pageParams(revokedDoc))
    expect(metadata.title).toBe("Reading — Artifact Studio")
  })
})

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe("ODE-659 — /shared resuelve por viewer y el id es la URL canónica", () => {
  beforeAll(async () => {
    // El slug es único por autor y sale del título: dos autores con el mismo
    // título colisionan. El trigger solo genera slug con visibility shared o
    // public.
    const notesTitle = `Notes ${runId}`
    const ownNotesTitle = `Own notes ${runId}`

    notesOwn = await seedWriting(admin, { authorId: viewer.id, title: ownNotesTitle, visibility: "shared" })
    await sleep(15)
    const notesOwnedByOther = await seedWriting(admin, {
      authorId: owner2.id,
      title: ownNotesTitle,
      visibility: "shared",
    })
    await seedShare(owner2Client, { writingId: notesOwnedByOther, sharedWithId: viewer.id })

    notesSharedA = await seedWriting(admin, { authorId: owner.id, title: notesTitle, visibility: "shared" })
    await seedShare(ownerClient, { writingId: notesSharedA, sharedWithId: viewer.id })
    await sleep(15)
    notesSharedB = await seedWriting(admin, { authorId: owner2.id, title: notesTitle, visibility: "shared" })
    await seedShare(owner2Client, { writingId: notesSharedB, sharedWithId: viewer.id })

    const sharedRow = await readRow<{ slug: string | null }>(admin, "writings", sharedDoc)
    const notesSharedRow = await readRow<{ slug: string | null }>(admin, "writings", notesSharedA)
    const notesOwnRow = await readRow<{ slug: string | null }>(admin, "writings", notesOwn)
    sharedDocSlug = sharedRow?.slug ?? ""
    notesSharedSlug = notesSharedRow?.slug ?? ""
    notesOwnSlug = notesOwnRow?.slug ?? ""
    if (!sharedDocSlug || !notesSharedSlug || !notesOwnSlug) {
      throw new Error("[sharing] el trigger no generó los slugs de ODE-659")
    }
  })

  it("un slug viejo redirige al id canónico", async () => {
    await actAs(viewer)
    await expectRedirect(() => SharedReadingPage(pageParams(sharedDocSlug)), `/shared/${sharedDoc}`)
  })

  it("el id de cada autor abre su propio documento sin redirect", async () => {
    await actAs(viewer)
    expect(readingProps(await SharedReadingPage(pageParams(notesSharedA))).writing.id).toBe(notesSharedA)
    expect(readingProps(await SharedReadingPage(pageParams(notesSharedB))).writing.id).toBe(notesSharedB)
  })

  it("el slug repetido elige el documento legible más reciente", async () => {
    await actAs(viewer)
    await expectRedirect(() => SharedReadingPage(pageParams(notesSharedSlug)), `/shared/${notesSharedB}`)
  })

  it("el slug repetido prefiere el documento del propio viewer", async () => {
    await actAs(viewer)
    // `notesOwn` es más antiguo que el de owner2; aun así gana el propio.
    await expectRedirect(() => SharedReadingPage(pageParams(notesOwnSlug)), `/shared/${notesOwn}`)
  })

  it("un extraño con el slug repetido recibe 404, nunca 500", async () => {
    await actAs(stranger)
    await expectNotFound(() => SharedReadingPage(pageParams(notesSharedSlug)))
  })
})

describe("Control positivo — /[username]/[slug]", () => {
  it("un extraño sin sesión ve el documento público", async () => {
    await actAs(null)
    const element = await PublicWritingPage({
      params: Promise.resolve({ username: owner.username, slug: publicSlug }),
    })
    expect(readingProps(element).writing.id).toBe(publicDoc)
  })

  it("un documento privado no se sirve por la ruta pública", async () => {
    await actAs(stranger)
    const privateRow = await readRow<{ slug: string | null }>(admin, "writings", privateDoc)
    await expectNotFound(() =>
      PublicWritingPage({
        params: Promise.resolve({ username: owner.username, slug: privateRow?.slug ?? "missing" }),
      }),
    )
  })
})
