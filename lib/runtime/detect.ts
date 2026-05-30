/**
 * Runtime detection helpers.
 *
 * Single source of truth for "is this code running inside the Tauri desktop shell
 * or inside a regular browser tab". Both helpers are client-safe: when evaluated
 * during SSR (`typeof window === "undefined"`), they return `false`.
 *
 * Tauri v2 injects `window.__TAURI_INTERNALS__` into the renderer at startup,
 * so its presence is the canonical client-side signal.
 */
export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined"

export const isWebRuntime = (): boolean =>
  typeof window !== "undefined" && !isTauriRuntime()
