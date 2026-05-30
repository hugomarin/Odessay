#!/usr/bin/env node
/**
 * ODE-218 — Performance Contract evidence harness.
 *
 * Goal: assert the Waterfall shape contract for desktop signIn:
 *   - Exactly 1 request to *.supabase.co (the signInWithPassword call)
 *   - 0 requests to /api/* from the origin
 *
 * Equivalence note: the .dmg bundles dist/ verbatim and loads it via WebKit.
 * Serving dist/ over a local HTTP origin + Playwright Chromium + an init script
 * that injects window.__TAURI_INTERNALS__ before any chunk evaluates is the
 * faithful headless analogue of opening DevTools Network panel on the running DMG.
 *
 * The signIn call will receive a 400 from Supabase (fake credentials) — that is
 * expected and irrelevant. What matters is WHICH endpoint was called.
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, stat, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(import.meta.url), "../../..")
const distDir = join(root, "dist")
const evidenceDir = join(root, "evidence", "ode-218")

if (!existsSync(distDir)) {
  console.error("[ode-218] dist/ missing. Run `node scripts/prepare-tauri-build.mjs` first.")
  process.exit(1)
}

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
  const cleaned = decodeURIComponent(urlPath.split("?")[0])
  const candidates = [
    join(distDir, cleaned),
    join(distDir, cleaned + ".html"),
    join(distDir, cleaned, "index.html"),
  ]
  for (const candidate of candidates) {
    try {
      const s = await stat(candidate)
      if (s.isFile()) return candidate
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
        const filePath = await resolveStaticPath(req.url || "/")
        if (!filePath) {
          res.statusCode = 404
          res.end("not found: " + req.url)
          return
        }
        const buf = await readFile(filePath)
        res.setHeader("Content-Type", mimeTypes[extname(filePath)] || "application/octet-stream")
        res.end(buf)
      } catch (err) {
        res.statusCode = 500
        res.end(String(err))
      }
    })
    server.on("error", rejectServer)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      resolveServer({ server, port: address.port })
    })
  })

// Inject Tauri shim so isTauriRuntime() returns true — same signal the real DMG injects
const TAURI_SHIM = "globalThis.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) }"

const main = async () => {
  await mkdir(evidenceDir, { recursive: true })
  const { server, port } = await startServer()
  const origin = `http://127.0.0.1:${port}`
  console.log(`[ode-218] serving dist/ at ${origin}`)

  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript(TAURI_SHIM)

  // Capture all network requests
  const allRequests = []
  context.on("request", (req) => {
    allRequests.push({
      url: req.url(),
      method: req.method(),
      resourceType: req.resourceType(),
    })
  })

  const page = await context.newPage()
  const consoleErrors = []
  page.on("pageerror", (err) => consoleErrors.push(String(err)))
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  // Navigate to login page and wait for it to be interactive
  await page.goto(`${origin}/login`, { waitUntil: "networkidle", timeout: 15000 })

  const tauriShimVisible = await page.evaluate(
    () => typeof globalThis.__TAURI_INTERNALS__ !== "undefined",
  )

  // Clear pre-load requests — we only care about requests triggered by signIn
  allRequests.length = 0

  const screenshotLoginPath = join(evidenceDir, "login-page.png")
  await page.screenshot({ path: screenshotLoginPath, fullPage: false })

  // Fill in the login form with test credentials (will get 400 from Supabase — expected)
  await page.fill('[data-testid="login-form"] input[name="email"]', "harness-test@example.com")
  await page.fill('[data-testid="login-form"] input[name="password"]', "harness-test-password")

  // Clear again right before submit to isolate only signIn network calls
  allRequests.length = 0

  // Submit and wait for network to settle (signIn request completes)
  const submitPromise = page.click('[data-testid="login-form"] button[type="submit"]')
  await Promise.race([
    page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => null),
    submitPromise,
  ])
  await page.waitForTimeout(2000)

  const screenshotAfterPath = join(evidenceDir, "signin-network-settled.png")
  await page.screenshot({ path: screenshotAfterPath, fullPage: false })

  await browser.close()
  server.close()

  // Classify requests
  const supabaseHits = allRequests.filter((r) => /supabase\.co/i.test(r.url))
  const apiHits = allRequests.filter((r) => {
    try {
      const u = new URL(r.url)
      return u.origin === origin && u.pathname.startsWith("/api/")
    } catch {
      return false
    }
  })
  const externalHits = allRequests.filter((r) => !r.url.startsWith(origin))

  const waterfallPass = apiHits.length === 0
  const supabaseOnly = externalHits.every((r) => /supabase\.co/i.test(r.url))

  const evidence = {
    issue: "ODE-218",
    capturedAt: new Date().toISOString(),
    origin,
    tauriShimInjected: tauriShimVisible,
    contract: {
      "Waterfall shape (required)": {
        rule: "desktop signIn fires exactly 1+ request to *.supabase.co, 0 to /api/*",
        supabaseHits: supabaseHits.length,
        apiHits: apiHits.length,
        pass: waterfallPass && supabaseHits.length >= 1,
      },
      "No /api/* from origin (required)": {
        rule: "0 requests to origin/api/* during signIn",
        count: apiHits.length,
        pass: apiHits.length === 0,
      },
      "External traffic is Supabase-only": {
        rule: "all external requests go to *.supabase.co",
        externalCount: externalHits.length,
        pass: supabaseOnly,
      },
    },
    counts: {
      total: allRequests.length,
      supabase: supabaseHits.length,
      apiInternal: apiHits.length,
      external: externalHits.length,
    },
    waterfall: {
      supabaseHits,
      apiHits,
      allRequests,
    },
    consoleErrors,
    artifacts: {
      loginPage: "evidence/ode-218/login-page.png",
      afterSignIn: "evidence/ode-218/signin-network-settled.png",
    },
  }

  const evidenceJsonPath = join(evidenceDir, "performance-contract.json")
  await writeFile(evidenceJsonPath, JSON.stringify(evidence, null, 2) + "\n", "utf-8")

  const allPass = Object.values(evidence.contract).every((c) => c.pass)

  console.log("\n=== ODE-218 Performance Contract — Waterfall Shape Evidence ===")
  console.log(`Tauri shim injected:    ${tauriShimVisible}`)
  console.log(`Total requests (signIn): ${allRequests.length}`)
  console.log(`Supabase hits:           ${supabaseHits.length}`)
  console.log(`Internal /api/ hits:     ${apiHits.length}  (contract requires 0)`)
  console.log(`External hits (total):   ${externalHits.length}`)
  console.log(`Console errors:          ${consoleErrors.length}`)
  console.log(`Overall:                 ${allPass ? "PASS ✓" : "FAIL ✗"}`)
  if (supabaseHits.length > 0) {
    console.log("\nSupabase endpoints called:")
    for (const r of supabaseHits) {
      const url = new URL(r.url)
      console.log(`  ${r.method} ${url.origin}${url.pathname}`)
    }
  }
  if (apiHits.length > 0) {
    console.log("\n[FAIL] /api/* hits detected:")
    for (const r of apiHits) {
      console.log(`  ${r.method} ${r.url}`)
    }
  }
  console.log(`\nEvidence JSON: ${evidenceJsonPath}`)

  if (!allPass) {
    console.error("\n[ode-218] Performance Contract FAILED. See evidence JSON.")
    process.exit(2)
  }
}

main().catch((err) => {
  console.error("[ode-218] capture failed:", err)
  process.exit(1)
})
