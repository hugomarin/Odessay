#!/usr/bin/env node
/**
 * capture-collections-trace.mjs — perf trace para /collections y /collections/[id] (ODE-111)
 *
 * Escenario: navegar a /perf/collections-harness → esperar grid de colecciones →
 *   hacer clic en una collection card → verificar detail panel →
 *   hover sobre writing rows → clic en action buttons
 *
 * Usage:
 *   node scripts/capture-collections-trace.mjs \
 *     --base-url http://127.0.0.1:3000 \
 *     --output artifacts/perf/collections-trace.json.gz
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/collections-harness";
const DEFAULT_OUTPUT = "artifacts/perf/collections-trace.json.gz";
const DEFAULT_TIMEOUT_MS = 45_000;

function fail(message) {
  console.error(`[ops:perf:capture-collections] ${message}`);
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

  console.log(`[ops:perf:capture-collections] target: ${url}`);
  console.log(`[ops:perf:capture-collections] output: ${opts.outputPath}`);

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
    // ── 1. Navigate and wait for collections grid ──
    await page.goto(url, { waitUntil: "networkidle", timeout: opts.timeoutMs });
    await page.waitForSelector('[data-testid="collections-harness"]', { timeout: opts.timeoutMs });
    await page.waitForTimeout(400);

    // ── 2. Start trace ──
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });

    // ── 3. Measured scenario ──

    // Click a collection card — simulates sidebar → /collections → collection card navigation
    const card = page.locator('[data-testid="collection-card-col-letters"]');
    const cardOk = await card.isVisible().catch(() => false);
    if (cardOk) {
      await card.click();
      await page.waitForTimeout(300);
    }

    // Click uncategorized card
    const uncategorizedCard = page.locator('[data-testid="collection-card-uncategorized"]');
    const uncategorizedOk = await uncategorizedCard.isVisible().catch(() => false);
    if (uncategorizedOk) {
      await uncategorizedCard.click();
      await page.waitForTimeout(200);
    }

    // Click New collection card
    const newCollectionCard = page.locator('[data-testid="new-collection-card"]');
    const newCardOk = await newCollectionCard.isVisible().catch(() => false);
    if (newCardOk) {
      await newCollectionCard.click();
      await page.waitForTimeout(150);
    }

    // Press Escape — generates keydown event required by budget
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);

    // Hover over writing rows in detail list and interact with action buttons
    const detailList = page.locator('[data-testid="collection-detail-list"]');
    const detailOk = await detailList.isVisible().catch(() => false);
    if (detailOk) {
      const rows = page.locator('[data-testid^="writing-row-"]');
      const rowCount = await rows.count();

      for (let i = 0; i < rowCount; i++) {
        const row = rows.nth(i);
        const box = await row.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
          await page.waitForTimeout(160); // let hover opacity transition settle
        }
      }

      // Click a Rename button
      const renameBtn = page.locator('[data-testid="rename-collection-btn"]');
      const renameOk = await renameBtn.isVisible().catch(() => false);
      if (renameOk) {
        await renameBtn.click();
        await page.waitForTimeout(150);
        await page.keyboard.press("Escape");
        await page.waitForTimeout(100);
      }

      // Click Remove from collection on first row
      const removeBtn = page.locator('[data-testid="remove-btn-w-1"]');
      const removeOk = await removeBtn.isVisible().catch(() => false);
      if (removeOk) {
        await removeBtn.click();
        await page.waitForTimeout(200);
      }
    }

    // Additional clicks to improve click stats
    const extraCards = page.locator('[data-testid^="collection-card-"]');
    const extraCount = await extraCards.count();
    for (let i = 0; i < Math.min(extraCount, 3); i++) {
      const box = await extraCards.nth(i).boundingBox().catch(() => null);
      if (box) {
        await page.mouse.click(box.x + 20, box.y + 20);
        await page.waitForTimeout(100);
      }
    }

    await page.waitForTimeout(500);

    // ── 4. Stop trace and save ──
    await cdp.send("Tracing.end");
    const completion = await traceCompleted;
    const traceBuf = await readTraceFromStream(cdp, completion.stream);
    const out = opts.outputPath.endsWith(".gz") ? gzipSync(traceBuf) : traceBuf;

    mkdirSync(dirname(opts.outputPath), { recursive: true });
    writeFileSync(opts.outputPath, out);
    console.log(`[ops:perf:capture-collections] OK - ${opts.outputPath} (${out.length} bytes)`);

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
