#!/usr/bin/env node

/**
 * ODE-447 — visual and time-to-interactive evidence for the app rail.
 *
 *   node scripts/capture-rail-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
 *
 * Captures the rail collapsed and expanded at 1440 / 1100 / 900 / 768, a
 * side-by-side against each of the four prototypes that draw it, the measured
 * geometry, the icon's X position through the expansion, and the time to
 * interactive of a view that mounts it.
 *
 * `app/perf/rail-harness` already mounts the real rail, so the capture drives
 * the shipped component rather than a mock of it. The app must be served with
 * ODESSAY_PERF_HARNESS_ENABLED=true; the prototypes come from
 * docs/design/reference. `--vendor` serves their unpkg dependencies from disk
 * when unpkg is unreachable.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUTPUT_DIR = "artifacts/design/ode-447";

/** The same query the rail uses (`docs/design/layout.md` §5). */
const RAIL_FORCED_COLLAPSE_QUERY = "(max-width: 899px)";
const WIDTHS = [1440, 1100, 900, 768];

/** The four prototypes of the package that draw the rail. */
const PROTOTYPES = [
  "Artifact Studio Desk.dc.html",
  "Artifact Studio Studio.dc.html",
  "Artifact Studio Workspace.dc.html",
  "Artifact Studio Settings.dc.html",
];

const VENDOR_FILES = {
  "react@18.3.1/umd/react.production.min.js": "react/umd/react.production.min.js",
  "react-dom@18.3.1/umd/react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "lucide@0.469.0/dist/umd/lucide.js": "lucide/dist/umd/lucide.js",
};

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
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

/**
 * Opens the rail harness and, above the forced-collapse band, asserts the rail
 * actually reached its expanded state before anything is measured.
 */
async function openRail(context, appUrl, { expanded = true } = {}) {
  const page = await context.newPage();
  await page.goto(`${appUrl}/perf/rail-harness`, { waitUntil: "networkidle" });
  await page.locator("#sidebar").waitFor({ state: "visible", timeout: 45_000 });
  await page.waitForTimeout(1200);

  // Whether the rail can be expanded at all is the page's call, not the
  // window's: a vertical scrollbar takes the CSS viewport a few pixels below
  // the window, which is exactly what happens at a 900px window. Ask the same
  // media query the rail asks.
  const forcedCollapse = await page.evaluate(
    (query) => window.matchMedia(query).matches,
    RAIL_FORCED_COLLAPSE_QUERY,
  );

  if (expanded && !forcedCollapse) {
    await expand(page);
  }

  return { page, forcedCollapse };
}

/**
 * Retried until the rail actually reports its expanded width, and hard-failing
 * if it never does. A capture that records 52px and labels it "expanded" is
 * worse than no capture: it looks like evidence.
 */
const expand = async (page, expectedWidth = 244) => {
  const reachedWidth = async (timeout) =>
    page
      .waitForFunction(
        (target) =>
          Math.round(document.querySelector("#sidebar")?.getBoundingClientRect().width ?? 0) === target,
        expectedWidth,
        { timeout },
      )
      .then(() => true)
      .catch(() => false);

  // The harness renders collapsed on the server and only reaches its expanded
  // state on hydration. Clicking during that window toggles against a state
  // that is about to be replaced, so the first move is to wait it out.
  if (await reachedWidth(4000)) return true;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const button = page.locator('button[aria-label="Expand sidebar"]').first();
    if (await button.count()) {
      await button.click({ force: true });
    }
    if (await reachedWidth(3000)) return true;
  }

  const finalWidth = await page.evaluate(
    () => document.querySelector("#sidebar")?.getBoundingClientRect().width ?? 0,
  );
  if (Math.round(finalWidth) !== expectedWidth) {
    throw new Error(
      `[ode-447:evidence] the rail never reached ${expectedWidth}px (last read ${Math.round(finalWidth)}px). ` +
        `Refusing to record a measurement of a state that was never on screen.`,
    );
  }
  return true;
};

const collapse = async (page) => {
  const button = page.locator('button[aria-label="Collapse sidebar"]').first();
  if (await button.count()) {
    await button.click({ force: true });
    await page.waitForTimeout(600);
  }
};

async function captureStates(_browser, options) {
  for (const width of WIDTHS) {
    // A browser per width: the sweep toggles state, and nothing from one
    // viewport should be able to reach the next.
    const browser = await chromium.launch({
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim() || undefined,
    });
    const context = await browser.newContext({ viewport: { width, height: 900 } });
    const { page, forcedCollapse } = await openRail(context, options.app);

    if (!forcedCollapse) {
      await page.screenshot({
        path: `${OUTPUT_DIR}/rail-expanded-${width}.png`,
        clip: { x: 0, y: 0, width: Math.min(320, width), height: 900 },
      });
      await collapse(page);
    } else {
      console.log(`[ode-447:evidence] @${width} the rail is forced collapsed — no expanded state to capture.`);
    }
    await page.screenshot({
      path: `${OUTPUT_DIR}/rail-collapsed-${width}.png`,
      clip: { x: 0, y: 0, width: Math.min(320, width), height: 900 },
    });

    await context.close();
    await browser.close();
    console.log(`[ode-447:evidence] rail states captured @${width}.`);
  }
}

/**
 * The requirement the spec words as "the icon never changes X position when
 * collapsing". Measured, not asserted from the class list.
 */
async function measureIconTravel(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await openRail(context, options.app);

  const iconX = () =>
    page.evaluate(() => {
      const icon = document.querySelector('[data-testid="sidebar-nav-desk"] svg');
      return icon ? Math.round(icon.getBoundingClientRect().x * 100) / 100 : null;
    });

  const expanded = await iconX();
  await collapse(page);
  const collapsed = await iconX();

  await context.close();

  const result = { expanded, collapsed, travelPx: expanded === null || collapsed === null ? null : Math.abs(expanded - collapsed) };
  console.log(`[ode-447:evidence] icon travel: ${JSON.stringify(result)}`);
  return result;
}

async function measureGeometry(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await openRail(context, options.app);

  const read = () =>
    page.evaluate(() => {
      const rail = document.querySelector("#sidebar");
      const item = document.querySelector('[data-testid="sidebar-nav-desk"]');
      const icon = item?.querySelector("svg");
      const folders = document.querySelector('[data-testid="sidebar-workspace-folders"]');
      const avatar = document.querySelector('[data-testid="sidebar-user-avatar"]');
      const top = document.querySelector('[data-testid="sidebar-top"]');
      const railStyle = rail ? getComputedStyle(rail) : null;
      const itemStyle = item ? getComputedStyle(item) : null;

      return {
        railWidth: rail ? Math.round(rail.getBoundingClientRect().width) : null,
        railBackground: railStyle?.backgroundColor ?? null,
        railBorderRight: railStyle?.borderRightWidth ?? null,
        itemHeight: item ? Math.round(item.getBoundingClientRect().height) : null,
        itemRadius: itemStyle?.borderRadius ?? null,
        iconSize: icon ? Math.round(icon.getBoundingClientRect().width) : null,
        workspaceFoldersOverflowY: folders ? getComputedStyle(folders).overflowY : null,
        workspaceFolderCount: document.querySelectorAll('[data-testid="sidebar-workspace-folder"]').length,
        avatarSize: avatar ? Math.round(avatar.getBoundingClientRect().width) : null,
        // A label that clips horizontally must still fit its descenders: the
        // tail of a "g" overflowing a 14px line box is invisible in a class
        // list and obvious on screen.
        clippedLabels: Array.from(
          document.querySelectorAll('[data-section^="sidebar-nav-"] span:last-child, [data-testid="sidebar-workspace-folder"] span'),
        )
          .filter((node) => node.scrollHeight > node.clientHeight + 0.5)
          .map((node) => node.textContent),
        titleBarHasWordmark: top ? /Artifact Studio/.test(top.textContent || "") : null,
      };
    });

  const expanded = await read();
  await collapse(page);
  const collapsed = await read();

  await context.close();

  const result = { expanded, collapsed };
  console.log(`[ode-447:evidence] geometry: ${JSON.stringify(result)}`);
  return result;
}

/**
 * Forced collapse below 900px (`docs/design/layout.md` §5), and the preference
 * surviving the narrow window.
 */
async function measureForcedCollapse(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const { page } = await openRail(context, options.app);

  const width = () =>
    page.evaluate(() => {
      const rail = document.querySelector("#sidebar");
      return rail ? Math.round(rail.getBoundingClientRect().width) : null;
    });

  const atWide = await width();
  await page.setViewportSize({ width: 820, height: 900 });
  await page.waitForTimeout(600);
  const atNarrow = await width();
  const toggleGone = (await page.locator('button[aria-label="Expand sidebar"]').count()) === 0;
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(600);
  const restored = await width();

  await context.close();

  const result = { atWide, atNarrow, toggleHiddenWhileForced: toggleGone, restored };
  console.log(`[ode-447:evidence] forced collapse: ${JSON.stringify(result)}`);
  return result;
}

async function measureTimeToInteractive(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const started = Date.now();
  await page.goto(`${options.app}/perf/rail-harness`, { waitUntil: "commit" });
  await page.locator('[data-testid="sidebar-nav-desk"]').first().waitFor({ state: "visible", timeout: 45_000 });
  const railUsableAt = Date.now() - started;

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

  const result = { ...timing, railUsableMs: railUsableAt };
  console.log(`[ode-447:evidence] time to interactive: ${JSON.stringify(result)}`);
  return result;
}

/**
 * The rail against each prototype that draws it. The fidelity gate asks for the
 * four to be compared: if they disagree with each other, that is a question for
 * the design owner, not a value to pick.
 */
async function captureSideBySide(browser, options) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  if (options.vendor) {
    await routeVendoredDeps(context, options.vendor);
  }

  const { page: app } = await openRail(context, options.app);
  const appShot = await app.screenshot({ clip: { x: 0, y: 0, width: 260, height: 900 } });
  writeFileSync(`${OUTPUT_DIR}/side-by-side-implemented-1440.png`, appShot);

  const measured = {};
  for (const name of PROTOTYPES) {
    const prototype = await context.newPage();
    await prototype.goto(`${options.prototypes}/${encodeURIComponent(name)}`, { waitUntil: "networkidle" });
    await prototype.waitForTimeout(1500);

    const slug = name.replace("Artifact Studio ", "").replace(".dc.html", "").toLowerCase().replace(/\s+/g, "-");
    await prototype.screenshot({
      path: `${OUTPUT_DIR}/side-by-side-prototype-${slug}-1440.png`,
      clip: { x: 0, y: 0, width: 260, height: 900 },
    });

    measured[slug] = await prototype.evaluate(() => {
      // The prototypes mark their rail with a class or an aside; take the first
      // element in the top-left column that is tall and narrow.
      const candidates = Array.from(document.querySelectorAll("aside, nav, div"));
      const rail = candidates.find((node) => {
        const box = node.getBoundingClientRect();
        return box.x < 8 && box.height > 500 && box.width > 40 && box.width < 300;
      });
      return rail ? { width: Math.round(rail.getBoundingClientRect().width) } : null;
    });

    await prototype.close();
    console.log(`[ode-447:evidence] prototype captured: ${slug}`);
  }

  await context.close();
  console.log(`[ode-447:evidence] prototype rail widths: ${JSON.stringify(measured)}`);
  return measured;
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH?.trim() || undefined,
  });

  try {
    // Measurements first, on the cleanest contexts of the run; the screenshot
    // sweep toggles the rail repeatedly and is the noisiest thing here.
    const geometry = await measureGeometry(browser, options);
    const iconTravel = await measureIconTravel(browser, options);
    const forcedCollapse = await measureForcedCollapse(browser, options);
    const timeToInteractive = await measureTimeToInteractive(browser, options);
    const prototypeWidths = await captureSideBySide(browser, options);
    await captureStates(browser, options);

    writeFileSync(
      `${OUTPUT_DIR}/measurements.json`,
      `${JSON.stringify({ geometry, iconTravel, forcedCollapse, timeToInteractive, prototypeWidths }, null, 2)}\n`,
    );
    console.log(`[ode-447:evidence] measurements written to ${OUTPUT_DIR}/measurements.json`);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
