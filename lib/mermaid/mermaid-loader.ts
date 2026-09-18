import {
  getCachedMermaidSvg,
  setCachedMermaidSvg,
} from "@/lib/mermaid/mermaid-cache";
import {
  MERMAID_CONFIG_ID,
  MERMAID_MAX_SOURCE_LENGTH,
  MERMAID_RENDER_TIMEOUT_MS,
} from "@/lib/mermaid/mermaid-language";
import { sanitizeMermaidSvg } from "@/lib/mermaid/mermaid-sanitize";

/**
 * ODE-533: lazy Mermaid loader.
 *
 * Mermaid is excluded from editor bootstrap by construction: this module has
 * no static renderer import. The only load path is the dynamic renderer
 * import below, invoked on explicit preview request or when a Mermaid block
 * becomes visible. Tests inject a fake loader via `setMermaidLoaderForTests`
 * so the suite never pays the renderer cost.
 */

export type MermaidRenderErrorCode =
  | "empty-source"
  | "too-large"
  | "load-failed"
  | "timeout"
  | "invalid"
  | "unsafe";

export class MermaidRenderError extends Error {
  readonly code: MermaidRenderErrorCode;

  constructor(code: MermaidRenderErrorCode, message: string) {
    super(message);
    this.name = "MermaidRenderError";
    this.code = code;
  }
}

type MermaidApi = {
  initialize?: (config: Record<string, unknown>) => void | Promise<void>;
  render?: (id: string, text: string) => Promise<{ svg: string } | string>;
  default?: MermaidApi;
};

/**
 * Render-only normalization. AI-generated diagrams commonly use `<br>` where
 * Mermaid documents `<br/>`; both mean the same line break. The canonical
 * source is never rewritten — this applies to the renderer input only.
 */
export const normalizeMermaidSourceForRender = (source: string): string =>
  source.replace(/<\s*br\s*>/gi, "<br/>");

const MERMAID_ERROR_SVG_MARKER = "Syntax error in text";

const STATEMENT_SEPARATOR_HINT =
  " Tip: each statement needs its own line or a ';' separator (e.g. `A-->B; B-->C`).";

const toInvalidMessage = (error: unknown): string => {
  const raw = error instanceof Error && error.message ? error.message : "Invalid diagram source.";
  const capped = raw.length > 600 ? `${raw.slice(0, 600).trimEnd()}…` : raw;
  const needsHint = /SEMI|NEWLINE|Expecting/i.test(raw);
  return `Invalid diagram: ${capped}${needsHint ? STATEMENT_SEPARATOR_HINT : ""}`;
};

type MermaidLoader = () => Promise<MermaidApi>;

let testLoader: MermaidLoader | null = null;
let renderCounter = 0;
let initializePromise: Promise<void> | null = null;

export const setMermaidLoaderForTests = (loader: MermaidLoader | null): void => {
  testLoader = loader;
  initializePromise = null;
};

const defaultLoader: MermaidLoader = () => import("mermaid") as Promise<MermaidApi>;

const resolveLoader = (): MermaidLoader => testLoader ?? defaultLoader;

const resolveApi = (module: MermaidApi): MermaidApi =>
  module && typeof module === "object" && "default" in module && module.default ? (module.default as MermaidApi) : module;

let idCounter = 0;

const withTimeout = <T>(work: Promise<T>, timeoutMs: number): Promise<T> =>
  new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new MermaidRenderError("timeout", "Diagram render timed out. Retry when ready."));
    }, timeoutMs);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });

export const renderMermaidSvg = async (
  source: string,
  options: { timeoutMs?: number; configId?: string } = {},
): Promise<string> => {
  const trimmed = source.trim();
  if (!trimmed) {
    throw new MermaidRenderError("empty-source", "Diagram source is empty.");
  }
  if (source.length > MERMAID_MAX_SOURCE_LENGTH) {
    throw new MermaidRenderError("too-large", "Diagram source is too large to preview.");
  }
  const configId = options.configId ?? MERMAID_CONFIG_ID;
  const effective = normalizeMermaidSourceForRender(source);
  const cached = getCachedMermaidSvg(effective, configId);
  if (cached) return cached;

  const timeoutMs = options.timeoutMs ?? MERMAID_RENDER_TIMEOUT_MS;
  let loaded: MermaidApi;
  try {
    loaded = await withTimeout(resolveLoader()(), timeoutMs);
  } catch (error) {
    if (error instanceof MermaidRenderError && error.code === "timeout") throw error;
    throw new MermaidRenderError("load-failed", "Diagram renderer failed to load. Editing is unaffected — retry when ready.");
  }

  const api = resolveApi(loaded);
  try {
    if (!initializePromise) {
      initializePromise = (async () => {
        await api.initialize?.({ startOnLoad: false, securityLevel: "strict", theme: "neutral" });
      })();
    }
    await withTimeout(initializePromise, timeoutMs);
  } catch (error) {
    initializePromise = null;
    if (error instanceof MermaidRenderError) throw error;
    throw new MermaidRenderError("load-failed", "Diagram renderer failed to start. Editing is unaffected — retry when ready.");
  }

  if (typeof api.render !== "function") {
    throw new MermaidRenderError("load-failed", "Diagram renderer is unavailable. Editing is unaffected — retry when ready.");
  }

  renderCounter += 1;
  idCounter += 1;
  const renderId = `odessay-mermaid-${Date.now().toString(36)}-${idCounter}-${renderCounter}`;
  let raw: { svg: string } | string;
  try {
    raw = await withTimeout(api.render(renderId, effective), timeoutMs);
  } catch (error) {
    if (error instanceof MermaidRenderError) throw error;
    throw new MermaidRenderError("invalid", toInvalidMessage(error));
  }

  const svg = typeof raw === "string" ? raw : raw.svg;
  // Depending on config, Mermaid can resolve (instead of throwing) with an
  // inline error SVG. That is still a render failure: never display it as a
  // successful preview and never cache it — fall back to source + retry.
  if (typeof svg === "string" && svg.includes(MERMAID_ERROR_SVG_MARKER)) {
    const textContent = svg
      .replace(/<[^>]*>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    const markerAt = textContent.indexOf(MERMAID_ERROR_SVG_MARKER);
    const detail =
      markerAt >= 0
        ? textContent
            .slice(markerAt + MERMAID_ERROR_SVG_MARKER.length)
            .trim()
            .slice(0, 400)
        : "";
    throw new MermaidRenderError(
      "invalid",
      toInvalidMessage(detail ? new Error(detail) : new Error("Mermaid reported a syntax error.")),
    );
  }
  const sanitized = sanitizeMermaidSvg(svg);
  if (!sanitized) {
    throw new MermaidRenderError("unsafe", "Diagram output was rejected for safety. The source is preserved.");
  }
  setCachedMermaidSvg(effective, sanitized, configId);
  return sanitized;
};

export const getMermaidRenderCountForTests = (): number => renderCounter;

export const resetMermaidLoaderForTests = (): void => {
  renderCounter = 0;
  idCounter = 0;
  initializePromise = null;
};
