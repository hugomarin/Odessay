/**
 * Desktop runtime detection.
 *
 * In Tauri v2, `window.__TAURI_INTERNALS__` is injected by the shell at runtime.
 * This is the most reliable client-side signal that we are running inside the
 * desktop application rather than a browser.
 */
export const isDesktopRuntime = (): boolean =>
  typeof window !== "undefined" &&
  typeof (window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__ !==
    "undefined"
