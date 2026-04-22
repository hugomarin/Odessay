import { describe, expect, it } from "vitest";
import type { PublicationSuggestion } from "../lib/local-db/schema";
import {
  applyAllPublicationSuggestions,
  applySuggestionToMarkdown,
  findSuggestionMatch,
  hashPublicationSource,
} from "../lib/editor/suggestion-engine";

const createSuggestion = (overrides: Partial<PublicationSuggestion> = {}): PublicationSuggestion => ({
  id: "spelling-1",
  kind: "spelling",
  title: "Fix agreement",
  reason: "Correct the verb form.",
  original_text: "are ready",
  replacement_text: "is ready",
  context_before: "The letter",
  context_after: "for print.",
  status: "pending",
  ...overrides,
});

describe("publication suggestion engine", () => {
  it("finds a context-aware match inside markdown", () => {
    const source = "The letter are ready for print.\n\nThe notes are ready for review.";
    const match = findSuggestionMatch(source, createSuggestion());

    expect(match).toEqual({ start: 11, end: 20 });
  });

  it("applies a single suggestion to markdown", () => {
    const source = "The letter are ready for print.";
    const result = applySuggestionToMarkdown(source, createSuggestion());

    expect(result.applied).toBe(true);
    expect(result.markdown).toBe("The letter is ready for print.");
  });

  it("applies all pending suggestions from the end of the document", () => {
    const source = "The letter are ready for print.\nThe notes are ready for review.";
    const result = applyAllPublicationSuggestions(source, [
      createSuggestion(),
      createSuggestion({
        id: "rewriting-1",
        kind: "rewriting",
        title: "Tighten line",
        reason: "Shorter phrasing.",
        original_text: "for review",
        replacement_text: "to review",
        context_before: "ready",
        context_after: null,
      }),
    ]);

    expect(result.appliedIds).toEqual(["rewriting-1", "spelling-1"]);
    expect(result.markdown).toBe("The letter is ready for print.\nThe notes are ready to review.");
  });

  it("returns a stable content hash", () => {
    expect(hashPublicationSource("same source")).toBe(hashPublicationSource("same source"));
    expect(hashPublicationSource("same source")).not.toBe(hashPublicationSource("other source"));
  });
});
