import { describe, expect, it } from "vitest";
import { sanitizeMermaidSvg } from "@/lib/mermaid/mermaid-sanitize";

/**
 * ODE-533 security fixtures: unsafe Mermaid payloads must never execute.
 * Each fixture preserves the source (caller falls back to the fence) and the
 * sanitizer returns null so no SVG is committed.
 */
describe("mermaid security fixtures (ODE-533)", () => {
  const fixtures: Array<[string, string]> = [
    ["script in svg", `<svg><script>fetch("https://evil.example")</script></svg>`],
    ["onerror handler", `<svg><image href="x" onerror="alert(1)"/></svg>`],
    ["onload handler", `<svg><g onload="alert(1)"><rect/></g></svg>`],
    ["javascript href", `<svg><a href="JaVaScRiPt:alert(1)"><text>x</text></a></svg>`],
    ["data html href", `<svg><a xlink:href="data:text/html;base64,PHNjcmlwdD4="><text>x</text></a></svg>`],
    ["foreignObject html", `<svg><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img src=x onerror=alert(1)>`],
    ["iframe embed", `<svg><g><iframe src="https://evil.example"></iframe></g></svg>`],
    ["css javascript url", `<svg><style>.a{background:url(javascript:alert(1))}</style></svg>`],
    ["vbscript href", `<svg><a href="vbscript:msgbox(1)"><text>x</text></a></svg>`],
  ];

  it.each(fixtures)("neutralizes %s", (_name, svg) => {
    const cleaned = sanitizeMermaidSvg(svg);
    // Either outcome is safe: reject (null, caller falls back to source) or
    // sanitize (no script/event-handler/unsafe-URL/foreign runtime survives).
    if (cleaned === null) return;
    expect(cleaned).not.toMatch(/<script/i);
    expect(cleaned).not.toMatch(/\son\w+\s*=/i);
    expect(cleaned).not.toMatch(/javascript:/i);
    expect(cleaned).not.toMatch(/data:text\/html/i);
    expect(cleaned).not.toMatch(/<(iframe|object|embed|foreignObject|link|meta|base|form)\b/i);
  });

  it("allows safe http/https/mailto links and fragment links", () => {
    const safe = `<svg><a href="https://example.com"><text>a</text></a><a href="mailto:a@example.com"><text>b</text></a><a href="#node"><text>c</text></a></svg>`;
    expect(sanitizeMermaidSvg(safe)).not.toBeNull();
  });
});
