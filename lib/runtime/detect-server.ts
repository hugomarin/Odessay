/**
 * Server-safe runtime detection helper.
 *
 * Returns true when Next.js is serving the Tauri desktop shell, both during
 * `tauri dev` (TAURI_ENV=true) and `tauri build` (TAURI_BUILD=true).
 *
 * Do NOT use this in client components; use `isTauriRuntime()` from
 * `lib/runtime/detect.ts` instead. Do NOT use this in `next.config.ts`, where
 * only `TAURI_BUILD` should trigger the static export.
 */
export const isTauriRuntimeServer = (): boolean =>
  process.env.TAURI_BUILD === "true" || process.env.TAURI_ENV === "true"
