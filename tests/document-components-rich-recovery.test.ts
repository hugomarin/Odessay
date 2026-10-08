/**
 * @vitest-environment happy-dom
 */
import { describe, expect, it } from "vitest";
import { parseControlledMarkdown } from "@/lib/document-components/parser";
import {
  parseMarkdownToSnapshot,
  serializeDocumentToMarkdown,
} from "@/lib/editor/document-serialization";

const richRoundTrip = (markdown: string) =>
  serializeDocumentToMarkdown(parseMarkdownToSnapshot(markdown).bodyJson);

describe("ODE-529 Rich parser recovery", () => {
  it("recovers only an unclosed unknown token before a same-line component without losing bytes", () => {
    const source = '<Future><Annotation id="a1" type="ai" comment="note">editable</Annotation>';
    const core = parseControlledMarkdown(source);
    const coreOpaque = core.document.children.find((node) => node.type === "opaque");
    const { bodyJson, bodyText } = parseMarkdownToSnapshot(source);
    const paragraphNodes = bodyJson.content?.[0]?.content ?? [];
    const opaqueToken = paragraphNodes.find((node) => node.type === "opaqueSource");

    // The default core contract still leaves the complete unclosed suffix opaque.
    expect(coreOpaque?.type === "opaque" ? coreOpaque.raw : undefined).toBe(source);
    // The Rich adapter treats only the unknown opener as opaque; the registered
    // Annotation suffix is available to Rich and retains its visible text.
    expect(opaqueToken?.attrs?.raw).toBe("<Future>");
    expect(bodyText).toContain("editable");
    // Positive control for preservation: this real Rich round-trip restores all bytes.
    expect(richRoundTrip(source)).toBe(source);
  });
});
