#!/usr/bin/env node
/**
 * Capture a Chrome DevTools performance trace for the reading view.
 * Analogous to capture-editor-trace.mjs but targeting /perf/reading-harness.
 *
 * Usage:
 *   node scripts/capture-reading-trace.mjs [--output <path>] [--route <route>]
 *     [--base-url <url>] [--timeout-ms <ms>] [--headed]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/reading-harness";
const DEFAULT_OUTPUT = "artifacts/perf/reading-trace.json.gz";
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
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const value = args[index + 1];

    if (arg === "--base-url") {
      if (!value) fail("Missing value for --base-url.");
      options.baseUrl = value;
      index += 1;
      continue;
    }

    if (arg === "--route") {
      if (!value) fail("Missing value for --route.");
      options.route = value;
      index += 1;
      continue;
    }

    if (arg === "--output") {
      if (!value) fail("Missing value for --output.");
      options.outputPath = value;
      index += 1;
      continue;
    }

    if (arg === "--timeout-ms") {
      if (!value) fail("Missing value for --timeout-ms.");
      const parsed = Number(value);
      if (!Number.isFinite(parsed) || parsed <= 0) {
        fail(`Invalid timeout value "${value}".`);
      }
      options.timeoutMs = parsed;
      index += 1;
      continue;
    }

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    fail(`Unknown argument "${arg}".`);
  }

  return options;
}

function resolveTargetUrl(baseUrl, route) {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  const normalizedRoute = route.startsWith("/") ? route : `/${route}`;
  return `${normalizedBase}${normalizedRoute}`;
}

async function readTraceFromStream(cdp, stream) {
  const chunks = [];

  while (true) {
    const response = await cdp.send("IO.read", {
      handle: stream,
      size: 1_048_576,
    });

    if (response.data) {
      const chunk = response.base64Encoded
        ? Buffer.from(response.data, "base64")
        : Buffer.from(response.data, "utf8");
      chunks.push(chunk);
    }

    if (response.eof) {
      break;
    }
  }

  await cdp.send("IO.close", { handle: stream });
  return Buffer.concat(chunks);
}

async function prepareHarness(page, targetUrl, timeoutMs) {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: timeoutMs });
  // Wait for the reading content to render
  await page.waitForSelector("[data-testid='reading-text']", { timeout: timeoutMs });
  // Click the reading body to establish focus context
  const body = page.locator("[data-testid='reading-body']").first();
  await body.click({ position: { x: 80, y: 40 } });
  // Brief warm-up pause
  await page.waitForTimeout(300);
}

async function runMeasuredScenario(page) {
  // --- Click interactions ---
  const content = page.locator("[data-testid='reading-body']").first();
  const box = await content.boundingBox();

  if (box) {
    for (let iteration = 0; iteration < 12; iteration += 1) {
      const x = box.x + 40 + ((iteration * 47) % Math.max(box.width - 100, 20));
      const y = box.y + 20 + ((iteration * 31) % Math.max(box.height - 40, 20));
      await page.mouse.click(x, y);
      await page.waitForTimeout(40);
    }
  }

  // --- Keyboard interactions — arrow keys (reading navigation) ---
  for (let i = 0; i < 20; i += 1) {
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(24);
  }
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(24);
  }
  for (let i = 0; i < 8; i += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(24);
  }
  // ESC (margin popup close — no-op in this phase)
  await page.keyboard.press("Escape");

  await page.waitForTimeout(500);
}

async function main() {
  const options = parseArgs(process.argv);
  const targetUrl = resolveTargetUrl(options.baseUrl, options.route);

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();

  await page.setViewportSize({ width: 1440, height: 900 });

  const cdp = await page.context().newCDPSession(page);

  console.log(`[ops:perf:capture-reading] Navigating to ${targetUrl}`);

  try {
    await prepareHarness(page, targetUrl, options.timeoutMs);
  } catch (error) {
    await browser.close();
    fail(
      `Harness preparation failed: ${error instanceof Error ? error.message : String(error)}\n` +
        `Make sure the dev server is running at ${options.baseUrl}.`,
    );
  }

  console.log("[ops:perf:capture-reading] Starting trace...");

  await cdp.send("Tracing.start", {
    traceConfig: {
      recordMode: "recordContinuously",
      includedCategories: [
        "devtools.timeline",
        "v8.execute",
        "disabled-by-default-devtools.timeline",
        "disabled-by-default-devtools.timeline.frame",
        "latencyInfo",
        "disabled-by-default-v8.cpu_profiler",
      ],
    },
  });

  await runMeasuredScenario(page);

  console.log("[ops:perf:capture-reading] Stopping trace...");

  const traceResult = await new Promise((resolve, reject) => {
    cdp.on("Tracing.tracingComplete", resolve);
    cdp.send("Tracing.end").catch(reject);
  });

  const traceBuffer = await readTraceFromStream(cdp, traceResult.stream);

  await browser.close();

  const compressed = gzipSync(traceBuffer);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, compressed);

  console.log(
    `[ops:perf:capture-reading] Trace saved to ${options.outputPath} (${(compressed.length / 1024).toFixed(1)} KB compressed).`,
  );
}

main().catch((error) => {
  console.error("[ops:perf:capture-reading] Unexpected error:", error);
  process.exit(1);
});
