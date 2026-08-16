import { existsSync, readFileSync } from "node:fs";

/**
 * Opening a `.dc.html` prototype from a sandbox.
 *
 * The prototypes fetch React, Babel and Lucide from unpkg at runtime, so a
 * runner without egress to that host renders the raw `{{template}}` markup
 * instead of the design — and a capture of that is worthless as evidence. The
 * helper below serves those three files from a local directory instead.
 *
 * Populate the directory with the same versions the prototypes pin:
 *
 *   npm pack react@18.3.1 react-dom@18.3.1 @babel/standalone@7.29.0 lucide@0.469.0
 *
 * then extract each tarball and pass the parent directory as `--vendor`.
 */

/** unpkg path → the path it lives at under an extracted npm tarball. */
const VENDOR_FILES = {
  "react@18.3.1/umd/react.production.min.js": "react-18.3.1/umd/react.production.min.js",
  "react-dom@18.3.1/umd/react-dom.production.min.js":
    "react-dom-18.3.1/umd/react-dom.production.min.js",
  "@babel/standalone@7.29.0/babel.min.js": "babel-standalone-7.29.0/babel.min.js",
  "lucide@0.469.0/dist/umd/lucide.js": "lucide-0.469.0/dist/umd/lucide.js",
};

export async function routeVendoredPrototypeDeps(context, vendorDir) {
  if (!vendorDir) return;

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
      body: readFileSync(filePath),
    });
  });
}

/**
 * Opens a prototype and waits until it has actually rendered — a page still
 * showing `{{` placeholders never hydrated, and capturing it would compare the
 * implementation against nothing.
 */
export async function openPrototype(context, baseUrl, file, { timeout = 30_000 } = {}) {
  const page = await context.newPage();
  await page.goto(`${baseUrl}/${encodeURIComponent(file)}`, { waitUntil: "networkidle" });

  await page.waitForFunction(
    () => !document.body.innerHTML.includes("{{") && document.body.children.length > 0,
    undefined,
    { timeout },
  );
  await page.waitForTimeout(1200);

  return page;
}
