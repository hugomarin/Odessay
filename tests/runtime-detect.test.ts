import { afterEach, describe, expect, it, vi } from "vitest"

type TauriWindow = typeof globalThis & { __TAURI_INTERNALS__?: unknown }

const cleanup = () => {
  const w = globalThis as TauriWindow
  delete w.__TAURI_INTERNALS__
  // @ts-expect-error allow stripping window for SSR-like assertion
  delete globalThis.window
  vi.unstubAllEnvs()
  vi.resetModules()
}

describe("runtime detect helpers", () => {
  afterEach(() => {
    cleanup()
  })

  it("returns false for both helpers when running on the server (no window)", async () => {
    const { isTauriRuntime, isWebRuntime } = await import("@/lib/runtime/detect")
    expect(isTauriRuntime()).toBe(false)
    expect(isWebRuntime()).toBe(false)
  })

  it("returns isWebRuntime=true and isTauriRuntime=false in a plain browser window", async () => {
    // @ts-expect-error simulate browser globalThis.window
    globalThis.window = globalThis
    const { isTauriRuntime, isWebRuntime } = await import("@/lib/runtime/detect")
    expect(isTauriRuntime()).toBe(false)
    expect(isWebRuntime()).toBe(true)
  })

  it("returns isTauriRuntime=true when window.__TAURI_INTERNALS__ is present", async () => {
    // @ts-expect-error simulate Tauri shell injection
    globalThis.window = globalThis
    ;(globalThis as TauriWindow).__TAURI_INTERNALS__ = { invoke: () => {} }
    const { isTauriRuntime, isWebRuntime } = await import("@/lib/runtime/detect")
    expect(isTauriRuntime()).toBe(true)
    expect(isWebRuntime()).toBe(false)
  })

  it("returns isTauriRuntime=true in a TAURI_BUILD client bundle without injected internals", async () => {
    vi.stubEnv("TAURI_BUILD", "true")
    vi.resetModules()
    // @ts-expect-error simulate browser globalThis.window
    globalThis.window = globalThis
    const { isTauriRuntime, isWebRuntime } = await import("@/lib/runtime/detect")
    expect(isTauriRuntime()).toBe(true)
    expect(isWebRuntime()).toBe(false)
  })
})
