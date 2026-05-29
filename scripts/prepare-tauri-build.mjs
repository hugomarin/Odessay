#!/usr/bin/env node
/**
 * Prepare the Next.js app for Tauri static export.
 *
 * Next.js `output: 'export'` does not support API / Route handlers,
 * dynamic pages without generateStaticParams, or server-only APIs
 * like `cookies()`. This script temporarily applies build-time patches
 * so the static build succeeds, then restores them.
 *
 * Usage:
 *   node scripts/prepare-tauri-build.mjs
 *
 * Strategy documented in ODE-207: static export for desktop shell.
 * Long-term, desktop will use Tauri commands instead of Next.js API routes
 * and will not depend on SSR cookies.
 */
import { execSync } from "node:child_process"
import globPkg from "glob"
import { renameSync, writeFileSync, existsSync } from "node:fs"
import { join } from "node:path"

const { sync } = globPkg
const root = process.cwd()
const disabledSuffix = ".route-disabled"

const appLayoutPath = join(root, "app", "(app)", "layout.tsx")
const appLayoutBackupPath = appLayoutPath + ".backup"

const supabaseServerPath = join(root, "lib", "supabase", "server.ts")
const supabaseServerBackupPath = supabaseServerPath + ".backup"

const writePagePath = join(root, "app", "(app)", "write", "page.tsx")
const writePageBackupPath = writePagePath + ".backup"

// Directories inside app/ to temporarily exclude from static export.
// They are moved outside app/ because Next.js scans all subdirectories.
const dirsToExclude = [
  { inside: "app/(reading)", outside: ".excluded-app-reading" },
  { inside: "app/(public)", outside: ".excluded-app-public" },
  { inside: "app/[username]", outside: ".excluded-app-username" },
  { inside: "app/perf", outside: ".excluded-app-perf" },
]

const desktopAppLayout = `import { Sidebar } from "@/components/navigation/sidebar"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"

export default function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <UserSettingsProvider>
      <Sidebar
        initialSidebarMode="expanded"
        user={{ email: null, displayName: null, username: null }}
      >
        {children}
      </Sidebar>
    </UserSettingsProvider>
  )
}
`

const staticSupabaseServer = `import { createClient as createSupabaseClient } from "@supabase/supabase-js"
import { supabasePublicKey, supabaseUrl } from "@/lib/supabase/shared"

export const createClient = async () => {
  return createSupabaseClient(supabaseUrl, supabasePublicKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  })
}
`

const staticWritePage = `import { EditorShell } from "@/components/editor/editor-shell"

export default function WritePage() {
  return <EditorShell />
}
`

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

function patchAppLayout() {
  if (existsSync(appLayoutPath)) {
    renameSync(appLayoutPath, appLayoutBackupPath)
    writeFileSync(appLayoutPath, desktopAppLayout, "utf-8")
    console.log("[tauri-build] Patched app/(app)/layout.tsx for static export")
  }
}

function restoreAppLayout() {
  if (existsSync(appLayoutBackupPath)) {
    renameSync(appLayoutBackupPath, appLayoutPath)
    console.log("[tauri-build] Restored app/(app)/layout.tsx")
  }
}

function patchSupabaseServer() {
  if (existsSync(supabaseServerPath)) {
    renameSync(supabaseServerPath, supabaseServerBackupPath)
    writeFileSync(supabaseServerPath, staticSupabaseServer, "utf-8")
    console.log("[tauri-build] Patched lib/supabase/server.ts for static export")
  }
}

function restoreSupabaseServer() {
  if (existsSync(supabaseServerBackupPath)) {
    renameSync(supabaseServerBackupPath, supabaseServerPath)
    console.log("[tauri-build] Restored lib/supabase/server.ts")
  }
}

function patchWritePage() {
  if (existsSync(writePagePath)) {
    renameSync(writePagePath, writePageBackupPath)
    writeFileSync(writePagePath, staticWritePage, "utf-8")
    console.log("[tauri-build] Patched app/(app)/write/page.tsx for static export")
  }
}

function restoreWritePage() {
  if (existsSync(writePageBackupPath)) {
    renameSync(writePageBackupPath, writePagePath)
    console.log("[tauri-build] Restored app/(app)/write/page.tsx")
  }
}

let exitCode = 0
try {
  disableRouteHandlers()
  excludeDirs()
  patchAppLayout()
  patchSupabaseServer()
  patchWritePage()
  execSync("TAURI_BUILD=true pnpm build", { stdio: "inherit", cwd: root })
} catch (err) {
  exitCode = err.status || 1
} finally {
  restoreWritePage()
  restoreSupabaseServer()
  restoreAppLayout()
  restoreDirs()
  enableRouteHandlers()
}

process.exit(exitCode)
