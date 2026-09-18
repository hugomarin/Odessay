export const MERMAID_LANGUAGE = "mermaid";

export const MERMAID_CONFIG_ID = "odessay-mermaid-v1";

export const MERMAID_RENDER_TIMEOUT_MS = 5000;

export const MERMAID_MAX_SOURCE_LENGTH = 20000;

export const normalizeCodeLanguage = (language: unknown): string =>
  typeof language === "string" ? language.trim().toLowerCase() : "";

export const isMermaidLanguage = (language: unknown): boolean =>
  normalizeCodeLanguage(language) === MERMAID_LANGUAGE;
