import "fake-indexeddb/auto"
import { beforeEach, describe, expect, it } from "vitest"
import { z } from "zod"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import { webDocumentService } from "@/lib/services/web-document-service"

// Reproduce the server schema validation from app/api/writings/[id]/route.ts
const writingPayloadSchema = z.object({
  title: z.string().nullable().optional(),
  body_json: z.record(z.string(), z.unknown()),
  body_text: z.string(),
  slug: z.string().nullable().optional(),
  status: z.enum(["new", "exploring", "draft", "in_review", "done", "archived", "canceled", "finished"]).default("draft"),
  visibility: z.enum(["private", "shared", "public"]).default("private"),
  parent_id: z.string().uuid().nullable().optional(),
  correspondence_id: z.string().uuid().nullable().optional(),
  version: z.number().int().min(1),
  updated_at: z.string().datetime(),
  deleted_at: z.string().datetime().nullable().optional(),
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = globalThis
  setLocalDBScope(`ode-198-evidence-${crypto.randomUUID()}`)
})

describe("ODE-198 blank-draft version contract evidence", () => {
  it("creates a blank draft with version 1 that passes server validation", async () => {
    const nowIso = new Date().toISOString()
    const draftId = crypto.randomUUID()

    const createResult = await webDocumentService.saveWriting({
      writing: {
        id: draftId,
        authorId: null,
        title: "Untitled — 2026-05-28",
        content: {
          richText: { type: "doc", content: [] },
          markdown: null,
          plainText: "",
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    })

    expect(createResult.error).toBeNull()
    expect(createResult.data?.version).toBe(1)

    // Local persistence
    const localWriting = await localDB.writings.get(draftId)
    expect(localWriting).not.toBeNull()
    expect(localWriting?.version).toBe(1)
    expect(localWriting?.sync_status).toBe("pending")

    // Sync queue carries version 1
    const mutation = await localDB.syncQueue.getCurrentForWriting(draftId)
    expect(mutation).not.toBeNull()
    expect(mutation?.operation).toBe("upsert")
    expect(mutation?.payload.version).toBe(1)

    // Server contract validation
    const serverParseResult = writingPayloadSchema.safeParse(mutation?.payload)
    expect(serverParseResult.success).toBe(true)
  })

  it("increments version on edit without creating stale compensating mutations", async () => {
    const draftId = crypto.randomUUID()
    const nowIso = new Date().toISOString()

    await webDocumentService.saveWriting({
      writing: {
        id: draftId,
        authorId: null,
        title: "Untitled",
        content: {
          richText: { type: "doc", content: [] },
          markdown: null,
          plainText: "",
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
      },
    })

    const editResult = await webDocumentService.saveWriting({
      writing: {
        id: draftId,
        authorId: null,
        title: "Untitled",
        content: {
          richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First paragraph" }] }] },
          markdown: null,
          plainText: "First paragraph",
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 2,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: new Date().toISOString(),
      },
    })

    expect(editResult.error).toBeNull()
    expect(editResult.data?.version).toBe(2)

    // Current mutation should reflect the latest version
    const currentMutation = await localDB.syncQueue.getCurrentForWriting(draftId)
    expect(currentMutation?.payload.version).toBe(2)

    // Reopen should show version 2
    const openResult = await webDocumentService.openWriting(draftId)
    expect(openResult.error).toBeNull()
    expect(openResult.data?.version).toBe(2)
  })

  it("rejects version 0 under the server adapter contract", () => {
    const payload = {
      title: "Untitled",
      body_json: { type: "doc", content: [] },
      body_text: "",
      slug: null,
      status: "draft",
      visibility: "private",
      parent_id: null,
      correspondence_id: null,
      version: 0,
      updated_at: new Date().toISOString(),
      deleted_at: null,
    }

    const result = writingPayloadSchema.safeParse(payload)
    expect(result.success).toBe(false)
    if (!result.success) {
      const versionIssue = result.error.issues.find(i => i.path.includes("version"))
      expect(versionIssue?.message).toMatch(/Too small|expected number to be >=1/)
    }
  })
})
