/**
 * Desktop runtime host guard (ODE-409).
 *
 * A distributable desktop artifact talks to the hosted web runtime for every
 * `/api/*` capability that cannot exist in a static export — transcription and
 * publication review among them. If `NEXT_PUBLIC_APP_URL` is baked in as
 * `http://localhost:3000`, the DMG installs fine and then fails at runtime on
 * every machine but the one that built it.
 *
 * The env var is checked before the build; this module additionally checks the
 * value that actually ended up *inside* the artifact, because those two can
 * diverge (stale `dist/`, a shell that lost the variable, a rebuilt frontend).
 *
 * The matching logic is pure; the filesystem walk is a thin wrapper over it so
 * both the release script and the bundle validator share one definition.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, relative } from "node:path"

/** Matches a bare local host origin. Tauri's own `ipc.localhost` /
 * `asset.localhost` / `tauri.localhost` are subdomains and never match. */
const LOCAL_HOST_ORIGIN = String.raw`https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d+)?`

export function isLocalRuntimeHost(value) {
  if (typeof value !== "string" || !value.trim()) return false
  return new RegExp(`^${LOCAL_HOST_ORIGIN}$`, "i").test(value.trim().replace(/\/+$/, ""))
}

/**
 * The Tauri CSP legitimately allow-lists `http://localhost:3000` for
 * `tauri dev`, and it is copied into the exported `index.html` as a meta tag.
 * That is configuration, not an embedded runtime target — strip it before
 * scanning HTML so it does not produce a false failure.
 */
export function stripCspMeta(html) {
  return html.replace(/<meta[^>]+http-equiv=["']?Content-Security-Policy["']?[^>]*>/gi, "")
}

/**
 * Find local-host references inside one asset's contents.
 * @returns {string[]} unique offending origins, in first-seen order
 */
export function findLocalRuntimeHosts(contents, { isHtml = false } = {}) {
  if (typeof contents !== "string" || !contents) return []
  const haystack = isHtml ? stripCspMeta(contents) : contents
  const matches = haystack.match(new RegExp(LOCAL_HOST_ORIGIN, "gi")) ?? []
  return [...new Set(matches.map((match) => match.toLowerCase()))]
}

export const RUNTIME_MANIFEST_FILENAME = "odessay-runtime.json"

/**
 * Evaluate the runtime host a desktop artifact will actually call.
 *
 * A blanket "no local origin anywhere" scan is not usable: dependencies ship
 * their own local defaults (gotrue-js embeds `http://localhost:9999`), so it
 * fails a perfectly good production bundle. The export writes a manifest naming
 * the host it inlined; this checks that value and then corroborates it by
 * finding the same literal in the shipped assets — so a stale manifest, or one
 * that disagrees with the bundle, is a failure rather than a rubber stamp.
 *
 * @param {{
 *   manifest: { appUrl?: string } | null,
 *   assets: Array<{ path: string, contents: string }>,
 *   allowLocalhost?: boolean,
 * }} input
 */
export function evaluateEmbeddedRuntimeHost({ manifest, assets, allowLocalhost = false }) {
  const scanned = assets?.length ?? 0

  if (!manifest || typeof manifest.appUrl !== "string" || !manifest.appUrl.trim()) {
    return { ok: false, reason: "missing-manifest", scanned, appUrl: null, carriers: [] }
  }

  const appUrl = manifest.appUrl.trim().replace(/\/+$/, "")
  const carriers = (assets ?? []).filter((asset) => asset.contents.includes(appUrl)).map((asset) => asset.path)

  if (carriers.length === 0) {
    return { ok: false, reason: "manifest-mismatch", scanned, appUrl, carriers }
  }

  if (isLocalRuntimeHost(appUrl)) {
    return { ok: Boolean(allowLocalhost), reason: "local-host", scanned, appUrl, carriers }
  }

  return { ok: true, reason: "remote-host", scanned, appUrl, carriers }
}

export const SCANNABLE_ASSET_EXTENSIONS = [".js", ".mjs", ".html"]

export function listFrontendAssetPaths(dir, collected = []) {
  if (!dir || !existsSync(dir)) return collected
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const entryPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      listFrontendAssetPaths(entryPath, collected)
    } else if (SCANNABLE_ASSET_EXTENSIONS.some((ext) => entry.name.toLowerCase().endsWith(ext))) {
      collected.push(entryPath)
    }
  }
  return collected
}

/**
 * Read the frontend assets of a desktop artifact from the first candidate
 * directory that actually contains any. Tauri copies `frontendDist` into
 * `<app>/Contents/Resources`; the local `dist/` static export is the fallback
 * when the artifact has not been packaged yet.
 *
 * @param {string[]} candidateDirs — in priority order
 */
export function collectFrontendAssets(candidateDirs) {
  for (const dir of candidateDirs) {
    const paths = listFrontendAssetPaths(dir)
    if (paths.length === 0) continue
    return {
      baseDir: dir,
      assets: paths.map((path) => ({
        path: relative(dir, path),
        contents: readFileSync(path, "utf8"),
      })),
    }
  }
  return { baseDir: null, assets: [] }
}

const REBUILD_HINT = `      Rebuild with: NEXT_PUBLIC_APP_URL=https://odessay.vercel.app npm run desktop:release:prod:signed`

/**
 * Read the manifest the static export wrote, from the first candidate directory
 * that has one. Returns `null` when no artifact declares its runtime host.
 */
export function readRuntimeManifest(candidateDirs) {
  for (const dir of candidateDirs) {
    if (!dir) continue
    const path = join(dir, RUNTIME_MANIFEST_FILENAME)
    if (!existsSync(path)) continue
    try {
      return { path, manifest: JSON.parse(readFileSync(path, "utf8")) }
    } catch {
      return { path, manifest: null }
    }
  }
  return { path: null, manifest: null }
}

/** Render a verdict as a build-log block with the fix inline. */
export function formatEmbeddedHostFailure(verdict) {
  if (verdict.reason === "missing-manifest") {
    return (
      `The artifact does not declare the runtime host it was built with ` +
      `(${RUNTIME_MANIFEST_FILENAME} missing or unreadable).\n` +
      `      Refusing to publish an artifact whose runtime host cannot be verified.\n${REBUILD_HINT}`
    )
  }

  if (verdict.reason === "manifest-mismatch") {
    return (
      `The declared runtime host (${verdict.appUrl}) does not appear in any of the ` +
      `${verdict.scanned} shipped asset(s) — the manifest and the bundle disagree.\n${REBUILD_HINT}`
    )
  }

  return (
    `The artifact embeds a local runtime host (${verdict.appUrl}) in ` +
    `${verdict.carriers.length} asset(s): ${verdict.carriers.slice(0, 3).join(", ")}${
      verdict.carriers.length > 3 ? ", …" : ""
    }\n      It will fail on every machine except the one that built it.\n${REBUILD_HINT}`
  )
}
