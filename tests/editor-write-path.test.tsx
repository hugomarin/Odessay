import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { webDocumentService } from "@/lib/services/web-document-service"

const makeRecord = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Untitled",
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] },
  body_text: "Hello world",
  slug: null,
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 1,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  local_updated_at: 1735689600000,
  ...overrides,
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = globalThis
  vi.stubGlobal("navigator", { onLine: false })
  setLocalDBScope(`test-write-path-${crypto.randomUUID()}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("editor write-path — DocumentService integration", () => {
  it("write → save → close → reopen preserves content without loss", async () => {
    // 1. Write: create a new writing via DocumentService
    const createResult = await webDocumentService.saveWriting({
      writing: {
        id: "writing-new",
        authorId: null,
        title: "First Draft",
        content: {
          richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First paragraph" }] }] },
          markdown: null,
          plainText: "First paragraph",
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        artifactType: "general",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    })

    expect(createResult.error).toBeNull()
    expect(createResult.data?.title).toBe("First Draft")

    // Verify local persistence and sync queue
    let local = await localDB.writings.get("writing-new")
    expect(local?.body_text).toBe("First paragraph")
    expect(local?.sync_status).toBe("pending")
    let mutation = await localDB.syncQueue.getCurrentForWriting("writing-new")
    expect(mutation?.operation).toBe("upsert")

    // 2. Save: update the same writing
    const saveResult = await webDocumentService.saveWriting({
      writing: {
        ...createResult.data!,
        content: {
          richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "First paragraph\n\nSecond paragraph" }] }] },
          markdown: null,
          plainText: "First paragraph\n\nSecond paragraph",
          canonicalSource: "rich-text",
        },
        version: 2,
      },
    })

    expect(saveResult.error).toBeNull()
    expect(saveResult.data?.version).toBe(2)

    local = await localDB.writings.get("writing-new")
    expect(local?.body_text).toBe("First paragraph\n\nSecond paragraph")
    expect(local?.version).toBe(2)

    // 3. Close: simulate closing by reading local state
    const beforeClose = await localDB.writings.get("writing-new")
    expect(beforeClose).not.toBeNull()

    // 4. Reopen: load the writing back through DocumentService
    const openResult = await webDocumentService.openWriting("writing-new")
    expect(openResult.error).toBeNull()
    expect(openResult.data?.content.plainText).toBe("First paragraph\n\nSecond paragraph")
    expect(openResult.data?.version).toBe(2)
  })

  it("rename flows through DocumentService without direct transport", async () => {
    await localDB.writings.save(makeRecord({ id: "writing-rename", title: "Old Title", version: 1 }))

    const result = await webDocumentService.renameWriting({
      writingId: "writing-rename",
      title: "New Title",
      updatedAt: "2026-01-02T00:00:00.000Z",
    })

    expect(result.error).toBeNull()
    expect(result.data?.title).toBe("New Title")

    const local = await localDB.writings.get("writing-rename")
    expect(local?.title).toBe("New Title")
    expect(local?.sync_status).toBe("pending")

    const mutation = await localDB.syncQueue.getCurrentForWriting("writing-rename")
    expect(mutation?.operation).toBe("upsert")
  })

  it("blank draft identity creation → save → reopen stays stable", async () => {
    const draftId = "draft-abc"
    const createResult = await webDocumentService.saveWriting({
      writing: {
        id: draftId,
        authorId: null,
        title: "Untitled — 2026-01-01",
        content: {
          richText: { type: "doc", content: [] },
          markdown: null,
          plainText: "",
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        artifactType: "general",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
    })

    expect(createResult.error).toBeNull()

    const openResult = await webDocumentService.openWriting(draftId)
    expect(openResult.error).toBeNull()
    expect(openResult.data?.id).toBe(draftId)
    expect(openResult.data?.version).toBe(1)
    // WritingRecord intentionally does not carry lifecycle — it is adapter-local state
  })
})
