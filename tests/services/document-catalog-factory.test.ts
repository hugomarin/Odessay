import { beforeEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ desktop: false, join: vi.fn() }))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({ isDesktopRuntime: () => mocks.desktop }))
vi.mock("@tauri-apps/api/path", () => ({ appConfigDir: vi.fn(async () => "/config"), join: mocks.join }))
vi.mock("@/lib/services/web-document-catalog", () => ({ webDocumentCatalog: { runtime: "web" } }))
vi.mock("@/lib/services/desktop/sqlite-document-catalog", () => ({
  SqliteDocumentCatalog: class { runtime = "desktop"; constructor(readonly dbPath: string) {} },
}))

describe("document-catalog-factory", () => {
  beforeEach(() => { vi.resetModules(); mocks.desktop = false; mocks.join.mockReset().mockResolvedValue("/config/desktop-index.sqlite3") })
  it("keeps web on the IndexedDB adapter", async () => {
    const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
    expect(await getDocumentCatalog()).toMatchObject({ runtime: "web" })
  })
  it("selects the global SQLite adapter for desktop", async () => {
    mocks.desktop = true
    const { getDocumentCatalog } = await import("@/lib/services/document-catalog-factory")
    expect(await getDocumentCatalog()).toMatchObject({ runtime: "desktop", dbPath: "/config/desktop-index.sqlite3" })
  })
})
