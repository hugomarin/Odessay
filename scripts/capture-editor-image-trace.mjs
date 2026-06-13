#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/editor-harness";
const DEFAULT_OUTPUT = "artifacts/perf/editor-image-trace.json.gz";
const DEFAULT_TIMEOUT_MS = 45_000;

function fail(message) {
  console.error(`[ops:perf:capture:image] ${message}`);
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

    if (arg === "--timeout") {
      if (!value) fail("Missing value for --timeout.");
      options.timeoutMs = Number.parseInt(value, 10);
      index += 1;
      continue;
    }

    if (arg === "--headed") {
      options.headless = false;
      continue;
    }

    fail(`Unknown argument: ${arg}`);
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
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForSelector(".odessay-editor-content", { timeout: timeoutMs });
  const editor = page.locator(".odessay-editor-content").first();
  await editor.click();

  await page.keyboard.type("warmup editor", { delay: 10 });
  await page.keyboard.press(process.platform === "darwin" ? "Meta+A" : "Control+A");
  await page.keyboard.press("Backspace");
  const longFixture = Array.from({ length: 1400 }, (_, index) => {
    if (index % 140 === 0) {
      return `alpha beta gamma delta ${index + 1}`;
    }
    return `paper quiet river ${index + 1}`;
  }).join(" ");
  await page.keyboard.insertText(longFixture);
  await page.waitForTimeout(300);
}

async function runMeasuredScenario(page, targetUrl) {
  const commandKey = process.platform === "darwin" ? "Meta" : "Control";
  const editor = page.locator(".odessay-editor-content").first();

  try {
    const origin = new URL(targetUrl).origin;
    const pastePayload = " alpha beta";
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, pastePayload);
    await page.keyboard.press(`${commandKey}+V`);
  } catch {
    // Ignore clipboard restrictions
  }

  await page.keyboard.press(`${commandKey}+F`);
  await page.getByLabel("Find text").fill("alpha beta");

  for (let iteration = 0; iteration < 5; iteration += 1) {
    await page.getByLabel("Find text").press("Enter");
  }

  await page.keyboard.press(
    process.platform === "darwin" ? `${commandKey}+Alt+F` : `${commandKey}+Alt+F`,
  );
  await page.getByLabel("Replace text").fill("omega beta");
  page.once("dialog", (dialog) => dialog.accept());
  await page.getByRole("button", { name: "Replace all" }).click({ force: true });

  const box = await editor.boundingBox();
  if (box) {
    for (let iteration = 0; iteration < 5; iteration += 1) {
      const x = box.x + 48 + iteration * 24;
      const y = box.y + 56 + iteration * 12;
      await page.mouse.click(x, y);
    }
  }

  await page.waitForTimeout(900);

  // Image insertion scenario
  await page.route("**/api/writings/perf-harness-writing/images", async (route) => {
    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({
        data: { assetId: "perf-asset-id", url: "/api/writing-assets/perf-asset-id", alt: "Perf test" },
        error: null,
      }),
    });
  });

  await page.locator("#editor-action-image").click();
  await page.waitForSelector('input[type="file"]');
  const fileInput = page.locator('input[type="file"]');
  await fileInput.setInputFiles({
    name: "perf.png",
    mimeType: "image/png",
    buffer: Buffer.from("fake-image-data-for-perf"),
  });
  await page.getByRole("button", { name: "Insert image" }).click();
  await page.waitForSelector("[role='dialog']", { state: "hidden", timeout: 5000 });
  await editor.type(" After image", { delay: 10 });
}

async function main() {
  const options = parseArgs(process.argv);
  const targetUrl = resolveTargetUrl(options.baseUrl, options.route);

  const browser = await chromium.launch({ headless: options.headless });
  const context = await browser.newContext();
  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);

  const categories = [
    "-*",
    "devtools.timeline",
    "disabled-by-default-devtools.timeline",
    "disabled-by-default-devtools.timeline.inputs",
    "disabled-by-default-devtools.timeline.event-timing",
    "latencyInfo",
    "blink.user_timing",
    "loading",
    "toplevel",
  ];

  const traceCompleted = new Promise((resolve) => {
    cdp.once("Tracing.tracingComplete", resolve);
  });

  try {
    await prepareHarness(page, targetUrl, options.timeoutMs);
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });

    await runMeasuredScenario(page, targetUrl);

    await cdp.send("Tracing.end");
    const completion = await traceCompleted;
    const traceBuffer = await readTraceFromStream(cdp, completion.stream);
    const outputBuffer = options.outputPath.endsWith(".gz")
      ? gzipSync(traceBuffer)
      : traceBuffer;

    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, outputBuffer);

    console.log(
      `[ops:perf:capture:image] OK - trace stored at ${options.outputPath} (${outputBuffer.length} bytes).`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = String(error?.message ?? error);
  if (message.includes("Executable doesn't exist")) {
    fail("Chromium is not installed. Run `npx playwright install --with-deps chromium` first.");
  }
  fail(message);
});
