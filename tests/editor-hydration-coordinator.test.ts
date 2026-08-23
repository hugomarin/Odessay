/**
 * @contract ODE-455 — pure decision core of the desktop hydration path
 * (ODE-452/454 scope), extracted from editor-shell.tsx's main hydration
 * effect as a behavior-preserving refactor. Table-driven: each case exercises
 * one transition of `resolveHydrationOutcome` in isolation, with fake
 * dependencies standing in for the unified opener, DocumentService and the
 * local metadata store.
 */
import { describe, expect, it, vi } from "vitest"
import { resolveHydrationOutcome, type HydrationCoordinatorDeps } from "@/lib/editor/hydration-coordinator"
import type { OpenDocumentResult } from "@/lib/services/open-document"
import type { WritingRecord } from "@/lib/services/contracts/document-service"
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog"

function writing(overrides: Partial<WritingRecord> = {}): WritingRecord {
  return {
    id: "doc-1",
    authorId: null,
    title: "Doc",
    content: { richText: { type: "doc", content: [] }, markdown: null, plainText: "Doc", canonicalSource: "rich-text" },
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    parentId: null,
    correspondenceId: null,
    version: 1,
    deletedAt: null,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    contentUpdatedAt: "2026-01-01T00:00:00Z",
    metadataUpdatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  }
}

function catalogRecord(overrides: Partial<DocumentCatalogRecord> = {}): DocumentCatalogRecord {
  return {
    id: "doc-1",
    localPresent: true,
    cloudPresent: false,
    cloudAccountId: null,
    syncStatus: "pending",
    title: "Doc",
    slug: null,
    status: "draft",
    artifactType: "general",
    visibility: "private",
    version: 1,
    deletedAt: null,
    createdAt: 1,
    modifiedAt: 2,
    binding: null,
    ...overrides,
  } as DocumentCatalogRecord
}

function baseDeps(overrides: Partial<HydrationCoordinatorDeps> = {}): HydrationCoordinatorDeps {
  return {
    isDesktopRuntime: () => true,
    isUnifiedOpenEnabled: () => true,
    isCancelled: () => false,
    openDocumentByIdWithRetry: vi.fn(async () => ({
      result: { status: "opened", documentId: "doc-1", record: catalogRecord(), strategy: "existing" } as OpenDocumentResult,
      attempt: 1,
    })),
    openWriting: vi.fn(async () => ({ error: null, data: writing() })),
    getLocalWriting: vi.fn(async () => null),
    ...overrides,
  }
}

describe("resolveHydrationOutcome — ODE-455 table tests", () => {
  it("web/non-desktop runtime skips the unified opener entirely and hydrates from the document service", async () => {
    const openDocumentByIdWithRetry = vi.fn()
    const deps = baseDeps({ isDesktopRuntime: () => false, openDocumentByIdWithRetry })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(openDocumentByIdWithRetry).not.toHaveBeenCalled()
    expect(outcome.status).toBe("hydrated")
  })

  it("unified-open disabled (flag off) skips the opener even on desktop", async () => {
    const openDocumentByIdWithRetry = vi.fn()
    const deps = baseDeps({ isUnifiedOpenEnabled: () => false, openDocumentByIdWithRetry })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(openDocumentByIdWithRetry).not.toHaveBeenCalled()
    expect(outcome.status).toBe("hydrated")
  })

  it("opened outcome carries the catalog record into the hydrated record's canonicalPath", async () => {
    const deps = baseDeps({
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: {
          status: "opened",
          documentId: "doc-1",
          record: catalogRecord({ binding: { canonicalPath: "/docs/doc-1.md" } as never }),
          strategy: "existing",
        } as OpenDocumentResult,
        attempt: 1,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("hydrated")
    if (outcome.status === "hydrated") {
      expect(outcome.record.canonicalPath).toBe("/docs/doc-1.md")
    }
  })

  it("conflict outcome still proceeds to hydrate the local copy (ODE-373 owns conflict UX)", async () => {
    const deps = baseDeps({
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: { status: "conflict", documentId: "doc-1", record: catalogRecord() } as OpenDocumentResult,
        attempt: 1,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("hydrated")
  })

  it("orphaned outcome resolves as unavailable, sourced from the unified opener, without calling openWriting", async () => {
    const openWriting = vi.fn()
    const deps = baseDeps({
      openWriting,
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: { status: "orphaned", id: "doc-1" } as OpenDocumentResult,
        attempt: 1,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome).toEqual({ status: "unavailable", source: "unified-open", openStatus: "orphaned", reasonCode: "orphaned", attempt: 1 })
    expect(openWriting).not.toHaveBeenCalled()
  })

  it("terminal failed (retryable: false) resolves as unavailable with its reasonCode", async () => {
    const deps = baseDeps({
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: { status: "failed", reason: "boom", reasonCode: "file-unreadable", retryable: false } as OpenDocumentResult,
        attempt: 1,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome).toEqual({
      status: "unavailable",
      source: "unified-open",
      openStatus: "failed",
      reasonCode: "file-unreadable",
      attempt: 1,
    })
  })

  it("retry-exhausted failed (attempt > 1) resolves as unavailable and surfaces the final attempt count", async () => {
    const deps = baseDeps({
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: { status: "failed", reason: "still locked", reasonCode: "catalog-unavailable", retryable: true } as OpenDocumentResult,
        attempt: 4,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome).toMatchObject({ status: "unavailable", source: "unified-open", attempt: 4 })
  })

  it("retryable failure that recovers on a later attempt (rearm) hydrates normally — retry itself is the opener's concern, not the coordinator's", async () => {
    // openDocumentByIdWithRetry already owns the rearm loop (ODE-454); the
    // coordinator only ever sees its final outcome, so a recovered retry is
    // indistinguishable here from a first-try success.
    const deps = baseDeps({
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: { status: "opened", documentId: "doc-1", record: catalogRecord(), strategy: "existing" } as OpenDocumentResult,
        attempt: 3,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("hydrated")
  })

  it("cancelled immediately after the unified-open call short-circuits before classifying the outcome", async () => {
    let cancelled = false
    const openWriting = vi.fn()
    const deps = baseDeps({
      isCancelled: () => cancelled,
      openWriting,
      openDocumentByIdWithRetry: vi.fn(async () => {
        cancelled = true // e.g. the user switched documents mid-open
        return { result: { status: "orphaned", id: "doc-1" } as OpenDocumentResult, attempt: 1 }
      }),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome).toEqual({ status: "cancelled" })
    expect(openWriting).not.toHaveBeenCalled()
  })

  it("A→B: a genuinely concurrent switch cancels A and resolves B with B's own identity", async () => {
    // Real editor-shell interleaving: the user switches documents while A's
    // unified-open call is still in flight. A's own async work does not
    // finish and unblock until *after* B has already started resolving —
    // both calls are live at once, not sequential await-then-await.
    let cancelledForA = false
    const releaseBox: { release: (() => void) | null } = { release: null }

    const depsForA = baseDeps({
      isCancelled: () => cancelledForA,
      openDocumentByIdWithRetry: vi.fn(
        () =>
          new Promise<{ result: OpenDocumentResult; attempt: number }>((resolve) => {
            releaseBox.release = () =>
              resolve({
                result: {
                  status: "opened",
                  documentId: "doc-a",
                  record: catalogRecord({ id: "doc-a" }),
                  strategy: "existing",
                },
                attempt: 1,
              })
          }),
      ),
    })

    const depsForB = baseDeps({
      openWriting: vi.fn(async () => ({ error: null, data: writing({ id: "doc-b", title: "Doc B" }) })),
      openDocumentByIdWithRetry: vi.fn(async () => ({
        result: {
          status: "opened",
          documentId: "doc-b",
          record: catalogRecord({ id: "doc-b" }),
          strategy: "existing",
        } as OpenDocumentResult,
        attempt: 1,
      })),
    })

    const outcomeForAPromise = resolveHydrationOutcome("doc-a", depsForA)

    // The switch: editor-shell's effect cleanup flips `cancelled` for the
    // stale target as soon as `hydrationWritingId` changes to "doc-b", then
    // a new effect run starts resolving B — both are now in flight together.
    cancelledForA = true
    const outcomeForBPromise = resolveHydrationOutcome("doc-b", depsForB)

    // Only now does A's hung open call resolve — A finishes *after* B started.
    releaseBox.release?.()

    const [outcomeForA, outcomeForB] = await Promise.all([outcomeForAPromise, outcomeForBPromise])

    expect(outcomeForA).toEqual({ status: "cancelled" })
    expect(outcomeForB.status).toBe("hydrated")
    if (outcomeForB.status === "hydrated") {
      expect(outcomeForB.record.writing.id).toBe("doc-b")
      expect(outcomeForB.record.writing.title).toBe("Doc B")
    }
  })

  it("NOT_FOUND from the document service resolves as unavailable without going through the unified-open log path", async () => {
    const deps = baseDeps({
      openWriting: vi.fn(async () => ({ error: { code: "NOT_FOUND", message: "gone", retryable: false }, data: null })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome).toEqual({ status: "unavailable", source: "not-found" })
  })

  it("a non-NOT_FOUND document-service error resolves as open-error, preserving the pre-existing silent-failure asymmetry", async () => {
    const deps = baseDeps({
      openWriting: vi.fn(async () => ({ error: { code: "UNAVAILABLE", message: "db down", retryable: true }, data: null })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("open-error")
  })

  it("a thrown exception anywhere in the flow resolves as open-error, matching the original single catch block", async () => {
    const deps = baseDeps({
      openWriting: vi.fn(async () => {
        throw new Error("network down")
      }),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("open-error")
    if (outcome.status === "open-error") {
      expect(outcome.error).toBeInstanceOf(Error)
    }
  })

  it("when the unified-open branch is skipped (web), a cancellation flag does not gate the document-service call — matches original: the only pre-openWriting cancellation check lived inside the unified-open branch", async () => {
    // The pre-refactor effect had exactly one `if (cancelled) return` between
    // the unified-open branch and openWriting, and it only existed *inside*
    // that branch. On web (or with the branch skipped), nothing checked
    // `cancelled` before calling openWriting — only the caller's post-hoc
    // check after the whole resolution gates applying the result. Preserve
    // that asymmetry exactly; do not add a check that wasn't there before.
    const openWriting = vi.fn(async () => ({ error: null, data: writing() }))
    const deps = baseDeps({ isDesktopRuntime: () => false, isCancelled: () => true, openWriting })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(openWriting).toHaveBeenCalledTimes(1)
    expect(outcome.status).toBe("hydrated")
  })

  it("local metadata fallback feeds canonicalPath/lifecycle when no catalog record is present (web runtime)", async () => {
    const deps = baseDeps({
      isDesktopRuntime: () => false,
      getLocalWriting: vi.fn(async () => ({
        canonicalPath: "/local/doc-1.md",
        lifecycle: "server-confirmed" as const,
        syncStatus: "synced" as const,
      })),
    })

    const outcome = await resolveHydrationOutcome("doc-1", deps)

    expect(outcome.status).toBe("hydrated")
    if (outcome.status === "hydrated") {
      expect(outcome.record.canonicalPath).toBe("/local/doc-1.md")
      expect(outcome.record.lifecycle).toBe("server-confirmed")
    }
  })
})
