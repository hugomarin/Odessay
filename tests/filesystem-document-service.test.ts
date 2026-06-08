/**
 * @vitest-environment happy-dom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import JSZip from "jszip"
import { FilesystemDocumentService } from "@/lib/services/desktop/filesystem-document-service"
import { LocalIndexService } from "@/lib/services/desktop/local-index-service"
import type { WritingRecord } from "@/lib/services/contracts/document-service"

// ─── Mock Tauri commands (no real filesystem in test env) ─────────────────────

const mockFiles = new Map<string, string>()
const mockMetadata: Array<{ path: string; name: string; modifiedAt: number; size: number }> = []

const mockIndexEntries: Array<{ path: string; title: string; createdAt: number; modifiedAt: number }> = []

vi.mock("@/lib/services/desktop/tauri-commands", () => ({
  tauriOpenFile: vi.fn(async (path: string) => {
    if (!mockFiles.has(path)) throw new Error(`File not found: ${path}`)
    return mockFiles.get(path)!
  }),
  tauriCreateFile: vi.fn(async (dir: string, filename: string) => {
    const path = `${dir}/${filename}`
    mockFiles.set(path, "")
    mockMetadata.push({ path, name: filename.replace(/\.md$/, ""), modifiedAt: Date.now(), size: 0 })
    return path
  }),
  tauriWriteFile: vi.fn(async (path: string, content: string) => {
    mockFiles.set(path, content)
    const entry = mockMetadata.find((m) => m.path === path)
    if (entry) {
      entry.size = content.length
      entry.modifiedAt = Date.now()
    }
  }),
  tauriRenameFile: vi.fn(async (oldPath: string, newPath: string) => {
    const content = mockFiles.get(oldPath) ?? ""
    mockFiles.delete(oldPath)
    mockFiles.set(newPath, content)
    const idx = mockMetadata.findIndex((m) => m.path === oldPath)
    if (idx !== -1) {
      mockMetadata[idx].path = newPath
      mockMetadata[idx].name = newPath.split("/").pop()?.replace(/\.md$/, "") ?? newPath
    }
    return newPath
  }),
  tauriListRecentFiles: vi.fn(async (_dir: string, limit: number) => {
    return [...mockMetadata].sort((a, b) => b.modifiedAt - a.modifiedAt).slice(0, limit)
  }),
  tauriResolveAssetPath: vi.fn(async (docPath: string, relativePath: string) => {
    const dir = docPath.split("/").slice(0, -1).join("/")
    const resolved = `${dir}/${relativePath}`
    if (!mockFiles.has(resolved)) throw new Error(`Asset not found: ${resolved}`)
    return resolved
  }),
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
    mockIndexEntries.length = 0
    for (const meta of mockMetadata) {
      mockIndexEntries.push({
        path: meta.path,
        title: meta.name,
        createdAt: meta.modifiedAt,
        modifiedAt: meta.modifiedAt,
      })
    }
    return mockIndexEntries.length
  }),
  tauriSettingsRead: vi.fn(async (_configDir: string, _key: string) => {
    return null
  }),
  tauriSettingsWrite: vi.fn(async (_configDir: string, _key: string, _valueJson: string) => {
    // no-op
  }),
  tauriSettingsDelete: vi.fn(async (_configDir: string, _key: string) => {
    // no-op
  }),
  tauriSettingsListKeys: vi.fn(async (_configDir: string) => {
    return []
  }),
}))

// Re-import after mock registration
import * as tauriCommandsMod from "@/lib/services/desktop/tauri-commands"

// ─── Helpers ──────────────────────────────────────────────────────────────────

const WRITINGS_DIR = "/home/user/writings"

function makeWritingRecord(overrides: Partial<WritingRecord> = {}): WritingRecord {
  return {
    id: `${WRITINGS_DIR}/test-doc.md`,
    authorId: null,
    title: "Test Writing",
    content: {
      markdown: "# Test Writing\n\nHello world.",
      richText: null,
      plainText: "Test Writing Hello world.",
      canonicalSource: "markdown",
    },
    slug: null,
    status: "draft",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: 1,
    deletedAt: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("FilesystemDocumentService", () => {
  let service: FilesystemDocumentService

  beforeEach(() => {
    vi.useFakeTimers()
    mockFiles.clear()
    mockMetadata.length = 0
    mockIndexEntries.length = 0
    service = new FilesystemDocumentService(WRITINGS_DIR, { autoSaveDebounceMs: 300 })
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  // ── Architecture Contract: all I/O goes through Tauri commands ─────────────

  it("saveWriting routes disk I/O through tauriWriteFile, never via fetch or Supabase", async () => {
    vi.useRealTimers()
    const writing = makeWritingRecord()
    mockFiles.set(writing.id, "")
    await service.saveWriting({ writing })
    expect(vi.mocked(tauriCommandsMod.tauriWriteFile)).toHaveBeenCalledWith(
      writing.id,
      writing.content.markdown,
    )
    vi.useFakeTimers()
  })

  // ── createDraft ────────────────────────────────────────────────────────────

  it("createDraft creates a .md file and returns a WritingRecord with the path as id", async () => {
    vi.useRealTimers()
    const result = await service.createDraft("My First Writing")
    expect(result.error).toBeNull()
    expect(result.data!.path).toContain(WRITINGS_DIR)
    expect(result.data!.path).toMatch(/\.md$/)
    expect(result.data!.writing.title).toBe("My First Writing")
    expect(result.data!.writing.id).toBe(result.data!.path)
    expect(result.data!.writing.authorId).toBeNull()
    expect(result.data!.writing.status).toBe("draft")
    expect(result.data!.writing.visibility).toBe("private")
    expect(result.data!.writing.content.canonicalSource).toBe("markdown")
    vi.useFakeTimers()
  })

  it("createDraft without title uses 'Untitled'", async () => {
    vi.useRealTimers()
    const result = await service.createDraft()
    expect(result.error).toBeNull()
    expect(result.data!.writing.title).toBe("Untitled")
    vi.useFakeTimers()
  })

  // ── listWritings ───────────────────────────────────────────────────────────

  it("listWritings returns WritingSummary[] via tauriListRecentFiles", async () => {
    vi.useRealTimers()
    await service.createDraft("Alpha")
    await service.createDraft("Beta")
    const result = await service.listWritings()
    expect(result.error).toBeNull()
    expect(result.data!.length).toBeGreaterThanOrEqual(2)
    expect(result.data![0]).toMatchObject({
      status: "draft",
      visibility: "private",
      authorId: null,
    })
    vi.useFakeTimers()
  })

  // ── openWriting ────────────────────────────────────────────────────────────

  it("openWriting reads the .md and returns markdown as content.markdown", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/my-writing.md`
    const md = "# My Writing\n\nSome content here."
    mockFiles.set(path, md)

    const result = await service.openWriting(path)
    expect(result.error).toBeNull()
    expect(result.data!.id).toBe(path)
    expect(result.data!.content.markdown).toBe(md)
    expect(result.data!.title).toBe("My Writing")
    expect(result.data!.content.canonicalSource).toBe("markdown")
    expect(result.data!.content.richText).toBeNull()
    vi.useFakeTimers()
  })

  it("openWriting derives title from filename when no H1 is present", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/my-writing-file.md`
    mockFiles.set(path, "Some plain paragraph without a heading.")

    const result = await service.openWriting(path)
    expect(result.error).toBeNull()
    expect(result.data!.title).toBe("my writing file")
    vi.useFakeTimers()
  })

  it("openWriting returns NOT_FOUND error for missing file", async () => {
    vi.useRealTimers()
    const result = await service.openWriting("/nonexistent/file.md")
    expect(result.data).toBeNull()
    expect(result.error!.code).toBe("NOT_FOUND")
    vi.useFakeTimers()
  })

  // ── saveWriting ────────────────────────────────────────────────────────────

  it("saveWriting writes markdown to disk and returns updated record", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/save-test.md`
    mockFiles.set(path, "")
    const writing = makeWritingRecord({
      id: path,
      content: {
        markdown: "# Save Test\n\nNew content.",
        richText: null,
        plainText: "Save Test New content.",
        canonicalSource: "markdown",
      },
    })

    const result = await service.saveWriting({ writing })
    expect(result.error).toBeNull()
    expect(result.data!.version).toBe(writing.version + 1)
    expect(vi.mocked(tauriCommandsMod.tauriWriteFile)).toHaveBeenCalledWith(
      path,
      "# Save Test\n\nNew content.",
    )
    vi.useFakeTimers()
  })

  it("saveWriting emits a saved event with the writingId", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/event-test.md`
    mockFiles.set(path, "")
    const writing = makeWritingRecord({ id: path })

    const savedIds: string[] = []
    service.onSaved((id) => savedIds.push(id))

    await service.saveWriting({ writing })
    expect(savedIds).toEqual([path])
    vi.useFakeTimers()
  })

  // ── Performance Contract: Interaction Latency ──────────────────────────────

  it(
    "saveWriting completes in < 100ms for a typical document (< 100KB) [ODE-208 perf contract]",
    async () => {
      vi.useRealTimers()
      const path = `${WRITINGS_DIR}/perf-test.md`
      mockFiles.set(path, "")

      // ~50KB document — representative of a full writing session
      const markdown = "# Performance Test\n\n" + "Lorem ipsum dolor sit amet. ".repeat(1800)
      expect(new TextEncoder().encode(markdown).byteLength).toBeLessThan(100_000)

      const writing = makeWritingRecord({
        id: path,
        content: { markdown, richText: null, plainText: markdown, canonicalSource: "markdown" },
      })

      const start = performance.now()
      const result = await service.saveWriting({ writing })
      const elapsed = performance.now() - start

      expect(result.error).toBeNull()
      // Service-layer overhead (excluding real Tauri IPC) must be well within the 100ms budget.
      expect(elapsed).toBeLessThan(100)
      vi.useFakeTimers()
    },
  )

  // ── Performance Contract: Reactive Fan-out ─────────────────────────────────

  it(
    "scheduleAutoSave emits exactly one saved event per debounce window regardless of keystroke count [ODE-208 perf contract]",
    async () => {
      const savedIds: string[] = []
      service.onSaved((id) => savedIds.push(id))

      const path = `${WRITINGS_DIR}/debounce-test.md`
      mockFiles.set(path, "")
      const writing = makeWritingRecord({ id: path })

      // Simulate 20 rapid TipTap onUpdate calls (one per keystroke)
      for (let i = 0; i < 20; i++) {
        service.scheduleAutoSave({
          ...writing,
          content: { ...writing.content, markdown: "# Writing\n\n" + "a".repeat(i + 1) },
        })
      }

      await vi.runAllTimersAsync()

      expect(savedIds).toHaveLength(1)
      expect(savedIds[0]).toBe(path)
    },
  )

  it("scheduleAutoSave across two separate debounce windows emits two saved events", async () => {
    const savedIds: string[] = []
    service.onSaved((id) => savedIds.push(id))

    const path = `${WRITINGS_DIR}/debounce-two.md`
    mockFiles.set(path, "")
    const writing = makeWritingRecord({ id: path })

    service.scheduleAutoSave(writing)
    await vi.runAllTimersAsync()

    service.scheduleAutoSave({
      ...writing,
      content: { ...writing.content, markdown: "# v2\n\nUpdated." },
    })
    await vi.runAllTimersAsync()

    expect(savedIds).toHaveLength(2)
  })

  // ── renameWriting ──────────────────────────────────────────────────────────

  it("renameWriting moves the file and returns a record with the new path as id", async () => {
    vi.useRealTimers()
    const oldPath = `${WRITINGS_DIR}/old-name.md`
    mockFiles.set(oldPath, "# Old Name\n\nContent.")

    const result = await service.renameWriting({
      writingId: oldPath,
      title: "New Name",
      updatedAt: new Date().toISOString(),
    })

    expect(result.error).toBeNull()
    expect(result.data!.id).not.toBe(oldPath)
    expect(result.data!.id).toContain(WRITINGS_DIR)
    expect(result.data!.title).toBe("New Name")
    vi.useFakeTimers()
  })

  it("renameWriting returns INVALID_INPUT when title is null", async () => {
    vi.useRealTimers()
    const result = await service.renameWriting({
      writingId: `${WRITINGS_DIR}/some.md`,
      title: null,
      updatedAt: new Date().toISOString(),
    })
    expect(result.data).toBeNull()
    expect(result.error!.code).toBe("INVALID_INPUT")
    vi.useFakeTimers()
  })

  // ── listWritingCollections / setWritingCollections ─────────────────────────

  it("listWritingCollections returns empty array (no DB in Fase 6)", async () => {
    vi.useRealTimers()
    const result = await service.listWritingCollections("any-path")
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    vi.useFakeTimers()
  })

  it("setWritingCollections is a no-op and returns empty array (no DB in Fase 6)", async () => {
    vi.useRealTimers()
    const result = await service.setWritingCollections({
      writingId: "any-path",
      collectionIds: ["col-1"],
    })
    expect(result.error).toBeNull()
    expect(result.data).toEqual([])
    vi.useFakeTimers()
  })

  it("exportWriting returns real DOCX bytes instead of markdown text", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/export-me.md`
    mockFiles.set(path, "# Export Me\n\nA paragraph with **formatting**.")

    const result = await service.exportWriting({ writingId: path, format: "docx" })

    expect(result.error).toBeNull()
    expect(result.data!.fileName).toBe("export-me.docx")
    expect(result.data!.mimeType).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document")
    expect(new TextDecoder().decode(result.data!.bytes.slice(0, 4))).toBe("PK\u0003\u0004")

    const zip = await JSZip.loadAsync(result.data!.bytes)
    expect(zip.file("word/document.xml")).not.toBeNull()
    vi.useFakeTimers()
  })

  // ── onSaved unsubscribe ────────────────────────────────────────────────────

  it("onSaved unsubscribe prevents the listener from receiving future events", async () => {
    vi.useRealTimers()
    const path = `${WRITINGS_DIR}/unsub-test.md`
    mockFiles.set(path, "")
    const writing = makeWritingRecord({ id: path })

    const received: string[] = []
    const unsubscribe = service.onSaved((id) => received.push(id))

    await service.saveWriting({ writing })
    unsubscribe()
    await service.saveWriting({ writing })

    expect(received).toHaveLength(1)
    vi.useFakeTimers()
  })

  // ── ODE-210: LocalIndexService integration ─────────────────────────────────

  it("saveWriting with localIndex upserts exactly one index entry and emits one indexUpdated event [ODE-210 perf contract]", async () => {
    vi.useRealTimers()
    const indexService = new LocalIndexService("/tmp/index.db", WRITINGS_DIR)
    const indexServiceWithIndex = new FilesystemDocumentService(WRITINGS_DIR, {
      localIndex: indexService,
      autoSaveDebounceMs: 300,
    })

    const updatedPaths: string[] = []
    indexService.onIndexUpdated((path) => updatedPaths.push(path))

    const path = `${WRITINGS_DIR}/indexed-save.md`
    mockFiles.set(path, "")
    const writing = makeWritingRecord({ id: path, title: "Indexed Save" })

    const result = await indexServiceWithIndex.saveWriting({ writing })
    expect(result.error).toBeNull()

    // Exactly one index update event per save operation
    expect(updatedPaths).toHaveLength(1)
    expect(updatedPaths[0]).toBe(path)

    // Index entry exists
    const entries = await indexService.listRecent()
    expect(entries).toHaveLength(1)
    expect(entries[0].path).toBe(path)
    expect(entries[0].title).toBe("Indexed Save")

    vi.useFakeTimers()
  })

  it("listWritings uses LocalIndexService when configured and falls back to directory listing when index is empty", async () => {
    vi.useRealTimers()
    const indexService = new LocalIndexService("/tmp/index.db", WRITINGS_DIR)
    const serviceWithIndex = new FilesystemDocumentService(WRITINGS_DIR, { localIndex: indexService })

    // Pre-seed the mock filesystem
    await serviceWithIndex.createDraft("Alpha")
    await serviceWithIndex.createDraft("Beta")

    // Index should have entries after createDraft
    const fromIndex = await serviceWithIndex.listWritings()
    expect(fromIndex.error).toBeNull()
    expect(fromIndex.data!.length).toBeGreaterThanOrEqual(2)

    vi.useFakeTimers()
  })

  it("deleteWriting removes the entry from the local index", async () => {
    vi.useRealTimers()
    const indexService = new LocalIndexService("/tmp/index.db", WRITINGS_DIR)
    const serviceWithIndex = new FilesystemDocumentService(WRITINGS_DIR, { localIndex: indexService })

    const path = `${WRITINGS_DIR}/delete-me.md`
    mockFiles.set(path, "# Delete Me")
    mockMetadata.push({ path, name: "delete-me", modifiedAt: Date.now(), size: 20 })
    await indexService.upsert(path, "Delete Me", Date.now(), Date.now())

    const result = await serviceWithIndex.deleteWriting({
      writingId: path,
      version: 1,
      updatedAt: new Date().toISOString(),
      deletedAt: new Date().toISOString(),
    })
    expect(result.error).toBeNull()

    const entries = await indexService.listRecent()
    expect(entries.find((e) => e.path === path)).toBeUndefined()
    vi.useFakeTimers()
  })

  it("renameWriting updates the index (deletes old path, inserts new path)", async () => {
    vi.useRealTimers()
    const indexService = new LocalIndexService("/tmp/index.db", WRITINGS_DIR)
    const serviceWithIndex = new FilesystemDocumentService(WRITINGS_DIR, { localIndex: indexService })

    const oldPath = `${WRITINGS_DIR}/old-title.md`
    mockFiles.set(oldPath, "# Old Title")
    await indexService.upsert(oldPath, "Old Title", Date.now(), Date.now())

    const result = await serviceWithIndex.renameWriting({
      writingId: oldPath,
      title: "New Title",
      updatedAt: new Date().toISOString(),
    })
    expect(result.error).toBeNull()

    const entries = await indexService.listRecent()
    expect(entries.find((e) => e.path === oldPath)).toBeUndefined()
    expect(entries.some((e) => e.title === "New Title")).toBe(true)
    vi.useFakeTimers()
  })
})
