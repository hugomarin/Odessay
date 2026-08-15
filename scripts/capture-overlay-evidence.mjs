#!/usr/bin/env node

/**
 * ODE-427 — visual evidence for the five overlay primitives.
 *
 * Captures each pattern twice: the primitive as implemented (from the overlay
 * harness) and the overlay it was read from (from the reference prototype),
 * then composes the pair side by side at the same viewport width.
 *
 *   node scripts/capture-overlay-evidence.mjs \
 *     --app http://127.0.0.1:3000 --prototypes http://127.0.0.1:4321 [--vendor <dir>]
 *
 * The app must be built and started with ODESSAY_PERF_HARNESS_ENABLED=true, and
 * the prototypes served from docs/design/reference (see its README).
 *
 * The prototypes boot React, ReactDOM and Lucide from unpkg. On a machine with
 * no access to it, pass `--vendor <dir>` holding the same UMD bundles
 * (`npm pack react@18.3.1 react-dom@18.3.1 lucide@0.469.0`) and they are served
 * from disk instead.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";

const OUTPUT_DIR = "artifacts/design/ode-427";
const WIDTHS = [1440, 1100];

function parseArgs(argv) {
  const options = { app: "http://127.0.0.1:3000", prototypes: "http://127.0.0.1:4321", vendor: "" };
  const args = argv.slice(2);

  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === "--app") options.app = args[(index += 1)];
    else if (args[index] === "--prototypes") options.prototypes = args[(index += 1)];
    else if (args[index] === "--vendor") options.vendor = args[(index += 1)];
    else {
      console.error(`[ode-427:evidence] Unknown argument "${args[index]}".`);
      process.exit(1);
    }
  }

  return options;
}

/** Each pattern: how to open it in the harness, and where it lives in the prototypes. */
const PATTERNS = [
  {
    id: "flow-modal",
    harness: async (page) => {
      await page.getByTestId("open-flow-modal").click();
      await page.getByTestId("flow-modal").waitFor({ state: "visible" });
    },
    prototype: {
      file: "Artifact Studio Add Workspace.dc.html",
      open: async (page) => {
        // The prototype opens on its own; the first step is already the flow modal.
        await page.getByRole("button", { name: /use an existing folder/i }).first().waitFor();
        await page.waitForTimeout(300);
      }
    }
  },
  {
    id: "form-modal",
    harness: async (page) => {
      await page.getByTestId("open-form-modal").click();
      await page.getByTestId("form-modal").waitFor({ state: "visible" });
    },
    prototype: {
      file: "Artifact Studio Settings.dc.html",
      open: async (page) => {
        await page.getByRole("button", { name: /^(edit|editar)$/i }).first().click();
        await page.waitForTimeout(500);
      }
    }
  },
  {
    id: "display-modal",
    harness: async (page) => {
      await page.getByTestId("open-display-modal").click();
      await page.getByTestId("display-modal").waitFor({ state: "visible" });
    },
    prototype: {
      file: "Artifact Studio Studio.dc.html",
      open: async (page) => {
        await page.getByTitle("Keyboard shortcuts").first().click();
        await page.waitForTimeout(500);
      }
    }
  },
  {
    id: "full-overlay",
    harness: async (page) => {
      await page.getByTestId("open-full-overlay").click();
      await page.getByTestId("full-overlay").waitFor({ state: "visible" });
    },
    prototype: {
      file: "Artifact Studio Desk.dc.html",
      open: async (page) => {
        await page.getByTitle("Preview").first().click();
        await page.waitForTimeout(500);
      }
    }
  },
  {
    id: "dropdown",
    harness: async (page) => {
      await page.getByTestId("open-dropdown").click();
      await page.getByRole("menu").waitFor({ state: "visible" });
      // Focus state is part of the evidence.
      await page.keyboard.press("ArrowDown");
    },
    prototype: {
      file: "Artifact Studio Desk.dc.html",
      open: async (page) => {
        // The row menu trigger only becomes visible on row hover.
        await page.getByTitle("Más").first().hover({ force: true });
        await page.waitForTimeout(200);
        await page.getByTitle("Más").first().click({ force: true });
        await page.waitForTimeout(400);
      }
    }
  }
];

function composeHtml(leftPath, rightPath, label, width) {
  const encode = (path) => `data:image/png;base64,${readFileSync(path).toString("base64")}`;

  return `<!doctype html><html><body style="margin:0;background:#1E1915;font:500 13px/1 system-ui,sans-serif;color:#FBFAF9">
    <div style="display:flex;gap:8px;padding:8px">
      <figure style="margin:0;flex:1"><figcaption style="padding:6px 2px">${label} — primitive @${width}</figcaption><img src="${encode(leftPath)}" style="width:100%;display:block"/></figure>
      <figure style="margin:0;flex:1"><figcaption style="padding:6px 2px">${label} — prototype @${width}</figcaption><img src="${encode(rightPath)}" style="width:100%;display:block"/></figure>
    </div>
  </body></html>`;
}

const VENDOR_FILES = {
  "react@18.3.1/umd/react.production.min.js": "react/umd/react.production.min.js",
  "react-dom@18.3.1/umd/react-dom.production.min.js": "react-dom/umd/react-dom.production.min.js",
  "lucide@0.469.0/dist/umd/lucide.js": "lucide/dist/umd/lucide.js"
};

/** Serves the prototypes' unpkg dependencies from a local directory. */
async function routeVendoredDeps(context, vendorDir) {
  await context.route("https://unpkg.com/**", async (route) => {
    const requested = route.request().url().replace("https://unpkg.com/", "");
    const relative = VENDOR_FILES[requested];
    const filePath = relative ? `${vendorDir}/${relative}` : null;

    if (!filePath || !existsSync(filePath)) {
      await route.abort();
      return;
    }

    await route.fulfill({
      status: 200,
      contentType: "application/javascript",
      body: readFileSync(filePath)
    });
  });
}

/**
 * The keyboard walkthrough of a three-step flow modal: open, move through the
 * steps, and close — pointer never used.
 */
async function recordKeyboardWalkthrough(browser, options) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    recordVideo: { dir: `${OUTPUT_DIR}/keyboard-walkthrough`, size: { width: 1440, height: 900 } }
  });
  const page = await context.newPage();

  await page.goto(`${options.app}/perf/overlay-harness`, { waitUntil: "networkidle" });
  await page.getByTestId("open-flow-modal").focus();
  await page.waitForTimeout(600);
  await page.keyboard.press("Enter");
  await page.getByTestId("flow-modal").waitFor({ state: "visible" });
  await page.waitForTimeout(700);

  for (let step = 0; step < 2; step += 1) {
    // Tab to the footer's primary action and advance a step.
    for (let hop = 0; hop < 8; hop += 1) {
      await page.keyboard.press("Tab");
      await page.waitForTimeout(90);
      const label = await page.evaluate(() => document.activeElement?.textContent?.trim() ?? "");
      if (label === "Continue") break;
    }
    await page.keyboard.press("Enter");
    await page.waitForTimeout(700);
  }

  // Esc closes from the last step; focus returns to the trigger.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);

  await context.close();
  console.log(`[ode-427:evidence] keyboard walkthrough recorded in ${OUTPUT_DIR}/keyboard-walkthrough.`);
}

async function main() {
  const options = parseArgs(process.argv);
  mkdirSync(OUTPUT_DIR, { recursive: true });

  const browser = await chromium.launch();

  try {
    for (const width of WIDTHS) {
      for (const pattern of PATTERNS) {
        const context = await browser.newContext({ viewport: { width, height: 900 } });
        if (options.vendor) {
          await routeVendoredDeps(context, options.vendor);
        }

        const harnessPage = await context.newPage();
        await harnessPage.goto(`${options.app}/perf/overlay-harness`, { waitUntil: "networkidle" });
        await pattern.harness(harnessPage);
        await harnessPage.waitForTimeout(500);
        const primitivePath = `${OUTPUT_DIR}/${pattern.id}-primitive-${width}.png`;
        await harnessPage.screenshot({ path: primitivePath });

        const prototypePage = await context.newPage();
        await prototypePage.goto(`${options.prototypes}/${encodeURIComponent(pattern.prototype.file)}`, {
          waitUntil: "networkidle"
        });
        await prototypePage.waitForTimeout(800);
        try {
          await pattern.prototype.open(prototypePage);
        } catch (error) {
          console.warn(`[ode-427:evidence] ${pattern.id}@${width}: could not open the prototype overlay — ${error.message}`);
        }
        const prototypePath = `${OUTPUT_DIR}/${pattern.id}-prototype-${width}.png`;
        await prototypePage.screenshot({ path: prototypePath });

        const composePage = await context.newPage();
        const htmlPath = `${OUTPUT_DIR}/.${pattern.id}-${width}.html`;
        writeFileSync(htmlPath, composeHtml(primitivePath, prototypePath, pattern.id, width));
        await composePage.goto(`file://${process.cwd()}/${htmlPath}`, { waitUntil: "load" });
        await composePage.setViewportSize({ width: width * 2, height: 980 });
        await composePage.waitForTimeout(200);
        await composePage.screenshot({ path: `${OUTPUT_DIR}/${pattern.id}-side-by-side-${width}.png` });

        await context.close();
        console.log(`[ode-427:evidence] ${pattern.id} @${width} captured.`);
      }
    }
    await recordKeyboardWalkthrough(browser, options);
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[ode-427:evidence] ${error?.message ?? error}`);
  process.exit(1);
});
