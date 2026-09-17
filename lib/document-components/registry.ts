import type {
  DocumentComponentKind,
  DocumentComponentSpec,
  DocumentProjectionSurface,
} from "@/lib/document-components/types";

const anyString = (value: string) => value.length > 0;
const safeUrl = (value: string) => {
  if (value.length === 0 || value !== value.trim() || /[\u0000-\u001F\u007F]/.test(value)) {
    return false;
  }
  if (value.startsWith("//") || value.startsWith("\\")) return false;
  if (value.startsWith("#")) return true;
  const scheme = value.match(/^([A-Za-z][A-Za-z0-9+.-]*):/);
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
    attributes: [
      { name: "id", required: true, validate: anyString },
      { name: "color" },
    ],
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
