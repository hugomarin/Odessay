export type DocumentComponentFamily =
  | "markdown"
  | "semantic-inline"
  | "registered-block";

export type DocumentComponentForm =
  | "inline"
  | "block"
  | "container"
  | "item"
  | "fence";

export type DocumentComponentKind =
  | "Annotation"
  | "Highlight"
  | "Entity"
  | "ProtectedText"
  | "Tip"
  | "Info"
  | "Card"
  | "AccordionGroup"
  | "Accordion"
  | "Tabs"
  | "Tab"
  | "Steps"
  | "Step"
  | "CardGroup"
  | "CodeGroup"
  | "CodeBlock";

export type DocumentProjectionSurface =
  | "rich"
  | "source"
  | "preview"
  | "shared"
  | "public"
  | "body_text"
  | "ai_context"
  | "clean_markdown"
  | "pdf"
  | "docx";

export type DocumentComponentAttributeSpec = {
  name: string;
  required?: boolean;
  validate?: (value: string) => boolean;
};

export type DocumentComponentSpec = {
  kind: DocumentComponentKind;
  family: DocumentComponentFamily;
  form: DocumentComponentForm;
  attributes: readonly DocumentComponentAttributeSpec[];
  allowedParents: readonly (DocumentComponentKind | "document" | "text-block")[];
  minimumChildren?: number;
  childKinds?: readonly DocumentComponentKind[];
};

export type MarkdownNode = {
  type: "markdown";
  raw: string;
  start: number;
  end: number;
};

export type CodeBlockNode = {
  type: "code-block";
  kind: "CodeBlock";
  language: string;
  raw: string;
  start: number;
  end: number;
};

export type ComponentNode = {
  type: "component";
  kind: Exclude<DocumentComponentKind, "CodeBlock">;
  attributes: Readonly<Record<string, string>>;
  children: DocumentIrNode[];
  start: number;
  end: number;
};

export type OpaqueSourceNode = {
  type: "opaque";
  raw: string;
  reason: DocumentDiagnosticCode;
  start: number;
  end: number;
};

export type DocumentIrNode =
  | MarkdownNode
  | CodeBlockNode
  | ComponentNode
  | OpaqueSourceNode;

export type DocumentIr = {
  type: "document";
  version: 1;
  source: string;
  children: DocumentIrNode[];
};

export type DocumentDiagnosticCode =
  | "unknown-component"
  | "invalid-tag"
  | "invalid-attributes"
  | "unbalanced-component"
  | "invalid-nesting"
  | "invalid-content";

export type DocumentDiagnostic = {
  code: DocumentDiagnosticCode;
  message: string;
  start: number;
  end: number;
  kind?: string;
};

export type DocumentParseResult = {
  document: DocumentIr;
  diagnostics: DocumentDiagnostic[];
  recoverable: true;
};

