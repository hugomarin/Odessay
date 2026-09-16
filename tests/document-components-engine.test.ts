import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DOCUMENT_PROJECTION_SURFACES,
  DocumentComponentSpecRegistry,
  canonicalizeControlledMarkdown,
  parseControlledMarkdown,
  serializeControlledDocument,
  validateDocumentComponentCoverage,
} from "@/lib/document-components";
import {
  parseMarkdownToDocumentIr,
  serializeDocumentIrToMarkdown,
} from "@/lib/editor/document-serialization";

const fixtures = join(process.cwd(), "tests/fixtures/document-components");
const fixture = (path: string) => readFileSync(join(fixtures, path), "utf8");

describe("ODE-529 controlled document engine", () => {
  it("offers static O(1) registry lookup with canonical attribute order", () => {
    expect(DocumentComponentSpecRegistry.get("Card")?.attributes.map(({ name }) => name)).toEqual([
      "title",
      "icon",
      "href",
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
});
