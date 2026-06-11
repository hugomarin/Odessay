#!/usr/bin/env node
/**
 * Signs an update archive for the Tauri updater.
 *
 * Usage:
 *   node scripts/sign-update-manifest.mjs <path-to-archive>
 *
 * Environment:
 *   TAURI_SIGNING_PRIVATE_KEY — Ed25519 private key in PKCS8 PEM format
 *                               or base64-encoded raw private key.
 *
 * Output:
 *   <path-to-archive>.sig — base64-encoded Ed25519 signature
 *
 * The public key embedded in the app (tauri.conf.json) verifies this
 * signature when the updater downloads a new release.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { sign } from "node:crypto"
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

  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY
  if (!privateKey) {
    console.error(
      "TAURI_SIGNING_PRIVATE_KEY is not set.\n" +
        "  Generate a keypair and keep the private key in your CI secrets or local env.\n" +
        "  The public key must be set in src-tauri/tauri.conf.json updater.pubkey."
    )
    process.exit(1)
  }

  const archive = readFileSync(archivePath)

  // Support both PEM and base64 raw key formats
  let keyInput
  if (privateKey.includes("BEGIN PRIVATE KEY")) {
    keyInput = privateKey
  } else {
    // Try to decode as base64 and see if it's PEM inside
    const decoded = Buffer.from(privateKey, "base64").toString("utf-8")
    if (decoded.includes("BEGIN PRIVATE KEY")) {
      keyInput = decoded
    } else {
      // Assume base64-encoded raw private key bytes
      keyInput = Buffer.from(privateKey, "base64")
    }
  }

  const signature = sign(null, archive, keyInput)

  const sigPath = `${archivePath}.sig`
  const sigB64 = signature.toString("base64")
  writeFileSync(sigPath, sigB64, "utf-8")

  console.log(`[sign-update] ✓ Signature written: ${resolve(sigPath)}`)
  console.log(`[sign-update]   Archive: ${resolve(archivePath)}`)
  console.log(`[sign-update]   Sig length: ${signature.length} bytes`)
}

main()
