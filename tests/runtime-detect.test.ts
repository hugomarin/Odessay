import { afterEach, describe, expect, it } from "vitest"
import { isTauriRuntime, isWebRuntime } from "@/lib/runtime/detect"

type TauriWindow = typeof globalThis & { __TAURI_INTERNALS__?: unknown }

const cleanup = () => {
  const w = globalThis as TauriWindow
  delete w.__TAURI_INTERNALS__
  // @ts-expect-error allow stripping window for SSR-like assertion
  delete globalThis.window
}

describe("runtime detect helpers", () => {
  afterEach(() => {
    cleanup()
  })

  it("returns false for both helpers when running on the server (no window)", () => {
    expect(isTauriRuntime()).toBe(false)
    expect(isWebRuntime()).toBe(false)
  })

  it("returns isWebRuntime=true and isTauriRuntime=false in a plain browser window", () => {
    // @ts-expect-error simulate browser globalThis.window
    globalThis.window = globalThis
    expect(isTauriRuntime()).toBe(false)
    expect(isWebRuntime()).toBe(true)
  })

  it("returns isTauriRuntime=true when window.__TAURI_INTERNALS__ is present", () => {
    // @ts-expect-error simulate Tauri shell injection
    globalThis.window = globalThis
    ;(globalThis as TauriWindow).__TAURI_INTERNALS__ = { invoke: () => {} }
    expect(isTauriRuntime()).toBe(true)
    expect(isWebRuntime()).toBe(false)
  })
})
