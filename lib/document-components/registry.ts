import type {
  DocumentComponentKind,
  DocumentComponentSpec,
  DocumentProjectionSurface,
} from "@/lib/document-components/types";

const anyString = (value: string) => value.length > 0;

const URL_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  colon: ":",
  tab: "\t",
  newline: "\n",
  nbsp: "\u00a0",
  sol: "/",
  bsol: "\\",
};

const URL_SCHEME_PREFIX_LIMIT = 1024;
const URL_NETWORK_PREFIX_LIMIT = 32;
const URL_NORMALIZATION_MAX_PASSES = 2;
const ENCODED_URL_TOKEN = /%(?:[\da-f]{2})|&(?:#x[\da-f]+|#\d+|[a-z][\da-z]*);?/i;
const URL_BACKSLASH_REFERENCE = /\\|%(?:25)*5c|&(?:amp;)*(?:bsol;?|#(?:x0*5c|0*92);?)/i;
const URL_WHITESPACE_AND_CONTROLS = /[\u0000-\u0020\u007f-\u009f\s]/gu;

const firstUrlBoundary = (value: string): number => {
  const entities = Array.from(value.matchAll(/&(?:#x[\da-f]+|#\d+|[a-z][\da-z]*);?/gi));
  let entityIndex = 0;

  for (const boundary of value.matchAll(/[:/?#]/g)) {
    const boundaryIndex = boundary.index ?? -1;
    while (
      entityIndex < entities.length &&
      (entities[entityIndex].index ?? -1) + entities[entityIndex][0].length <= boundaryIndex
    ) {
      entityIndex += 1;
    }

    const entity = entities[entityIndex];
    if (entity && (entity.index ?? -1) <= boundaryIndex) continue;
    return boundaryIndex;
  }

  return -1;
};

const decodeUrlHtmlEntities = (value: string): string =>
  value.replace(/&(?:#x([\da-f]+)|#(\d+)|([a-z][\da-z]*));?/gi, (entity, hex, decimal, named) => {
    if (hex !== undefined || decimal !== undefined) {
      const codePoint = Number.parseInt(hex ?? decimal, hex !== undefined ? 16 : 10);
      return Number.isFinite(codePoint) && codePoint <= 0x10ffff
        ? String.fromCodePoint(codePoint)
        : entity;
    }

    return URL_HTML_ENTITIES[String(named).toLowerCase()] ?? entity;
  });

const decodeUrlPercentEncoding = (value: string): string =>
  value.replace(/(?:%[\da-f]{2})+/gi, (encoded) => {
    try {
      return decodeURIComponent(encoded);
    } catch {
      // Invalid UTF-8 must not hide valid ASCII escapes such as `%3A`.
      return encoded.replace(/%([\da-f]{2})/gi, (byte, hex) => {
        const codePoint = Number.parseInt(hex, 16);
        return codePoint < 0x80 ? String.fromCharCode(codePoint) : byte;
      });
    }
  });

const normalizeUrlForValidation = (value: string): string | null => {
  let normalized = value.slice(0, URL_SCHEME_PREFIX_LIMIT + 1);

  for (let pass = 0; pass < URL_NORMALIZATION_MAX_PASSES; pass += 1) {
    const boundary = firstUrlBoundary(normalized);
    const isLeadingSlash = boundary === 0 && normalized.startsWith("/");
    const prefix = isLeadingSlash
      ? normalized.slice(0, URL_NETWORK_PREFIX_LIMIT)
      : boundary < 0
        ? normalized
        : normalized.slice(0, boundary + 1);
    const decoded = decodeUrlPercentEncoding(decodeUrlHtmlEntities(prefix));
    const cleaned = decoded.replace(URL_WHITESPACE_AND_CONTROLS, "");

    if (cleaned.startsWith("//")) return null;

    const decodedBoundary = firstUrlBoundary(cleaned);
    if (decodedBoundary === 0 && cleaned.startsWith("/")) {
      normalized = cleaned.slice(0, URL_NETWORK_PREFIX_LIMIT);
    } else {
      normalized = decodedBoundary < 0 ? cleaned : cleaned.slice(0, decodedBoundary + 1);
    }

    if (normalized === prefix) break;
  }

  const boundary = firstUrlBoundary(normalized);
  const schemeZone = boundary < 0 ? normalized : normalized.slice(0, boundary);

  // A small fixed decode budget must never turn an ambiguous scheme prefix
  // into a relative URL. A missing boundary beyond our scan limit is also
  // ambiguous, so reject it closed.
  if (ENCODED_URL_TOKEN.test(schemeZone)) return null;
  if (boundary < 0 && value.length > URL_SCHEME_PREFIX_LIMIT) return null;
  if (normalized.startsWith("/") && /^(?:%|&)/.test(normalized.slice(1))) return null;

  return normalized;
};

export const safeUrl = (value: string) => {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    return false;
  }
  if (value.startsWith("//") || URL_BACKSLASH_REFERENCE.test(value)) return false;

  const normalized = normalizeUrlForValidation(value);
  if (normalized === null || normalized.length === 0 || normalized.startsWith("//")) return false;
  if (normalized.startsWith("#")) return true;
  const scheme = normalized.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme) return /^(?:https?|mailto)$/i.test(scheme[1]);
  return true;
};

/**
 * Image sources have a narrower policy than links: HTTPS/HTTP or a
 * document-relative path only. Reuse safeUrl's bounded normalization so
 * entity/percent-encoded and control-obfuscated schemes cannot look relative.
 */
export const safeImageSrc = (value: string) => {
  if (!safeUrl(value)) return false;

  const normalized = normalizeUrlForValidation(value);
  if (normalized === null || normalized.length === 0 || normalized.startsWith("//") || normalized.startsWith("#")) {
    return false;
  }

  const normalizedScheme = normalized.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (!normalizedScheme) return true;

  // A scheme is accepted only when it appeared literally in the source. This
  // keeps encoded spellings such as https%3A from relying on another consumer
  // to decode the destination before loading it.
  const literalScheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/)?.[1]?.toLowerCase();
  if (literalScheme !== normalizedScheme) return false;
  return /^https?$/i.test(literalScheme);
};
const columns = (value: string) => /^[1-4]$/.test(value);

const specs: readonly DocumentComponentSpec[] = [
  {
    kind: "Annotation",
    family: "semantic-inline",
    form: "inline",
    attributes: [
      { name: "id", required: true, validate: anyString },
      { name: "type", required: true, validate: anyString },
      { name: "comment", required: true },
    ],
    allowedParents: ["text-block", "Annotation", "ProtectedText"],
  },
  {
    kind: "Highlight",
    family: "semantic-inline",
    form: "inline",
    attributes: [{ name: "color" }],
    allowedParents: ["text-block", "Entity", "Annotation", "ProtectedText"],
  },
  {
    kind: "Entity",
    family: "semantic-inline",
    form: "inline",
    attributes: [
      { name: "id", required: true, validate: anyString },
      { name: "type", required: true, validate: anyString },
      { name: "ref" },
    ],
    allowedParents: ["text-block", "Annotation", "ProtectedText"],
  },
  {
    kind: "ProtectedText",
    family: "semantic-inline",
    form: "inline",
    attributes: [
      { name: "id", required: true, validate: anyString },
      { name: "reason" },
    ],
    allowedParents: ["text-block"],
  },
  {
    kind: "Tip",
    family: "registered-block",
    form: "block",
    attributes: [{ name: "title" }],
    allowedParents: ["document", "Tab", "Step"],
  },
  {
    kind: "Info",
    family: "registered-block",
    form: "block",
    attributes: [{ name: "title" }],
    allowedParents: ["document", "Tab", "Step"],
  },
  {
    kind: "Card",
    family: "registered-block",
    form: "block",
    attributes: [
      { name: "title", required: true, validate: anyString },
      { name: "icon" },
      { name: "href", validate: safeUrl },
    ],
    allowedParents: ["document", "CardGroup", "Tab", "Step"],
  },
  {
    kind: "AccordionGroup",
    family: "registered-block",
    form: "container",
    attributes: [],
    allowedParents: ["document", "Tab", "Step"],
    childKinds: ["Accordion"],
    minimumChildren: 1,
  },
  {
    kind: "Accordion",
    family: "registered-block",
    form: "item",
    attributes: [{ name: "title", required: true, validate: anyString }],
    allowedParents: ["AccordionGroup"],
  },
  {
    kind: "Tabs",
    family: "registered-block",
    form: "container",
    attributes: [],
    allowedParents: ["document", "Tab", "Step"],
    childKinds: ["Tab"],
    minimumChildren: 2,
  },
  {
    kind: "Tab",
    family: "registered-block",
    form: "item",
    attributes: [{ name: "title", required: true, validate: anyString }],
    allowedParents: ["Tabs"],
  },
  {
    kind: "Steps",
    family: "registered-block",
    form: "container",
    attributes: [],
    allowedParents: ["document", "Tab"],
    childKinds: ["Step"],
    minimumChildren: 1,
  },
  {
    kind: "Step",
    family: "registered-block",
    form: "item",
    attributes: [{ name: "title", required: true, validate: anyString }],
    allowedParents: ["Steps"],
  },
  {
    kind: "CardGroup",
    family: "registered-block",
    form: "container",
    attributes: [{ name: "columns", validate: columns }],
    allowedParents: ["document", "Tab", "Step"],
    childKinds: ["Card"],
    minimumChildren: 1,
  },
  {
    kind: "CodeGroup",
    family: "registered-block",
    form: "container",
    attributes: [],
    allowedParents: ["document", "Tab", "Step"],
    childKinds: ["CodeBlock"],
    minimumChildren: 2,
  },
  {
    kind: "CodeBlock",
    family: "markdown",
    form: "fence",
    attributes: [{ name: "language" }],
    allowedParents: ["document", "CodeGroup", "Tab", "Step"],
  },
] as const;

const specByKind = new Map<DocumentComponentKind, DocumentComponentSpec>(
  specs.map((spec) => [spec.kind, spec]),
);

export const DOCUMENT_PROJECTION_SURFACES: readonly DocumentProjectionSurface[] = [
  "rich",
  "source",
  "preview",
  "shared",
  "public",
  "body_text",
  "ai_context",
  "clean_markdown",
  "pdf",
  "docx",
] as const;

/**
 * Registry validation for one attribute value. Projections use it to decide
 * whether an attribute (e.g. a Card href) may be activated, so no surface
 * re-implements the URL policy.
 */
export const validateComponentAttribute = (kind: string, name: string, value: string): boolean => {
  const attribute = specByKind.get(kind as DocumentComponentKind)?.attributes.find((candidate) => candidate.name === name);
  if (!attribute || value.length === 0) return false;
  return attribute.validate?.(value) ?? true;
};

export const DocumentComponentSpecRegistry = Object.freeze({
  get(kind: string): DocumentComponentSpec | undefined {
    return specByKind.get(kind as DocumentComponentKind);
  },
  has(kind: string): kind is DocumentComponentKind {
    return specByKind.has(kind as DocumentComponentKind);
  },
  values(): readonly DocumentComponentSpec[] {
    return specs;
  },
});
