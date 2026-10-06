/**
 * ODE-675 — proof de la cadena de token UX-eval.
 *
 * El punto de entrada es el POST real de `/api/writings/[id]/share-test-link`,
 * con un Bearer emitido por Supabase local y un `request.url` que el servicio
 * usa para devolver el enlace. El token se toma siempre de esa respuesta; no
 * se fabrica en el test. Postgres local persiste `invitations`, y el mismo
 * token atraviesa después el server component `/preview/[token]`, el GET real
 * de márgenes y el POST real de importación. Solo se sustituye la factoría
 * externa del cliente service-role por un cliente service-role real local, la
 * sesión de cookies anónima del server component y el transporte de red por
 * `createRouteFetch`; handlers, servicio, resolver, Supabase y sus transiciones
 * internas siguen reales.
 *
 * Completitud: cada respuesta de POST regresa después del commit de la RPC o
 * del handler; las afirmaciones durables se leen de Postgres y la importación
 * se verifica sobre la fila nueva. El markup se obtiene del PreviewPage real.
 * No existe TTL para estos tokens: `expired` significa rotado, revocado o
 * expirado por el soft delete del writing.
 */
import { randomUUID } from "node:crypto"
import { Children, isValidElement, type ReactElement, type ReactNode } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import type { SupabaseClient } from "@supabase/supabase-js"
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest"

const adminHolder = vi.hoisted(() => ({ client: null as SupabaseClient | null }))

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    if (!adminHolder.client) {
      throw new Error("[ODE-675] createAdminClient sin cliente service-role local")
    }
    return adminHolder.client
  },
}))

// PreviewPage solo consulta la sesión para decidir si enseña login o import.
// La decisión de acceso al writing permanece en el resolver real y el token.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }))

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: () => undefined }) }))

import PreviewPage from "@/app/(public)/preview/[token]/page"
import { PreviewBodyWithMargins } from "@/components/reading/preview-body-with-margins"
import { DELETE as deleteWriting } from "@/app/api/writings/[id]/route"
import { POST as restoreWriting } from "@/app/api/writings/[id]/lifecycle/route"
import {
  DELETE as revokePreviewLink,
  POST as rotatePreviewLink,
} from "@/app/api/writings/[id]/share-test-link/route"
import { POST as importWriting } from "@/app/api/writings/import/route"
import { GET as previewMargins } from "@/app/api/margins/preview/route"
import { createClient as createServerClient } from "@/lib/supabase/server"
import { getTestLinkEmail } from "@/lib/sharing/test-link"
import {
  cleanupUsers,
  readRow,
  readRows,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient } from "../../support/supabase-local/local-supabase"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"
import { serverClientAs } from "../../support/supabase-local/session"

const runId = randomUUID().replace(/[^a-z0-9]/g, "").slice(0, 8)
const missingValidToken = "ode-675-static-token-that-does-not-exist"

type InvitationRow = {
  id: string
  inviter_id: string
  writing_id: string | null
  email: string
  token: string
  status: "pending" | "accepted" | "expired"
}

type WritingRow = {
  id: string
  author_id: string
  title: string | null
  body_json: Record<string, unknown> | null
  body_text: string | null
  version: number
  deleted_at: string | null
}

type RotationResponse = {
  data: {
    active: boolean
    token: string
    link: string
    replacedPrevious?: boolean
  } | null
  error: { code: string; message: string } | null
}

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let stranger!: SeedUser
let guestServerClient!: SupabaseClient

const createServerClientMock = createServerClient as unknown as {
  mockImplementation: (impl: () => Promise<SupabaseClient>) => void
}

const bodyFor = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

function routeContext(id: string) {
  return { params: Promise.resolve({ id }) }
}

function request(path: string, method = "GET", body?: unknown): Request {
  return new Request(`http://harness.test${path}`, {
    method,
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

function shareFetch(writingId: string, as: SeedUser) {
  const path = `/api/writings/${writingId}/share-test-link`
  return createRouteFetch(
    {
      [path]: (incoming) => {
        if (incoming.method === "POST") return rotatePreviewLink(incoming, routeContext(writingId))
        if (incoming.method === "DELETE") return revokePreviewLink(incoming, routeContext(writingId))
        return new Response(null, { status: 405 })
      },
    },
    { as },
  )
}

async function createWriting(title: string, bodyText: string): Promise<string> {
  return seedWriting(admin, {
    authorId: owner.id,
    title,
    visibility: "private",
    bodyJson: bodyFor(bodyText),
  })
}

async function uxInvitations(writingId: string): Promise<InvitationRow[]> {
  const rows = await readRows<InvitationRow>(admin, "invitations", "writing_id", writingId)
  return rows.filter((row) => row.email === getTestLinkEmail(writingId))
}

async function previewTree(token: string): Promise<ReactNode> {
  return await PreviewPage({ params: Promise.resolve({ token }) })
}

function findPreviewBody(node: ReactNode): ReactElement<Record<string, unknown>> | null {
  if (!isValidElement(node)) return null
  if (node.type === PreviewBodyWithMargins) {
    return node as ReactElement<Record<string, unknown>>
  }

  const children = (node.props as { children?: ReactNode }).children
  for (const child of Children.toArray(children)) {
    const found = findPreviewBody(child)
    if (found) return found
  }
  return null
}

async function renderPreview(token: string): Promise<string> {
  return renderToStaticMarkup(await previewTree(token))
}

async function withServerClient<T>(client: SupabaseClient, run: () => Promise<T>): Promise<T> {
  createServerClientMock.mockImplementation(async () => client)
  try {
    return await run()
  } finally {
    createServerClientMock.mockImplementation(async () => guestServerClient)
  }
}

async function postPreviewLink(writingId: string, as: SeedUser): Promise<Response> {
  const path = `/api/writings/${writingId}/share-test-link`
  return shareFetch(writingId, as)(request(path, "POST"))
}

async function tokenFrom(response: Response): Promise<string> {
  return (await linkDataFrom(response)).token
}

async function linkDataFrom(response: Response): Promise<NonNullable<RotationResponse["data"]>> {
  const body = (await response.json()) as RotationResponse
  if (!body.data?.token) {
    throw new Error(`[ODE-675] POST no devolvió token: ${JSON.stringify(body)}`)
  }
  return body.data
}

beforeAll(async () => {
  expect(process.env.ODE_TEST_LINK_FIXTURES, "el backdoor de fixtures debe estar desactivado").toBeUndefined()
  admin = createLocalAdminClient()
  adminHolder.client = admin
  users = await seedUsers(`ode675_${runId}`, ["owner", "stranger"])
  ;[owner, stranger] = users
  guestServerClient = await serverClientAs(null)
  createServerClientMock.mockImplementation(async () => guestServerClient)
})

afterAll(async () => {
  adminHolder.client = null
  await cleanupUsers(users)
})

describe("ODE-675 preview token (Supabase local)", () => {
  it("connects the production token POST to rendered preview, margins, import, and the other writing", async () => {
    const titleA = `ODE-675 A ${runId}`
    const titleB = `ODE-675 B ${runId}`
    const bodyA = `private body for A ${runId}`
    const bodyB = `private body for B ${runId}`
    const writingA = await createWriting(titleA, bodyA)
    const writingB = await createWriting(titleB, bodyB)

    const postA = await postPreviewLink(writingA, owner)
    expect(postA.status, "la ruta real autentica el Bearer y crea el enlace").toBe(201)
    const createdA = await linkDataFrom(postA)
    const tokenA = createdA.token
    expect(tokenA).toMatch(/^[A-Za-z0-9_-]{16,255}$/)
    expect(createdA.link, "requestUrl llega a la respuesta de producción").toBe(`http://harness.test/preview/${tokenA}`)
    const rowA = await uxInvitations(writingA)
    expect(rowA, "la fila canónica usa el discriminador UX-eval compartido").toHaveLength(1)
    expect(rowA[0]).toMatchObject({ token: tokenA, inviter_id: owner.id, writing_id: writingA, status: "pending" })

    const pageTreeA = await previewTree(tokenA)
    const resolvedA = findPreviewBody(pageTreeA)
    expect(resolvedA?.props.title, "PreviewPage entrega el título resuelto al cuerpo").toBe(titleA)
    expect(resolvedA?.props.bodyHtml).toContain(bodyA)
    const pageA = renderToStaticMarkup(pageTreeA)
    expect(pageA).toContain(bodyA)
    expect(pageA).not.toContain(bodyB)

    const marginsFetch = createRouteFetch({ "/api/margins/preview": previewMargins })
    const marginsResponse = await marginsFetch(
      request(`/api/margins/preview?token=${encodeURIComponent(tokenA)}`),
    )
    expect(marginsResponse.status, "GET margins resuelve el mismo token persistido").toBe(200)
    expect(await marginsResponse.json()).toMatchObject({ data: [], error: null })

    const importFetch = createRouteFetch({ "/api/writings/import": importWriting }, { as: stranger })
    const importResponse = await importFetch(
      request("/api/writings/import", "POST", { source: "preview", token: tokenA }),
    )
    expect(importResponse.status, "el import usa el previewToken real con el Bearer del lector").toBe(201)
    const importBody = (await importResponse.json()) as { id: string }
    const imported = await readRow<WritingRow>(admin, "writings", importBody.id)
    expect(imported).toMatchObject({
      author_id: stranger.id,
      title: `Copy of ${titleA}`,
      body_json: bodyFor(bodyA),
    })

    const postB = await postPreviewLink(writingB, owner)
    expect(postB.status).toBe(201)
    const tokenB = await tokenFrom(postB)
    expect(tokenB).not.toBe(tokenA)
    const pageTreeB = await previewTree(tokenB)
    const resolvedB = findPreviewBody(pageTreeB)
    expect(resolvedB?.props.title).toBe(titleB)
    expect(resolvedB?.props.bodyHtml).toContain(bodyB)
    const pageB = renderToStaticMarkup(pageTreeB)
    expect(pageB).toContain(bodyB)
    expect(pageB).not.toContain(bodyA)
  })

  it("returns not-found for malformed and valid unknown tokens, then revokes rotation and DELETE", async () => {
    const malformed = await renderPreview("bad token")
    const unknown = await renderPreview(missingValidToken)
    expect(malformed).toContain("Preview link not found")
    expect(unknown).toContain("Preview link not found")

    const writingId = await createWriting(`ODE-675 rotation ${runId}`, `rotated content ${runId}`)
    const firstPost = await postPreviewLink(writingId, owner)
    expect(firstPost.status).toBe(201)
    const firstToken = await tokenFrom(firstPost)

    const secondPost = await postPreviewLink(writingId, owner)
    expect(secondPost.status, "la rotación real completa su RPC").toBe(201)
    const secondBody = (await secondPost.json()) as RotationResponse
    expect(secondBody.data?.replacedPrevious).toBe(true)
    const secondToken = secondBody.data?.token
    expect(secondToken).toBeTruthy()

    const afterRotation = await uxInvitations(writingId)
    expect(afterRotation, "la rotación conserva ambas filas para auditar la anterior").toHaveLength(2)
    expect(afterRotation.find((row) => row.token === firstToken)?.status).toBe("expired")
    expect(afterRotation.filter((row) => row.status === "pending"), "solo queda una fila pending").toHaveLength(1)
    expect(afterRotation.find((row) => row.token === secondToken)?.status).toBe("pending")
    expect(await renderPreview(firstToken)).toContain("Preview link revoked")
    expect(await renderPreview(secondToken as string)).toContain(`rotated content ${runId}`)

    const revokeResponse = await shareFetch(writingId, owner)(
      request(`/api/writings/${writingId}/share-test-link`, "DELETE"),
    )
    expect(revokeResponse.status).toBe(200)
    expect(await revokeResponse.json()).toMatchObject({ data: { writingId, revoked: true }, error: null })
    expect((await uxInvitations(writingId)).every((row) => row.status === "expired")).toBe(true)
    expect(await renderPreview(secondToken as string)).toContain("Preview link revoked")
  })

  it("fails closed for deleted writings, stale pending invitations, and restore", async () => {
    const writingId = await createWriting(`ODE-675 deleted ${runId}`, `deleted body ${runId}`)
    const post = await postPreviewLink(writingId, owner)
    expect(post.status).toBe(201)
    const token = await tokenFrom(post)

    const deletePath = `/api/writings/${writingId}`
    const deleteFetch = createRouteFetch(
      { [deletePath]: (incoming) => deleteWriting(incoming, routeContext(writingId)) },
      { as: owner },
    )
    const deletedAt = new Date().toISOString()
    const deleteResponse = await deleteFetch(
      request(deletePath, "DELETE", { version: 2, updated_at: deletedAt, deleted_at: deletedAt }),
    )
    expect(deleteResponse.status, "el DELETE real confirma el soft delete").toBe(200)
    expect((await readRow<WritingRow>(admin, "writings", writingId))?.deleted_at).not.toBeNull()

    const invitation = (await uxInvitations(writingId)).find((row) => row.token === token)
    expect(invitation?.status, "ODE-674 expira la invitación UX-eval en Postgres").toBe("expired")
    expect(await renderPreview(token)).toContain("Preview link revoked")

    // ODE-674 normalmente evita este estado. Reponer solo el status modela
    // una invitación pendiente histórica/stale y discrimina la segunda guarda:
    // el resolver también debe rechazar el writing soft-deleted por deleted_at.
    const stalePending = await admin
      .from("invitations")
      .update({ status: "pending" })
      .eq("id", invitation?.id ?? "")
    expect(stalePending.error, "se prepara la fila histórica solo después de probar el trigger").toBeNull()
    expect(await renderPreview(token)).toContain("Preview link revoked")

    const expireAgain = await admin
      .from("invitations")
      .update({ status: "expired" })
      .eq("id", invitation?.id ?? "")
    expect(expireAgain.error).toBeNull()

    const archived = await readRow<WritingRow>(admin, "writings", writingId)
    const restorePath = `/api/writings/${writingId}/lifecycle`
    const restoreFetch = createRouteFetch(
      { [restorePath]: (incoming) => restoreWriting(incoming, routeContext(writingId)) },
      { as: owner },
    )
    const restoreResponse = await withServerClient(await serverClientAs(owner), () =>
      restoreFetch(
        request(restorePath, "POST", {
          action: "restore",
          version: archived?.version ?? 0,
          updated_at: new Date(Date.now() + 1_000).toISOString(),
        }),
      ),
    )
    expect(restoreResponse.status, "la ruta de lifecycle restaura el writing").toBe(200)
    expect((await readRow<WritingRow>(admin, "writings", writingId))?.deleted_at).toBeNull()
    expect((await uxInvitations(writingId)).find((row) => row.token === token)?.status).toBe("expired")
    expect(await renderPreview(token)).toContain("Preview link revoked")
  })

  it("returns 404 for a non-owner without adding an invitation row", async () => {
    const writingId = await createWriting(`ODE-675 owner scope ${runId}`, `owner body ${runId}`)
    const before = await uxInvitations(writingId)
    expect(before).toEqual([])

    const response = await postPreviewLink(writingId, stranger)
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({ data: null, error: { code: "NOT_FOUND" } })
    expect(await uxInvitations(writingId), "el POST ajeno no debe dejar una fila UX-eval").toEqual([])
  })
})
