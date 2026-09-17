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

  it("keeps block-looking tags literal when they do not occupy their own lines", () => {
    const source = 'Before <Tip title="x">literal</Tip> after';
    const parsed = parseControlledMarkdown(source);

    expect(parsed.diagnostics).toEqual([]);
    expect(parsed.document.children).toEqual([
      { type: "markdown", raw: source, start: 0, end: source.length },
    ]);
    expect(canonicalizeControlledMarkdown(source)).toBe(source);
  });

  it.each(["Annotation", "Highlight", "Entity", "ProtectedText"])(
    "preserves an empty %s as invalid opaque source",
    (kind) => {
      const attributes = kind === "Annotation"
        ? 'id="a" type="footnote" comment=""'
        : kind === "Entity"
          ? 'id="e" type="person"'
          : 'id="x"';
      const source = `<${kind} ${attributes}></${kind}>`;
      const parsed = parseControlledMarkdown(source);

      expect(parsed.diagnostics).toContainEqual(expect.objectContaining({
        code: "invalid-content",
        kind,
      }));
      expect(serializeControlledDocument(parsed.document)).toBe(source);
    },
  );

  it("accepts only explicit safe schemes or document-relative Card links", () => {
    const href = DocumentComponentSpecRegistry.get("Card")?.attributes.find(({ name }) => name === "href");

    expect(href?.validate?.("https://example.com")).toBe(true);
    expect(href?.validate?.("mailto:reader@example.com")).toBe(true);
    expect(href?.validate?.("../chapter/two")).toBe(true);
    expect(href?.validate?.("chapter/two")).toBe(true);
    expect(href?.validate?.("#notes")).toBe(true);
    expect(href?.validate?.("//evil.example")).toBe(false);
    expect(href?.validate?.(String.raw`\evil.example`)).toBe(false);
    expect(href?.validate?.(" javascript:alert(1)")).toBe(false);
    expect(href?.validate?.("data:text/html,bad")).toBe(false);
    expect(href?.validate?.("file:///tmp/private")).toBe(false);
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
