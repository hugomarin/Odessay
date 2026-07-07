import { describe, expect, it } from "vitest";
import { findTokenBoundaryMatch } from "@/lib/corrections/engine/matching";

describe("corrections token-boundary matching", () => {
  it("matches an isolated correction target instead of a substring inside another token", () => {
    const source = "la comodidad de como escribo";
    const match = findTokenBoundaryMatch(source, "como", "cómo");

    expect(match).toEqual({ start: 16, end: 20 });
  });

  it("rejects partial matches inside tokens with apostrophes, hyphens, or diacritics", () => {
    expect(findTokenBoundaryMatch("rock'n'roll sigue", "roll", "rol", null, null)).toBeNull();
    expect(findTokenBoundaryMatch("pre-como escrito", "como", "cómo", null, null)).toBeNull();
    expect(findTokenBoundaryMatch("acciónable no es accion", "acción", "accion", null, null)).toBeNull();
  });

  it("returns null when occurrence metadata points outside valid token-boundary matches", () => {
    expect(findTokenBoundaryMatch("como y como", "como", "cómo", null, null, 2)).toBeNull();
  });

  it("uses context to select among repeated token-boundary matches", () => {
    const source = "como inicio. Luego como final.";

    expect(findTokenBoundaryMatch(source, "como", "cómo", "Luego", "final")).toEqual({
      start: 19,
      end: 23,
    });
  });
});
