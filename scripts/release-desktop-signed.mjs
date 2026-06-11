#!/usr/bin/env node
/**
 * Wrapper around release-desktop.mjs that auto-discovers the local updater
 * signing key so you don't have to export it manually every time.
 *
 * Usage:
 *   npm run desktop:release:signed
 *
 * Resolution order:
 *   1. TAURI_SIGNING_PRIVATE_KEY_PATH env var (if already set)
 *   2. TAURI_SIGNING_PRIVATE_KEY env var (if already set)
 *   3. ~/.config/odessay/updater/odessay-updater-key (default local location)
 *
 * The private key never leaves your machine; this script only sets the env
 * var and delegates to release-desktop.mjs.
 */
import { existsSync } from "node:fs"
import { join } from "node:path"
import { homedir } from "node:os"
import { fileURLToPath } from "node:url"
import { execSync } from "node:child_process"

const DEFAULT_KEY_PATH = join(homedir(), ".config/odessay/updater/odessay-updater-key")

function resolveKeyPath() {
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    return process.env.TAURI_SIGNING_PRIVATE_KEY_PATH
  }
  if (process.env.TAURI_SIGNING_PRIVATE_KEY) {
    return null // key content already in env, no path needed
  }
  if (existsSync(DEFAULT_KEY_PATH)) {
    return DEFAULT_KEY_PATH
  }
  return null
}

function main() {
  const keyPath = resolveKeyPath()
  if (!keyPath && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    console.error(
      "No updater signing key found.\n" +
        "  Options:\n" +
        `    • Save it to ${DEFAULT_KEY_PATH}\n` +
        "    • Set TAURI_SIGNING_PRIVATE_KEY_PATH environment variable\n" +
        "    • Set TAURI_SIGNING_PRIVATE_KEY environment variable\n" +
        "\nGenerate a keypair with: npx tauri signer generate --write-keys ./updater-key"
    )
    process.exit(1)
  }

  const env = { ...process.env }
  if (keyPath) {
    env.TAURI_SIGNING_PRIVATE_KEY_PATH = keyPath
    console.log(`[release-desktop-signed] Using signing key: ${keyPath}`)
  }

  const args = process.argv.slice(2)
  execSync(`node scripts/release-desktop.mjs ${args.join(" ")}`, {
    stdio: "inherit",
    env,
    cwd: process.cwd(),
  })
}

main()
