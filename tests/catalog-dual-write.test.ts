import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ desktop: true, enabled: true, write: vi.fn(), metric: vi.fn() }))
vi.mock("@/lib/services/desktop/runtime-detection", () => ({ isDesktopRuntime: () => mocks.desktop }))
vi.mock("@/lib/services/desktop/catalog-feature-flag", () => ({ isDesktopCatalogDualWriteEnabled: () => mocks.enabled }))
vi.mock("@tauri-apps/api/path", () => ({ appConfigDir: vi.fn(async () => "/config"), join: vi.fn(async (...parts: string[]) => parts.join("/")) }))
vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class { constructor(readonly dbPath: string) {} commitDualWrite = mocks.write },
}))

const writing = {
  id: "doc-1", author_id: null, title: "Doc", canonical_path: "/tmp/Doc.md", body_json: {}, body_text: "",
  status: "draft" as const, artifact_type: "general" as const, visibility: "private" as const, version: 1,
  sync_status: "pending" as const, lifecycle: "local-only" as const, created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z", local_updated_at: 1,
}
const mutation = {
  id: "mutation-1", entity_kind: "writing" as const, entity_id: "doc-1", entity_key: "writing:doc-1",
  operation: "upsert" as const, payload: { body_json: {}, body_text: "", artifact_type: "general" as const, status: "draft" as const, visibility: "private" as const, version: 1, updated_at: "2026-01-01T00:00:00.000Z" },
  created_at: 1, attempts: 0,
}

describe("desktop catalog dual-write", () => {
  beforeEach(() => { vi.resetModules(); mocks.desktop = true; mocks.enabled = true; mocks.write.mockReset(); mocks.metric.mockReset() })
  it("is disabled without invoking SQLite", async () => {
    mocks.enabled = false
    const { scheduleDesktopCatalogDualWrite } = await import("@/lib/sync/catalog-dual-write")
    scheduleDesktopCatalogDualWrite(writing, mutation)
    await Promise.resolve()
    expect(mocks.write).not.toHaveBeenCalled()
  })
  it("returns immediately and reports a failed background write", async () => {
    mocks.write.mockRejectedValue(new Error("corrupt sqlite"))
    const module = await import("@/lib/sync/catalog-dual-write")
    module.subscribeToCatalogDualWriteMetrics(mocks.metric)
    module.scheduleDesktopCatalogDualWrite(writing, mutation)
    expect(mocks.write).not.toHaveBeenCalled()
    await vi.waitFor(() => expect(mocks.metric).toHaveBeenCalledWith(expect.objectContaining({ success: false, errorCode: "CATALOG_TRANSACTION_FAILED" })))
  })
})
