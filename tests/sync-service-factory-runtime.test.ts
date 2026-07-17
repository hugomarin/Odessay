import { afterEach, describe, expect, it, vi } from "vitest"

vi.mock("@/lib/services/web-sync-service", () => ({
  webSyncService: { runtime: "web" },
}))

vi.mock("@/lib/sync/desktop-catalog-sync-service", () => ({
  desktopCatalogSyncService: { runtime: "desktop" },
}))

type TauriWindow = typeof globalThis & { __TAURI_INTERNALS__?: unknown }

const cleanup = () => {
  const w = globalThis as TauriWindow
  delete w.__TAURI_INTERNALS__
  // @ts-expect-error allow stripping window for SSR-like assertion
  delete globalThis.window
  vi.unstubAllEnvs()
  vi.resetModules()
}

describe("getSyncService", () => {
  afterEach(() => {
    cleanup()
  })

  it("selects the desktop sync adapter in a NEXT_PUBLIC_TAURI_BUILD client bundle", async () => {
    vi.stubEnv("NEXT_PUBLIC_TAURI_BUILD", "true")
    vi.resetModules()
    // @ts-expect-error simulate browser globalThis.window
    globalThis.window = globalThis

    const { getSyncService } = await import("@/lib/sync/sync-service-factory")

    expect(getSyncService()).toEqual({ runtime: "desktop" })
  })

  it("selects the web sync adapter in a plain browser bundle", async () => {
    // @ts-expect-error simulate browser globalThis.window
    globalThis.window = globalThis

    const { getSyncService } = await import("@/lib/sync/sync-service-factory")

    expect(getSyncService()).toEqual({ runtime: "web" })
  })
})
