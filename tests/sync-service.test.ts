import "fake-indexeddb/auto"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createEntityKey, localDB, setLocalDBScope } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { webSyncService } from "@/lib/services/web-sync-service"

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
  local_updated_at: 1735689600000,
  ...overrides,
})

beforeEach(() => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(globalThis as any).window = {
    ...globalThis,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
    CustomEvent: class CustomEvent<T> extends Event {
      detail: T
      constructor(type: string, eventInitDict?: { detail?: T }) {
        super(type)
        this.detail = eventInitDict?.detail as T
      }
    },
  }
  setLocalDBScope(`test-sync-svc-${crypto.randomUUID()}`)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe("webSyncService", () => {
  describe("enqueueMutation", () => {
    it("enqueues a writing mutation and returns a receipt", async () => {
      const result = await webSyncService.enqueueMutation({
        mutation: {
          id: "mutation-1",
          entityKind: "writing",
          entityId: "writing-1",
          operation: "upsert",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            title: "Test",
            bodyText: "Hello",
            bodyJson: { type: "doc", content: [] },
            slug: "test",
            status: "draft",
            artifactType: "general",
            visibility: "private",
            parentId: null,
            correspondenceId: null,
            version: 1,
            updatedAt: "2026-01-01T00:00:00.000Z",
            deletedAt: null,
          },
        },
      })

      expect(result.error).toBeNull()
      expect(result.data?.accepted).toBe(true)
      expect(result.data?.mutationId).toBe("mutation-1")
      expect(result.data?.entityKind).toBe("writing")
      expect(result.data?.entityId).toBe("writing-1")

      const pending = await localDB.syncQueue.getCurrentForEntity("writing", "writing-1")
      expect(pending).not.toBeNull()
      expect(pending?.operation).toBe("upsert")
    })

    it("enqueues a collection mutation", async () => {
      const result = await webSyncService.enqueueMutation({
        mutation: {
          id: "mutation-2",
          entityKind: "collection",
          entityId: "collection-1",
          operation: "upsert",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            name: "Test Collection",
            description: null,
            visibility: "private",
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      })

      expect(result.error).toBeNull()
      expect(result.data?.entityKind).toBe("collection")

      const pending = await localDB.syncQueue.getCurrentForEntity("collection", "collection-1")
      expect(pending).not.toBeNull()
    })

    it("enqueues a writing-collections mutation", async () => {
      const result = await webSyncService.enqueueMutation({
        mutation: {
          id: "mutation-3",
          entityKind: "writing-collections",
          entityId: "writing-1",
          operation: "set",
          createdAt: Date.now(),
          attempts: 0,
          payload: {
            collectionIds: ["collection-1"],
            updatedAt: "2026-01-01T00:00:00.000Z",
          },
        },
      })

      expect(result.error).toBeNull()

      const pending = await localDB.syncQueue.getCurrentForEntity("writing-collections", "writing-1")
      expect(pending).not.toBeNull()
      expect(pending?.payload).toEqual({
        collection_ids: ["collection-1"],
        updated_at: "2026-01-01T00:00:00.000Z",
      })
    })

    it("rejects correction-block mutations as unsupported", async () => {
      const result = await webSyncService.enqueueMutation({
        mutation: {
          id: "mutation-4",
          entityKind: "correction-block",
          entityId: "block-1",
          operation: "upsert",
          createdAt: Date.now(),
          attempts: 0,
          payload: {},
        },
      })

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("UNAVAILABLE")
    })
  })

  describe("hydrateWritings", () => {
    it("hydrates writings from remote and returns applied count", async () => {
      const listResponse = {
        data: [
          {
            id: "writing-1",
            author_id: "user-1",
            title: "Remote Title",
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
        ],
        error: null,
      }

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(listResponse), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ),
      )

      const result = await webSyncService.hydrateWritings()

      expect(result.error).toBeNull()
      expect(result.data?.appliedCount).toBe(1)
    })

    it("returns UNAVAILABLE on network error", async () => {
      vi.stubGlobal("fetch", vi.fn(() => Promise.reject(new Error("Network failure"))))

      const result = await webSyncService.hydrateWritings()

      expect(result.data).toBeNull()
      expect(result.error?.code).toBe("UNAVAILABLE")
    })
  })

  describe("hydrateWriting", () => {
    it("hydrates a single writing body from remote", async () => {
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

      const result = await webSyncService.hydrateWriting({ writingId: "writing-1" })

      expect(result.error).toBeNull()
      expect(result.data?.hydrated).toBe(true)
      expect(result.data?.writingId).toBe("writing-1")

      const reloaded = await localDB.writings.get("writing-1")
      expect(reloaded?.body_text).toBe("Remote body")
    })

    it("returns hydrated=false when body already exists", async () => {
      const local = makeLocalWriting()
      await localDB.writings.save(local)

      const result = await webSyncService.hydrateWriting({ writingId: "writing-1" })

      expect(result.error).toBeNull()
      expect(result.data?.hydrated).toBe(false)
    })
  })

  describe("hydrateCollections", () => {
    it("hydrates collections from remote", async () => {
      const payload = {
        data: {
          collections: [
            {
              id: "collection-1",
              owner_id: "user-1",
              name: "Remote Collection",
              description: null,
              visibility: "private",
              created_at: "2026-04-21T00:00:00.000Z",
              updated_at: "2026-04-21T00:00:00.000Z",
            },
          ],
          writingCollections: [],
        },
        error: null,
      }

      vi.stubGlobal(
        "fetch",
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(payload), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            }),
          ),
        ),
      )

      const result = await webSyncService.hydrateCollections()

      expect(result.error).toBeNull()
      expect(result.data?.appliedCount).toBe(1)
    })
  })

  describe("getRuntimeState", () => {
    it("returns idle when no pending mutations", async () => {
      const result = await webSyncService.getRuntimeState()

      expect(result.error).toBeNull()
      expect(result.data?.status).toBe("idle")
      expect(result.data?.pendingMutations).toBe(0)
    })

    it("returns pending status when mutations are queued", async () => {
      await localDB.syncQueue.enqueue({
        id: "mutation-1",
        entity_kind: "writing",
        entity_id: "writing-1",
        entity_key: createEntityKey("writing", "writing-1"),
        operation: "upsert",
        payload: {
          body_json: { type: "doc", content: [] },
          body_text: "",
          status: "draft",
          artifact_type: "general",
          visibility: "private",
          version: 1,
          updated_at: "2026-01-01T00:00:00.000Z",
        },
        created_at: Date.now(),
        attempts: 0,
      })

      const result = await webSyncService.getRuntimeState()

      expect(result.error).toBeNull()
      expect(result.data?.status).toBe("pending")
      expect(result.data?.pendingMutations).toBe(1)
    })

    it("returns writing-specific status", async () => {
      const local = makeLocalWriting({ sync_status: "failed" })
      await localDB.writings.save(local)

      const result = await webSyncService.getRuntimeState({ writingId: "writing-1" })

      expect(result.error).toBeNull()
      expect(result.data?.status).toBe("failed")
    })
  })

  describe("scheduleFlush / start / stop", () => {
    it("scheduleFlush returns ok without throwing", async () => {
      const result = await webSyncService.scheduleFlush()
      expect(result.error).toBeNull()
    })

    it("start returns ok without throwing", async () => {
      const result = await webSyncService.start()
      expect(result.error).toBeNull()
    })

    it("stop returns ok without throwing", async () => {
      const result = await webSyncService.stop()
      expect(result.error).toBeNull()
    })
  })
})
