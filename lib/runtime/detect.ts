/**
 * Runtime detection helpers.
 *
 * Single source of truth for "is this code running inside the Tauri desktop shell
 * or inside a regular browser tab". Both helpers are client-safe: when evaluated
 * during SSR (`typeof window === "undefined"`), they return `false`.
 *
 * Tauri v2 injects `window.__TAURI_INTERNALS__` into the renderer at startup.
 * The bundled DMG also sets TAURI_BUILD=true at compile time, which is the
 * stable fallback for runtime adapter selection when the injected global is not
 * visible yet.
 */
const isTauriBuild = process.env.TAURI_BUILD === "true"

export const isTauriRuntime = (): boolean =>
  typeof window !== "undefined" &&
  (isTauriBuild ||
    typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
      "undefined")

export const isWebRuntime = (): boolean =>
  typeof window !== "undefined" && !isTauriRuntime()
