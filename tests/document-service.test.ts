import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { webDocumentService } from "@/lib/services/web-document-service"

const makeLocalWriting = (overrides: Partial<LocalWriting> = {}): LocalWriting => ({
  id: "writing-1",
  author_id: "user-1",
  title: "Local Title",
  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello world" }] }] },
  body_text: "Hello world",
  slug: "local-title",
  status: "draft",
  visibility: "private",
  parent_id: null,
  correspondence_id: null,
  version: 2,
  sync_status: "synced",
  lifecycle: "server-confirmed",
  deleted_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
  content_updated_at: "2026-01-02T00:00:00.000Z",
  metadata_updated_at: "2026-01-02T00:00:00.000Z",
  local_updated_at: 1735689600000,
  ...overrides,
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = globalThis
  setLocalDBScope(`test-doc-svc-${crypto.randomUUID()}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("webDocumentService", () => {
  describe("saveWriting", () => {
    it("persists a writing to localDB and enqueues sync", async () => {
      const record = {
        id: "writing-new",
        authorId: null,
        title: "New Writing",
        content: {
          richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Hello" }] }] },
          markdown: null,
          plainText: "Hello",
          canonicalSource: "rich-text" as const,
        },
        slug: null,
        status: "draft" as const,
        visibility: "private" as const,
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      }

      const result = await webDocumentService.saveWriting({ writing: record })

      expect(result.error).toBeNull()
      expect(result.data?.id).toBe("writing-new")

      const local = await localDB.writings.get("writing-new")
      expect(local).not.toBeNull()
      expect(local?.title).toBe("New Writing")
      expect(local?.sync_status).toBe("pending")

      const pending = await localDB.syncQueue.getCurrentForWriting("writing-new")
      expect(pending).not.toBeNull()
      expect(pending?.operation).toBe("upsert")
    })

    it("preserves lifecycle of an existing server-confirmed writing", async () => {
      const existing = makeLocalWriting({
        id: "writing-lifecycle",
        title: "Existing",
        lifecycle: "server-confirmed",
        sync_status: "synced",
      })
      await localDB.writings.save(existing)

      const result = await webDocumentService.saveWriting({
        writing: {
          id: "writing-lifecycle",
          authorId: null,
          title: "Updated Title",
          content: {
            richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Updated" }] }] },
            markdown: null,
            plainText: "Updated",
            canonicalSource: "rich-text",
          },
          slug: null,
          status: "draft",
          visibility: "private",
          parentId: null,
          correspondenceId: null,
          version: 2,
          deletedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
        },
      })

      expect(result.error).toBeNull()

      const local = await localDB.writings.get("writing-lifecycle")
      expect(local?.lifecycle).toBe("server-confirmed")
      expect(local?.sync_status).toBe("pending")
    })

    it("sets content_updated_at when contentUpdatedAt is provided", async () => {
      const existing = makeLocalWriting({
        id: "writing-content-ts",
        content_updated_at: "2026-01-01T00:00:00.000Z",
        metadata_updated_at: "2026-01-01T00:00:00.000Z",
      })
      await localDB.writings.save(existing)

      const result = await webDocumentService.saveWriting({
        writing: {
          id: "writing-content-ts",
          authorId: null,
          title: "Updated Title",
          content: {
            richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Updated body" }] }] },
            markdown: null,
            plainText: "Updated body",
            canonicalSource: "rich-text",
          },
          slug: null,
          status: "draft",
          visibility: "private",
          parentId: null,
          correspondenceId: null,
          version: 2,
          deletedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          contentUpdatedAt: "2026-01-02T00:00:00.000Z",
        },
      })

      expect(result.error).toBeNull()

      const local = await localDB.writings.get("writing-content-ts")
      expect(local?.content_updated_at).toBe("2026-01-02T00:00:00.000Z")
      expect(local?.metadata_updated_at).toBe("2026-01-01T00:00:00.000Z")
    })

    it("preserves content_updated_at when contentUpdatedAt is omitted", async () => {
      const existing = makeLocalWriting({
        id: "writing-metadata-only",
        content_updated_at: "2026-01-01T00:00:00.000Z",
        metadata_updated_at: "2026-01-01T00:00:00.000Z",
      })
      await localDB.writings.save(existing)

      const result = await webDocumentService.saveWriting({
        writing: {
          id: "writing-metadata-only",
          authorId: null,
          title: "Existing Title",
          content: {
            richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Existing body" }] }] },
            markdown: null,
            plainText: "Existing body",
            canonicalSource: "rich-text",
          },
          slug: null,
          status: "done",
          visibility: "public",
          parentId: null,
          correspondenceId: null,
          version: 2,
          deletedAt: null,
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-02T00:00:00.000Z",
          metadataUpdatedAt: "2026-01-02T00:00:00.000Z",
        },
      })

      expect(result.error).toBeNull()

      const local = await localDB.writings.get("writing-metadata-only")
      expect(local?.content_updated_at).toBe("2026-01-01T00:00:00.000Z")
      expect(local?.metadata_updated_at).toBe("2026-01-02T00:00:00.000Z")
    })
  })

  describe("openWriting", () => {
    it("returns a writing from localDB when it exists with body", async () => {
      const local = makeLocalWriting()
      await localDB.writings.save(local)

      const result = await webDocumentService.openWriting("writing-1")

      expect(result.error).toBeNull()
      expect(result.data?.id).toBe("writing-1")
      expect(result.data?.content.plainText).toBe("Hello world")
    })

    it("hydrates from remote when local writing has no body", async () => {
      const local = makeLocalWriting({
        body_json: { type: "doc", content: [] },
        body_text: "",
        lifecycle: "server-confirmed",
        sync_status: "synced",
      })
      await localDB.writings.save(local)

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({
                data: {
                  id: "writing-1",
                  author_id: "user-1",
                  title: "Remote Title",
                  body_json: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Remote body" }] }] },
                  body_text: "Remote body",
                  slug: "remote-title",
                  status: "draft",
                  visibility: "private",
                  parent_id: null,
                  correspondence_id: null,
                  version: 3,
                  sync_status: "synced",
                  deleted_at: null,
                  created_at: "2026-01-01T00:00:00.000Z",
                  updated_at: "2026-01-03T00:00:00.000Z",
                },
                error: null,
              }),
              { status: 200, headers: { "Content-Type": "application/json" } },
            ),
          ),
        ),
      )

      const result = await webDocumentService.openWriting("writing-1")

      expect(result.error).toBeNull()
      expect(result.data?.content.plainText).toBe("Remote body")
      expect(result.data?.version).toBe(3)
    })

    it("returns NOT_FOUND when writing does not exist locally or remotely", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ data: null, error: { code: "NOT_FOUND", message: "Not found" } }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            ),
          ),
        ),
      )

      const result = await webDocumentService.openWriting("missing-id")

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("NOT_FOUND")
    })
  })

  describe("renameWriting", () => {
    it("updates title and enqueues sync", async () => {
      const local = makeLocalWriting()
      await localDB.writings.save(local)

      const result = await webDocumentService.renameWriting({
        writingId: "writing-1",
        title: "Renamed Title",
        updatedAt: "2026-01-03T00:00:00.000Z",
      })

      expect(result.error).toBeNull()
      expect(result.data?.title).toBe("Renamed Title")

      const reloaded = await localDB.writings.get("writing-1")
      expect(reloaded?.title).toBe("Renamed Title")
      expect(reloaded?.sync_status).toBe("pending")
    })

    it("updates content_updated_at for a title change", async () => {
      const local = makeLocalWriting({
        id: "writing-rename-ts",
        content_updated_at: "2026-01-01T00:00:00.000Z",
        metadata_updated_at: "2026-01-01T00:00:00.000Z",
      })
      await localDB.writings.save(local)

      const result = await webDocumentService.renameWriting({
        writingId: "writing-rename-ts",
        title: "Renamed Title",
        updatedAt: "2026-01-03T00:00:00.000Z",
      })

      expect(result.error).toBeNull()

      const reloaded = await localDB.writings.get("writing-rename-ts")
      expect(reloaded?.content_updated_at).toBe("2026-01-03T00:00:00.000Z")
      expect(reloaded?.metadata_updated_at).toBe("2026-01-01T00:00:00.000Z")
    })

    it("returns NOT_FOUND for missing writing", async () => {
      const result = await webDocumentService.renameWriting({
        writingId: "missing",
        title: "Title",
        updatedAt: "2026-01-03T00:00:00.000Z",
      })

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("NOT_FOUND")
    })
  })

  describe("exportWriting", () => {
    it("normalizes export artifacts through the document-service boundary", async () => {
      await localDB.writings.save(makeLocalWriting({ id: "writing-export", title: "Export Me" }))

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(new Uint8Array([1, 2, 3, 4]), {
              status: 200,
              headers: {
                "Content-Type": "application/pdf",
              },
            }),
          ),
        ),
      )

      const result = await webDocumentService.exportWriting({
        writingId: "writing-export",
        format: "pdf",
      })

      expect(result.error).toBeNull()
      expect(result.data).toEqual({
        writingId: "writing-export",
        format: "pdf",
        fileName: "Export-Me.pdf",
        mimeType: "application/pdf",
        bytes: new Uint8Array([1, 2, 3, 4]),
      })
    })
  })

  describe("deleteWriting", () => {
    it("soft-deletes a writing and enqueues sync", async () => {
      const local = makeLocalWriting()
      await localDB.writings.save(local)

      const result = await webDocumentService.deleteWriting({
        writingId: "writing-1",
        version: 3,
        updatedAt: "2026-01-03T00:00:00.000Z",
        deletedAt: "2026-01-03T00:00:00.000Z",
      })

      expect(result.error).toBeNull()

      const reloaded = await localDB.writings.get("writing-1")
      expect(reloaded?.sync_status).toBe("deleted")
    })

    it("returns NOT_FOUND for missing writing", async () => {
      const result = await webDocumentService.deleteWriting({
        writingId: "missing",
        version: 1,
        updatedAt: "2026-01-03T00:00:00.000Z",
        deletedAt: "2026-01-03T00:00:00.000Z",
      })

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("NOT_FOUND")
    })
  })

  describe("listWritings", () => {
    it("returns summaries ordered by created_at DESC", async () => {
      await localDB.writings.save(
        makeLocalWriting({ id: "a", title: "First", created_at: "2026-01-01T00:00:00.000Z" }),
      )
      await localDB.writings.save(
        makeLocalWriting({ id: "b", title: "Second", created_at: "2026-01-02T00:00:00.000Z" }),
      )

      const result = await webDocumentService.listWritings()

      expect(result.error).toBeNull()
      expect(result.data?.length).toBe(2)
      expect(result.data?.[0].title).toBe("Second")
      expect(result.data?.[1].title).toBe("First")
    })

    it("excludes deleted writings by default", async () => {
      await localDB.writings.save(makeLocalWriting({ id: "a", sync_status: "synced" }))
      await localDB.writings.save(makeLocalWriting({ id: "b", sync_status: "deleted" }))

      const result = await webDocumentService.listWritings()

      expect(result.error).toBeNull()
      expect(result.data?.length).toBe(1)
      expect(result.data?.[0].id).toBe("a")
    })
  })

  describe("exportWriting", () => {
    it("fetches export bytes from the API", async () => {
      await localDB.writings.save(makeLocalWriting({ id: "writing-1", title: "Exportable" }))

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(new Uint8Array([1, 2, 3]), {
              status: 200,
              headers: { "Content-Type": "application/pdf" },
            }),
          ),
        ),
      )

      const result = await webDocumentService.exportWriting({ writingId: "writing-1", format: "pdf" })

      expect(result.error).toBeNull()
      expect(result.data?.format).toBe("pdf")
      expect(result.data?.mimeType).toBe("application/pdf")
      expect(result.data?.bytes.length).toBe(3)
    })

    it("returns UNAVAILABLE on API error", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(
              JSON.stringify({ data: null, error: { code: "NOT_FOUND", message: "Not found" } }),
              { status: 404, headers: { "Content-Type": "application/json" } },
            ),
          ),
        ),
      )

      const result = await webDocumentService.exportWriting({ writingId: "missing", format: "pdf" })

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("UNAVAILABLE")
    })
  })
})
