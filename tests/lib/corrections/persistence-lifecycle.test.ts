import { beforeEach, describe, expect, it, vi } from "vitest"
import {
  findStaleCorrectionBlockRecords,
  hydrateCorrectionBlocksFromRemote,
  reconcileHydratedCorrectionBlocks,
} from "@/lib/corrections/persistence"
import type { LocalWriting, WritingLifecycle } from "@/lib/local-db/schema"

const localDBMock = vi.hoisted(() => ({
  writings: {
    get: vi.fn(),
  },
  correctionBlocks: {
    saveMany: vi.fn(),
    evictOldestWriting: vi.fn(),
  },
}))

const webAIServiceMock = vi.hoisted(() => ({
  hydrateCorrectionBlocks: vi.fn(),
}))

vi.mock("@/lib/local-db", () => ({
  localDB: localDBMock,
}))

vi.mock("@/lib/services/web-ai-service", () => ({
  webAIService: webAIServiceMock,
}))

describe("hydrateCorrectionBlocksFromRemote lifecycle awareness", () => {
  beforeEach(() => {
    localDBMock.writings.get.mockReset()
    localDBMock.correctionBlocks.saveMany.mockReset()
    localDBMock.correctionBlocks.evictOldestWriting.mockReset()
    webAIServiceMock.hydrateCorrectionBlocks.mockReset()
  })

  function makeLocalWriting(lifecycle: WritingLifecycle): LocalWriting {
    return {
      id: "writing-1",
      author_id: "user-1",
      title: "Test",
      body_json: { type: "doc", content: [] },
      body_text: "Test",
      slug: null,
      status: "draft",
      visibility: "private",
      version: 1,
      sync_status: "pending",
      lifecycle,
      created_at: "2026-05-28T00:00:00.000Z",
      updated_at: "2026-05-28T00:00:00.000Z",
      local_updated_at: Date.now(),
    }
  }

  it("returns empty array without remote call for local-only writings", async () => {
    localDBMock.writings.get.mockResolvedValue(makeLocalWriting("local-only"))

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(result).toEqual([])
    expect(webAIServiceMock.hydrateCorrectionBlocks).not.toHaveBeenCalled()
  })

  it("returns empty array without remote call for syncing writings", async () => {
    localDBMock.writings.get.mockResolvedValue(makeLocalWriting("syncing"))

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(result).toEqual([])
    expect(webAIServiceMock.hydrateCorrectionBlocks).not.toHaveBeenCalled()
  })

  it("calls remote hydration for server-confirmed writings", async () => {
    localDBMock.writings.get.mockResolvedValue(makeLocalWriting("server-confirmed"))
    webAIServiceMock.hydrateCorrectionBlocks.mockResolvedValue({
      data: [
        {
          id: "auto-correction:writing-1:blk-1",
          writingId: "writing-1",
          blockId: "correction-block:blk-1:12",
          blockHash: "blk-1",
          suggestions: [],
          model: "test-model",
          engineRevision: "test-revision",
          createdAt: "2026-05-28T00:00:00.000Z",
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          syncedAt: null,
        },
      ],
      error: null,
    })

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(webAIServiceMock.hydrateCorrectionBlocks).toHaveBeenCalledWith("writing-1")
    expect(result).toHaveLength(1)
    expect(result[0].blockHash).toBe("blk-1")
  })

  it("returns empty array when no local writing exists", async () => {
    localDBMock.writings.get.mockResolvedValue(null)

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(result).toEqual([])
    expect(webAIServiceMock.hydrateCorrectionBlocks).not.toHaveBeenCalled()
  })

  it("returns empty array and logs info when remote writing is not found (404)", async () => {
    localDBMock.writings.get.mockResolvedValue(makeLocalWriting("server-confirmed"))
    webAIServiceMock.hydrateCorrectionBlocks.mockResolvedValue({
      data: null,
      error: { code: "NOT_FOUND", message: "Writing not found.", retryable: false },
    })

    const consoleSpy = vi.spyOn(console, "info").mockImplementation(() => {})

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("remote writing not found"))

    consoleSpy.mockRestore()
  })

  it("returns empty array and logs warning on genuine auth failure (403)", async () => {
    localDBMock.writings.get.mockResolvedValue(makeLocalWriting("server-confirmed"))
    webAIServiceMock.hydrateCorrectionBlocks.mockResolvedValue({
      data: null,
      error: { code: "FORBIDDEN", message: "Access denied.", retryable: false },
    })

    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {})

    const result = await hydrateCorrectionBlocksFromRemote("writing-1")

    expect(result).toEqual([])
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("auth failure"))

    consoleSpy.mockRestore()
  })
})

describe("correction persistence invalidation", () => {
  it("invalidates stale logical versions when a block hash changes after a small position shift", () => {
    const staleBlocks = findStaleCorrectionBlockRecords(
      [
        {
          id: "auto-correction:writing-1:blk-old",
          blockId: "correction-block:0.3:blk-old:236",
          blockHash: "blk-old",
        },
        {
          id: "auto-correction:writing-1:blk-neighbor",
          blockId: "correction-block:0.4:blk-neighbor:240",
          blockHash: "blk-neighbor",
        },
      ],
      {
        id: "correction-block:0.3:blk-new:237",
        hash: "blk-new",
        pos: 237,
      },
    )

    expect(staleBlocks.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-old"])
  })

  it("drops hydrated blocks whose source hash no longer exists in the current document", () => {
    const reconciliation = reconcileHydratedCorrectionBlocks(
      [
        {
          id: "auto-correction:writing-1:blk-old",
          writingId: "writing-1",
          blockId: "correction-block:0.3:blk-old:236",
          blockHash: "blk-old",
          suggestions: [],
          model: "test-model",
          engineRevision: "test-revision",
          createdAt: "2026-05-28T00:00:00.000Z",
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          syncedAt: "2026-05-28T00:00:01.000Z",
        },
        {
          id: "auto-correction:writing-1:blk-current",
          writingId: "writing-1",
          blockId: "correction-block:0.4:blk-current:245",
          blockHash: "blk-current",
          suggestions: [],
          model: "test-model",
          engineRevision: "test-revision",
          createdAt: "2026-05-28T00:00:00.000Z",
          latencyMs: null,
          promptTokens: null,
          completionTokens: null,
          syncedAt: "2026-05-28T00:00:01.000Z",
        },
      ],
      ["blk-current"],
    )

    expect(reconciliation.fresh.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-current"])
    expect(reconciliation.stale.map((block) => block.id)).toEqual(["auto-correction:writing-1:blk-old"])
  })
})
