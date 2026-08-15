import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Guards the five design deltas closed by ODE-425.
 *
 * The tokens and the editor body size are the vocabulary every Fase 10 view
 * issue consumes; if any of them drifts, the views built on top of them drift
 * silently. This file is the cheap check that they did not.
 */

const globals = readFileSync(resolve(__dirname, "../app/globals.css"), "utf8");

/** Renders an `H S% L%` triplet to the uppercase hex a browser would paint. */
function hslTripletToHex(triplet: string): string {
  const [rawH, rawS, rawL] = triplet.trim().split(/\s+/);
  const h = Number.parseFloat(rawH);
  const s = Number.parseFloat(rawS) / 100;
  const l = Number.parseFloat(rawL) / 100;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sector = Math.floor(h / 60) % 6;
  const [r, g, b] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ][sector];

  return [r, g, b]
    .map((channel) =>
      Math.round((channel + m) * 255)
        .toString(16)
        .padStart(2, "0")
        .toUpperCase()
    )
    .join("");
}

function readRootToken(name: string): string {
  const match = globals.match(new RegExp(`--${name}:\\s*([^;]+);`));
  expect(match, `--${name} is not declared in app/globals.css`).not.toBeNull();
  return match![1].trim();
}

describe("delta 1 — Artifact Studio tokens", () => {
  // Hex as painted by the prototypes in docs/design/reference/*.dc.html.
  // The prototype render is the authority, not the HSL transcription in
  // docs/design/globals-additions.css — see docs/design/system-app.md §1.
  const colorTokens: Record<string, string> = {
    "ink-5": "B5ADA5",
    "ink-6": "CFC9C1",
    "line-soft": "EDEBE8",
    "line-softer": "F0EEEB",
    "surface-selected": "FAF7F3",
    "surface-row-hover": "FCFBFA",
    success: "2E7D4F",
    "success-tint": "E4F0E7",
  };

  it.each(Object.entries(colorTokens))(
    "--%s renders the prototype hex exactly",
    (token, hex) => {
      expect(hslTripletToHex(readRootToken(token))).toBe(hex);
    }
  );

  it.each(Object.keys(colorTokens))("--%s is exposed as a Tailwind color", (token) => {
    expect(globals).toContain(`--color-${token}: hsl(var(--${token}));`);
  });

  const sizeTokens: Record<string, string> = {
    "size-rail-collapsed": "52px",
    "size-rail-expanded": "232px",
    "size-settings-nav": "244px",
    "size-panel-left": "236px",
    "size-panel-right": "276px",
    "size-titlebar": "44px",
    "size-topbar": "48px",
    "size-statusbar": "46px",
    "size-sheet-editor": "720px",
    "size-sheet-reading": "660px",
    "radius-bar": "14px",
    "radius-modal": "18px",
  };

  it.each(Object.entries(sizeTokens))("--%s is %s", (token, value) => {
    expect(readRootToken(token)).toBe(value);
  });

  it.each([
    "shadow-selection-bar",
    "shadow-modal",
    "shadow-auth-card",
    "shadow-splash-mark",
  ])("--%s is declared", (token) => {
    expect(readRootToken(token).length).toBeGreaterThan(0);
  });

  it("keeps the marketing layer out of the product stylesheet", () => {
    // The [data-layer="marketing"] block of globals-additions.css belongs to
    // ODE-440, not here. Leaking it would let marketing tokens reach app views.
    expect(globals).not.toContain('data-layer="marketing"');
    expect(globals).not.toContain("--font-newsreader");
  });
});

describe("delta 3 — editor body is 17/1.9 on every presentation surface", () => {
  const bodyRule = globals.match(
    /\.odessay-editor-content,\s*\n\s*\.prose-odessay\s*\{([^}]*)\}/
  );

  it("declares 17px / 1.9 in the grouped rule", () => {
    expect(bodyRule).not.toBeNull();
    expect(bodyRule![1]).toMatch(/font-size:\s*17px;/);
    expect(bodyRule![1]).toMatch(/line-height:\s*1\.9;/);
  });

  it("keeps the markdown source overlay pair in lockstep with the body", () => {
    // The textarea is transparent and sits on top of the semantic layer: if the
    // two ever differ, the caret stops landing on the glyph it is editing.
    for (const cls of ["odessay-markdown-source", "odessay-markdown-semantic"]) {
      const rule = globals.match(new RegExp(`\\.${cls}\\s*\\{([^}]*)\\}`));
      expect(rule, `.${cls} rule not found`).not.toBeNull();
      expect(rule![1]).toMatch(/font-size:\s*17px;/);
      expect(rule![1]).toMatch(/line-height:\s*1\.9;/);
    }
  });

  it("has no per-surface body size override outside the mobile breakpoint", () => {
    // /write/[id], /preview/[token], /shared/[id] and /{username}/{slug} all
    // reach the body size through .odessay-editor-content or .prose-odessay.
    // A second declaration anywhere else would break cross-mode parity.
    const mobileBlockStart = globals.indexOf("@media (max-width: 699px)");
    const beforeMobile = globals.slice(0, mobileBlockStart).replace(/\/\*[\s\S]*?\*\//g, "");

    // Rules that set a font-size AND whose every selector is one of the two
    // container classes bare — i.e. the body size itself, not an em-scaled child.
    const containerRules = [...beforeMobile.matchAll(/([^{}]+)\{([^}]*)\}/g)].filter(
      ([, selector, body]) =>
        /font-size:/.test(body) &&
        selector
          .split(",")
          .map((part) => part.trim())
          .every((part) => part === ".prose-odessay" || part === ".odessay-editor-content")
    );

    expect(containerRules).toHaveLength(1);
  });
});

describe("scrollbars — a single .od-scroll treatment", () => {
  it("is defined once with the prototype values", () => {
    expect(globals).toContain(".od-scroll {");
    expect(globals).toMatch(/scrollbar-color:\s*#e3e0db transparent;/i);
    expect(globals).toMatch(
      /\.od-scroll::-webkit-scrollbar-thumb\s*\{[^}]*background-clip:\s*content-box;/
    );
  });
});
