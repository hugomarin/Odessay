import { beforeEach, describe, expect, it, vi } from "vitest"
import { LocalIndexService } from "@/lib/services/desktop/local-index-service"

const mockIndexEntries: Array<{ path: string; title: string; createdAt: number; modifiedAt: number }> = []

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriIndexUpsert: vi.fn(async (_dbPath: string, path: string, title: string, createdAt: number, modifiedAt: number) => {
    const idx = mockIndexEntries.findIndex((e) => e.path === path)
    if (idx !== -1) {
      mockIndexEntries[idx] = { path, title, createdAt, modifiedAt }
    } else {
      mockIndexEntries.push({ path, title, createdAt, modifiedAt })
    }
  }),
  tauriIndexList: vi.fn(async (_dbPath: string, limit: number) => {
    return [...mockIndexEntries].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit)
  }),
  tauriIndexDelete: vi.fn(async (_dbPath: string, path: string) => {
    const idx = mockIndexEntries.findIndex((e) => e.path === path)
    if (idx !== -1) mockIndexEntries.splice(idx, 1)
  }),
  tauriIndexRebuild: vi.fn(async (_dbPath: string, _dir: string) => {
    // In a real rebuild, entries are rebuilt from filesystem scan.
    // For the mock, we just clear and return 0 unless pre-seeded externally.
    mockIndexEntries.length = 0
    return 0
  }),
}))

describe("LocalIndexService", () => {
  let service: LocalIndexService

  beforeEach(() => {
    mockIndexEntries.length = 0
    service = new LocalIndexService("/tmp/test-index.db", "/home/user/writings")
    vi.clearAllMocks()
  })

  it("upsert inserts a new entry and emits indexUpdated", async () => {
    const updated: string[] = []
    service.onIndexUpdated((path) => updated.push(path))

    await service.upsert("/home/user/writings/doc.md", "Doc", 1000, 2000)

    expect(updated).toEqual(["/home/user/writings/doc.md"])
    const entries = await service.listRecent()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ path: "/home/user/writings/doc.md", title: "Doc" })
  })

  it("upsert updates an existing entry", async () => {
    await service.upsert("/home/user/writings/doc.md", "Old", 1000, 2000)
    await service.upsert("/home/user/writings/doc.md", "New", 1000, 3000)

    const entries = await service.listRecent()
    expect(entries).toHaveLength(1)
    expect(entries[0].title).toBe("New")
    expect(entries[0].modifiedAt).toBe(3000)
  })

  it("listRecent returns entries ordered by modifiedAt descending", async () => {
    await service.upsert("/home/user/writings/a.md", "A", 1000, 3000)
    await service.upsert("/home/user/writings/b.md", "B", 1000, 5000)
    await service.upsert("/home/user/writings/c.md", "C", 1000, 4000)

    const entries = await service.listRecent()
    expect(entries.map((e) => e.title)).toEqual(["B", "C", "A"])
  })

  it("listRecent respects the limit", async () => {
    for (let i = 0; i < 5; i++) {
      await service.upsert(`/home/user/writings/${i}.md`, `Doc ${i}`, 1000, 5000 - i)
    }
    const entries = await service.listRecent(3)
    expect(entries).toHaveLength(3)
  })

  it("delete removes an entry and emits indexUpdated", async () => {
    await service.upsert("/home/user/writings/doc.md", "Doc", 1000, 2000)

    const updated: string[] = []
    service.onIndexUpdated((path) => updated.push(path))

    await service.delete("/home/user/writings/doc.md")

    expect(updated).toEqual(["/home/user/writings/doc.md"])
    const entries = await service.listRecent()
    expect(entries).toHaveLength(0)
  })

  it("rebuildFromDirectory returns count and emits rebuildComplete", async () => {
    const completed: number[] = []
    service.onRebuildComplete((count) => completed.push(count))

    const count = await service.rebuildFromDirectory()
    expect(count).toBe(0)
    expect(completed).toEqual([0])
  })

  it("unsubscribe prevents listener from receiving future events", async () => {
    const updated: string[] = []
    const unsubscribe = service.onIndexUpdated((path) => updated.push(path))

    await service.upsert("/home/user/writings/doc.md", "Doc", 1000, 2000)
    unsubscribe()
    await service.upsert("/home/user/writings/doc2.md", "Doc2", 1000, 2000)

    expect(updated).toHaveLength(1)
  })
})
