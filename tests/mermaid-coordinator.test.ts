/**
 * @vitest-environment happy-dom
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clearMermaidCache } from "@/lib/mermaid/mermaid-cache";
import { mermaidRenderCoordinator } from "@/lib/mermaid/mermaid-coordinator";
import { resetMermaidLoaderForTests, setMermaidLoaderForTests } from "@/lib/mermaid/mermaid-loader";

const requestForOwner = (owner: object, source: string): Promise<string> => {
  const revisionApi = mermaidRenderCoordinator as unknown as {
    nextRevision(owner: object): unknown;
    requestRender(source: string, revision: unknown): Promise<string>;
  };
  const revision = revisionApi.nextRevision(owner);
  return revisionApi.requestRender(source, revision);
};

describe("mermaid coordinator (ODE-533)", () => {
  beforeEach(() => {
    clearMermaidCache();
    resetMermaidLoaderForTests();
    mermaidRenderCoordinator.resetForTests();
    setMermaidLoaderForTests(null);
  });

  it("single-flights concurrent renders and discards the older request for one owner", async () => {
    const render = vi.fn(async (_id: string, _text: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      return { svg: "<svg><g>shared</g></svg>" };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    const owner = {};
    // Both callers share the in-flight render; the older revision is stale
    // once a newer revision exists, so only the latest may commit.
    const first = requestForOwner(owner, "graph TD; A-->B");
    const second = requestForOwner(owner, "graph TD; A-->B");
    await expect(second).resolves.toBe("<svg><g>shared</g></svg>");
    await expect(first).rejects.toMatchObject({ code: "invalid" });
    expect(render).toHaveBeenCalledTimes(1);
    setMermaidLoaderForTests(null);
  });

  it("allows concurrent renders for different owners and sources", async () => {
    let releaseRenders!: () => void;
    const renderGate = new Promise<void>((resolve) => {
      releaseRenders = resolve;
    });
    const render = vi.fn(async (_id: string, source: string) => {
      await renderGate;
      return {
        svg: source.includes("A-->B") ? "<svg><g>owner-a</g></svg>" : "<svg><g>owner-b</g></svg>",
      };
    });
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));

    const first = requestForOwner({}, "graph TD; A-->B");
    const second = requestForOwner({}, "graph TD; C-->D");
    await vi.waitFor(() => expect(render).toHaveBeenCalledTimes(2), { timeout: 2000 });
    releaseRenders();

    await expect(Promise.all([first, second])).resolves.toEqual([
      "<svg><g>owner-a</g></svg>",
      "<svg><g>owner-b</g></svg>",
    ]);
    expect(render).toHaveBeenCalledTimes(2);
    setMermaidLoaderForTests(null);
  });

  it("serves cached renders without touching the loader", async () => {
    const render = vi.fn(async () => ({ svg: "<svg><g>cached</g></svg>" }));
    setMermaidLoaderForTests(async () => ({ initialize: () => {}, render }));
    const owner = {};
    await expect(requestForOwner(owner, "graph TD; A-->B")).resolves.toBe(
      "<svg><g>cached</g></svg>",
    );
    expect(render).toHaveBeenCalledTimes(1);
    const failingLoader = vi.fn(async () => {
      throw new Error("must not load");
    });
    setMermaidLoaderForTests(failingLoader);
    await expect(requestForOwner(owner, "graph TD; A-->B")).resolves.toBe(
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
