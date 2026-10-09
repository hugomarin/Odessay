/**
 * ODE-533: Mermaid SVG sanitizer.
 *
 * Generated SVG must never escape the document trust boundary. Rejects or
 * strips: <script>, event-handler attributes (on*), javascript:/data:text/html
 * URLs, foreign runtimes (<foreignObject>, <iframe>, <object>, <embed>,
 * <link>, <meta>, <base>, <form>) and unsafe href/src/xlink:href values.
 *
 * Returns the sanitized SVG, or null when the payload is unsafe and the
 * caller must fall back to source. Pure string transform — no DOM, no
 * network, works in Node tests and the browser.
 */

const FORBIDDEN_ELEMENTS = [
  "script",
  "iframe",
  "object",
  "embed",
  "link",
  "meta",
  "base",
  "form",
  "foreignobject",
  "audio",
  "video",
  "source",
  "track",
] as const;

const isUnsafeUrl = (url: string): boolean => {
  const trimmed = url.trim();
  if (!trimmed) return false;
  if (/^[\s\u0000-\u001F]*javascript:/i.test(trimmed)) return true;
  if (/^[\s\u0000-\u001F]*data:text\/html/i.test(trimmed)) return true;
  if (/^[\s\u0000-\u001F]*vbscript:/i.test(trimmed)) return true;
  if (/^[\s\u0000-\u001F]*file:/i.test(trimmed)) return true;
  return false;
};

const sanitizeUrlsInSvg = (svg: string): string | null => {
  // href/src/xlink:href/dyn attributes with quoted values.
  const urlAttribute = /\s(?:href|src|xlink:href|dyn:href|from|to|values)\s*=\s*("([^"]*)"|'([^']*)')/gi;
  let failed = false;
  const cleaned = svg.replace(urlAttribute, (match, _quoted: string, doubleQuoted?: string, singleQuoted?: string) => {
    const url = doubleQuoted ?? singleQuoted ?? "";
    if (isUnsafeUrl(url)) {
      failed = true;
      return "";
    }
    return match;
  });
  if (failed) return null;
  // Unquoted URL-ish attributes are not valid SVG; treat as unsafe.
  if (/\s(?:href|src|xlink:href)\s*=\s*javascript:/i.test(cleaned)) return null;
  // CSS url(javascript:...) / url(data:text/html...) inside <style> or style="".
  if (/url\(\s*["']?\s*javascript:/i.test(cleaned)) return null;
  if (/url\(\s*["']?\s*data:text\/html/i.test(cleaned)) return null;
  // CSS expression(...) is IE-era script execution.
  if (/expression\s*\(/i.test(cleaned)) return null;
  return cleaned;
};

export const sanitizeMermaidSvg = (svg: string): string | null => {
  if (typeof svg !== "string" || !svg.includes("<svg")) return null;
  let cleaned = svg;

  // Strip HTML comments (conditional comments can hide scripts).
  cleaned = cleaned.replace(/<!--[\s\S]*?-->/g, "");

  for (const tag of FORBIDDEN_ELEMENTS) {
    const pair = new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}\\s*>`, "gi");
    if (pair.test(cleaned)) return null;
    const selfClosing = new RegExp(`<${tag}\\b[^>]*\\/?>`, "gi");
    if (selfClosing.test(cleaned)) return null;
  }

  // Event-handler attributes: onclick=, onload=, onerror=, ... (quoted or not).
  if (/\son\w+\s*=/i.test(cleaned)) {
    cleaned = cleaned.replace(/\s+on\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
    // If an event handler survived the strip (aberrant quoting), reject.
    if (/\son\w+\s*=/i.test(cleaned)) return null;
  }

  const withSafeUrls = sanitizeUrlsInSvg(cleaned);
  if (withSafeUrls === null) return null;
  cleaned = withSafeUrls;

  // Inline <style> is emitted by Mermaid for diagram styling; keep it only
  // when it carries no executable URL/expression payload (checked above).
  // <script> is already rejected as a forbidden element.

  if (!cleaned.includes("<svg")) return null;
  return cleaned;
};
