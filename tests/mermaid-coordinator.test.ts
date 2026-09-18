/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMermaidCache } from "@/lib/mermaid/mermaid-cache";
import { mermaidRenderCoordinator } from "@/lib/mermaid/mermaid-coordinator";
import { resetMermaidLoaderForTests, setMermaidLoaderForTests } from "@/lib/mermaid/mermaid-loader";

describe("mermaid coordinator (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
    resetMermaidLoaderForTests();
    mermaidRenderCoordinator.resetForTests();
    setMermaidLoaderForTests(null);
  });

  it("single-flights concurrent renders for the same source", async () => {
    const render = vi.fn(async (_id: string, _text: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { svg: "<svg><g>shared</g></svg>" };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    const firstRevision = mermaidRenderCoordinator.nextRevision();
    const secondRevision = mermaidRenderCoordinator.nextRevision();
    // Both callers share the in-flight render; the older revision is stale
    // once a newer revision exists, so only the latest may commit.
    const first = mermaidRenderCoordinator.requestRender("graph TD; A-->B", firstRevision);
    const second = mermaidRenderCoordinator.requestRender("graph TD; A-->B", secondRevision);
    await expect(second).resolves.toBe("<svg><g>shared</g></svg>");
    await expect(first).rejects.toMatchObject({ code: "invalid" });
    expect(render).toHaveBeenCalledTimes(1);
    setMermaidLoaderForTests(null);
  });

  it("serves cached renders without touching the loader", async () => {
    const render = vi.fn(async () => ({ svg: "<svg><g>cached</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    const firstRevision = mermaidRenderCoordinator.nextRevision();
    await expect(mermaidRenderCoordinator.requestRender("graph TD; A-->B", firstRevision)).resolves.toBe(
      "<svg><g>cached</g></svg>",
    );
    expect(render).toHaveBeenCalledTimes(1);
    const failingLoader = vi.fn(async () => {
      throw new Error("must not load");
    });
    setMermaidLoaderForTests(failingLoader);
    const secondRevision = mermaidRenderCoordinator.nextRevision();
    await expect(mermaidRenderCoordinator.requestRender("graph TD; A-->B", secondRevision)).resolves.toBe(
      "<svg><g>cached</g></svg>",
    );
    expect(failingLoader).not.toHaveBeenCalled();
    setMermaidLoaderForTests(null);
  });

  it("owns a single shared observer instead of one per block", () => {
    const first = document.createElement("div");
    const second = document.createElement("div");
    document.body.append(first, second);
    const releaseFirst = mermaidRenderCoordinator.observe(first, () => {});
    const releaseSecond = mermaidRenderCoordinator.observe(second, () => {});
    expect(mermaidRenderCoordinator.getObservedCountForTests()).toBe(2);
    // One coordinator instance multiplexes both registrations.
    expect(mermaidRenderCoordinator.hasSharedObserverForTests() || typeof IntersectionObserver === "undefined").toBe(true);
    releaseFirst();
    releaseSecond();
    expect(mermaidRenderCoordinator.getObservedCountForTests()).toBe(0);
    first.remove();
    second.remove();
  });
});
