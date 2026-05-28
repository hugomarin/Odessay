import { beforeEach, describe, expect, it, vi } from "vitest"
import { hydrateCorrectionBlocksFromRemote } from "@/lib/corrections/persistence"
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
