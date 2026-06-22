#!/usr/bin/env node
/**
 * ODE-318 — Presentation Contract evidence harness.
 *
 * Captures the shared Workspace assignment control in every contracted state:
 *   - closed, with and without a workspace (Desk row + Preview rail variants)
 *   - open, assigned (Current / Move to / New workspace…)
 *   - open, unassigned (Add to workspace / New workspace…)
 *   - web runtime informative state (no local workspaces)
 *
 * The control is purely prop-driven, so the harness route renders all states
 * without auth or seeded data. This script spawns `next dev`, drives Chromium,
 * writes PNGs to evidence/ode-318/, then tears the server down.
 *
 * Usage: node scripts/evidence/capture-ode-318-workspace-assignment.mjs
 */
import { chromium } from "playwright"
import { spawn } from "node:child_process"
import { mkdir } from "node:fs/promises"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(import.meta.url), "../../..")
const evidenceDir = join(root, "evidence", "ode-318")
const PORT = process.env.PORT ?? "3199"
const HARNESS_URL = `http://localhost:${PORT}/evidence/workspace-assignment`

async function waitForReady(child) {
  return new Promise((resolveReady, rejectReady) => {
    const timeout = setTimeout(() => rejectReady(new Error("next dev did not become ready in time")), 90_000)
    const onData = (buf) => {
      const text = buf.toString()
      process.stdout.write(text)
      if (text.includes("Ready in") || text.includes("compiled")) {
        clearTimeout(timeout)
        resolveReady()
      }
    }
    child.stdout.on("data", onData)
    child.stderr.on("data", (buf) => process.stderr.write(buf.toString()))
  })
}

async function openAndShoot(page, ariaLabel, file) {
  await page.keyboard.press("Escape").catch(() => {})
  await page.waitForTimeout(150)
  await page.click(`[aria-label="Manage workspace for ${ariaLabel}"]`)
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(evidenceDir, file), fullPage: true })
}

async function main() {
  await mkdir(evidenceDir, { recursive: true })

  // TAURI_ENV short-circuits the auth middleware (see lib/supabase/middleware.ts)
  // so the prop-only presentation harness under /evidence renders without a
  // signed-in session. The control needs no runtime — it is fully prop-driven.
  const dev = spawn("npm", ["run", "dev"], {
    cwd: root,
    env: { ...process.env, PORT, TAURI_ENV: "true" },
  })

  try {
    await waitForReady(dev)
    const browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1100, height: 1000 }, deviceScaleFactor: 2 })

    await page.goto(HARNESS_URL, { waitUntil: "networkidle" })
    await page.waitForSelector('[data-testid="ode-318-workspace-harness"]')
    await page.waitForTimeout(500)

    await page.screenshot({ path: join(evidenceDir, "01-closed-states.png"), fullPage: true })
    await openAndShoot(page, "Open assigned", "02-open-assigned.png")
    await openAndShoot(page, "Open unassigned", "03-open-unassigned.png")
    await openAndShoot(page, "Rail assigned", "04-rail-open.png")
    await openAndShoot(page, "Web informative", "05-web-informative.png")

    await browser.close()
    console.log(`[ode-318] evidence written to ${evidenceDir}`)
  } finally {
    dev.kill("SIGTERM")
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
