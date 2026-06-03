#!/usr/bin/env node
/**
 * Produces a versioned, distributable DMG from the current package.json version.
 *
 * Usage:
 *   npm run desktop:release
 *
 * Output:
 *   dist/releases/Odessay-{version}-aarch64.dmg
 *
 * Fails fast if package.json and src-tauri/tauri.conf.json versions differ.
 * Code signing is intentionally out of scope — see docs/desktop-distribution.md.
 */
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const RELEASES_DIR = "dist/releases"
const DMG_BUNDLE_DIR = "src-tauri/target/release/bundle/dmg"

/**
 * Checks whether package.json and tauri.conf.json declare the same version.
 * Returns { ok: true, version } or { ok: false, pkg, tauri }.
 */
export function checkVersionDrift(root = process.cwd()) {
  const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"))
  const tauri = JSON.parse(readFileSync(join(root, "src-tauri/tauri.conf.json"), "utf8"))
  if (pkg.version !== tauri.version) {
    return { ok: false, pkg: pkg.version, tauri: tauri.version }
  }
  return { ok: true, version: pkg.version }
}

function findDmg(bundleDir) {
  if (!existsSync(bundleDir)) return null
  const files = readdirSync(bundleDir).filter((f) => f.endsWith(".dmg"))
  return files.length > 0 ? join(bundleDir, files[0]) : null
}

function main() {
  const root = process.cwd()

  // 1. Version drift check — fail fast
  const drift = checkVersionDrift(root)
  if (!drift.ok) {
    console.error(
      `[desktop:release] VERSION DRIFT DETECTED\n` +
        `  package.json:         ${drift.pkg}\n` +
        `  tauri.conf.json:      ${drift.tauri}\n` +
        `\n` +
        `  Fix: align both files to the same version before releasing.`
    )
    process.exit(1)
  }

  const { version } = drift
  console.log(`[desktop:release] Building Odessay ${version}…`)

  // 2. Build — beforeBuildCommand in tauri.conf.json handles the Next.js static export prep
  try {
    execSync("npm run tauri:build", { stdio: "inherit", cwd: root })
  } catch (err) {
    console.error("[desktop:release] tauri build failed — see output above.")
    process.exit(err.status || 1)
  }

  // 3. Locate the DMG produced by Tauri
  const bundleDir = join(root, DMG_BUNDLE_DIR)
  const sourceDmg = findDmg(bundleDir)
  if (!sourceDmg) {
    console.error(
      `[desktop:release] DMG not found in ${bundleDir}\n` +
        `  Ensure 'bundle.targets' in tauri.conf.json includes "dmg" or "all".`
    )
    process.exit(1)
  }

  // 4. Copy to dist/releases/ with versioned name. Next static export rewrites
  // dist during the build, so create this directory only after tauri:build.
  mkdirSync(join(root, RELEASES_DIR), { recursive: true })
  const destName = `Odessay-${version}-aarch64.dmg`
  const destPath = join(root, RELEASES_DIR, destName)
  copyFileSync(sourceDmg, destPath)

  console.log(`[desktop:release] ✓ DMG ready: ${resolve(destPath)}`)
  console.log(
    `[desktop:release] Distribute to known users and share docs/desktop-distribution.md` +
      ` for the xattr quarantine workaround.`
  )
}

// Run only when executed directly, not when imported by tests
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
