export {
  MERMAID_CONFIG_ID,
  MERMAID_LANGUAGE,
  MERMAID_MAX_SOURCE_LENGTH,
  MERMAID_RENDER_TIMEOUT_MS,
  isMermaidLanguage,
  normalizeCodeLanguage,
} from "@/lib/mermaid/mermaid-language";
export {
  getCachedMermaidSvg,
  setCachedMermaidSvg,
  hasCachedMermaidSvg,
  clearMermaidCache,
  getMermaidCacheSize,
  hashMermaidSource,
  mermaidCacheKey,
} from "@/lib/mermaid/mermaid-cache";
export { sanitizeMermaidSvg } from "@/lib/mermaid/mermaid-sanitize";
export {
  MermaidRenderError,
  renderMermaidSvg,
  setMermaidLoaderForTests,
  getMermaidRenderCountForTests,
  resetMermaidLoaderForTests,
  type MermaidRenderErrorCode,
} from "@/lib/mermaid/mermaid-loader";
export { mermaidRenderCoordinator, type MermaidRevision } from "@/lib/mermaid/mermaid-coordinator";
