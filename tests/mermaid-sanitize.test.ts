import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "@/lib/mermaid/mermaid-sanitize";

const SAFE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><style>.node{fill:#fff}</style><g><rect width="10" height="10"/><text>Hello</text><a href="#fragment"><text>link</text></a></g></svg>`;

describe("mermaid sanitizer (ODE-533)", () => {
  it("keeps safe Mermaid SVG including style and fragment links", () => {
    expect(sanitizeMermaidSvg(SAFE_SVG)).toBe(SAFE_SVG);
  });

  it("rejects non-SVG payloads", () => {
    expect(sanitizeMermaidSvg("not svg")).toBeNull();
    expect(sanitizeMermaidSvg("<div>hi</div>")).toBeNull();
  });

  it("rejects script elements", () => {
    expect(sanitizeMermaidSvg(`<svg><script>alert(1)</script><g></g></svg>`)).toBeNull();
  });

  it("strips event-handler attributes instead of executing them", () => {
    const cleaned = sanitizeMermaidSvg(`<svg><g onclick="alert(1)"><rect width="1"/></g></svg>`);
    expect(cleaned).not.toBeNull();
    expect(cleaned).not.toMatch(/onclick/i);
  });

  it("rejects javascript: URLs", () => {
    expect(sanitizeMermaidSvg(`<svg><a href="javascript:alert(1)"><text>x</text></a></svg>`)).toBeNull();
  });

  it("rejects data:text/html URLs", () => {
    expect(sanitizeMermaidSvg(`<svg><a href="data:text/html,<script>alert(1)</script>"><text>x</text></a></svg>`)).toBeNull();
  });

  it("rejects foreign runtimes", () => {
    expect(sanitizeMermaidSvg(`<svg><foreignObject><div>html</div></foreignObject></svg>`)).toBeNull();
    expect(sanitizeMermaidSvg(`<svg><iframe src="https://example.com"></iframe></svg>`)).toBeNull();
    expect(sanitizeMermaidSvg(`<svg><object data="https://example.com"></object></svg>`)).toBeNull();
  });

  it("rejects CSS expression payloads", () => {
    expect(sanitizeMermaidSvg(`<svg><style>.x{width:expression(alert(1))}</style><g></g></svg>`)).toBeNull();
  });
});
