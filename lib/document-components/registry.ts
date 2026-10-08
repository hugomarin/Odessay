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

const normalizeUrlForValidation = (value: string): string => {
  let normalized = value;

  while (true) {
    const decoded = decodeUrlPercentEncoding(decodeUrlHtmlEntities(normalized));
    if (decoded === normalized) break;
    normalized = decoded;
  }

  return normalized.replace(/[\u0000-\u0020\u007f-\u009f\s]/gu, "");
};

export const safeUrl = (value: string) => {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    return false;
  }

  const normalized = normalizeUrlForValidation(value);
  if (normalized.length === 0 || normalized.startsWith("//") || normalized.includes("\\")) return false;
  if (normalized.startsWith("#")) return true;
  const scheme = normalized.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
  if (scheme) return /^(?:https?|mailto)$/i.test(scheme[1]);
  return true;
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
