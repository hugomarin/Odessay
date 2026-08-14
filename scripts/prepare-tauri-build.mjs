#!/usr/bin/env node
/**
 * Prepare the Next.js app for Tauri static export.
 *
 * Next.js `output: 'export'` does not support API / Route handlers or
 * directories with dynamic-only pages. This script temporarily moves those
 * out of the app/ tree so the static build succeeds, then restores them.
 *
 * Usage:
 *   node scripts/prepare-tauri-build.mjs
 *
 * All architectural files (layout, supabase/server, write pages, login-form)
 * are natively runtime-aware via TAURI_BUILD env flag — no patching required.
 * See ODE-215 (layout) and ODE-216 (remaining files).
 */
import { execSync } from "node:child_process"
import globPkg from "glob"
import { renameSync, existsSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import nextEnv from "@next/env" // CJS: no named exports over ESM
import {
  RUNTIME_MANIFEST_FILENAME,
  collectFrontendAssets,
  evaluateEmbeddedRuntimeHost,
  formatBuildRuntimeHostFailure,
  formatEmbeddedHostFailure,
  resolveBuildRuntimeHost,
} from "./lib/desktop-runtime-host.mjs"

const { sync } = globPkg
const root = process.cwd()
const disabledSuffix = ".route-disabled"
const allowLocalhost =
  process.argv.includes("--allow-localhost") || process.env.DESKTOP_ALLOW_LOCAL_RUNTIME === "1"

/**
 * Resolve the runtime host *before* building, exactly as Next.js would, and
 * refuse to export against a local one (ODE-409 follow-up). Every desktop build
 * path funnels through this script — `beforeBuildCommand` in tauri.conf.json —
 * so this is the only place that can guarantee no artifact is ever produced
 * with a dev host inlined, including a bare `npm run tauri:build` that skips
 * the release script's own gates.
 */
function resolveRuntimeHost() {
  const shellValue = process.env.NEXT_PUBLIC_APP_URL
  const silentLogger = { info: () => {}, error: () => {}, warn: () => {} }
  nextEnv.loadEnvConfig(root, false, silentLogger)
  const dotenvValue = process.env.NEXT_PUBLIC_APP_URL

  const verdict = resolveBuildRuntimeHost({ shellValue, dotenvValue, allowLocalhost })
  if (!verdict.ok) {
    console.error(`[tauri-build] INVALID RUNTIME HOST\n  ${formatBuildRuntimeHostFailure(verdict)}`)
    process.exit(1)
  }
  if (verdict.reason === "local-host") {
    console.log(
      `[tauri-build] WARNING: exporting against ${verdict.appUrl} (--allow-localhost). Do not distribute this build.`
    )
  }
  return verdict.appUrl
}

// Directories inside app/ to temporarily exclude from static export.
// They are moved outside app/ because Next.js scans all subdirectories.
const dirsToExclude = [
  { inside: "app/(reading)", outside: ".excluded-app-reading" },
  { inside: "app/(public)", outside: ".excluded-app-public" },
  { inside: "app/[username]", outside: ".excluded-app-username" },
  { inside: "app/perf", outside: ".excluded-app-perf" },
]

function disableRouteHandlers() {
  const routes = sync("app/**/route.ts", { cwd: root })
  for (const route of routes) {
    const original = join(root, route)
    const disabled = original + disabledSuffix
    renameSync(original, disabled)
  }
  if (routes.length > 0) {
    console.log(`[tauri-build] Disabled ${routes.length} route handler(s) for static export`)
  }
  return routes.length
}

function enableRouteHandlers() {
  const routes = sync(`app/**/route.ts${disabledSuffix}`, { cwd: root })
  for (const route of routes) {
    const disabled = join(root, route)
    const original = disabled.slice(0, -disabledSuffix.length)
    renameSync(disabled, original)
  }
  if (routes.length > 0) {
    console.log(`[tauri-build] Restored ${routes.length} route handler(s)`)
  }
}

function excludeDirs() {
  const excluded = []
  for (const { inside, outside } of dirsToExclude) {
    const insidePath = join(root, inside)
    const outsidePath = join(root, outside)
    if (existsSync(insidePath)) {
      renameSync(insidePath, outsidePath)
      excluded.push(inside)
    }
  }
  if (excluded.length > 0) {
    console.log(`[tauri-build] Excluded ${excluded.length} directorie(s) from static export: ${excluded.join(", ")}`)
  }
  return excluded
}

function restoreDirs() {
  const restored = []
  for (const { inside, outside } of dirsToExclude) {
    const insidePath = join(root, inside)
    const outsidePath = join(root, outside)
    if (existsSync(outsidePath)) {
      renameSync(outsidePath, insidePath)
      restored.push(inside)
    }
  }
  if (restored.length > 0) {
    console.log(`[tauri-build] Restored ${restored.length} directorie(s)`)
  }
}

const appUrl = resolveRuntimeHost()

let exitCode = 0
try {
  disableRouteHandlers()
  excludeDirs()
  // NEXT_PUBLIC_TAURI_BUILD is the client-visible twin of TAURI_BUILD. Plain
  // TAURI_BUILD is NOT inlined into client bundles (Next only inlines
  // NEXT_PUBLIC_* vars), so any runtime `process.env.TAURI_BUILD` check inside a
  // client component evaluates to false in the packaged DMG. Modules that branch
  // at client runtime (e.g. lib/writings/writing-route.ts) must read the public
  // twin instead.
  // The resolved host is passed explicitly so the build cannot fall back to a
  // `.env.local` value the gates never saw.
  execSync("TAURI_BUILD=true NEXT_PUBLIC_TAURI_BUILD=true npm run build", {
    stdio: "inherit",
    cwd: root,
    env: { ...process.env, NEXT_PUBLIC_APP_URL: appUrl },
  })

  // ODE-409: record the runtime host this export actually inlined. The release
  // and bundle gates read this instead of guessing from a raw localhost scan,
  // which dependencies poison with their own local defaults.
  const manifest = {
    appUrl,
    tauriBuild: true,
    generatedAt: new Date().toISOString(),
  }
  writeFileSync(join(root, "dist", RUNTIME_MANIFEST_FILENAME), JSON.stringify(manifest, null, 2) + "\n", "utf8")
  console.log(`[tauri-build] Runtime host recorded: ${appUrl}`)

  // Corroborate the manifest against the export that was just written, so a
  // stale `dist/` or a chunk carrying a different host fails here rather than
  // on a writer's machine.
  const { assets } = collectFrontendAssets([join(root, "dist")])
  const embedded = evaluateEmbeddedRuntimeHost({ manifest, assets, allowLocalhost })
  if (!embedded.ok) {
    console.error(`[tauri-build] INVALID EMBEDDED RUNTIME HOST\n  ${formatEmbeddedHostFailure(embedded)}`)
    exitCode = 1
  } else {
    console.log(
      `[tauri-build] ✓ Export embeds ${embedded.appUrl} (found in ${embedded.carriers.length} of ${embedded.scanned} asset(s))`
    )
  }
} catch (err) {
  exitCode = err.status || 1
} finally {
  restoreDirs()
  enableRouteHandlers()
}

process.exit(exitCode)
