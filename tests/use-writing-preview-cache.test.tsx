/**
 * @vitest-environment happy-dom
 *
 * @contract ODE-397 — Preview opens through DocumentService, never IndexedDB.
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import type { WritingRecord } from "@/lib/services/contracts/document-service"
import { useWritingPreviewCache } from "@/hooks/useWritingPreviewCache"

const openWriting = vi.fn()

vi.mock("@/lib/services/document-service-factory", () => ({
  getDocumentService: async () => ({ openWriting }),
}))

let container: HTMLDivElement
let root: Root | null = null
let hook: ReturnType<typeof useWritingPreviewCache> | null = null

const writing: WritingRecord = {
  id: "writing-1",
  authorId: "author-1",
  title: "Guide CMP",
  content: {
    markdown: null,
    richText: { type: "doc", content: [{ type: "paragraph", content: [{ type: "text", text: "Same content" }] }] },
    plainText: "Same content",
    canonicalSource: "markdown",
  },
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  parentId: null,
  correspondenceId: null,
  version: 1,
  deletedAt: null,
  createdAt: "2026-07-19T10:00:00.000Z",
  updatedAt: "2026-07-19T10:01:00.000Z",
  lifecycle: "server-confirmed",
}

function Harness() {
  hook = useWritingPreviewCache()
  return null
}

beforeEach(() => {
  openWriting.mockReset()
  hook = null
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
  act(() => root?.render(<Harness />))
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  hook = null
  container.remove()
})

describe("useWritingPreviewCache", () => {
  it("maps DocumentService content and deduplicates concurrent opens", async () => {
    openWriting.mockResolvedValue({ data: writing, error: null })

    const [first, second] = await act(async () => Promise.all([
      hook!.fetchPreview(writing.id),
      hook!.fetchPreview(writing.id),
    ]))

    expect(openWriting).toHaveBeenCalledTimes(1)
    expect(openWriting).toHaveBeenCalledWith(writing.id)
    expect(first).toMatchObject({
      id: writing.id,
      title: "Guide CMP",
      bodyText: "Same content",
      wordCount: 2,
      lifecycle: "server-confirmed",
    })
    expect(second).toBe(first)
    expect(hook!.getCachedPreview(writing.id)).toBe(first)
  })

  it("degrades a failed open to unavailable without caching content", async () => {
    openWriting.mockResolvedValue({
      data: null,
      error: { code: "NOT_FOUND", message: "Missing", retryable: false },
    })

    await expect(hook!.fetchPreview("missing")).resolves.toBeNull()
    expect(hook!.getCachedPreview("missing")).toBeNull()
  })
})
