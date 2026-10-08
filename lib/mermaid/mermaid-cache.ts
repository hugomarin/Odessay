import { MERMAID_CONFIG_ID } from "@/lib/mermaid/mermaid-language";

/**
 * ODE-533: source-first Mermaid cache.
 *
 * The shared IR only knows `CodeBlock { language, source }`. Rendering is a
 * frontend/export adapter capability, so the cache lives here (adapter layer),
 * never in `lib/document-components/**`.
 *
 * Key = FNV-1a(source + config), with the original source checked on every hit.
 * Only successful, sanitized renders are cached in a small LRU; failures never
 * populate the cache.
 */

export const hashMermaidSource = (source: string, configId: string = MERMAID_CONFIG_ID): string => {
  const input = `${configId}\n${source}`;
  let hash = 2166136261;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
};

export const mermaidCacheKey = (source: string, configId: string = MERMAID_CONFIG_ID): string =>
  `${configId}:${hashMermaidSource(source, configId)}`;

export const MERMAID_RENDER_CACHE_MAX_ENTRIES = 32;

type SuccessfulRender = {
  source: string;
  svg: string;
};

const successfulRenders = new Map<string, SuccessfulRender>();

export const getCachedMermaidSvg = (source: string, configId: string = MERMAID_CONFIG_ID): string | undefined => {
  const key = mermaidCacheKey(source, configId);
  const cached = successfulRenders.get(key);
  if (!cached || cached.source !== source) return undefined;

  // Map insertion order tracks LRU order: hits move to the newest position.
  successfulRenders.delete(key);
  successfulRenders.set(key, cached);
  return cached.svg;
};

export const setCachedMermaidSvg = (
  source: string,
  svg: string,
  configId: string = MERMAID_CONFIG_ID,
): void => {
  const key = mermaidCacheKey(source, configId);
  successfulRenders.delete(key);
  successfulRenders.set(key, { source, svg });

  while (successfulRenders.size > MERMAID_RENDER_CACHE_MAX_ENTRIES) {
    const leastRecentlyUsedKey = successfulRenders.keys().next().value;
    if (leastRecentlyUsedKey === undefined) break;
    successfulRenders.delete(leastRecentlyUsedKey);
  }
};

export const hasCachedMermaidSvg = (source: string, configId: string = MERMAID_CONFIG_ID): boolean =>
  getCachedMermaidSvg(source, configId) !== undefined;

export const clearMermaidCache = (): void => {
  successfulRenders.clear();
};

export const getMermaidCacheSize = (): number => successfulRenders.size;
