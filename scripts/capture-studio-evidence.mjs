#!/usr/bin/env node

/**
 * ODE-433 — visual and time-to-interactive evidence for the Studio shell.
 *
 *   node scripts/capture-studio-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
 *
 * Captures the shell at 1440 / 1100 / 768 in every panel combination, the
 * overflowed tab strip, a side-by-side of each region against the Studio
 * prototype, a focus-mode recording, and the measured time to interactive.
 *
 * The app must be built and served with ODESSAY_PERF_HARNESS_ENABLED=true; the
 * prototypes come from docs/design/reference (see its README). `--vendor` serves
 * their unpkg dependencies from disk when unpkg is unreachable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUTPUT_DIR = "artifacts/design/ode-433";
const WIDTHS = [1440, 1100, 768];

const FIXTURE = [
  "# Studio shell",
  "",
  "A paragraph of body text long enough to wrap inside the sheet and show the 720px measure at every width.",
  "",
  "## Second section",
  "",
  "Another paragraph, so the table of contents has something to build a tree from.",
  "",
  "## Third section",
  "",
  "One more paragraph to give the panel a scroll.",
].join("\n");

const VENDOR_FILES = {
  "react@18.3.1/umd/react.production.min.js": "react/umd/react.production.min.js",
  "react-dom@18.3.1/umd/react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "lucide@0.469.0/dist/umd/lucide.js": "lucide/dist/umd/lucide.js"
};

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
    else {
      console.error(`[ode-433:evidence] Unknown argument "${args[index]}".`);
      process.exit(1);
    }
  }

  return options;
}

async function routeVendoredDeps(context, vendorDir) {
  await context.route("https://unpkg.com/**", async (route) => {
    const requested = route.request().url().replace("https://unpkg.com/", "");
    const relative = VENDOR_FILES[requested];
    const filePath = relative ? `${vendorDir}/${relative}` : null;

    if (!filePath || !existsSync(filePath)) {
      await route.abort();
      return;
    }

    await route.fulfill({ status: 200, contentType: "application/javascript", body: readFileSync(filePath) });
  });
}

async function openHarness(context, appUrl, { type = true } = {}) {
  const page = await context.newPage();
  await page.goto(`${appUrl}/perf/editor-harness`, { waitUntil: "networkidle" });
  await page.locator(".odessay-editor-content").first().waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForTimeout(1500);

  if (type) {
    await page.locator(".odessay-editor-content").first().click();
    await page.keyboard.type(FIXTURE, { delay: 1 });
    await page.waitForTimeout(900);
  }

  return page;
}

const toggle = async (page, label) => {
  const button = page.locator(`button[aria-label="${label}"]`).first();
  if (await button.count()) {
    await button.click({ force: true });
    await page.waitForTimeout(700);
  }
};

async function captureStates(browser, options) {
  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const page = await openHarness(context, options.app);

    await page.screenshot({ path: `${OUTPUT_DIR}/shell-both-closed-${width}.png` });

    await toggle(page, "Table of contents");
    await page.screenshot({ path: `${OUTPUT_DIR}/shell-toc-${width}.png` });

    await toggle(page, "Workspace");
    await page.screenshot({ path: `${OUTPUT_DIR}/shell-workspace-${width}.png` });

    await toggle(page, "Properties panel");
    await page.screenshot({ path: `${OUTPUT_DIR}/shell-both-open-${width}.png` });

    await toggle(page, "Workspace");
    await page.screenshot({ path: `${OUTPUT_DIR}/shell-right-only-${width}.png` });

    await context.close();
    console.log(`[ode-433:evidence] shell states captured @${width}.`);
  }
}

async function captureTabOverflow(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  const page = await openHarness(context, options.app, { type: false });

  // Enough tabs that the strip has to scroll.
  for (let index = 0; index < 7; index += 1) {
    await page.locator('button[aria-label="New writing"]').click({ force: true });
    await page.waitForTimeout(500);
  }

  await page.waitForTimeout(600);
  await page.screenshot({ path: `${OUTPUT_DIR}/tab-strip-overflow-1100.png`, clip: { x: 0, y: 0, width: 1100, height: 70 } });

  const measured = await page.evaluate(() => {
    const tabs = Array.from(document.querySelectorAll("[data-editor-tab-id]"));
    const scroller = document.querySelector("[data-testid='editor-topbar'] .overflow-x-auto");
    return {
      count: tabs.length,
      heights: Array.from(new Set(tabs.map((tab) => Math.round(tab.getBoundingClientRect().height)))),
      scrolls: scroller ? scroller.scrollWidth > scroller.clientWidth : false,
    };
  });

  console.log(`[ode-433:evidence] tab strip: ${JSON.stringify(measured)}`);
  await context.close();
  return measured;
}

async function captureFocusMode(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${OUTPUT_DIR}/focus-mode`, size: { width: 1440, height: 900 } }
  });
  const page = await openHarness(context, options.app);

  const paragraph = page.locator(".odessay-editor-content p").first();
  const rect = async () => {
    const box = await paragraph.boundingBox();
    return box ? { x: Number(box.x.toFixed(1)), y: Number(box.y.toFixed(1)), width: Number(box.width.toFixed(1)) } : null;
  };

  const before = await rect();
  await page.locator('[data-testid="editor-topbar"] button[aria-label="Focus mode"]').click();
  await page.waitForTimeout(1200);
  const during = await rect();
  await page.screenshot({ path: `${OUTPUT_DIR}/focus-mode-1440.png` });
  await page.keyboard.press("Escape");
  await page.waitForTimeout(1200);
  const after = await rect();

  await context.close();

  const reflow = { before, during, after };
  console.log(`[ode-433:evidence] focus mode reflow: ${JSON.stringify(reflow)}`);
  return reflow;
}

async function measureTimeToInteractive(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const started = Date.now();
  await page.goto(`${options.app}/perf/editor-harness`, { waitUntil: "commit" });
  await page.locator(".odessay-editor-content").first().waitFor({ state: "visible", timeout: 45_000 });
  const editableAt = Date.now() - started;

  const timing = await page.evaluate(() => {
    const [entry] = performance.getEntriesByType("navigation");
    const paint = performance.getEntriesByType("paint").find((item) => item.name === "first-contentful-paint");
    return {
      domInteractive: entry ? Math.round(entry.domInteractive) : null,
      domContentLoaded: entry ? Math.round(entry.domContentLoadedEventEnd) : null,
      firstContentfulPaint: paint ? Math.round(paint.startTime) : null,
    };
  });

  await context.close();

  const result = { ...timing, editorEditableMs: editableAt };
  console.log(`[ode-433:evidence] time to interactive: ${JSON.stringify(result)}`);
  return result;
}

async function captureSideBySide(browser, options) {
  const regions = [
    { id: "titlebar-tabs", clip: { x: 0, y: 0, width: 1440, height: 60 } },
    { id: "sheet-header", clip: { x: 0, y: 40, width: 1440, height: 80 } },
    { id: "status-bar", clip: { x: 0, y: 840, width: 1440, height: 60 } },
    { id: "full", clip: null },
  ];

  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (options.vendor) {
    await routeVendoredDeps(context, options.vendor);
  }

  const app = await openHarness(context, options.app);
  await toggle(app, "Table of contents");

  const prototype = await context.newPage();
  await prototype.goto(`${options.prototypes}/${encodeURIComponent("Artifact Studio Studio.dc.html")}`, {
    waitUntil: "networkidle",
  });
  await prototype.waitForTimeout(1500);
  // The prototype's TOC lives behind the same toggle.
  await prototype.getByTitle("Table of contents").first().click({ force: true }).catch(() => {});
  await prototype.waitForTimeout(600);

  for (const region of regions) {
    const appPath = `${OUTPUT_DIR}/.region-${region.id}-app.png`;
    const protoPath = `${OUTPUT_DIR}/.region-${region.id}-proto.png`;

    await app.screenshot({ path: appPath, ...(region.clip ? { clip: region.clip } : {}) });
    await prototype.screenshot({ path: protoPath, ...(region.clip ? { clip: region.clip } : {}) });

    const encode = (path) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;
    const htmlPath = `${OUTPUT_DIR}/.side-${region.id}.html`;
    writeFileSync(
      htmlPath,
      `<!doctype html><html><body style="margin:0;background:#1E1915;font:500 13px/1 system-ui,sans-serif;color:#FBFAF9">
        <div style="display:flex;flex-direction:column;gap:10px;padding:10px">
          <figure style="margin:0"><figcaption style="padding:4px 2px">${region.id} — implemented</figcaption><img src="${encode(appPath)}" style="width:100%;display:block"/></figure>
          <figure style="margin:0"><figcaption style="padding:4px 2px">${region.id} — prototype</figcaption><img src="${encode(protoPath)}" style="width:100%;display:block"/></figure>
        </div>
      </body></html>`,
    );

    const composer = await context.newPage();
    await composer.goto(`file://${process.cwd()}/${htmlPath}`, { waitUntil: "load" });
    await composer.setViewportSize({ width: 1460, height: region.clip ? region.clip.height * 2 + 90 : 1860 });
    await composer.waitForTimeout(200);
    await composer.screenshot({ path: `${OUTPUT_DIR}/side-by-side-${region.id}-1440.png`, fullPage: true });
    await composer.close();
    console.log(`[ode-433:evidence] side by side captured: ${region.id}.`);
  }

  await context.close();
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  try {
    await captureStates(browser, options);
    const tabs = await captureTabOverflow(browser, options);
    const reflow = await captureFocusMode(browser, options);
    const tti = await measureTimeToInteractive(browser, options);
    await captureSideBySide(browser, options);

    writeFileSync(
      `${OUTPUT_DIR}/measurements.json`,
      `${JSON.stringify({ tabs, focusModeReflow: reflow, timeToInteractive: tti }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[ode-433:evidence] ${error?.message ?? error}`);
  process.exit(1);
});
