#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/editor-harness";
const DEFAULT_OUTPUT = "artifacts/perf/editor-trace.json.gz";
const DEFAULT_TIMEOUT_MS = 45_000;

function fail(message) {
  console.error(`[ops:perf:capture] ${message}`);
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

async function runScenario(page, targetUrl, timeoutMs) {
  await page.goto(targetUrl, { waitUntil: "networkidle", timeout: timeoutMs });
  await page.waitForSelector(".odessay-editor-content", { timeout: timeoutMs });

  const editor = page.locator(".odessay-editor-content").first();
  await editor.click();

  const typeSeed =
    "Odessay performance harness typing pass to validate EventDispatch and EventTiming.";

  for (let iteration = 0; iteration < 14; iteration += 1) {
    await page.keyboard.type(`${typeSeed} `, { delay: 12 });
  }

  const pastePayload = `\n${"Large paste block for perf gate. ".repeat(220)}\n`;
  try {
    const origin = new URL(targetUrl).origin;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, pastePayload);
    await page.keyboard.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
  } catch {
    await page.evaluate((value) => {
      const target = document.querySelector(".odessay-editor-content");
      if (!target) return;
      const dataTransfer = new DataTransfer();
      dataTransfer.setData("text/plain", value);
      target.dispatchEvent(
        new ClipboardEvent("paste", {
          bubbles: true,
          cancelable: true,
          clipboardData: dataTransfer,
        }),
      );
    }, pastePayload);
  }

  const box = await editor.boundingBox();
  if (box) {
    for (let iteration = 0; iteration < 18; iteration += 1) {
      const ratio = (iteration % 6) / 6;
      const x = box.x + 40 + ratio * Math.max(box.width - 120, 20);
      const y = box.y + 40 + ((iteration * 31) % Math.max(box.height - 80, 20));
      await page.mouse.click(x, y);
    }

    const dragStartX = box.x + 60;
    const dragEndX = Math.min(box.x + box.width - 60, dragStartX + 220);
    const dragY = box.y + Math.min(140, Math.max(box.height / 3, 50));

    await page.mouse.move(dragStartX, dragY);
    await page.mouse.down();
    await page.mouse.move(dragEndX, dragY);
    await page.mouse.up();
  }

  await page.waitForTimeout(900);
}

async function main() {
  const options = parseArgs(process.argv);
  const targetUrl = resolveTargetUrl(options.baseUrl, options.route);

  const browser = await chromium.launch({
    headless: options.headless,
  });

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
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });

    await runScenario(page, targetUrl, options.timeoutMs);

    await cdp.send("Tracing.end");
    const completion = await traceCompleted;
    const traceBuffer = await readTraceFromStream(cdp, completion.stream);
    const outputBuffer = options.outputPath.endsWith(".gz")
      ? gzipSync(traceBuffer)
      : traceBuffer;

    mkdirSync(dirname(options.outputPath), { recursive: true });
    writeFileSync(options.outputPath, outputBuffer);

    console.log(
      `[ops:perf:capture] OK - trace stored at ${options.outputPath} (${outputBuffer.length} bytes).`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  const message = String(error?.message ?? error);
  if (message.includes("Executable doesn't exist")) {
    fail(
      "Chromium is not installed. Run `npx playwright install --with-deps chromium` first.",
    );
  }
  fail(message);
});
