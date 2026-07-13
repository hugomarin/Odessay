import { afterEach, describe, expect, it, vi } from "vitest"

const mocks = vi.hoisted(() => ({ desktop: false, enabled: false, appConfigDir: vi.fn(async () => "/config") }))

vi.mock("@/lib/services/desktop/runtime-detection", () => ({ isDesktopRuntime: () => mocks.desktop }))
vi.mock("@/lib/services/desktop/indexeddb-migration-flag", () => ({
  isDesktopIndexedDbMigrationEnabled: () => mocks.enabled,
}))
vi.mock("@tauri-apps/api/path", () => ({
  appConfigDir: mocks.appConfigDir,
  join: vi.fn(async (...parts: string[]) => parts.join("/")),
}))

afterEach(() => {
  vi.resetModules()
  mocks.desktop = false
  mocks.enabled = false
  mocks.appConfigDir.mockClear()
})

describe("ODE-376 · ensureDesktopCatalogMigrated startup gate", () => {
  it("is a no-op on the web runtime (never resolves a desktop path)", async () => {
    mocks.desktop = false
    mocks.enabled = true
    const { ensureDesktopCatalogMigrated } = await import("@/lib/migrations/desktop-catalog-migration")
    await ensureDesktopCatalogMigrated()
    expect(mocks.appConfigDir).not.toHaveBeenCalled()
  })

  it("is a no-op on desktop when the cutover flag is off", async () => {
    mocks.desktop = true
    mocks.enabled = false
    const { ensureDesktopCatalogMigrated } = await import("@/lib/migrations/desktop-catalog-migration")
    await ensureDesktopCatalogMigrated()
    expect(mocks.appConfigDir).not.toHaveBeenCalled()
  })

  it("resolves the desktop catalog path when desktop + flag are on", async () => {
    mocks.desktop = true
    mocks.enabled = true
    const { ensureDesktopCatalogMigrated } = await import("@/lib/migrations/desktop-catalog-migration")
    // The migration itself will fail fast (no real Tauri catalog command), but the
    // gate must have opened and attempted to resolve the config dir. The failure is
    // swallowed so bootstrap is never blocked.
    await expect(ensureDesktopCatalogMigrated()).resolves.toBeUndefined()
    expect(mocks.appConfigDir).toHaveBeenCalled()
  })
})
