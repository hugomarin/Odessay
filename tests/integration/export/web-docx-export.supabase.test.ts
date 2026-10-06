import "fake-indexeddb/auto"
import { randomUUID } from "node:crypto"
import type { SupabaseClient } from "@supabase/supabase-js"
import JSZip from "jszip"
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"

import {
  cleanupUsers,
  seedUsers,
  seedWriting,
  type SeedUser,
} from "../../support/supabase-local/fixtures"
import { createLocalAdminClient } from "../../support/supabase-local/local-supabase"
import { mockEmptyCookies } from "../../support/supabase-local/session"
import { createRouteFetch } from "../../support/supabase-local/route-fetch"

const rendererControl = vi.hoisted(() => ({ mode: "real" as "real" | "throw" | "empty" }))

vi.mock("@/lib/export/to-docx", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/export/to-docx")>()

  return {
    ...actual,
    renderWritingToDocxBuffer: async (
      input: Parameters<typeof actual.renderWritingToDocxBuffer>[0],
    ) => {
      if (rendererControl.mode === "throw") throw new Error("renderer failed")
      if (rendererControl.mode === "empty") return Buffer.alloc(0)
      return actual.renderWritingToDocxBuffer(input)
    },
  }
})

// The unauthenticated direct-route control must exercise cookie auth with no session.
mockEmptyCookies()

const originalFetch = globalThis.fetch
const runId = randomUUID().replace(/-/g, "").slice(0, 8)
const selectedText = "ODE680_SELECTED_BODY_CONTENT"
const siblingText = "ODE680_OTHER_WRITING_BODY_MUST_NOT_APPEAR"
const foreignText = "ODE680_FOREIGN_WRITING_BODY"
const deletedText = "ODE680_DELETED_WRITING_BODY"
const localShadowText = "ODE680_INDEXEDDB_BODY_MUST_NOT_APPEAR"
const doc = (text: string) => ({
  type: "doc",
  content: [{ type: "paragraph", content: [{ type: "text", text }] }],
})

const { GET } = await import("@/app/api/writings/[id]/export/route")
const { localDB, setLocalDBScope } = await import("@/lib/local-db")
const { webDocumentService } = await import("@/lib/services/web-document-service")
type LocalWriting = import("@/lib/local-db/schema").LocalWriting

let admin: SupabaseClient
let users: SeedUser[] = []
let owner!: SeedUser
let stranger!: SeedUser
let selectedId = ""
let siblingId = ""
let foreignId = ""
let deletedId = ""
const routedResponses: Response[] = []

beforeAll(async () => {
  admin = createLocalAdminClient()
  users = await seedUsers(runId, ["owner", "stranger"])
  ;[owner, stranger] = users

  selectedId = await seedWriting(admin, {
    authorId: owner.id,
    title: "Server route title",
    bodyJson: doc(selectedText),
  })
  siblingId = await seedWriting(admin, {
    authorId: owner.id,
    title: "Other writing title",
    bodyJson: doc(siblingText),
  })
  foreignId = await seedWriting(admin, {
    authorId: stranger.id,
    title: "Foreign writing title",
    bodyJson: doc(foreignText),
  })
  deletedId = await seedWriting(admin, {
    authorId: owner.id,
    title: "Deleted writing title",
    bodyJson: doc(deletedText),
  })

  const { error } = await admin
    .from("writings")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", deletedId)
  if (error) throw new Error(`[ode-680] marcar writing como borrado falló: ${error.message}`)
})

afterAll(async () => {
  await cleanupUsers(users)
})

beforeEach(() => {
  rendererControl.mode = "real"
  routedResponses.length = 0
  setLocalDBScope(`ode-680-${crypto.randomUUID()}`)
  vi.stubGlobal("window", {
    setTimeout,
    clearTimeout,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class {},
  })
})

afterEach(() => {
  rendererControl.mode = "real"
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

function installRoutedFetch(as: SeedUser): void {
  const ids = [selectedId, siblingId, foreignId, deletedId]
  const routes = Object.fromEntries(
    ids.map((id) => [
      `/api/writings/${id}/export`,
      async (request: Request) => {
        const response = await GET(request, { params: Promise.resolve({ id }) })
        routedResponses.push(response.clone())
        return response
      },
    ]),
  )
  const routeFetch = createRouteFetch(routes, { as })

  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init?: RequestInit) => {
    const request =
      input instanceof Request
        ? input
        : new Request(typeof input === "string" ? new URL(input, "http://harness.test") : input, init)
    const url = new URL(request.url)
    if (url.origin === "http://127.0.0.1:54321") return originalFetch(request)
    return routeFetch(request)
  })
}

async function directGet(id: string, as?: SeedUser): Promise<Response> {
  const headers = new Headers()
  if (as) headers.set("authorization", `Bearer ${as.accessToken}`)
  const request = new Request(`http://harness.test/api/writings/${id}/export?format=docx`, { headers })
  return GET(request, { params: Promise.resolve({ id }) })
}

async function saveLocalFilenameMetadata(): Promise<void> {
  const local: LocalWriting = {
    id: selectedId,
    author_id: owner.id,
    title: "Local browser filename",
    body_json: doc(localShadowText),
    body_text: localShadowText,
    status: "draft",
    visibility: "private",
    version: 1,
    sync_status: "synced",
    lifecycle: "server-confirmed",
    created_at: "2026-10-05T00:00:00.000Z",
    updated_at: "2026-10-05T00:00:00.000Z",
    local_updated_at: Date.now(),
  }
  await localDB.writings.save(local)
}

describe("ODE-680 — export DOCX web a través del servicio y la ruta real", () => {
  it("incluye el cuerpo del UUID solicitado y mantiene separados los nombres del servicio y de la ruta", async () => {
    await saveLocalFilenameMetadata()
    installRoutedFetch(owner)

    const result = await webDocumentService.exportWriting({ writingId: selectedId, format: "docx" })

    expect(result.error).toBeNull()
    expect(result.data).not.toBeNull()
    const artifact = result.data!
    expect(artifact.writingId).toBe(selectedId)
    expect(artifact.fileName).toBe("Local-browser-filename.docx")
    expect(artifact.mimeType).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(artifact.bytes.byteLength).toBeGreaterThan(0)

    const zip = await JSZip.loadAsync(artifact.bytes)
    const documentXml = await zip.file("word/document.xml")!.async("string")
    expect(documentXml).toContain(selectedText)
    expect(documentXml).not.toContain(siblingText)
    expect(documentXml).not.toContain(foreignText)
    expect(documentXml).not.toContain(localShadowText)

    expect(routedResponses).toHaveLength(1)
    expect(routedResponses[0].status).toBe(200)
    expect(routedResponses[0].headers.get("content-type")).toBe(
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    )
    expect(routedResponses[0].headers.get("content-disposition")).toBe(
      "attachment; filename=\"Server-route-title.docx\"; filename*=UTF-8''Server-route-title.docx",
    )
  })

  it("devuelve 401 sin sesión por la rama de cookies", async () => {
    const response = await directGet(selectedId)

    expect(response.status).toBe(401)
    expect((await response.json()).error.code).toBe("UNAUTHORIZED")
  })

  it("observa 403 para un writing de otro usuario", async () => {
    const response = await directGet(foreignId, owner)

    expect(response.status).toBe(403)
    expect((await response.json()).error.code).toBe("FORBIDDEN")
  })

  it("devuelve 404 para un writing borrado y uno ausente", async () => {
    const deleted = await directGet(deletedId, owner)
    const missing = await directGet(randomUUID(), owner)

    expect(deleted.status).toBe(404)
    expect(missing.status).toBe(404)
    expect((await deleted.json()).error.code).toBe("NOT_FOUND")
    expect((await missing.json()).error.code).toBe("NOT_FOUND")
  })

  it("convierte una excepción del renderer en UNAVAILABLE sin un artefacto exitoso", async () => {
    installRoutedFetch(owner)
    rendererControl.mode = "throw"

    const result = await webDocumentService.exportWriting({ writingId: selectedId, format: "docx" })

    expect(result.error?.code).toBe("UNAVAILABLE")
    expect(result.data).toBeNull()
  })

  it.fails("rechaza un DOCX vacío desde la ruta en vez de devolver éxito", async () => {
    installRoutedFetch(owner)
    rendererControl.mode = "empty"

    const result = await webDocumentService.exportWriting({ writingId: selectedId, format: "docx" })

    expect(routedResponses).toHaveLength(1)
    expect(routedResponses[0].status).toBe(500)
    expect(result.error?.code).toBe("UNAVAILABLE")
    expect(result.data).toBeNull()
  })
})
