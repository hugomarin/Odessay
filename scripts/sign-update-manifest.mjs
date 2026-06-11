#!/usr/bin/env node
/**
 * Signs an update archive for the Tauri updater using `tauri signer sign`.
 *
 * Usage:
 *   node scripts/sign-update-manifest.mjs <path-to-archive>
 *
 * Environment:
 *   TAURI_SIGNING_PRIVATE_KEY     — minisign private key string (base64 content)
 *   TAURI_SIGNING_PRIVATE_KEY_PATH — path to minisign private key file
 *
 * Output:
 *   <path-to-archive>.sig — base64-encoded minisign signature
 *
 * The public key embedded in the app (tauri.conf.json) verifies this
 * signature when the updater downloads a new release.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import { resolve } from "node:path"

function main() {
  const archivePath = process.argv[2]
  if (!archivePath) {
    console.error("Usage: node scripts/sign-update-manifest.mjs <path-to-archive>")
    process.exit(1)
  }

  if (!existsSync(archivePath)) {
    console.error(`Archive not found: ${archivePath}`)
    process.exit(1)
  }

  const hasKey = Boolean(process.env.TAURI_SIGNING_PRIVATE_KEY || process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)
  if (!hasKey) {
    console.error(
      "TAURI_SIGNING_PRIVATE_KEY or TAURI_SIGNING_PRIVATE_KEY_PATH is not set.\n" +
        "  Generate a keypair with `npx tauri signer generate` and keep the private key secret.\n" +
        "  The public key must be set in src-tauri/tauri.conf.json updater.pubkey."
    )
    process.exit(1)
  }

  // Run `tauri signer sign` to produce a minisign-compatible signature.
  // The CLI prints the public signature (base64 of the .sig file) to stdout.
  const args = ["tauri", "signer", "sign", "--password", ""]
  if (process.env.TAURI_SIGNING_PRIVATE_KEY_PATH) {
    args.push("--private-key-path", process.env.TAURI_SIGNING_PRIVATE_KEY_PATH)
  } else {
    args.push("--private-key", process.env.TAURI_SIGNING_PRIVATE_KEY)
  }
  args.push(archivePath)

  const output = execFileSync("npx", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "inherit"] })

  // The CLI outputs the base64 signature after "Public signature:".
  const marker = "Public signature:\n"
  const markerIndex = output.indexOf(marker)
  if (markerIndex === -1) {
    console.error("[sign-update] Could not parse signature from tauri signer sign output.")
    process.exit(1)
  }

  const sigB64 = output.slice(markerIndex + marker.length).split("\n")[0].trim()
  const sigPath = `${archivePath}.sig`
  writeFileSync(sigPath, sigB64, "utf-8")

  console.log(`[sign-update] ✓ Signature written: ${resolve(sigPath)}`)
  console.log(`[sign-update]   Archive: ${resolve(archivePath)}`)
}

main()
