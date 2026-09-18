import { describe, expect, it, beforeEach } from "vitest";
import {
  clearMermaidCache,
  getCachedMermaidSvg,
  getMermaidCacheSize,
  hasCachedMermaidSvg,
  hashMermaidSource,
  mermaidCacheKey,
  setCachedMermaidSvg,
} from "@/lib/mermaid/mermaid-cache";

describe("mermaid cache (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
  });

  it("hashes stably and distinguishes sources and configs", () => {
    expect(hashMermaidSource("graph TD; A-->B")).toBe(hashMermaidSource("graph TD; A-->B"));
    expect(hashMermaidSource("graph TD; A-->B")).not.toBe(hashMermaidSource("graph TD; A-->C"));
    expect(mermaidCacheKey("a", "cfg-1")).not.toBe(mermaidCacheKey("a", "cfg-2"));
  });

  it("caches only successful renders with O(1) lookup", () => {
    expect(hasCachedMermaidSvg("graph TD; A-->B")).toBe(false);
    setCachedMermaidSvg("graph TD; A-->B", "<svg></svg>");
    expect(hasCachedMermaidSvg("graph TD; A-->B")).toBe(true);
    expect(getCachedMermaidSvg("graph TD; A-->B")).toBe("<svg></svg>");
    expect(getCachedMermaidSvg("graph TD; A-->C")).toBeUndefined();
    expect(getMermaidCacheSize()).toBe(1);
  });

  it("keeps distinct sources under distinct keys", () => {
    setCachedMermaidSvg("graph TD; A-->B", "<svg>one</svg>");
    setCachedMermaidSvg("graph TD; A-->C", "<svg>two</svg>");
    expect(getCachedMermaidSvg("graph TD; A-->B")).toBe("<svg>one</svg>");
    expect(getCachedMermaidSvg("graph TD; A-->C")).toBe("<svg>two</svg>");
    expect(getMermaidCacheSize()).toBe(2);
  });
});
