import { MERMAID_CONFIG_ID } from "@/lib/mermaid/mermaid-language";

/**
 * ODE-533: source-first Mermaid cache.
 *
 * The shared IR only knows `CodeBlock { language, source }`. Rendering is a
 * frontend/export adapter capability, so the cache lives here (adapter layer),
 * never in `lib/document-components/**`.
 *
 * Key = FNV-1a(source + config). Lookup is O(1) by hash. Only successful,
 * sanitized renders are cached; failures never populate the cache.
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

const successfulRenders = new Map<string, string>();

export const getCachedMermaidSvg = (source: string, configId: string = MERMAID_CONFIG_ID): string | undefined =>
  successfulRenders.get(mermaidCacheKey(source, configId));

export const setCachedMermaidSvg = (
  source: string,
  svg: string,
  configId: string = MERMAID_CONFIG_ID,
): void => {
  successfulRenders.set(mermaidCacheKey(source, configId), svg);
};

export const hasCachedMermaidSvg = (source: string, configId: string = MERMAID_CONFIG_ID): boolean =>
  successfulRenders.has(mermaidCacheKey(source, configId));

export const clearMermaidCache = (): void => {
  successfulRenders.clear();
};

export const getMermaidCacheSize = (): number => successfulRenders.size;
