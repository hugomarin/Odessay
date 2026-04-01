#!/usr/bin/env node
/**
 * capture-reading-trace.mjs — perf trace para reading view + margins (ODE-65)
 *
 * Escenario: navegar a /perf/reading-harness → esperar #reading-body →
 *   seleccionar texto → interactuar con popup → abrir/cerrar panel de márgenes
 *
 * Usage:
 *   node scripts/capture-reading-trace.mjs \
 *     --base-url http://127.0.0.1:3000 \
 *     --output artifacts/perf/margins-trace.json.gz
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/reading-harness";
const DEFAULT_OUTPUT = "artifacts/perf/margins-trace.json.gz";
const DEFAULT_TIMEOUT_MS = 45_000;

function fail(message) {
  console.error(`[ops:perf:capture-reading] ${message}`);
  process.exit(1);
}

function parseArgs(argv) {
  const options = {
    baseUrl: DEFAULT_BASE_URL,
    route: DEFAULT_ROUTE,
    outputPath: DEFAULT_OUTPUT,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    headless: true,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const val = args[i + 1];
    if (arg === "--base-url") { options.baseUrl = val; i++; continue; }
    if (arg === "--route")    { options.route = val; i++; continue; }
    if (arg === "--output")   { options.outputPath = val; i++; continue; }
    if (arg === "--headed")   { options.headless = false; continue; }
    if (arg === "--timeout-ms") {
      const n = Number(val);
      if (!Number.isFinite(n) || n <= 0) fail(`Invalid timeout "${val}".`);
      options.timeoutMs = n; i++; continue;
    }
    fail(`Unknown argument "${arg}".`);
  }
  return options;
}

async function readTraceFromStream(cdp, stream) {
  const chunks = [];
  while (true) {
    const r = await cdp.send("IO.read", { handle: stream, size: 1_048_576 });
    if (r.data) chunks.push(r.base64Encoded ? Buffer.from(r.data, "base64") : Buffer.from(r.data, "utf8"));
    if (r.eof) break;
  }
  await cdp.send("IO.close", { handle: stream });
  return Buffer.concat(chunks);
}

async function main() {
  const opts = parseArgs(process.argv);
  const base = opts.baseUrl.replace(/\/$/, "");
  const route = opts.route.startsWith("/") ? opts.route : `/${opts.route}`;
  const url = `${base}${route}`;

  console.log(`[ops:perf:capture-reading] target: ${url}`);
  console.log(`[ops:perf:capture-reading] output: ${opts.outputPath}`);

  const browser = await chromium.launch({ headless: opts.headless });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);

  const categories = [
    "-*","devtools.timeline","disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.inputs",
    "disabled-by-default-devtools.timeline.event-timing",
    "latencyInfo","blink.user_timing","loading","toplevel",
  ];

  const traceCompleted = new Promise(r => cdp.once("Tracing.tracingComplete", r));

  try {
    // ── 1. Navigate and wait for reading body ──
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs });
    await page.waitForSelector("#reading-body", { timeout: opts.timeoutMs });
    await page.waitForTimeout(400);

    // ── 2. Start trace ──
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });

    // ── 3. Measured scenario ──
    const body = page.locator("#reading-body");
    const box = await body.boundingBox();
    if (!box) fail("Could not locate #reading-body bounding box.");

    // Text selection drag
    await page.mouse.move(box.x + 40, box.y + 60);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Dismiss selection popup (it will be shown but margins API will 401 — that's OK)
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    // Toggle margin panel open (topbar button)
    const toggle = page.locator('[aria-label="Open margins"]');
    const toggleOk = await toggle.isVisible().catch(() => false);
    if (toggleOk) {
      await toggle.click();
      await page.waitForTimeout(400); // 300ms animation + buffer
    }

    // Scroll reading area
    const scrollEl = page.locator('[data-section="reading-text"]');
    const scrollBox = await scrollEl.boundingBox().catch(() => null);
    if (scrollBox) {
      await page.mouse.move(scrollBox.x + scrollBox.width / 2, scrollBox.y + scrollBox.height / 2);
      await page.mouse.wheel(0, 400);
      await page.waitForTimeout(200);
      await page.mouse.wheel(0, -400);
      await page.waitForTimeout(200);
    }

    // Close panel
    const closeBtn = page.locator('[aria-label="Close margins"]');
    const closeOk = await closeBtn.isVisible().catch(() => false);
    if (closeOk) {
      await closeBtn.click();
      await page.waitForTimeout(400);
    }

    await page.waitForTimeout(500);

    // ── 4. Stop trace and save ──
    await cdp.send("Tracing.end");
    const completion = await traceCompleted;
    const traceBuf = await readTraceFromStream(cdp, completion.stream);
    const out = opts.outputPath.endsWith(".gz") ? gzipSync(traceBuf) : traceBuf;

    mkdirSync(dirname(opts.outputPath), { recursive: true });
    writeFileSync(opts.outputPath, out);
    console.log(`[ops:perf:capture-reading] OK - ${opts.outputPath} (${out.length} bytes)`);

  } finally {
    await browser.close();
  }
}

main().catch(err => {
  const msg = String(err?.message ?? err);
  if (msg.includes("Executable doesn't exist")) {
    fail("Chromium not installed. Run: npx playwright install --with-deps chromium");
  }
  fail(msg);
});
