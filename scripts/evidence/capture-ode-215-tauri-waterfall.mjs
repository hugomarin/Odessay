#!/usr/bin/env node
/**
 * ODE-215 — Performance Contract evidence harness.
 *
 * Goal: programmatically reproduce the same conditions the Tauri DMG hits at
 * launch and assert the two contract requirements:
 *   - Waterfall: 0 requests to *.supabase.co/auth/* or /api/* during /desk first paint
 *   - TTI: performance.getEntriesByType("navigation")[0].domInteractive < 1500 ms
 *
 * Equivalence note: the .dmg bundles dist/ verbatim and loads it via WebKit.
 * Serving dist/ over a local HTTP origin + Playwright Chromium + an init script
 * that injects window.__TAURI_INTERNALS__ before any chunk evaluates is the
 * faithful headless analogue of opening DevTools on the running DMG.
 */
import { chromium } from "playwright"
import { createServer } from "node:http"
import { readFile, stat, writeFile, mkdir } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const root = resolve(fileURLToPath(import.meta.url), "../../..")
const distDir = join(root, "dist")
const evidenceDir = join(root, "evidence", "ode-215")

if (!existsSync(distDir)) {
  console.error("[ode-215] dist/ missing. Run `node scripts/prepare-tauri-build.mjs` first.")
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

const TAURI_RESERVED = "globalThis.__TAURI_INTERNALS__ = { invoke: () => Promise.resolve(null) }"

const main = async () => {
  await mkdir(evidenceDir, { recursive: true })
  const { server, port } = await startServer()
  const origin = `http://127.0.0.1:${port}`
  console.log(`[ode-215] serving dist/ at ${origin}`)

  const browser = await chromium.launch()
  const context = await browser.newContext()
  await context.addInitScript(TAURI_RESERVED)

  const requests = []
  context.on("request", (req) => {
    requests.push({ url: req.url(), method: req.method(), resourceType: req.resourceType() })
  })

  const page = await context.newPage()
  const consoleErrors = []
  page.on("pageerror", (err) => consoleErrors.push(String(err)))
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text())
  })

  const startedAt = Date.now()
  await page.goto(`${origin}/desk`, { waitUntil: "networkidle", timeout: 15000 })

  const tauriShimVisible = await page.evaluate(
    () => typeof globalThis.__TAURI_INTERNALS__ !== "undefined",
  )

  const navigation = await page.evaluate(() => {
    const entry = performance.getEntriesByType("navigation")[0]
    if (!entry) return null
    return {
      startTime: entry.startTime,
      domInteractive: entry.domInteractive,
      domContentLoadedEventEnd: entry.domContentLoadedEventEnd,
      loadEventEnd: entry.loadEventEnd,
    }
  })

  const waterfallEndedAt = Date.now()

  const screenshotPath = join(evidenceDir, "desk-first-paint.png")
  await page.screenshot({ path: screenshotPath, fullPage: false })

  await browser.close()
  server.close()

  const supabaseAuthHits = requests.filter((r) => /supabase\.co\/auth\//i.test(r.url))
  const apiHits = requests.filter((r) => {
    const u = new URL(r.url)
    return u.origin === origin && u.pathname.startsWith("/api/")
  })
  const externalHits = requests.filter((r) => !r.url.startsWith(origin))

  const ttiMs = navigation?.domInteractive ?? null
  const ttiPasses = typeof ttiMs === "number" && ttiMs < 1500

  const evidence = {
    issue: "ODE-215",
    capturedAt: new Date().toISOString(),
    origin,
    tauriShimInjected: tauriShimVisible,
    wallClockMs: waterfallEndedAt - startedAt,
    navigation,
    counts: {
      total: requests.length,
      external: externalHits.length,
      supabaseAuth: supabaseAuthHits.length,
      apiInternal: apiHits.length,
    },
    waterfall: {
      supabaseAuthHits,
      apiHits,
      externalHits,
      allRequests: requests,
    },
    contract: {
      "Waterfall (required)": {
        rule: "0 requests to *.supabase.co/auth/* or /api/*",
        pass: supabaseAuthHits.length === 0 && apiHits.length === 0,
      },
      "TTI (required)": {
        rule: "performance.getEntriesByType(\"navigation\")[0].domInteractive < 1500 ms",
        observedMs: ttiMs,
        pass: ttiPasses,
      },
    },
    consoleErrors,
    artifacts: {
      screenshot: "evidence/ode-215/desk-first-paint.png",
    },
  }

  const evidenceJsonPath = join(evidenceDir, "performance-contract.json")
  await writeFile(evidenceJsonPath, JSON.stringify(evidence, null, 2) + "\n", "utf-8")

  const allPass =
    evidence.contract["Waterfall (required)"].pass && evidence.contract["TTI (required)"].pass

  console.log("\n=== ODE-215 Performance Contract — Evidence Summary ===")
  console.log(`Tauri shim visible:       ${tauriShimVisible}`)
  console.log(`Total requests captured:  ${requests.length}`)
  console.log(`Supabase auth hits:       ${supabaseAuthHits.length}`)
  console.log(`Internal /api/ hits:      ${apiHits.length}`)
  console.log(`External hits:            ${externalHits.length}`)
  console.log(`Navigation domInteractive: ${ttiMs} ms (budget < 1500)`)
  console.log(`Screenshot:               ${screenshotPath}`)
  console.log(`Evidence JSON:            ${evidenceJsonPath}`)
  console.log(`Console errors:           ${consoleErrors.length}`)
  console.log(`Overall:                  ${allPass ? "PASS" : "FAIL"}`)

  if (!allPass) {
    console.error("\n[ode-215] Performance Contract FAILED. See evidence JSON for details.")
    process.exit(2)
  }
}

main().catch((err) => {
  console.error("[ode-215] capture failed:", err)
  process.exit(1)
})
