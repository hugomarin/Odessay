#!/usr/bin/env node

/**
 * ODE-430 — visual and navigational evidence for the redesigned Desk.
 *
 *   node scripts/capture-desk-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
 *
 * Captures the Desk at 1440 / 1100 / 768 in every state the brief enumerates,
 * the side-by-side against the prototype per region, the keyboard walk that
 * reaches the row actions, the proof that the filter bar's height is the same
 * with 0 and with 6 filters applied, and the measured time to interactive.
 *
 * The app must be served with ODESSAY_PERF_HARNESS_ENABLED=true.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { openPrototype, routeVendoredPrototypeDeps } from "./lib/prototype-page.mjs";

const OUTPUT_DIR = "artifacts/design/ode-430";
const WIDTHS = [1440, 1100, 768];
const STATES = ["populated", "filtered", "selection", "loading", "empty", "grouped"];

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
    else {
      console.error(`[ode-430:evidence] Unknown argument "${args[index]}".`);
      process.exit(1);
    }
  }

  return options;
}

async function openDesk(context, options, state) {
  const page = await context.newPage();
  await page.goto(`${options.app}/perf/desk-harness?state=${state}`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="desk-sheet"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(500);
  return page;
}

/** Reads the painted geometry of the regions the fidelity gate names. */
const MEASURE = () => {
  const round = (value) => Math.round(value * 10) / 10;
  const box = (selector) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { width: round(rect.width), height: round(rect.height) };
  };
  const styleOf = (selector, properties) => {
    const element = document.querySelector(selector);
    if (!element) return null;
    const style = getComputedStyle(element);
    return Object.fromEntries(properties.map((property) => [property, style[property]]));
  };

  const heading = document.querySelector("h1");
  const headingStyle = heading ? getComputedStyle(heading) : null;
  const row = document.querySelector('[data-testid="desk-artifact-row"]');
  const rowStyle = row ? getComputedStyle(row) : null;

  return {
    header: box('[data-testid="desk-header"]'),
    headingFont: headingStyle
      ? `${headingStyle.fontWeight} ${headingStyle.fontSize}/${headingStyle.lineHeight} ${headingStyle.letterSpacing}`
      : null,
    primaryAction: {
      ...box('[data-testid="desk-new-artifact"]'),
      ...styleOf('[data-testid="desk-new-artifact"]', ["borderTopLeftRadius", "backgroundColor"]),
    },
    filterBar: box('[data-testid="desk-filter-bar"]'),
    filterTrigger: box('[data-testid="desk-filter-trigger"]'),
    filterTriggerLabel: document.querySelector('[data-testid="desk-filter-trigger"]')?.textContent ?? null,
    searchField: box('[data-testid="desk-filter-search"]'),
    sheet: styleOf('[data-testid="desk-sheet"]', ["borderTopLeftRadius", "backgroundColor", "boxShadow"]),
    row: row ? { height: Math.round(row.getBoundingClientRect().height) } : null,
    rowBorder: rowStyle ? `${rowStyle.borderBottomWidth} ${rowStyle.borderBottomColor}` : null,
    rowControlsVisible: (() => {
      const controls = document.querySelector('[data-testid="desk-artifact-row-controls"]');
      return controls ? getComputedStyle(controls).display !== "none" : null;
    })(),
    checkboxVisible: (() => {
      const checkbox = document.querySelector('[data-testid="desk-artifact-row-checkbox"]');
      if (!checkbox) return null;
      const style = getComputedStyle(checkbox);
      return style.display !== "none" && style.opacity !== "0";
    })(),
  };
};

function band(caption, path) {
  const encoded = `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  return `<figure style="margin:0">
    <figcaption style="padding:6px 2px">${caption}</figcaption>
    <img src="${encoded}" style="width:100%;display:block"/>
  </figure>`;
}

async function compose(context, name, bands, width, height) {
  const htmlPath = `${OUTPUT_DIR}/.${name}.html`;
  writeFileSync(
    htmlPath,
    `<!doctype html><html><body style="margin:0;background:#1E1915;font:500 13px/1 system-ui,sans-serif;color:#FBFAF9">
      <div style="display:flex;flex-direction:column;gap:12px;padding:12px">${bands.join("")}</div>
    </body></html>`,
  );

  const composer = await context.newPage();
  await composer.goto(`file://${process.cwd()}/${htmlPath}`, { waitUntil: "load" });
  await composer.setViewportSize({ width: width + 24, height });
  await composer.waitForTimeout(200);
  await composer.screenshot({ path: `${OUTPUT_DIR}/${name}.png`, fullPage: true });
  await composer.close();
  console.log(`[ode-430:evidence] composed ${name}.png`);
}

async function captureStates(browser, options) {
  const measurements = {};

  for (const width of WIDTHS) {
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    for (const state of STATES) {
      const page = await openDesk(context, options, state);
      await page.screenshot({ path: `${OUTPUT_DIR}/desk-${state}-${width}.png` });
      if (state === "populated" || state === "filtered") {
        measurements[`${state}-${width}`] = await page.evaluate(MEASURE);
      }
      await page.close();
    }
    await context.close();
    console.log(`[ode-430:evidence] states captured @${width}.`);
  }

  return measurements;
}

/**
 * Requirement 3: the bar's height must not change between 0 and 6 filters.
 * Measured, not asserted — a chip row under the bar would show up here.
 */
async function measureFilterBarHeight(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const heights = {};

  for (const state of ["populated", "filtered"]) {
    const page = await openDesk(context, options, state);
    const box = await page.locator('[data-testid="desk-filter-bar"]').boundingBox();
    heights[state === "populated" ? "zeroFilters" : "sixFilters"] = Math.round(box.height);
    await page.close();
  }

  await context.close();
  heights.constant = heights.zeroFilters === heights.sixFilters;
  console.log(`[ode-430:evidence] filter bar height: ${JSON.stringify(heights)}`);
  return heights;
}

/** Requirement 6: the row's edit and preview actions are reachable without a mouse. */
async function walkByKeyboard(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openDesk(context, options, "populated");

  const reached = [];
  for (let step = 0; step < 40; step += 1) {
    await page.keyboard.press("Tab");
    const label = await page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? null);
    if (label && !reached.includes(label)) reached.push(label);
    if (reached.some((entry) => entry.startsWith("Preview "))) break;
  }

  await page.screenshot({ path: `${OUTPUT_DIR}/keyboard-walk-1440.png` });
  await context.close();

  const result = {
    reachedRowCheckbox: reached.some((label) => label.startsWith("Select ")),
    reachedRename: reached.some((label) => label.startsWith("Rename ")),
    reachedPreview: reached.some((label) => label.startsWith("Preview ")),
    order: reached,
  };
  console.log(`[ode-430:evidence] keyboard walk: ${JSON.stringify(result)}`);
  return result;
}

async function measureTimeToInteractive(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const started = Date.now();
  await page.goto(`${options.app}/perf/desk-harness?state=populated`, { waitUntil: "commit" });
  await page.locator('[data-testid="desk-artifact-row"]').first().waitFor({ state: "visible", timeout: 45_000 });
  const rowsVisibleMs = Date.now() - started;

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
  const result = { ...timing, rowsVisibleMs, budgetMs: 1500, withinBudget: rowsVisibleMs < 1500 };
  console.log(`[ode-430:evidence] time to interactive: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Records a HAR of the Desk's cold load so `ops:network:gate` has something to
 * evaluate. It runs against `/perf/desk-harness`, not `/desk`: the real route is
 * behind auth, so it is not reachable from a build with fixture credentials. The
 * harness loads the same route bundle and the same component tree, which is what
 * this issue changed — the catalog reads it does not perform are unchanged by
 * this PR, and that limitation is declared in the evidence README.
 */
async function captureNetworkHar(browser, options) {
  const harPath = `${OUTPUT_DIR}/desk-cold-load.har`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordHar: { path: harPath, content: "omit" },
  });

  const page = await context.newPage();
  await page.goto(`${options.app}/perf/desk-harness?state=populated`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="desk-artifact-row"]').first().waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(1500);
  await context.close();

  console.log(`[ode-430:evidence] HAR written to ${harPath}`);
  return harPath;
}

async function captureSideBySide(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await routeVendoredPrototypeDeps(context, options.vendor);

  const prototype = await openPrototype(context, options.prototypes, "Artifact Studio Desk.dc.html");

  const regions = [
    { id: "header", clip: { x: 0, y: 0, width: 1440, height: 130 }, protoClip: { x: 260, y: 46, width: 1180, height: 130 } },
    { id: "filter-bar", clip: { x: 0, y: 100, width: 1440, height: 90 }, protoClip: { x: 260, y: 150, width: 1180, height: 90 } },
    { id: "rows", clip: { x: 0, y: 180, width: 1440, height: 260 }, protoClip: { x: 260, y: 230, width: 1180, height: 260 } },
    { id: "full", clip: null, protoClip: null },
  ];

  for (const state of ["populated", "loading", "empty"]) {
    const app = await openDesk(context, options, state);

    for (const region of regions) {
      if (state !== "populated" && region.id !== "full") continue;

      const appPath = `${OUTPUT_DIR}/.region-${state}-${region.id}-app.png`;
      const protoPath = `${OUTPUT_DIR}/.region-${state}-${region.id}-proto.png`;
      await app.screenshot({ path: appPath, ...(region.clip ? { clip: region.clip } : {}) });
      await prototype.screenshot({
        path: protoPath,
        ...(region.protoClip ? { clip: region.protoClip } : {}),
      });

      await compose(
        context,
        `side-by-side-${state}-${region.id}-1440`,
        [
          band(`${region.id} — implemented (${state})`, appPath),
          band(`${region.id} — prototype`, protoPath),
        ],
        1440,
        region.clip ? region.clip.height * 2 + 120 : 1900,
      );
    }

    await app.close();
  }

  await context.close();
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  try {
    const measurements = await captureStates(browser, options);
    const filterBarHeight = await measureFilterBarHeight(browser, options);
    const keyboard = await walkByKeyboard(browser, options);
    const timeToInteractive = await measureTimeToInteractive(browser, options);
    const harPath = await captureNetworkHar(browser, options);
    await captureSideBySide(browser, options);

    writeFileSync(
      `${OUTPUT_DIR}/measurements.json`,
      `${JSON.stringify({ measurements, filterBarHeight, keyboard, timeToInteractive, harPath }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[ode-430:evidence] ${error?.message ?? error}`);
  process.exit(1);
});
