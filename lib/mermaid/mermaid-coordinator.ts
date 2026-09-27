import { getCachedMermaidSvg } from "@/lib/mermaid/mermaid-cache";
import { MERMAID_CONFIG_ID } from "@/lib/mermaid/mermaid-language";
import { MermaidRenderError, renderMermaidSvg } from "@/lib/mermaid/mermaid-loader";

/**
 * ODE-533: one visibility/render coordinator.
 *
 * A single owner holds the shared IntersectionObserver and the in-flight
 * render map. Individual Mermaid blocks register/unregister; they never own
 * an observer, a listener, or a render queue themselves.
 *
 * - Work scales with visible/requested Mermaid blocks M, not every fence C.
 * - Cache lookup is O(1) by hash; in-flight renders are single-flighted.
 * - Stale renders (source/document/revision changed mid-render) are discarded
 *   by revision token: only the latest requested revision may commit.
 */

export type MermaidRevision = number;

type PendingRender = {
  promise: Promise<string>;
  revision: MermaidRevision;
};

type VisibilityCallback = () => void;

class MermaidRenderCoordinator {
  private pending = new Map<string, PendingRender>();
  private observed = new Map<Element, VisibilityCallback>();
  private observer: IntersectionObserver | null = null;
  private revisionCounter = 0;

  nextRevision(): MermaidRevision {
    this.revisionCounter += 1;
    return this.revisionCounter;
  }

  currentRevision(): MermaidRevision {
    return this.revisionCounter;
  }

  getPendingCountForTests(): number {
    return this.pending.size;
  }

  getObservedCountForTests(): number {
    return this.observed.size;
  }

  hasSharedObserverForTests(): boolean {
    return this.observer !== null;
  }

  private ensureObserver(): IntersectionObserver | null {
    if (typeof IntersectionObserver === "undefined") return null;
    if (!this.observer) {
      this.observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const callback = this.observed.get(entry.target);
            if (callback) {
              this.unobserve(entry.target);
              callback();
            }
          }
        },
        { rootMargin: "200px" },
      );
    }
    return this.observer;
  }

  observe(element: Element, onVisible: VisibilityCallback): () => void {
    this.observed.set(element, onVisible);
    const observer = this.ensureObserver();
    if (observer) {
      observer.observe(element);
      return () => this.unobserve(element);
    }
    // No IntersectionObserver (SSR/tests): caller decides when to render.
    return () => this.unobserve(element);
  }

  unobserve(element: Element): void {
    this.observed.delete(element);
    this.observer?.unobserve(element);
    if (this.observed.size === 0) {
      this.observer?.disconnect();
      this.observer = null;
    }
  }

  resetForTests(): void {
    this.pending.clear();
    this.observed.clear();
    this.observer?.disconnect();
    this.observer = null;
    this.revisionCounter = 0;
  }

  requestRender(source: string, revision: MermaidRevision, configId: string = MERMAID_CONFIG_ID): Promise<string> {
    const cached = getCachedMermaidSvg(source, configId);
    if (cached) return Promise.resolve(cached);

    const key = `${configId}:${source}`;
    const inFlight = this.pending.get(key);
    const withRevisionCheck = (raw: Promise<string>): Promise<string> =>
      raw.then((svg) => {
        if (revision < this.revisionCounter) {
          throw new MermaidRenderError("invalid", "Stale diagram render discarded.");
        }
        return svg;
      });
    if (inFlight) {
      // Single-flight: share the raw in-flight render. Each caller applies
      // its own revision check so an older caller goes stale without
      // poisoning the newer caller sharing the same raw work.
      return withRevisionCheck(inFlight.promise);
    }

    const raw = renderMermaidSvg(source, { configId });
    // Evict from the single-flight map once the raw work settles; revision
    // checks happen per caller on the derived promises below.
    raw.then(
      () => {
        this.pending.delete(key);
      },
      () => {
        this.pending.delete(key);
      },
    );
    const promise = raw;
    this.pending.set(key, { promise, revision });
    return withRevisionCheck(promise);
  }
}

export const mermaidRenderCoordinator = new MermaidRenderCoordinator();
