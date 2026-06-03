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
import { renameSync, existsSync } from "node:fs"
import { join } from "node:path"

const { sync } = globPkg
const root = process.cwd()
const disabledSuffix = ".route-disabled"

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
  execSync("TAURI_BUILD=true NEXT_PUBLIC_TAURI_BUILD=true npm run build", {
    stdio: "inherit",
    cwd: root,
  })
} catch (err) {
  exitCode = err.status || 1
} finally {
  restoreDirs()
  enableRouteHandlers()
}

process.exit(exitCode)
