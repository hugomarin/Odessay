#!/usr/bin/env node

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { gzipSync } from "node:zlib";
import { chromium } from "playwright";

const DEFAULT_BASE_URL = "http://127.0.0.1:3000";
const DEFAULT_ROUTE = "/perf/write-harness";
const DEFAULT_OUTPUT = "artifacts/perf/tab-switch-trace.json.gz";
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

async function prepareHarness(page, targetUrl, timeoutMs) {
  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForSelector(".odessay-editor-content", { timeout: timeoutMs });
  const editor = page.locator(".odessay-editor-content").first();
  await editor.click();

  // Inject a long document to make the viewport scrollable
  const longParagraph =
    "Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Ut enim ad minim veniam, quis nostrud exercitation ullamco laboris nisi ut aliquip ex ea commodo consequat. Duis aute irure dolor in reprehenderit in voluptate velit esse cillum dolore eu fugiat nulla pariatur. Excepteur sint occaecat cupidatat non proident, sunt in culpa qui officia deserunt mollit anim id est laborum.\n\n";

  const repeatedText = longParagraph.repeat(60);

  await editor.evaluate((element, text) => {
    const view = element.view;
    if (view && typeof view.dispatch === "function") {
      const { state } = view;
      const tr = state.tr.insertText(text, 1);
      view.dispatch(tr);
    } else {
      element.textContent = text;
    }
  }, repeatedText);

  await page.keyboard.press("Control+Home");
  await page.waitForTimeout(300);

  // Scroll down several screens
  const editorWritingArea = page.locator('[data-testid="editor-writing-area"]');
  await editorWritingArea.evaluate((element) => {
    element.scrollTop = 3000;
  });
  await page.evaluate(() => {
    window.scrollTo(0, 3000);
  });
  await page.waitForTimeout(300);
}

async function runMeasuredScenario(page) {
  const commandKey = process.platform === "darwin" ? "Meta" : "Control";
  const originalTabButton = page.locator('button[aria-label^="Open"]').first();

  // Switch to a new draft tab
  await page.getByRole("button", { name: "New writing" }).click();
  await page.waitForTimeout(300);

  // Switch back to the original tab
  await originalTabButton.click();
  await page.waitForTimeout(600);

  // Repeat the cycle to gather more samples
  await page.getByRole("button", { name: "New writing" }).click();
  await page.waitForTimeout(300);
  await originalTabButton.click();
  await page.waitForTimeout(600);

  // Include minimal editor input so required keydown/input metrics are present
  const editor = page.locator(".odessay-editor-content").first();
  await editor.click();
  await page.keyboard.type("abc", { delay: 10 });
  await page.keyboard.press("Backspace");

  try {
    const origin = new URL(page.url()).origin;
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
    await page.evaluate(async () => {
      await navigator.clipboard.writeText(" pasted");
    });
    await page.keyboard.press(`${commandKey}+V`);
  } catch {
    // Ignore clipboard restrictions in perf environments.
  }

  await page.waitForTimeout(300);
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

  await prepareHarness(page, targetUrl, options.timeoutMs);

  try {
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });
  } catch {
    // Tracing may already be active from a previous run; ignore.
  }

  await runMeasuredScenario(page);

  await cdp.send("Tracing.end");
  const completion = await traceCompleted;
  const traceBuffer = await readTraceFromStream(cdp, completion.stream);

  const compressed = gzipSync(traceBuffer);
  mkdirSync(dirname(options.outputPath), { recursive: true });
  writeFileSync(options.outputPath, compressed);

  await browser.close();
  console.log(`[ops:perf:capture] Trace written to ${options.outputPath} (${compressed.length} bytes)`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
