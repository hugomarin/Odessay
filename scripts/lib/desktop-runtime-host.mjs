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

/**
 * Evaluate every scanned asset of a desktop artifact.
 *
 * @param {{ assets: Array<{ path: string, contents: string }>, allowLocalhost?: boolean }} input
 * @returns {{ ok: boolean, scanned: number, offenders: Array<{ path: string, hosts: string[] }> }}
 */
export function evaluateEmbeddedRuntimeHost({ assets, allowLocalhost = false }) {
  const offenders = []

  for (const asset of assets ?? []) {
    const hosts = findLocalRuntimeHosts(asset.contents, {
      isHtml: asset.path.toLowerCase().endsWith(".html"),
    })
    if (hosts.length > 0) {
      offenders.push({ path: asset.path, hosts })
    }
  }

  return {
    ok: allowLocalhost || offenders.length === 0,
    scanned: assets?.length ?? 0,
    offenders,
  }
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

/**
 * Render an offender list as a build-log block with the fix inline.
 */
export function formatEmbeddedHostFailure(offenders) {
  const report = offenders.map((offender) => `      ${offender.path} → ${offender.hosts.join(", ")}`).join("\n")
  return (
    `Embedded runtime host points at localhost in ${offenders.length} asset(s):\n${report}\n` +
    `      Rebuild with: NEXT_PUBLIC_APP_URL=https://odessay.vercel.app npm run desktop:release:prod:signed`
  )
}
