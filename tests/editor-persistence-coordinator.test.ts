import { describe, expect, it, vi } from "vitest"

import {
  createPersistenceCoordinator,
  type PersistenceSnapshot,
} from "@/lib/editor/persistence-coordinator"
import type { WritingRecord } from "@/lib/services/contracts/document-service"

const baseRecord = (id: string, version = 2): WritingRecord => ({
  id,
  authorId: null,
  title: "Draft",
  content: {
    richText: { type: "doc", content: [] },
    markdown: null,
    plainText: "Draft",
    canonicalSource: "rich-text",
  },
  slug: null,
  status: "draft",
  artifactType: "general",
  visibility: "private",
  parentId: null,
  correspondenceId: null,
  version,
  deletedAt: null,
  createdAt: "2026-08-27T00:00:00.000Z",
  updatedAt: "2026-08-27T00:00:01.000Z",
  contentUpdatedAt: "2026-08-27T00:00:01.000Z",
  metadataUpdatedAt: "2026-08-27T00:00:01.000Z",
  lifecycle: "local-only",
})

const snapshot = (overrides: Partial<PersistenceSnapshot> = {}): PersistenceSnapshot => ({
  writingId: "writing-1",
  createdAt: "2026-08-27T00:00:00.000Z",
  version: 1,
  title: "Draft",
  bodyJson: { type: "doc", content: [] },
  bodyText: "Draft",
  status: "draft",
  artifactType: "general",
  visibility: "private",
  lifecycle: "local-only",
  ...overrides,
})

function response(data: WritingRecord) {
  return { data, error: null as null }
}

describe("editor persistence coordinator", () => {
  it("coalesces rapid local writes inside the configured quiet window", async () => {
    vi.useFakeTimers()

    try {
      const saveWriting = vi.fn(async (input: { writing: WritingRecord }) => response(input.writing))
      const states: string[] = []
      const coordinator = createPersistenceCoordinator(
        {
          runtime: "desktop",
          persistenceDebounceMs: 120,
          documentService: { saveWriting },
          createWritingId: () => "unused",
          now: () => "2026-08-27T00:00:02.000Z",
        },
        { onStateChange: ({ state }) => states.push(state) },
      )

      const first = coordinator.persist(snapshot({ bodyText: "first" }))
      const latest = coordinator.persist(snapshot({ bodyText: "latest" }))

      expect(saveWriting).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(119)
      expect(saveWriting).not.toHaveBeenCalled()

      await vi.advanceTimersByTimeAsync(1)
      await expect(first).resolves.toBe(true)
      await expect(latest).resolves.toBe(true)

      expect(saveWriting).toHaveBeenCalledTimes(1)
      expect(saveWriting.mock.calls[0]?.[0].writing.content.plainText).toBe("latest")
      expect(states).toEqual(["persisting_local", "queued_remote"])
    } finally {
      vi.useRealTimers()
    }
  })

  it("flushes a pending desktop snapshot before document cancellation", async () => {
    vi.useFakeTimers()

    try {
      const saveWriting = vi.fn(async (input: { writing: WritingRecord }) => response(input.writing))
      const coordinator = createPersistenceCoordinator({
        runtime: "desktop",
        persistenceDebounceMs: 120,
        documentService: { saveWriting },
        createWritingId: () => "unused",
        now: () => "2026-08-27T00:00:02.000Z",
      })

      const result = coordinator.persist(snapshot({ bodyText: "last offline edit" }))
      coordinator.cancel()

      expect(saveWriting).toHaveBeenCalledTimes(1)
      expect(saveWriting.mock.calls[0]?.[0].writing.content.plainText).toBe("last offline edit")
      await expect(result).resolves.toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })

  it("keeps one local write in flight and persists only the latest queued snapshot", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    const saveWriting = vi.fn((input: { writing: WritingRecord }) => {
      if (saveWriting.mock.calls.length === 1) {
        return new Promise<{ data: WritingRecord; error: null }>((resolve) => {
          deferred.resolve = () => resolve(response(input.writing))
        })
      }
      return Promise.resolve(response(input.writing))
    })
    const committed: string[] = []
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: { saveWriting },
        createWritingId: () => "generated",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      { onCommitted: ({ record }) => committed.push(record.content.plainText) },
    )

    void coordinator.persist(snapshot({ bodyText: "second" }))
    await coordinator.persist(snapshot({ bodyText: "third" }))

    expect(saveWriting).toHaveBeenCalledTimes(1)
    deferred.resolve?.()

    await vi.waitFor(() => expect(saveWriting).toHaveBeenCalledTimes(2))
    expect(saveWriting.mock.calls[1]?.[0].writing.content.plainText).toBe("third")
    expect(saveWriting.mock.calls[1]?.[0].writing.version).toBe(3)
    expect(committed).toEqual(["second", "third"])
  })

  it("materializes a desktop draft once and applies a queued update to its UUID", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    const createDesktopDraft = vi.fn(() => new Promise<{ data: WritingRecord; error: null }>((resolve) => {
      deferred.resolve = () => resolve(response(baseRecord("materialized", 1)))
    }))
    const saveWriting = vi.fn(async (input: { writing: WritingRecord }) => response(input.writing))
    const materialized = vi.fn()
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: { saveWriting },
        createDesktopDraft,
        createWritingId: () => "ephemeral",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      { onMaterialized: materialized },
    )

    void coordinator.persist(snapshot({ writingId: null, bodyText: "first", draftWritingId: "ephemeral" }))
    void coordinator.persist(snapshot({ writingId: null, bodyText: "latest", draftWritingId: "ephemeral" }))
    expect(createDesktopDraft).toHaveBeenCalledTimes(1)
    expect(saveWriting).not.toHaveBeenCalled()

    deferred.resolve?.()

    await vi.waitFor(() => expect(saveWriting).toHaveBeenCalledTimes(1))
    expect(materialized).toHaveBeenCalledTimes(1)
    expect(saveWriting.mock.calls[0]?.[0].writing.id).toBe("materialized")
    expect(saveWriting.mock.calls[0]?.[0].writing.content.plainText).toBe("latest")
    expect(saveWriting.mock.calls[0]?.[0].writing.version).toBe(2)
  })

  it("does not create a contentless desktop draft", async () => {
    const createDesktopDraft = vi.fn()
    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      documentService: { saveWriting: vi.fn() },
      createDesktopDraft,
      createWritingId: () => "unused",
      now: () => "2026-08-27T00:00:02.000Z",
    })

    await coordinator.persist(snapshot({ writingId: null, bodyText: "   " }))

    expect(createDesktopDraft).not.toHaveBeenCalled()
  })

  it("schedules only after a successful local commit when the adapter owns scheduling", async () => {
    const order: string[] = []
    const saveWriting = vi.fn(async (input: { writing: WritingRecord }) => {
      order.push("local")
      return response(input.writing)
    })
    const scheduleFlush = vi.fn(async () => {
      order.push("schedule")
      return { data: undefined, error: null as null }
    })
    const committed = vi.fn()
    const coordinator = createPersistenceCoordinator({
      runtime: "desktop",
      documentService: { saveWriting },
      syncService: { scheduleFlush },
      createWritingId: () => "unused",
      now: () => "2026-08-27T00:00:02.000Z",
    }, { onCommitted: committed })

    await coordinator.persist(snapshot())

    expect(order).toEqual(["local", "schedule"])
    expect(scheduleFlush).toHaveBeenCalledTimes(1)
    expect(committed.mock.calls[0]?.[0].diagnostics).toMatchObject({ operation: "save", payloadBytes: 5 })
  })

  it("reports a local failure without scheduling or claiming the snapshot was committed", async () => {
    const scheduleFlush = vi.fn(async () => ({ data: undefined, error: null as null }))
    const onError = vi.fn()
    const onCommitted = vi.fn()
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: {
          saveWriting: vi.fn(async () => ({
            data: null,
            error: { code: "DB_ERROR", message: "locked", retryable: true },
          })),
        },
        syncService: { scheduleFlush },
        createWritingId: () => "unused",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      { onError, onCommitted },
    )

    expect(await coordinator.persist(snapshot())).toBe(false)
    expect(scheduleFlush).not.toHaveBeenCalled()
    expect(onCommitted).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      operation: "save",
      error: expect.objectContaining({ code: "DB_ERROR" }),
    }))
  })

  it("suppresses stale completion callbacks after document cancellation", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    const saveWriting = vi.fn(() => new Promise<{ data: WritingRecord; error: null }>((resolve) => {
      deferred.resolve = () => resolve(response(baseRecord("writing-1")))
    }))
    const committed = vi.fn()
    const states: string[] = []
    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: { saveWriting },
        createWritingId: () => "unused",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      {
        onCommitted: committed,
        onStateChange: ({ state }) => states.push(state),
      },
    )

    const result = coordinator.persist(snapshot({ bodyText: "stale" }))
    coordinator.cancel()
    deferred.resolve?.()

    expect(await result).toBe(false)
    expect(committed).not.toHaveBeenCalled()
    expect(states).toEqual(["persisting_local"])
  })

  // ODE-478 case 1: an edit typed while a save is already in flight used to be
  // discarded outright if the author switched documents before that save
  // finished — `queued` was nulled on the switch, and even when it survived,
  // the drained continuation was filtered by the generation it could never
  // match again. Both of those were the actual bug; this reproduces the
  // realistic shape (a save that takes real time to complete, not an instant
  // mock) so the regression can't hide behind a synchronous save the way it
  // did in the pre-fix suite.
  it("still writes a queued edit to disk after switching documents mid-save", async () => {
    const savedBodies: string[] = []
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    const saveWriting = vi.fn((input: { writing: WritingRecord }) => {
      savedBodies.push(input.writing.content.plainText)
      if (savedBodies.length === 1) {
        return new Promise<{ data: WritingRecord; error: null }>((resolve) => {
          deferred.resolve = () => resolve(response(baseRecord("writing-1")))
        })
      }
      return Promise.resolve(response(baseRecord("writing-1")))
    })

    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: { saveWriting },
        createWritingId: () => "unused",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      {},
    )

    // First edit starts saving and stalls mid-flight, like a real fs write.
    const firstSave = coordinator.persist(snapshot({ writingId: "writing-1", bodyText: "primero" }))
    // A second edit to the same document arrives while that save is in flight.
    void coordinator.persist(snapshot({ writingId: "writing-1", bodyText: "segundo" }))
    // The author switches to a different document before the first save resolves.
    coordinator.activateDocument("writing-2")

    deferred.resolve?.()
    await firstSave

    await vi.waitFor(() => expect(savedBodies).toEqual(["primero", "segundo"]))
  })

  it("does not let a stale mid-flight save corrupt the document switched to", async () => {
    const deferred: { resolve: (() => void) | null } = { resolve: null }
    const saveWriting = vi.fn(() => new Promise<{ data: WritingRecord; error: null }>((resolve) => {
      deferred.resolve = () => resolve(response(baseRecord("writing-1", 5)))
    }))
    const committedIds: string[] = []

    const coordinator = createPersistenceCoordinator(
      {
        runtime: "desktop",
        documentService: { saveWriting },
        createWritingId: () => "unused",
        now: () => "2026-08-27T00:00:02.000Z",
      },
      { onCommitted: ({ record }) => committedIds.push(record.id) },
    )

    const firstSave = coordinator.persist(snapshot({ writingId: "writing-1", bodyText: "old doc" }))
    coordinator.activateDocument("writing-2")
    void coordinator.persist(snapshot({ writingId: "writing-2", bodyText: "new doc", version: 1 }))

    deferred.resolve?.()
    await firstSave

    // The stale completion for writing-1 must never fire onCommitted (it
    // would otherwise overwrite the now-active writing-2's displayed
    // version/createdAt with writing-1's).
    expect(committedIds).not.toContain("writing-1")
  })
})
