#!/usr/bin/env node
/**
 * Produces a versioned, distributable DMG and signed updater archive
 * from the current package.json version.
 *
 * Usage:
 *   npm run desktop:release
 *
 * Output:
 *   dist/releases/ArtifactStudio-{version}-aarch64.dmg
 *   dist/releases/ArtifactStudio_{version}_aarch64.app.tar.gz
 *   dist/releases/ArtifactStudio_{version}_aarch64.app.tar.gz.sig
 *   dist/releases/latest.json
 *
 * Fails fast if package.json and src-tauri/tauri.conf.json versions differ.
 * Code signing is intentionally out of scope — see docs/desktop-distribution.md.
 * Updater signing requires TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH in env.
 */
import { readFileSync, mkdirSync, copyFileSync, existsSync, readdirSync, writeFileSync } from "node:fs"
import { execSync } from "node:child_process"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
  collectFrontendAssets,
  evaluateEmbeddedRuntimeHost,
  findLocalRuntimeHosts,
  formatEmbeddedHostFailure,
  readRuntimeManifest,
} from "./lib/desktop-runtime-host.mjs"

const RELEASES_DIR = "dist/releases"
const DMG_BUNDLE_DIR = "src-tauri/target/release/bundle/dmg"
const APP_BUNDLE_DIR = "src-tauri/target/release/bundle/macos"
const GITHUB_REPO = "hugomarin/Odessay"

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

function findAppBundle(bundleDir) {
  if (!existsSync(bundleDir)) return null
  const apps = readdirSync(bundleDir).filter((f) => f.endsWith(".app"))
  return apps.length > 0 ? join(bundleDir, apps[0]) : null
}

function main() {
  const root = process.cwd()
  const allowLocalhost = process.argv.includes("--allow-localhost")

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

  // 2. Web runtime URL check — prevent shipping a DMG that points to localhost
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || ""
  const isLocalhost = findLocalRuntimeHosts(appUrl).length > 0
  if (isLocalhost && !allowLocalhost) {
    console.error(
      `[desktop:release] INVALID WEB RUNTIME URL\n` +
        `  NEXT_PUBLIC_APP_URL=${appUrl}\n` +
        `\n` +
        `  A production DMG must connect to the hosted web runtime, not localhost.\n` +
        `  Fix one of:\n` +
        `    • NEXT_PUBLIC_APP_URL=https://odessay.vercel.app npm run desktop:release\n` +
        `    • npm run desktop:release:prod\n` +
        `    • npm run desktop:release -- --allow-localhost  (only for local testing)`
    )
    process.exit(1)
  }

  const { version } = drift
  console.log(`[desktop:release] Building Artifact Studio ${version}…`)
  if (isLocalhost && allowLocalhost) {
    console.log(`[desktop:release] WARNING: DMG will connect to local dev server (${appUrl}). Do not distribute this build.`)
  }

  try {
    execSync("npm run test:desktop:draft-lifecycle", { stdio: "inherit", cwd: root })
  } catch (err) {
    console.error("[desktop:release] desktop draft lifecycle gate failed — release aborted.")
    process.exit(err.status || 1)
  }

  // 3. Build — beforeBuildCommand in tauri.conf.json handles the Next.js static export prep
  try {
    // The flag cannot reach prepare-tauri-build.mjs through `tauri build`'s
    // beforeBuildCommand, so it travels as an env var.
    execSync("npm run tauri:build", {
      stdio: "inherit",
      cwd: root,
      env: allowLocalhost ? { ...process.env, DESKTOP_ALLOW_LOCAL_RUNTIME: "1" } : process.env,
    })
  } catch (err) {
    console.error("[desktop:release] tauri build failed — see output above.")
    process.exit(err.status || 1)
  }

  // 3b. Embedded runtime host gate (ODE-409). Step 2 checked the *intent*; this
  // checks what the build actually baked into the shipped frontend, which is
  // what the app will call at runtime on someone else's machine.
  const builtApp = findAppBundle(join(root, APP_BUNDLE_DIR))
  const candidateDirs = [builtApp ? join(builtApp, "Contents", "Resources") : null, join(root, "dist")]
  const embedded = collectFrontendAssets(candidateDirs)
  const { manifest } = readRuntimeManifest(candidateDirs)

  if (embedded.assets.length === 0) {
    console.error(
      "[desktop:release] EMBEDDED HOST UNVERIFIABLE\n" +
        "  No frontend assets were found to scan — the static export did not reach the bundle.\n" +
        "  Refusing to publish an artifact whose runtime host cannot be verified."
    )
    process.exit(1)
  }

  const embeddedVerdict = evaluateEmbeddedRuntimeHost({ manifest, assets: embedded.assets, allowLocalhost })
  if (!embeddedVerdict.ok) {
    console.error(`[desktop:release] INVALID EMBEDDED RUNTIME HOST\n  ${formatEmbeddedHostFailure(embeddedVerdict)}`)
    process.exit(1)
  }
  if (embeddedVerdict.reason === "local-host") {
    console.log(
      `[desktop:release] WARNING: the artifact embeds ${embeddedVerdict.appUrl}. Do not distribute this build.`
    )
  } else {
    console.log(
      `[desktop:release] ✓ Embedded runtime host is remote: ${embeddedVerdict.appUrl} (found in ${embeddedVerdict.carriers.length} of ${embeddedVerdict.scanned} asset(s))`
    )
  }

  // 4. Locate the DMG produced by Tauri
  const bundleDir = join(root, DMG_BUNDLE_DIR)
  const sourceDmg = findDmg(bundleDir)
  if (!sourceDmg) {
    console.error(
      `[desktop:release] DMG not found in ${bundleDir}\n` +
        `  Ensure 'bundle.targets' in tauri.conf.json includes "dmg" or "all".`
    )
    process.exit(1)
  }

  // 5. Copy DMG to dist/releases/ with versioned name. Next static export rewrites
  // dist during the build, so create this directory only after tauri:build.
  mkdirSync(join(root, RELEASES_DIR), { recursive: true })
  const dmgName = `ArtifactStudio-${version}-aarch64.dmg`
  const dmgPath = join(root, RELEASES_DIR, dmgName)
  copyFileSync(sourceDmg, dmgPath)

  console.log(`[desktop:release] ✓ DMG ready: ${resolve(dmgPath)}`)

  // 6. Create updater archive (.app.tar.gz) for Tauri auto-updater
  const appBundle = findAppBundle(join(root, APP_BUNDLE_DIR))
  if (!appBundle) {
    console.error(
      `[desktop:release] App bundle not found in ${APP_BUNDLE_DIR}\n` +
        `  The updater archive cannot be created without the .app bundle.`
    )
    process.exit(1)
  }

  // Tauri updater expects underscore naming: ArtifactStudio_0.1.0_aarch64.app.tar.gz
  const updaterName = `ArtifactStudio_${version}_aarch64.app.tar.gz`
  const updaterPath = join(root, RELEASES_DIR, updaterName)

  try {
    execSync(`tar -czf "${updaterPath}" -C "${join(root, APP_BUNDLE_DIR)}" "${appBundle.split("/").pop()}"`, {
      stdio: "inherit",
      cwd: root,
      env: { ...process.env, COPYFILE_DISABLE: "1" },
    })
    console.log(`[desktop:release] ✓ Updater archive ready: ${resolve(updaterPath)}`)
  } catch (err) {
    console.error("[desktop:release] Failed to create updater archive.")
    process.exit(err.status || 1)
  }

  // 7. Sign the updater archive
  const hasSigningKey = Boolean(
    process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  )
  let signature = null
  if (hasSigningKey) {
    try {
      execSync(`node scripts/sign-update-manifest.mjs "${updaterPath}"`, {
        stdio: "inherit",
        cwd: root,
      })
      signature = readFileSync(`${updaterPath}.sig`, "utf-8").trim()
      console.log(`[desktop:release] ✓ Updater archive signed.`)
    } catch (err) {
      console.error("[desktop:release] Signing failed — see output above.")
      process.exit(err.status || 1)
    }
  } else {
    console.warn(
      `[desktop:release] WARNING: TAURI_SIGNING_PRIVATE_KEY not set.\n` +
        `  The updater archive was created but NOT signed.\n` +
        `  Unsigned updates will be rejected by the app.\n` +
        `  Set the private key and re-run to produce a signed release.`
    )
  }

  // 8. Generate latest.json manifest in Tauri updater format
  const tag = `app-v${version}`
  const updaterUrl = `https://github.com/${GITHUB_REPO}/releases/download/${tag}/${updaterName}`
  const latestJson = {
    version,
    notes: `Artifact Studio ${version}`,
    pub_date: new Date().toISOString(),
    url: updaterUrl,
    signature,
  }
  const latestJsonPath = join(root, RELEASES_DIR, "latest.json")
  writeFileSync(latestJsonPath, JSON.stringify(latestJson, null, 2) + "\n", "utf-8")
  console.log(`[desktop:release] ✓ Update manifest ready: ${resolve(latestJsonPath)}`)

  console.log(`\n[desktop:release] Release artifacts in ${resolve(join(root, RELEASES_DIR))}:`)
  console.log(`  • ${dmgName}`)
  console.log(`  • ${updaterName}`)
  if (hasSigningKey) {
    console.log(`  • ${updaterName}.sig`)
  }
  console.log(`  • latest.json`)
  console.log(
    `\n[desktop:release] Next steps:` +
      `\n  1. Create a GitHub release with tag "${tag}".` +
      `\n  2. Upload all artifacts above to the release.` +
      `\n  3. The app will find latest.json at:` +
      `\n     https://github.com/${GITHUB_REPO}/releases/latest/download/latest.json` +
      `\n  4. See docs/desktop-distribution.md for rollback and signing policy.`
  )
}

// Run only when executed directly, not when imported by tests
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main()
}
