#!/usr/bin/env node
/**
 * ODE-221 — Performance Contract evidence harness.
 *
 * Goal: assert the Waterfall shape contract for desktop Settings > Account:
 *   - Display name, username, email, and password updates hit Supabase directly
 *   - 0 requests to /api/user/* or /api/auth/* from the local origin
 *
 * Equivalence note: the .dmg bundles dist/ verbatim and loads it via WebKit.
 * Serving dist/ over a local HTTP origin + Playwright Chromium + a Tauri shim
 * that implements the desktop keychain commands in-memory is the faithful
 * headless analogue of opening DevTools Network panel on the running DMG.
 */
import { createClient } from "@supabase/supabase-js"
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, stat, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import crypto from "node:crypto"

const root = resolve(fileURLToPath(import.meta.url), "../../..")
const distDir = join(root, "dist")
const evidenceDir = join(root, "evidence", "ode-221")

if (!existsSync(distDir)) {
  console.error("[ode-221] dist/ missing. Run `node scripts/prepare-tauri-build.mjs` first.")
  process.exit(1)
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY

if (!supabaseUrl || !serviceRoleKey) {
  console.error("[ode-221] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
  process.exit(1)
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
})

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".map": "application/json",
  ".txt": "text/plain; charset=utf-8",
}

const resolveStaticPath = async (urlPath) => {
  const cleaned = decodeURIComponent((urlPath || "/").split("?")[0])
  const candidates = [
    join(distDir, cleaned),
    join(distDir, cleaned + ".html"),
    join(distDir, cleaned, "index.html"),
  ]

  for (const candidate of candidates) {
    try {
      const file = await stat(candidate)
      if (file.isFile()) {
        return candidate
      }
    } catch {
      /* try next */
    }
  }

  return null
}

const startServer = () =>
  new Promise((resolveServer, rejectServer) => {
    const server = createServer(async (req, res) => {
      try {
        const filePath = await resolveStaticPath(req.url)
        if (!filePath) {
          res.statusCode = 404
          res.end(`not found: ${req.url}`)
          return
        }

        const body = await readFile(filePath)
        res.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream")
        res.end(body)
      } catch (error) {
        res.statusCode = 500
        res.end(String(error))
      }
    })

    server.on("error", rejectServer)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolveServer({ server, port: address.port })
    })
  })

const TAURI_SHIM = `
  (() => {
    const keychain = new Map()
    globalThis.__TAURI_INTERNALS__ = {
      invoke(command, args = {}) {
        if (command === "keychain_write_token") {
          keychain.set(args.account, args.value)
          return Promise.resolve(null)
        }
        if (command === "keychain_read_token") {
          return Promise.resolve(keychain.get(args.account) ?? null)
        }
        if (command === "keychain_delete_token") {
          keychain.delete(args.account)
          return Promise.resolve(null)
        }
        return Promise.resolve(null)
      },
    }
  })()
`

function classifyRequests(origin, requests) {
  const apiHits = requests.filter((request) => {
    try {
      const url = new URL(request.url)
      return url.origin === origin && url.pathname.startsWith("/api/")
    } catch {
      return false
    }
  })

  const supabaseHits = requests.filter((request) => /supabase\.co/i.test(request.url))

  return {
    total: requests.length,
    apiHits,
    supabaseHits,
    pass: apiHits.length === 0 && supabaseHits.length >= 1,
  }
}

async function createHarnessUser() {
  const nonce = crypto.randomUUID().slice(0, 8)
  const email = `ode-221-${nonce}@example.com`
  const password = `Ode221!${nonce}x9`
  const username = `ode221_${nonce}`
  const displayName = `ODE 221 ${nonce}`

  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      display_name: displayName,
      username,
    },
  })

  if (error || !data.user) {
    throw error ?? new Error("Could not create ODE-221 harness user.")
  }

  const { error: profileError } = await admin.from("profiles").upsert(
    {
      id: data.user.id,
      username,
      display_name: displayName,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "id" },
  )

  if (profileError) {
    throw profileError
  }

  return {
    userId: data.user.id,
    email,
    password,
    username,
    displayName,
  }
}

async function cleanupHarnessUser(userId) {
  const { error } = await admin.auth.admin.deleteUser(userId)
  if (error) {
    console.error("[ode-221] cleanup failed:", error.message)
  }
}

async function waitForResult(page, expectedPrefix) {
  await page.waitForFunction(
    ([testId, prefix]) => {
      const node = document.querySelector(`[data-testid="${testId}"]`)
      return node?.textContent?.startsWith(prefix)
    },
    ["ode-221-last-result", expectedPrefix],
    { timeout: 15000 },
  )
}

const main = async () => {
  await mkdir(evidenceDir, { recursive: true })
  const harnessUser = await createHarnessUser()
  const { server, port } = await startServer()
  const origin = `http://127.0.0.1:${port}`
  const requests = []
  const responses = []
  const stepEvidence = []

  let browser

  try {
    browser = await chromium.launch()
    const context = await browser.newContext()
    await context.addInitScript(TAURI_SHIM)
    context.on("request", (request) => {
      requests.push({
        url: request.url(),
        method: request.method(),
        resourceType: request.resourceType(),
      })
    })
    context.on("response", async (response) => {
      responses.push({
        url: response.url(),
        status: response.status(),
      })
    })

    const page = await context.newPage()
    const consoleErrors = []
    page.on("pageerror", (error) => consoleErrors.push(String(error)))
    page.on("console", (msg) => {
      if (msg.type() === "error") {
        consoleErrors.push(msg.text())
      }
    })

    const harnessUrl = new URL(`${origin}/evidence/settings-account`)
    harnessUrl.searchParams.set("email", harnessUser.email)
    harnessUrl.searchParams.set("password", harnessUser.password)
    harnessUrl.searchParams.set("displayName", harnessUser.displayName)
    harnessUrl.searchParams.set("username", harnessUser.username)
    harnessUrl.searchParams.set("nextDisplayName", `${harnessUser.displayName} Updated`)
    harnessUrl.searchParams.set("nextUsername", `${harnessUser.username}_next`)
    harnessUrl.searchParams.set(
      "nextEmail",
      `ode-221-email-${crypto.randomUUID().slice(0, 8)}@example.com`,
    )
    harnessUrl.searchParams.set("nextPassword", `Ode221!${crypto.randomUUID().slice(0, 8)}z9`)

    await page.goto(harnessUrl.toString(), { waitUntil: "networkidle", timeout: 15000 })
    await page.getByTestId("ode-221-settings-harness").waitFor({ state: "visible", timeout: 15000 })
    requests.length = 0
    responses.length = 0
    await page.getByTestId("ode-221-update-display-name").click()
    try {
      await waitForResult(page, "ok:displayName:")
    } catch (error) {
      console.error("[ode-221] updateDisplayName failed")
      console.error("[ode-221] requests:\n" + JSON.stringify(requests, null, 2))
      console.error("[ode-221] responses:\n" + JSON.stringify(responses, null, 2))
      console.error("[ode-221] console errors:\n" + JSON.stringify(consoleErrors, null, 2))
      throw error
    }
    stepEvidence.push({
      step: "updateDisplayName",
      ...classifyRequests(origin, [...requests]),
    })

    requests.length = 0
    responses.length = 0
    await page.getByTestId("ode-221-update-username").click()
    await waitForResult(page, "ok:username:")
    stepEvidence.push({
      step: "updateUsername",
      ...classifyRequests(origin, [...requests]),
    })

    requests.length = 0
    responses.length = 0
    await page.getByTestId("ode-221-update-email").click()
    await waitForResult(page, "ok:email:")
    stepEvidence.push({
      step: "requestEmailChange",
      ...classifyRequests(origin, [...requests]),
    })

    requests.length = 0
    responses.length = 0
    await page.getByTestId("ode-221-update-password").click()
    await waitForResult(page, "ok:password:")
    stepEvidence.push({
      step: "updatePassword",
      ...classifyRequests(origin, [...requests]),
    })

    const screenshotPath = join(evidenceDir, "settings-account.png")
    await page.screenshot({ path: screenshotPath, fullPage: true })

    const evidence = {
      issue: "ODE-221",
      capturedAt: new Date().toISOString(),
      origin,
      contract: {
        "Waterfall shape (required)": {
          rule: "desktop settings account mutations hit Supabase directly and 0 origin /api/* routes",
          pass: stepEvidence.every((step) => step.pass),
        },
      },
      steps: stepEvidence,
      consoleErrors,
      artifacts: {
        screenshot: "evidence/ode-221/settings-account.png",
      },
    }

    const evidenceJsonPath = join(evidenceDir, "performance-contract.json")
    await writeFile(evidenceJsonPath, JSON.stringify(evidence, null, 2) + "\n", "utf-8")

    console.log("\n=== ODE-221 Performance Contract — Settings Waterfall Evidence ===")
    for (const step of stepEvidence) {
      console.log(
        `${step.step}: supabase=${step.supabaseHits.length} api=${step.apiHits.length} pass=${step.pass ? "PASS" : "FAIL"}`,
      )
    }
    console.log(`Console errors: ${consoleErrors.length}`)
    console.log(`Evidence JSON: ${evidenceJsonPath}`)

    if (!evidence.contract["Waterfall shape (required)"].pass) {
      process.exitCode = 2
    }
  } finally {
    await browser?.close()
    server.close()
    await cleanupHarnessUser(harnessUser.userId)
  }

  if (process.exitCode && process.exitCode !== 0) {
    process.exit(process.exitCode)
  }
}

main().catch((error) => {
  console.error("[ode-221] capture failed:", error)
  process.exit(1)
})
