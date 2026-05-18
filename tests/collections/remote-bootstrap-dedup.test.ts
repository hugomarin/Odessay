import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hydrateLocalCollectionsFromRemote } from "@/lib/collections/remote-bootstrap";
import { localDB, setLocalDBScope } from "@/lib/local-db";

beforeEach(() => {
  vi.stubGlobal("window", globalThis);
  setLocalDBScope(`collections-dedup-${crypto.randomUUID()}`);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("hydrateLocalCollectionsFromRemote — in-flight dedup", () => {
  it("deduplicates 4 concurrent invocations into a single fetch", async () => {
    const payload = {
      data: {
        collections: [
          {
            id: "collection-1",
            owner_id: "user-1",
            name: "Remote Collection",
            description: null,
            visibility: "private" as const,
            created_at: "2026-04-21T00:00:00.000Z",
            updated_at: "2026-04-21T00:00:00.000Z",
          },
        ],
        writingCollections: [],
      },
      error: null,
    };

    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1;
        return new Promise<Response>((resolve) => {
          setTimeout(() => {
            resolve(
              new Response(JSON.stringify(payload), {
                status: 200,
                headers: { "Content-Type": "application/json" },
              }),
            );
          }, 50);
        });
      }),
    );

    const p1 = hydrateLocalCollectionsFromRemote();
    const p2 = hydrateLocalCollectionsFromRemote();
    const p3 = hydrateLocalCollectionsFromRemote();
    const p4 = hydrateLocalCollectionsFromRemote();

    const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

    expect(fetchCount).toBe(1);
    expect(r1.collections).toHaveLength(1);
    expect(r2.collections).toHaveLength(1);
    expect(r3.collections).toHaveLength(1);
    expect(r4.collections).toHaveLength(1);

  });

  it("propagates errors to all concurrent callers", async () => {
    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1;
        return new Promise<Response>((_, reject) => {
          setTimeout(() => {
            reject(new Error("Network failure"));
          }, 50);
        });
      }),
    );

    const p1 = hydrateLocalCollectionsFromRemote();
    const p2 = hydrateLocalCollectionsFromRemote();
    const p3 = hydrateLocalCollectionsFromRemote();
    const p4 = hydrateLocalCollectionsFromRemote();

    await expect(Promise.all([p1, p2, p3, p4])).rejects.toThrow("Network failure");
    expect(fetchCount).toBe(1);

  });

  it("releases the in-flight promise so a subsequent call triggers a new fetch", async () => {
    const payload = {
      data: {
        collections: [
          {
            id: "collection-1",
            owner_id: "user-1",
            name: "Remote Collection",
            description: null,
            visibility: "private" as const,
            created_at: "2026-04-21T00:00:00.000Z",
            updated_at: "2026-04-21T00:00:00.000Z",
          },
        ],
        writingCollections: [],
      },
      error: null,
    };

    let fetchCount = 0;
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        fetchCount += 1;
        return Promise.resolve(
          new Response(JSON.stringify(payload), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          }),
        );
      }),
    );

    await hydrateLocalCollectionsFromRemote();
    expect(fetchCount).toBe(1);

    await hydrateLocalCollectionsFromRemote();
    expect(fetchCount).toBe(2);

  });
});
