#!/usr/bin/env node
/**
 * DMG Parity Validation — Smoke-test harness for the desktop bundle.
 *
 * Scope (ODE-225):
 *   Automates only checks that are reasonable to run against the DMG/app bundle
 *   without a full WebDriver/Playwright setup. Semi-manual steps live in
 *   docs/desktop-distribution.md §DMG Smoke Test Checklist.
 *
 * Usage:
 *   npm run validate:desktop                  # validate latest DMG in dist/releases
 *   npm run validate:desktop -- --dmg <path>  # validate a specific DMG
 *   npm run validate:desktop -- --app <path>  # validate an installed .app
 *
 * Exit codes:
 *   0 = all automated checks passed
 *   1 = one or more automated checks failed
 *   2 = runtime error / bad arguments
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, resolve, basename } from "node:path"
import { fileURLToPath } from "node:url"
import {
  collectFrontendAssets,
  evaluateEmbeddedRuntimeHost,
  findLocalRuntimeHosts,
  formatEmbeddedHostFailure,
} from "./lib/desktop-runtime-host.mjs"

const RELEASES_DIR = "dist/releases"
const TAURI_CONF = "src-tauri/tauri.conf.json"
const CARGO_TOML = "src-tauri/Cargo.toml"

let failures = 0
let warnings = 0

function fail(message) {
  console.error(`  ✖ ${message}`)
  failures++
}

function warn(message) {
  console.warn(`  ⚠ ${message}`)
  warnings++
}

function ok(message) {
  console.log(`  ✓ ${message}`)
}

function section(title) {
  console.log(`\n[validate:desktop] ${title}`)
}

/* ─── CLI args ─── */
const args = process.argv.slice(2)
let dmgPath = ""
let appPath = ""
const allowLocalhost = args.includes("--allow-localhost")
for (let i = 0; i < args.length; i++) {
  if (args[i] === "--dmg" && args[i + 1]) dmgPath = resolve(args[i + 1])
  if (args[i] === "--app" && args[i + 1]) appPath = resolve(args[i + 1])
}

const root = process.cwd()


/* ─── Helpers ─── */
function latestDmg() {
  const dir = join(root, RELEASES_DIR)
  if (!existsSync(dir)) return null
  const dmgs = readdirSync(dir)
    .filter((f) => f.endsWith(".dmg"))
    .map((f) => ({ name: f, mtime: statSync(join(dir, f)).mtime }))
    .sort((a, b) => b.mtime - a.mtime)
  return dmgs.length > 0 ? join(dir, dmgs[0].name) : null
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"))
}

function readToml(path) {
  return readFileSync(path, "utf8")
}

function findAppInsideDmg(mountPoint) {
  if (!existsSync(mountPoint)) return null
  const apps = readdirSync(mountPoint).filter((f) => f.endsWith(".app"))
  return apps.length > 0 ? join(mountPoint, apps[0]) : null
}

function appBundlePath(app) {
  return join(app, "Contents", "MacOS", "odessay")
}

function appResourcesPath(app) {
  return join(app, "Contents", "Resources")
}

/* ═══════════════════════════════════════
   1. DMG / App discovery
   ═══════════════════════════════════════ */
section("1. Bundle discovery")

let targetDmg = dmgPath
let mountedApp = null
let mountedPoint = null
let unmountOnExit = false

if (appPath) {
  if (!existsSync(appPath)) {
    fail(`Provided --app path does not exist: ${appPath}`)
    process.exit(1)
  }
  ok(`Using provided app: ${appPath}`)
  mountedApp = appPath
} else {
  if (!targetDmg) {
    targetDmg = latestDmg()
  }
  if (!targetDmg || !existsSync(targetDmg)) {
    fail(`No DMG found in ${RELEASES_DIR}. Run 'npm run desktop:release' first.`)
    process.exit(1)
  }
  ok(`DMG found: ${basename(targetDmg)}`)

  // Mount DMG
  try {
    const out = execSync(`hdiutil attach "${targetDmg}" -nobrowse -readonly`, {
      encoding: "utf8",
    })
    const match = out.match(/(\/Volumes\/[^\n]+)/)
    if (match) {
      mountedPoint = match[1].trim()
      unmountOnExit = true
      ok(`DMG mounted at: ${mountedPoint}`)
    } else {
      fail("Could not determine mount point from hdiutil output.")
      process.exit(2)
    }
  } catch (err) {
    fail(`Failed to mount DMG: ${err.message}`)
    process.exit(2)
  }

  mountedApp = findAppInsideDmg(mountedPoint)
  if (!mountedApp) {
    fail("No .app bundle found inside the DMG.")
    if (unmountOnExit) {
      try {
        execSync(`hdiutil detach "${mountedPoint}"`, { stdio: "ignore" })
      } catch {}
    }
    process.exit(1)
  }
  ok(`App bundle inside DMG: ${basename(mountedApp)}`)
}

/* ═══════════════════════════════════════
   2. App bundle structure
   ═══════════════════════════════════════ */
section("2. App bundle structure")

const binaryPath = appBundlePath(mountedApp)
const resourcesPath = appResourcesPath(mountedApp)

if (existsSync(binaryPath)) {
  ok(`Binary exists: ${binaryPath}`)
} else {
  fail(`Binary missing: ${binaryPath}`)
}

if (existsSync(resourcesPath)) {
  ok(`Resources directory exists`)
} else {
  fail(`Resources directory missing: ${resourcesPath}`)
}

const infoPlistPath = join(mountedApp, "Contents", "Info.plist")
if (existsSync(infoPlistPath)) {
  ok(`Info.plist exists`)
  try {
    const plist = execSync(`plutil -extract CFBundleIdentifier raw -o - "${infoPlistPath}"`, {
      encoding: "utf8",
    }).trim()
    if (plist && plist.length > 0) {
      ok(`CFBundleIdentifier: ${plist}`)
    } else {
      warn("CFBundleIdentifier is empty")
    }
  } catch {
    warn("Could not read CFBundleIdentifier from Info.plist")
  }

  try {
    const version = execSync(`plutil -extract CFBundleShortVersionString raw -o - "${infoPlistPath}"`, {
      encoding: "utf8",
    }).trim()
    if (version) {
      ok(`CFBundleShortVersionString: ${version}`)
    }
  } catch {
    warn("Could not read CFBundleShortVersionString from Info.plist")
  }
} else {
  fail(`Info.plist missing: ${infoPlistPath}`)
}

/* ═══════════════════════════════════════
   3. Build-time configuration checks
   ═══════════════════════════════════════ */
section("3. Build-time configuration")

// 3a. tauri.conf.json CSP
if (existsSync(TAURI_CONF)) {
  const tauriConf = readJson(TAURI_CONF)
  const csp = tauriConf?.app?.security?.csp || tauriConf?.bundle?.macOS?.entitlements || ""
  const cspString = typeof csp === "string" ? csp : JSON.stringify(csp)

  const hasIpc = cspString.includes("ipc:") || cspString.includes("http://ipc.localhost")
  const hasConnectSrc = cspString.includes("connect-src")

  if (hasIpc) {
    ok("CSP includes ipc: or http://ipc.localhost")
  } else {
    fail("CSP missing ipc: or http://ipc.localhost — Tauri IPC will be blocked in the DMG")
  }

  if (hasConnectSrc) {
    ok("CSP defines connect-src")
  } else {
    warn("CSP does not explicitly define connect-src")
  }
} else {
  fail(`tauri.conf.json not found at ${TAURI_CONF}`)
}

// 3b. Cargo.toml devtools feature
if (existsSync(CARGO_TOML)) {
  const cargo = readToml(CARGO_TOML)
  const hasDevtoolsFeature = cargo.includes('features = ["devtools"]') ||
    cargo.includes("features = ['devtools']")
  if (hasDevtoolsFeature) {
    ok('Cargo.toml has features = ["devtools"]')
  } else {
    warn('Cargo.toml missing "devtools" feature — DevTools unavailable in DMG (required in Fase 7)')
  }
} else {
  fail(`Cargo.toml not found at ${CARGO_TOML}`)
}

// 3c. Version alignment
const pkg = readJson(join(root, "package.json"))
const tauriConf = readJson(join(root, TAURI_CONF))
if (pkg.version === tauriConf.version) {
  ok(`Version aligned: ${pkg.version}`)
} else {
  fail(`Version drift: package.json=${pkg.version} vs tauri.conf.json=${tauriConf.version}`)
}

// 3d. NEXT_PUBLIC_APP_URL must not be localhost in a release build
const appUrl = process.env.NEXT_PUBLIC_APP_URL || pkg?.config?.appUrl || ""
if (appUrl && findLocalRuntimeHosts(appUrl).length > 0) {
  if (allowLocalhost) {
    warn(`NEXT_PUBLIC_APP_URL points to localhost (${appUrl}) — --allow-localhost given, not distributable`)
  } else {
    fail(`NEXT_PUBLIC_APP_URL points to localhost (${appUrl}) — DMG will fail outside this machine`)
  }
} else if (appUrl) {
  ok(`NEXT_PUBLIC_APP_URL is remote: ${appUrl}`)
} else {
  warn("NEXT_PUBLIC_APP_URL not set — verify the default points to production")
}

// 3e. The host actually embedded in the shipped frontend (ODE-409). The env var
// above describes the intended build; this reads what the artifact will really
// call at runtime, which is what the writer experiences.
const embedded = collectFrontendAssets([appResourcesPath(mountedApp), join(root, "dist")])
if (embedded.assets.length === 0) {
  warn("No frontend assets found to scan for an embedded runtime host — verify the static export was bundled")
} else {
  const verdict = evaluateEmbeddedRuntimeHost({ assets: embedded.assets, allowLocalhost })
  if (verdict.offenders.length === 0) {
    ok(`No local runtime host embedded in ${verdict.scanned} frontend asset(s) from ${embedded.baseDir}`)
  } else {
    const message = formatEmbeddedHostFailure(verdict.offenders)
    if (allowLocalhost) {
      warn(`${message}\n      (--allow-localhost given — this build is not distributable)`)
    } else {
      fail(message)
    }
  }
}

/* ═══════════════════════════════════════
   4. Static-export sanity (Next.js)
   ═══════════════════════════════════════ */
section("4. Static export sanity")

const staticExportDir = join(root, "dist")
const indexHtml = join(staticExportDir, "index.html")
if (existsSync(indexHtml)) {
  ok("dist/index.html exists (static export produced)")
} else {
  warn("dist/index.html not found — verify static export is enabled for the DMG build")
}

// Check for baked-in server redirects that break in static export
const outDir = join(root, ".next")
const serverPaths = [join(outDir, "server")]
let redirectFound = false
for (const sp of serverPaths) {
  if (!existsSync(sp)) continue
  try {
    const files = execSync(`find "${sp}" -name "*.html" -type f 2>/dev/null || true`, {
      encoding: "utf8",
    })
    for (const file of files.split("\n").filter(Boolean)) {
      const content = readFileSync(file, "utf8")
      if (content.includes('http-equiv="refresh"') || content.includes("window.location")) {
        if (content.includes("/login") || content.includes("/auth")) {
          warn(`Potential baked redirect found in ${file} — verify it does not break in DMG`)
          redirectFound = true
        }
      }
    }
  } catch {
    // ignore
  }
}
if (!redirectFound) {
  ok("No obvious baked-in server redirects detected in static export")
}

/* ═══════════════════════════════════════
   5. macOS quarantine / signing state
   ═══════════════════════════════════════ */
section("5. macOS quarantine / signing")

try {
  const xattr = execSync(`xattr -l "${mountedApp}" 2>/dev/null || true`, { encoding: "utf8" })
  if (xattr.includes("com.apple.quarantine")) {
    ok("Quarantine attribute present (expected for unsigned DMG)")
    console.log(`    → Users must run: xattr -d com.apple.quarantine /Applications/Artifact Studio.app`)
  } else {
    ok("No quarantine attribute — app may already be trusted")
  }
} catch {
  warn("Could not read extended attributes")
}

try {
  const codesign = execSync(`codesign -dv "${mountedApp}" 2>&1 || true`, { encoding: "utf8" })
  if (codesign.includes("Signature=adhoc") || codesign.includes("adhoc")) {
    ok("Ad-hoc signature detected (expected without Apple Developer ID)")
  } else if (codesign.includes("not signed") || codesign.includes("no signature")) {
    warn("App is not signed at all — Gatekeeper may block harder than ad-hoc")
  } else {
    ok("App appears to be code-signed")
  }
} catch {
  warn("Could not verify code signature")
}

/* ═══════════════════════════════════════
   Cleanup
   ═══════════════════════════════════════ */
if (unmountOnExit && mountedPoint) {
  try {
    execSync(`hdiutil detach "${mountedPoint}"`, { stdio: "ignore" })
    console.log(`\n[validate:desktop] Unmounted ${mountedPoint}`)
  } catch {
    warn(`Failed to unmount ${mountedPoint} — you may need to run: hdiutil detach "${mountedPoint}"`)
  }
}

/* ═══════════════════════════════════════
   Summary
   ═══════════════════════════════════════ */
section("Summary")
if (failures === 0 && warnings === 0) {
  console.log("  ✓ All automated checks passed.")
  console.log("  → Run the semi-manual smoke-test checklist in docs/desktop-distribution.md")
  process.exit(0)
} else if (failures === 0) {
  console.log(`  ⚠ ${warnings} warning(s), 0 failures.`)
  console.log("  → Review warnings above. If acceptable, proceed to manual checklist.")
  process.exit(0)
} else {
  console.log(`  ✖ ${failures} failure(s), ${warnings} warning(s).`)
  console.log("  → Fix failures before distributing the DMG or running manual tests.")
  process.exit(1)
}
