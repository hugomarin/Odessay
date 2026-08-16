#!/usr/bin/env node

/**
 * ODE-434 — visual and network evidence for the artifact preview overlay.
 *
 *   node scripts/capture-preview-overlay-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
 *
 * Captures the overlay at 1440 / 1100 / 768, the side-by-side against the
 * prototype for every region the fidelity gate names, the sharing card, the
 * keyboard walk over ten artifacts, and the HAR of that walk for the network
 * gate.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { openPrototype, routeVendoredPrototypeDeps } from "./lib/prototype-page.mjs";

const OUTPUT_DIR = "artifacts/design/ode-434";
const WIDTHS = [1440, 1100, 768];

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
    else {
      console.error(`[ode-434:evidence] Unknown argument "${args[index]}".`);
      process.exit(1);
    }
  }

  return options;
}

async function openOverlay(context, options, query = "") {
  const page = await context.newPage();
  await page.goto(`${options.app}/perf/preview-overlay-harness${query}`, { waitUntil: "networkidle" });
  await page.locator('[data-testid="preview-chrome"]').waitFor({ state: "visible", timeout: 30_000 });
  await page.waitForTimeout(900);
  return page;
}

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

  const title = document.querySelector('[data-testid="preview-title"]');
  const titleStyle = title ? getComputedStyle(title) : null;
  const path = document.querySelector('[data-testid="preview-path"]');
  const pathStyle = path ? getComputedStyle(path) : null;

  return {
    chrome: box('[data-testid="preview-chrome"]'),
    counter: document.querySelector('[data-testid="preview-counter"]')?.textContent ?? null,
    properties: box('[data-testid="preview-properties"]'),
    title: titleStyle
      ? `${titleStyle.fontWeight} ${titleStyle.fontSize}/${titleStyle.lineHeight} ${titleStyle.letterSpacing} ${titleStyle.fontFamily.split(",")[0]}`
      : null,
    path: pathStyle ? `${pathStyle.fontSize} ${pathStyle.fontFamily.split(",")[0]} ${pathStyle.textOverflow}` : null,
    sharingCard: {
      ...box('[data-testid="preview-sharing-card"]'),
      ...styleOf('[data-testid="preview-sharing-card"]', ["borderTopLeftRadius", "borderTopWidth"]),
    },
    sharingRule: box('[data-testid="preview-sharing-rule"]'),
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
  console.log(`[ode-434:evidence] composed ${name}.png`);
}

/** Requirement 6 and failure mode 1 — ← → walk, and the range ends. */
async function walkByKeyboard(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await openOverlay(context, options);

  const counters = [];
  const readCounter = async () =>
    (await page.locator('[data-testid="preview-counter"]').textContent())?.trim() ?? null;

  counters.push(await readCounter());
  // Failure mode 1 — at the first artifact, ← must not move or break the counter.
  await page.keyboard.press("ArrowLeft");
  await page.waitForTimeout(250);
  const afterLeftAtStart = await readCounter();

  for (let step = 0; step < 9; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(350);
    counters.push(await readCounter());
  }

  // …and at the last, → must not either.
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(250);
  const afterRightAtEnd = await readCounter();

  const disabled = await page.evaluate(() => ({
    previous: document.querySelector('button[aria-label="Previous artifact"]')?.disabled ?? null,
    next: document.querySelector('button[aria-label="Next artifact"]')?.disabled ?? null,
  }));

  await page.screenshot({ path: `${OUTPUT_DIR}/keyboard-walk-end-1440.png` });
  await context.close();

  const result = { counters, afterLeftAtStart, afterRightAtEnd, disabledAtEnd: disabled };
  console.log(`[ode-434:evidence] keyboard walk: ${JSON.stringify(result)}`);
  return result;
}

/** The payload of the ten-artifact walk, for the network gate. */
async function captureNetworkHar(browser, options) {
  const harPath = `${OUTPUT_DIR}/preview-walk.har`;
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordHar: { path: harPath, content: "omit" },
  });

  const page = await openOverlay(context, options);
  for (let step = 0; step < 9; step += 1) {
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(350);
  }
  await page.waitForTimeout(1200);
  await context.close();

  console.log(`[ode-434:evidence] HAR written to ${harPath}`);
  return harPath;
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});

  try {
    const measurements = {};

    for (const width of WIDTHS) {
      const context = await browser.newContext({ viewport: { width, height: 900 } });
      const page = await openOverlay(context, options);
      await page.screenshot({ path: `${OUTPUT_DIR}/preview-overlay-${width}.png` });
      measurements[width] = await page.evaluate(MEASURE);
      await context.close();
      console.log(`[ode-434:evidence] overlay captured @${width}.`);
    }

    const keyboard = await walkByKeyboard(browser, options);
    const harPath = await captureNetworkHar(browser, options);

    // Side by side against the prototype, per region the fidelity gate names.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    await routeVendoredPrototypeDeps(context, options.vendor);

    const prototype = await openPrototype(context, options.prototypes, "Artifact Studio Desk.dc.html");
    // The prototype opens its preview from a row's eye action.
    await prototype.locator('button[title="Preview"]').first().click({ force: true });
    await prototype.waitForTimeout(1200);

    const app = await openOverlay(context, options);

    const regions = [
      { id: "chrome", clip: { x: 0, y: 0, width: 1440, height: 60 } },
      { id: "sheet-header", clip: { x: 0, y: 48, width: 1100, height: 200 } },
      { id: "properties", clip: { x: 1100, y: 48, width: 340, height: 720 } },
      { id: "full", clip: null },
    ];

    for (const region of regions) {
      const appPath = `${OUTPUT_DIR}/.region-${region.id}-app.png`;
      const protoPath = `${OUTPUT_DIR}/.region-${region.id}-proto.png`;
      await app.screenshot({ path: appPath, ...(region.clip ? { clip: region.clip } : {}) });
      await prototype.screenshot({ path: protoPath, ...(region.clip ? { clip: region.clip } : {}) });

      await compose(
        context,
        `side-by-side-${region.id}-1440`,
        [band(`${region.id} — implemented`, appPath), band(`${region.id} — prototype`, protoPath)],
        region.clip ? region.clip.width : 1440,
        region.clip ? region.clip.height * 2 + 120 : 1900,
      );
    }

    // The sharing card on its own, both states.
    const cardBox = await app.locator('[data-testid="preview-sharing-card"]').boundingBox();
    if (cardBox) {
      await app.locator('[data-testid="preview-sharing-card"]').scrollIntoViewIfNeeded();
      await app.waitForTimeout(300);
      await app.screenshot({
        path: `${OUTPUT_DIR}/sharing-card-no-link-1440.png`,
        clip: await app.locator('[data-testid="preview-sharing-card"]').boundingBox(),
      });
    }

    await context.close();

    writeFileSync(
      `${OUTPUT_DIR}/measurements.json`,
      `${JSON.stringify({ measurements, keyboard, harPath }, null, 2)}\n`,
    );
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[ode-434:evidence] ${error?.message ?? error}`);
  process.exit(1);
});
