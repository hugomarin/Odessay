import { readFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { safeImageSrc, safeUrl } from "@/lib/document-components/registry";
import {
  DOCUMENT_PROJECTION_SURFACES,
  DocumentComponentSpecRegistry,
  canonicalizeControlledMarkdown,
  parseControlledComponentAt,
  parseControlledMarkdown,
  serializeControlledDocument,
  validateDocumentComponentCoverage,
} from "@/lib/document-components";
import {
  parseMarkdownToDocumentIr,
  serializeDocumentIrToMarkdown,
} from "@/lib/editor/document-serialization";
import { materializeOpaqueSourceForRichParser } from "@/lib/editor/opaque-source-extensions";

const fixtures = join(process.cwd(), "tests/fixtures/document-components");
const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8");

const measureStringWork = <T>(run: () => T) => {
  let searchedTagCharacters = 0;
  let copiedCharacters = 0;
  let newlineScanCharacters = 0;
  const nativeIndexOf = String.prototype.indexOf;
  const nativeLastIndexOf = String.prototype.lastIndexOf;
  const nativeSlice = String.prototype.slice;
  const nativeIncludes = String.prototype.includes;
  const nativeCharAt = String.prototype.charAt;
  const countForwardSearch = (length: number, searchLength: number, fromIndex: number, foundAt: number) => {
    const start = Math.min(length, Math.max(0, Math.trunc(fromIndex)));
    return foundAt === -1 ? length - start : foundAt - start + searchLength;
  };
  const countReverseSearch = (length: number, searchLength: number, position: number | undefined, foundAt: number) => {
    const start = Math.min(length - searchLength, Math.trunc(position ?? length));
    if (start < 0) return 0;
    return foundAt === -1 ? start + searchLength : start - foundAt + searchLength;
  };
  const indexOfSpy = vi.spyOn(String.prototype, "indexOf").mockImplementation(function (
    this: string,
    search: string,
    fromIndex?: number,
  ) {
    const foundAt = nativeIndexOf.call(this, search, fromIndex);
    if (search === "\n") {
      newlineScanCharacters += countForwardSearch(this.length, search.length, fromIndex ?? 0, foundAt);
    }
    if (search === ">" || search.startsWith("</")) {
      searchedTagCharacters += countForwardSearch(this.length, search.length, fromIndex ?? 0, foundAt);
    }
    return foundAt;
  });
  const lastIndexOfSpy = vi.spyOn(String.prototype, "lastIndexOf").mockImplementation(function (
    this: string,
    search: string,
    position?: number,
  ) {
    const foundAt = nativeLastIndexOf.call(this, search, position);
    if (search === "\n") {
      newlineScanCharacters += countReverseSearch(this.length, search.length, position, foundAt);
    }
    if (search === ">" || search.startsWith("</")) {
      searchedTagCharacters += countReverseSearch(this.length, search.length, position, foundAt);
    }
    return foundAt;
  });
  const sliceSpy = vi.spyOn(String.prototype, "slice").mockImplementation(function (
    this: string,
    start?: number,
    end?: number,
  ) {
    const normalize = (value: number | undefined, fallback: number) => {
      if (value === undefined) return fallback;
      return value < 0 ? Math.max(this.length + Math.trunc(value), 0) : Math.min(Math.trunc(value), this.length);
    };
    copiedCharacters += Math.max(0, normalize(end, this.length) - normalize(start, 0));
    return nativeSlice.call(this, start, end);
  });
  const includesSpy = vi.spyOn(String.prototype, "includes").mockImplementation(function (
    this: string,
    search: string,
    position?: number,
  ) {
    if (search === "\n") {
      const foundAt = nativeIndexOf.call(this, search, position);
      newlineScanCharacters += countForwardSearch(this.length, search.length, position ?? 0, foundAt);
    }
    return nativeIncludes.call(this, search, position);
  });
  // Count direct parser character reads used by the shared line summary.
  const charAtSpy = vi.spyOn(String.prototype, "charAt").mockImplementation(function (
    this: string,
    position?: number,
  ) {
    const index = Math.trunc(position ?? 0);
    const normalizedIndex = Number.isFinite(index) ? index : 0;
    if (normalizedIndex >= 0 && normalizedIndex < this.length) searchedTagCharacters += 1;
    return nativeCharAt.call(this, position ?? 0);
  });

  try {
    return {
      value: run(),
      searchedTagCharacters,
      copiedCharacters,
      newlineScanCharacters,
    };
  } finally {
    indexOfSpy.mockRestore();
    lastIndexOfSpy.mockRestore();
    sliceSpy.mockRestore();
    includesSpy.mockRestore();
    charAtSpy.mockRestore();
  }
};

describe("ODE-529 controlled document engine", () => {
  it("offers static O(1) registry lookup with canonical attribute order", () => {
    expect(DocumentComponentSpecRegistry.get("Card")?.attributes.map(({ name }) => name)).toEqual([
      "title",
      "icon",
      "href",
    ]);
    expect(DocumentComponentSpecRegistry.get("Entity")?.attributes.map(({ name }) => name)).toEqual([
      "id",
      "type",
      "ref",
    ]);
    expect(DocumentComponentSpecRegistry.get("Highlight")?.attributes.map(({ name }) => name)).toEqual([
      "color",
    ]);
    expect(DocumentComponentSpecRegistry.get("Unknown")).toBeUndefined();
    expect(DocumentComponentSpecRegistry.values()).toHaveLength(16);
  });

  it("treats fences as opaque even when they contain registered tags", () => {
    const parsed = parseControlledMarkdown(fixture("valid/mixed.md"));
    const fence = parsed.document.children.find((node) => node.type === "code-block");
    expect(fence).toMatchObject({ type: "code-block", language: "tsx" });
    expect(fence && "raw" in fence ? fence.raw : "").toContain('<Card title="This is literal">');
  });

  it("canonicalizes known attributes once and is byte-idempotent", () => {
    const source = '<Card href="https://example.com/?a=1&amp;b=2" title="A &lt; B" icon="book">\nBody\n</Card>';
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe('<Card title="A &lt; B" icon="book" href="https://example.com/?a=1&amp;b=2">\nBody\n</Card>');
    expect(canonicalizeControlledMarkdown(canonical)).toBe(canonical);
  });

  it("keeps block-looking tags literal when they do not occupy their own lines", () => {
    const source = 'Before <Tip title="x">literal</Tip> after';
    const parsed = parseControlledMarkdown(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.children).toEqual([
      { type: "markdown", raw: source, start: 0, end: source.length },
    ]);
    expect(canonicalizeControlledMarkdown(source)).toBe(source);
  });

  it("parses one controlled block from its source offset without copying the suffix", () => {
    const source = 'Prelude\n\n<Tip title="At offset">\nBody\n</Tip>\n\nEpilogue';
    const start = source.indexOf("<Tip");
    const component = parseControlledComponentAt(source, start);

    expect(component).toMatchObject({ kind: "Tip", start });
    expect(component?.end).toBe(source.indexOf("</Tip>") + "</Tip>".length);
    expect(parseControlledComponentAt(source, start + 1)).toBeNull();
  });

  it.each(["Annotation", "Highlight", "Entity", "ProtectedText"])(
    "preserves an empty %s as invalid opaque source",
    (kind) => {
      const attributes = kind === "Annotation"
        ? 'id="a" type="footnote" comment=""'
        : kind === "Entity"
          ? 'id="e" type="person"'
          : kind === "ProtectedText"
            ? 'id="x"'
            : "";
      const source = `<${kind}${attributes ? ` ${attributes}` : ""}></${kind}>`;
      const parsed = parseControlledMarkdown(source);

      expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
        code: "invalid-content",
        kind,
      }));
      expect(serializeControlledDocument(parsed.document)).toBe(source);
    },
  );

  it.each([
    ["Highlight", '<Highlight id="h1">text</Highlight>'],
    ["Highlight", '<Highlight color="amber" id="h1">text</Highlight>'],
    ["Entity", '<Entity id="e1">text</Entity>'],
    ["Entity", '<Entity type="person">text</Entity>'],
    ["Entity", '<Entity id="e1" type="person" ref="ref" extra="x">text</Entity>'],
  ])("preserves an invalid %s as opaque source", (kind, source) => {
    const parsed = parseControlledMarkdown(source);

    expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
      code: "invalid-attributes",
      kind,
    }));
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("canonicalizes Entity and Highlight inline semantics", () => {
    const source = 'See <Highlight color="amber">this</Highlight> about <Entity id="ent-123" ref="https://example.com" type="company">Aplyca</Entity>.';
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe(
      'See <Highlight color="amber">this</Highlight> about <Entity id="ent-123" type="company" ref="https://example.com">Aplyca</Entity>.',
    );
    expect(canonicalizeControlledMarkdown(canonical)).toBe(canonical);
  });

  it("round-trips a Highlight without attributes with the amber default", () => {
    const source = "<Highlight>text</Highlight>";
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toBe(source);
  });

  it("accepts only explicit safe schemes or document-relative Card links", () => {
    const href = DocumentComponentSpecRegistry.get("Card")?.attributes.find(({ name }) => name === "href");

    expect(href?.validate?.("https://example.com")).toBe(true);
    expect(href?.validate?.("mailto:reader@example.com")).toBe(true);
    expect(href?.validate?.("../chapter/two")).toBe(true);
    expect(href?.validate?.("chapter/two")).toBe(true);
    expect(href?.validate?.("#notes")).toBe(true);
    expect(href?.validate?.("//evil.example")).toBe(false);
    expect(href?.validate?.(String.raw`\evil.example`)).toBe(false);
    expect(href?.validate?.(String.raw`chapter\evil.example`)).toBe(false);
    expect(href?.validate?.(" javascript:alert(1)")).toBe(false);
    expect(href?.validate?.("data:text/html,bad")).toBe(false);
    expect(href?.validate?.("file:///tmp/private")).toBe(false);
  });

  it("fails closed when repeated percent escapes still hide a scheme after the decode budget", () => {
    const href = `javascript%25${"25".repeat(10)}3A/x`;

    expect(safeUrl(href)).toBe(false);
  });

  it("fails closed when a scheme boundary falls beyond the normalization prefix", () => {
    const href = `javascript${"%09".repeat(500)}:alert(1)`;

    expect(href).toHaveLength(1519);
    expect(safeUrl(href)).toBe(false);
  });

  it("keeps URL validation bounded for a 125 KB multiply encoded scheme", () => {
    const encodedScheme = `javascript%25${"25".repeat(1_999)}3A/`;
    const href = `${encodedScheme}${"x".repeat(125 * 1024 - encodedScheme.length)}`;
    const startedAt = performance.now();
    const accepted = safeUrl(href);
    const elapsedMs = performance.now() - startedAt;

    expect(Buffer.byteLength(href)).toBe(125 * 1024);
    expect(accepted).toBe(false);
    expect(elapsedMs).toBeLessThan(250);
  });

  it("keeps a deep 125 KB scheme prefix within the normalization budget", () => {
    const encodedScheme = `javascript%25${"25".repeat(9_999)}3A/`;
    const href = `${encodedScheme}${"x".repeat(125 * 1024 - encodedScheme.length)}`;
    const startedAt = performance.now();
    const accepted = safeUrl(href);
    const elapsedMs = performance.now() - startedAt;

    expect(Buffer.byteLength(href)).toBe(125 * 1024);
    expect(accepted).toBe(false);
    expect(elapsedMs).toBeLessThan(150);
  });

  it("uses the ASCII fallback for percent groups containing invalid UTF-8", () => {
    expect(safeUrl("https%3A%E0")).toBe(true);
    expect(safeUrl("javascript%3A%2F%2A%E0%2A%2Falert(1)")).toBe(false);
    expect(safeUrl("javascript%3A%2F%2A%E0alert(1)")).toBe(false);
  });

  it.each([
    ["web upload asset API path", "/api/writing-assets/123e4567-e89b-12d3-a456-426614174000"],
    ["desktop upload asset API URL", "https://app.odessay.test/api/writing-assets/123e4567-e89b-12d3-a456-426614174000"],
    ["relative desktop asset path", "images/photo.png"],
    ["case-sensitive relative desktop asset path", "images/Photo.PNG"],
    ["remote HTTPS image URL", "https://example.com/photo.png?size=original"],
  ])("accepts the %s image source", (_form, src) => {
    expect(safeImageSrc(src)).toBe(true);
  });

  it.each([
    "javascript:alert(1)",
    "vbscript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "data:image/png;base64,aGVsbG8=",
    "file:///private/image.png",
    "unknown:image.png",
    "mailto:images@example.com",
    "#image-anchor",
    "javascript%3Aalert(1)",
    "java&#x09;script:alert(1)",
    "https%3A//example.com/photo.png",
  ])("rejects the unsafe or unsupported image source %s", (src) => {
    expect(safeImageSrc(src)).toBe(false);
  });

  it.each([
    ["invalid/unbalanced.md", "unbalanced-component"],
    ["invalid/unknown-tag.md", "unknown-component"],
    ["invalid/attributes.md", "invalid-attributes"],
  ])("preserves %s opaque source byte-for-byte", (path, code) => {
    const source = fixture(path);
    const parsed = parseControlledMarkdown(source);
    expect(parsed.diagnostics.some((entry) => entry.code === code)).toBe(true);
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("reads legacy annotations but only writes canonical Annotation", () => {
    const source = "This ==older annotation==[@n: Keep this comment] remains readable.";
    const canonical = canonicalizeControlledMarkdown(source);
    expect(canonical).toMatch(/This <Annotation id="legacy-[a-f0-9]{8}" type="footnote" comment="Keep this comment">older annotation<\/Annotation> remains readable\./);
    expect(canonical).not.toContain("[@n:");
  });

  it("validates container nesting and preserves invalid groups as opaque", () => {
    const valid = parseControlledMarkdown(fixture("valid/nesting.md"));
    expect(valid.diagnostics).toEqual([]);
    const invalid = "<Tabs>\n<Card title=\"Wrong child\">\nBody\n</Card>\n</Tabs>";
    const parsed = parseControlledMarkdown(invalid);
    expect(parsed.diagnostics.some(({ code }) => code === "invalid-nesting")).toBe(true);
    expect(serializeControlledDocument(parsed.document)).toBe(invalid);
  });

  it.each([10, 100, 1000])("round-trips the %i-component fixture", (count) => {
    const source = fixture(`scale/${count}.md`);
    const parsed = parseControlledMarkdown(source);
    expect(parsed.diagnostics).toEqual([]);
    expect(serializeControlledDocument(parsed.document)).toBe(source);
  });

  it("exposes one adapter at the existing serialization boundary", () => {
    const parsed = parseMarkdownToDocumentIr(fixture("valid/mixed.md"));
    expect(serializeDocumentIrToMarkdown(parsed)).toBe(
      canonicalizeControlledMarkdown(fixture("valid/mixed.md")),
    );
  });

  it("fails coverage for any missing kind or projection", () => {
    const full = Object.fromEntries(
      DocumentComponentSpecRegistry.values().map(({ kind }) => [kind, DOCUMENT_PROJECTION_SURFACES]),
    );
    expect(validateDocumentComponentCoverage(full)).toEqual([]);
    expect(validateDocumentComponentCoverage({ Card: ["source"] })).toContainEqual({
      kind: "Card",
      missing: DOCUMENT_PROJECTION_SURFACES.filter((surface) => surface !== "source"),
    });
  });

  it("scans 10,000 malformed angle brackets with linear search work", () => {
    const source = "<".repeat(10_000);
    const measured = measureStringWork(() => parseControlledMarkdown(source));

    expect(measured.value.document.source).toBe(source);
    expect(measured.searchedTagCharacters).toBeLessThanOrEqual(source.length * 2);
  });

  it("checks the tag name before copying a distant malformed suffix", () => {
    const source = `${"<".repeat(10_000)}>`;
    const measured = measureStringWork(() => parseControlledMarkdown(source));

    expect(measured.value.document.source).toBe(source);
    expect(measured.copiedCharacters).toBeLessThanOrEqual(source.length * 2);
  });

  it("keeps valid tag-name prefixes with one distant > linear", () => {
    const sizes = [2_500, 5_000, 10_000, 20_000];
    const work = sizes.map((count) => {
      const source = `a ${"<Card ".repeat(count)}>`;
      const measured = measureStringWork(() => parseControlledMarkdown(source));

      expect(measured.value.diagnostics).toEqual([]);
      expect(measured.value.document.source).toBe(source);
      expect(measured.value.document.children).toEqual([
        { type: "markdown", raw: source, start: 0, end: source.length },
      ]);
      return (
        measured.searchedTagCharacters +
        measured.copiedCharacters +
        measured.newlineScanCharacters
      );
    });

    for (let index = 1; index < work.length; index += 1) {
      expect(work[index]).toBeLessThanOrEqual(work[index - 1] * 2.5);
    }
  });

  it("bounds line-break work for many code spans and closed unknown tags on one line", () => {
    const count = 300;
    const sources = [
      ["code spans", Array.from({ length: count }, () => "`x`").join("")],
      ["closed unknown tags", Array.from({ length: count }, () => "<Future></Future>").join("")],
    ] as const;
    const violations: string[] = [];

    for (const [label, source] of sources) {
      const measured = measureStringWork(() => parseControlledMarkdown(source));
      expect(measured.value.document.source).toBe(source);
      if (measured.newlineScanCharacters > source.length * 6) {
        violations.push(`${label}: ${measured.newlineScanCharacters} scans for ${source.length} characters`);
      }
    }

    expect(violations).toEqual([]);
  });

  it("checks only each span range for many single-line code spans", () => {
    const source = Array.from({ length: 300 }, () => "`x`").join(" ");
    const measured = measureStringWork(() => parseControlledMarkdown(source));

    expect(measured.value.document.source).toBe(source);
    expect(measured.newlineScanCharacters).toBeLessThanOrEqual(source.length * 6);
  });

  it("checks block crossing once for 500 nested inline components", () => {
    const depth = 500;
    const openingTags = Array.from(
      { length: depth },
      (_, index) => `<Annotation id="a${index}" type="ai" comment="note">`,
    ).join("");
    const closingTags = Array.from({ length: depth }, (_, index) => `</Annotation>`)
      .reverse()
      .join("");
    const source = `${openingTags}x${closingTags}`;
    const measured = measureStringWork(() => parseControlledMarkdown(source));

    expect(measured.value.diagnostics).toEqual([]);
    expect(measured.newlineScanCharacters).toBeLessThanOrEqual(source.length * 2);
  });

  it("materializes many unterminated unknown tags without reparsing suffixes", () => {
    const count = 300;
    const source = Array.from(
      { length: count },
      (_, index) => `before <FutureKind${index}> text-${index}`,
    ).join(" ");
    const measured = measureStringWork(() => materializeOpaqueSourceForRichParser(source));

    expect(measured.value.match(/<odessay-opaque(?:-block)? data-raw=/g)).toHaveLength(count);
    expect(measured.searchedTagCharacters).toBeLessThanOrEqual(source.length * 8);
  });

  it("copies the source once when replacing many opaque spans", () => {
    const count = 300;
    const source = Array.from(
      { length: count },
      (_, index) => `before <FutureKind${index}> text-${index}`,
    ).join(" ");
    const measured = measureStringWork(() => materializeOpaqueSourceForRichParser(source));

    expect(measured.value.match(/<odessay-opaque(?:-block)? data-raw=/g)).toHaveLength(count);
    expect(measured.copiedCharacters).toBeLessThanOrEqual(source.length * 8);
  });
});
