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
    scenario: "editor",
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

    if (arg === "--scenario") {
      if (value !== "editor" && value !== "notes-annotations") {
        fail(`Invalid scenario "${value}".`);
      }
      options.scenario = value;
      index += 1;
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

async function prepareHarness(page, targetUrl, timeoutMs, scenario) {
  if (scenario === "notes-annotations") {
    await page.route("**/api/writings/**", async (route) => {
      if (route.request().method() === "PATCH") {
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ data: null, error: null }),
        });
        return;
      }
      await route.continue();
    });
  }

  await page.goto(targetUrl, { waitUntil: "domcontentloaded", timeout: timeoutMs });
  await page.waitForSelector(".odessay-editor-content", { timeout: timeoutMs });

  if (scenario === "notes-annotations") {
    await page.getByRole("button", { name: "Markdown" }).click();
    const markdown = page.getByLabel("Markdown source");
    const types = ["ai", "personal", "footnote", "highlight"];
    const sigil = (type, index) => {
      if (type === "personal") return `@p${index}`;
      if (type === "footnote") return `^${index}`;
      if (type === "highlight") return `@h${index}`;
      return `@${index}`;
    };
    const typeCounts = new Map();
    const fixture = Array.from({ length: 24 }, (_, index) => {
      const type = types[index % types.length];
      const typeIndex = (typeCounts.get(type) ?? 0) + 1;
      typeCounts.set(type, typeIndex);
      return `==Annotation anchor ${index + 1}==[${sigil(type, typeIndex)}|perf-${index + 1}: Annotation note ${index + 1}]`;
    }).join("\n\n");
    await markdown.fill(fixture);
    await page.getByRole("button", { name: "Notes panel" }).click();
    const panel = page.getByTestId("editor-panel-notes");
    await panel.waitFor({ state: "visible", timeout: timeoutMs });
    await page.waitForFunction(
      () => document.querySelectorAll('[data-testid="editor-panel-notes"] article').length >= 24,
      undefined,
      { timeout: timeoutMs },
    );
    await page.waitForTimeout(300);
    return;
  }

  const editor = page.locator(".odessay-editor-content").first();
  await editor.click();

  // Warm-up to exclude first-render and first-input initialization work from the measured trace.
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

async function runMeasuredScenario(page, targetUrl, scenario) {
  if (scenario === "notes-annotations") {
    const panel = page.getByTestId("editor-panel-notes");
    const aiCard = panel.locator("article").filter({ hasText: "“Annotation anchor 1”" });
    const textarea = aiCard.locator("textarea");
    await textarea.fill("Updated annotation note from the performance scenario");
    try {
      const origin = new URL(targetUrl).origin;
      await page.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin });
      await page.evaluate(async () => {
        await navigator.clipboard.writeText(" pasted");
      });
      await textarea.press("End");
      await textarea.press(process.platform === "darwin" ? "Meta+V" : "Control+V");
    } catch {
      // Ignore clipboard restrictions in perf environments that do not expose it.
    }
    await aiCard.locator("button").filter({ hasText: "AI" }).click();
    await aiCard.getByRole("button", { name: "Personal" }).click();

    const footnoteCard = panel.locator("article").filter({ hasText: "“Annotation anchor 3”" });
    await footnoteCard.getByRole("button", { name: "Go to annotation in document" }).click({ force: true });

    const highlightCard = panel.locator("article").filter({ hasText: "“Annotation anchor 4”" });
    await highlightCard.getByRole("button", { name: "Delete Highlight" }).click({ force: true });
    await panel.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.waitForTimeout(900);
    return;
  }

  const commandKey = process.platform === "darwin" ? "Meta" : "Control";
  const editor = page.locator(".odessay-editor-content").first();

  try {
    const origin = new URL(targetUrl).origin;
    const pastePayload = " alpha beta";
    await page.context().grantPermissions(["clipboard-read", "clipboard-write"], {
      origin,
    });
    await page.evaluate(async (value) => {
      await navigator.clipboard.writeText(value);
    }, pastePayload);
    await page.keyboard.press(`${commandKey}+V`);
  } catch {
    // Ignore clipboard restrictions in perf environments that do not expose it.
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
    await prepareHarness(page, targetUrl, options.timeoutMs, options.scenario);
    await cdp.send("Tracing.start", {
      transferMode: "ReturnAsStream",
      categories: categories.join(","),
      options: "record-as-much-as-possible",
    });

    await runMeasuredScenario(page, targetUrl, options.scenario);

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
