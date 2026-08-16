#!/usr/bin/env node

/**
 * ODE-428 — visual evidence for the shared selection bar.
 *
 *   node scripts/capture-selection-bar-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321
 *
 * Produces the three-band capture the brief marks as blocking — the implemented
 * bar against the Desk prototype's bar and the Settings prototype's bar, at the
 * same width — plus the proof that the last row stays clickable while the bar is
 * up, and the measured geometry of all three.
 *
 * The app must be served with ODESSAY_PERF_HARNESS_ENABLED=true; the prototypes
 * come from docs/design/reference (see its README).
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

import { openPrototype, routeVendoredPrototypeDeps } from "./lib/prototype-page.mjs";

const OUTPUT_DIR = "artifacts/design/ode-428";
const WIDTH = 1440;

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
    else {
      console.error(`[ode-428:evidence] Unknown argument "${args[index]}".`);
      process.exit(1);
    }
  }

  return options;
}

/** Reads the painted geometry of a bar, so the comparison is measured and not eyeballed. */
const GEOMETRY = (element) => {
  const style = getComputedStyle(element);
  const box = element.getBoundingClientRect();
  const parentBox = element.offsetParent?.getBoundingClientRect();
  const count = element.querySelector("span");
  const countStyle = count ? getComputedStyle(count) : null;
  const danger = Array.from(element.querySelectorAll("button")).at(-1);
  const dangerStyle = danger ? getComputedStyle(danger) : null;

  return {
    height: Math.round(box.height),
    borderRadius: style.borderTopLeftRadius,
    background: style.backgroundColor,
    boxShadow: style.boxShadow,
    bottomOffset: parentBox ? Math.round(parentBox.bottom - box.bottom) : null,
    countFont: countStyle ? `${countStyle.fontWeight} ${countStyle.fontSize}` : null,
    countColor: countStyle ? countStyle.color : null,
    dangerBackground: dangerStyle ? dangerStyle.backgroundColor : null,
    dangerColor: dangerStyle ? dangerStyle.color : null,
    chipHeight: danger ? Math.round(danger.getBoundingClientRect().height) : null,
    chipRadius: dangerStyle ? dangerStyle.borderTopLeftRadius : null,
  };
};

/** Clicks rows in a prototype until its selection bar shows up. */
async function selectPrototypeRows(page, selector, howMany) {
  const rows = page.locator(selector);
  const available = await rows.count();
  for (let index = 0; index < Math.min(howMany, available); index += 1) {
    await rows.nth(index).click({ force: true });
    await page.waitForTimeout(150);
  }
}

/**
 * Ticks a prototype's row checkboxes by their painted size.
 *
 * The prototype runtime rewrites the inline `style` strings it was authored
 * with, so selecting the boxes by that text does not survive a render. Their
 * 20×20 geometry does. `skip` drops the list's master "select all" box, which
 * is the same size and always comes first.
 */
async function tickPrototypeCheckboxes(page, { howMany, skip = 0 }) {
  const clicked = await page.evaluate(
    ({ howMany, skip }) => {
      const boxes = Array.from(document.querySelectorAll("button")).filter((button) => {
        const box = button.getBoundingClientRect();
        return Math.round(box.width) === 20 && Math.round(box.height) === 20;
      });
      const targets = boxes.slice(skip, skip + howMany);
      targets.forEach((button) => button.click());
      return targets.length;
    },
    { howMany, skip },
  );

  await page.waitForTimeout(400);
  return clicked;
}

function band(caption, path) {
  const encoded = `data:image/png;base64,${readFileSync(path).toString("base64")}`;
  return `<figure style="margin:0">
    <figcaption style="padding:6px 2px">${caption}</figcaption>
    <img src="${encoded}" style="width:100%;display:block"/>
  </figure>`;
}

async function compose(context, name, bands, height) {
  const htmlPath = `${OUTPUT_DIR}/.${name}.html`;
  writeFileSync(
    htmlPath,
    `<!doctype html><html><body style="margin:0;background:#1E1915;font:500 13px/1 system-ui,sans-serif;color:#FBFAF9">
      <div style="display:flex;flex-direction:column;gap:12px;padding:12px">${bands.join("")}</div>
    </body></html>`,
  );

  const composer = await context.newPage();
  await composer.goto(`file://${process.cwd()}/${htmlPath}`, { waitUntil: "load" });
  await composer.setViewportSize({ width: WIDTH + 24, height });
  await composer.waitForTimeout(200);
  await composer.screenshot({ path: `${OUTPUT_DIR}/${name}.png`, fullPage: true });
  await composer.close();
  console.log(`[ode-428:evidence] composed ${name}.png`);
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  // PLAYWRIGHT_CHROMIUM_PATH lets a runner that ships its own Chromium — a
  // sandbox pinned to a different browser revision than package.json — run this
  // without re-downloading one.
  const executablePath = process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim();
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ viewport: { width: WIDTH, height: 900 } });
  await routeVendoredPrototypeDeps(context, options.vendor);

  try {
    const app = await context.newPage();
    await app.goto(`${options.app}/perf/selection-bar-harness`, { waitUntil: "networkidle" });
    await app.locator('[data-testid="harness-desk-bar"]').waitFor({ state: "visible", timeout: 30_000 });
    await app.waitForTimeout(600);

    const implementedDesk = await app.locator('[data-testid="harness-desk-bar"]').evaluate(GEOMETRY);
    const implementedArchive = await app
      .locator('[data-testid="harness-archive-bar"]')
      .evaluate(GEOMETRY);

    // The bar of the second sheet starts below the fold; scrolling it into view
    // first keeps every clip inside the rendered image.
    const shootBar = async (page, locator, path) => {
      await locator.scrollIntoViewIfNeeded();
      await page.waitForTimeout(300);
      const box = await locator.boundingBox();
      await page.screenshot({
        path,
        clip: { x: 0, y: Math.max(0, Math.round(box.y) - 22), width: WIDTH, height: Math.round(box.height) + 44 },
      });
    };

    const deskBarPath = `${OUTPUT_DIR}/.implemented-desk.png`;
    const archiveBarPath = `${OUTPUT_DIR}/.implemented-archive.png`;
    await shootBar(app, app.locator('[data-testid="harness-desk-bar"]'), deskBarPath);
    await shootBar(app, app.locator('[data-testid="harness-archive-bar"]'), archiveBarPath);

    // Requirement 4 — the sheet is padded, so the last row is still hittable.
    // Scroll the sheet all the way down first: the padding is what puts the last
    // row clear of the bar at the bottom of the scroll, which is precisely where
    // an unpadded sheet hides it.
    await app.locator("[data-selection-bar-sheet]").first().evaluate((sheet) => {
      sheet.scrollTop = sheet.scrollHeight;
    });
    await app.waitForTimeout(400);
    const lastRow = app.locator('[data-testid="harness-desk-bar-row"]').last();
    await lastRow.click({ timeout: 5_000 });
    const lastRowReachable = (
      await app.locator('[data-testid="harness-desk-bar-last-clicked"]').textContent()
    )?.includes("Last row");
    await app.screenshot({ path: `${OUTPUT_DIR}/last-row-reachable-1440.png` });
    console.log(`[ode-428:evidence] last row clickable with the bar up: ${lastRowReachable}`);

    const deskProto = await openPrototype(context, options.prototypes, "Artifact Studio Desk.dc.html");
    await selectPrototypeRows(deskProto, 'button[title="Select"]', 2);

    const archiveProto = await openPrototype(
      context,
      options.prototypes,
      "Artifact Studio Settings.dc.html",
    );
    await archiveProto.getByText("Archived writings", { exact: false }).first().click({ force: true });
    await archiveProto.waitForTimeout(600);
    // skip: 1 drops the list's master "select all" box, which precedes the rows.
    const ticked = await tickPrototypeCheckboxes(archiveProto, { howMany: 2, skip: 1 });
    console.log(`[ode-428:evidence] archive prototype rows selected: ${ticked}`);

    // Found by computed style rather than by the inline attribute: the prototype
    // runtime rewrites those strings, so matching on their text is brittle.
    const protoBar = (page) =>
      page
        .locator("div")
        .filter({
          has: page.locator("xpath=self::*"),
        })
        .evaluateAll((nodes) =>
          nodes.findIndex((node) => {
            const style = getComputedStyle(node);
            return (
              style.position === "absolute" &&
              style.bottom === "26px" &&
              Math.round(node.getBoundingClientRect().height) === 56
            );
          }),
        );

    const readProtoBar = async (page) => {
      const index = await protoBar(page);
      if (index < 0) return { locator: null, geometry: null };
      const locator = page.locator("div").nth(index);
      return { locator, geometry: await locator.evaluate(GEOMETRY) };
    };

    const desk = await readProtoBar(deskProto);
    const archive = await readProtoBar(archiveProto);
    const prototypeDesk = desk.geometry;
    const prototypeArchive = archive.geometry;

    const deskProtoPath = `${OUTPUT_DIR}/.prototype-desk.png`;
    const archiveProtoPath = `${OUTPUT_DIR}/.prototype-archive.png`;
    for (const [page, locator, path] of [
      [deskProto, desk.locator, deskProtoPath],
      [archiveProto, archive.locator, archiveProtoPath],
    ]) {
      const box = locator ? await locator.boundingBox().catch(() => null) : null;
      await page.screenshot({
        path,
        ...(box
          ? {
              clip: {
                x: 0,
                y: Math.max(0, Math.round(box.y) - 22),
                width: WIDTH,
                height: Math.round(box.height) + 44,
              },
            }
          : {}),
      });
    }

    await compose(
      context,
      "three-band-selection-bar-1440",
      [
        band("implemented — shared component, Desk actions", deskBarPath),
        band("prototype — Artifact Studio Desk.dc.html", deskProtoPath),
        band("prototype — Artifact Studio Settings.dc.html (Archived artifacts)", archiveProtoPath),
        band("implemented — shared component, Archived artifacts actions", archiveBarPath),
      ],
      1100,
    );

    writeFileSync(
      `${OUTPUT_DIR}/measurements.json`,
      `${JSON.stringify(
        { implementedDesk, implementedArchive, prototypeDesk, prototypeArchive, lastRowReachable },
        null,
        2,
      )}\n`,
    );
    console.log(`[ode-428:evidence] implemented: ${JSON.stringify(implementedDesk)}`);
    console.log(`[ode-428:evidence] prototype:   ${JSON.stringify(prototypeDesk)}`);
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[ode-428:evidence] ${error?.message ?? error}`);
  process.exit(1);
});
