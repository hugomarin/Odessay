import { decodeControlledAttribute } from "@/lib/document-components/entities";
import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry";
import type {
  ComponentNode,
  DocumentComponentKind,
  DocumentDiagnostic,
  DocumentDiagnosticCode,
  DocumentIrNode,
  DocumentParseResult,
} from "@/lib/document-components/types";

type ParsedTag = {
  kind: string;
  attributes: Readonly<Record<string, string>>;
  end: number;
  closing: boolean;
  valid: boolean;
};

const TAG_NAME = /^[A-Z][A-Za-z0-9]*$/;
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const LEGACY_ANNOTATION = /==([^=\n]+)==\[@([pchn]?)(\d*)(?:\|([^\]:|]+))?:\s*([^\]]*)\]/y;

const compatibilityId = (source: string): string => {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy-${(hash >>> 0).toString(16).padStart(8, "0")}`;
};

const annotationType = (prefix: string) => {
  if (prefix === "h") return "highlight";
  if (prefix === "p" || prefix === "c") return "personal";
  return "footnote";
};

const parseTag = (source: string, start: number): ParsedTag | null => {
  const close = source.indexOf(">", start + 1);
  if (close === -1) return null;
  const raw = source.slice(start + 1, close);
  const closing = raw.startsWith("/");
  const body = closing ? raw.slice(1) : raw;
  const nameMatch = body.match(/^([A-Za-z][A-Za-z0-9]*)([\s\S]*)$/);
  if (!nameMatch || !TAG_NAME.test(nameMatch[1])) return null;

  const kind = nameMatch[1];
  const rest = nameMatch[2];
  if (closing) {
    return {
      kind,
      attributes: {},
      end: close + 1,
      closing: true,
      valid: rest.trim().length === 0,
    };
  }

  if (rest.trimEnd().endsWith("/")) {
    return { kind, attributes: {}, end: close + 1, closing: false, valid: false };
  }

  const attributes: Record<string, string> = {};
  let cursor = 0;
  while (cursor < rest.length) {
    while (/\s/.test(rest[cursor] ?? "")) cursor += 1;
    if (cursor >= rest.length) break;
    const nameStart = cursor;
    while (/[-A-Za-z0-9]/.test(rest[cursor] ?? "")) cursor += 1;
    const name = rest.slice(nameStart, cursor);
    if (!ATTRIBUTE_NAME.test(name) || Object.hasOwn(attributes, name)) {
      return { kind, attributes, end: close + 1, closing: false, valid: false };
    }
    while (/\s/.test(rest[cursor] ?? "")) cursor += 1;
    if (rest[cursor] !== "=") {
      return { kind, attributes, end: close + 1, closing: false, valid: false };
    }
    cursor += 1;
    while (/\s/.test(rest[cursor] ?? "")) cursor += 1;
    if (rest[cursor] !== '"') {
      return { kind, attributes, end: close + 1, closing: false, valid: false };
    }
    cursor += 1;
    const valueStart = cursor;
    while (cursor < rest.length && rest[cursor] !== '"') cursor += 1;
    if (cursor >= rest.length) {
      return { kind, attributes, end: close + 1, closing: false, valid: false };
    }
    attributes[name] = decodeControlledAttribute(rest.slice(valueStart, cursor));
    cursor += 1;
  }

  return { kind, attributes, end: close + 1, closing: false, valid: true };
};

const findFenceEnd = (source: string, start: number): number | null => {
  const lineEnd = source.indexOf("\n", start);
  const openingEnd = lineEnd === -1 ? source.length : lineEnd;
  const opening = source.slice(start, openingEnd);
  const match = opening.match(/^ {0,3}(`{3,}|~{3,})/);
  if (!match) return null;
  const fence = match[1];
  let cursor = openingEnd < source.length ? openingEnd + 1 : openingEnd;
  while (cursor < source.length) {
    const nextLineEnd = source.indexOf("\n", cursor);
    const end = nextLineEnd === -1 ? source.length : nextLineEnd;
    const line = source.slice(cursor, end);
    if (new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`).test(line)) {
      return nextLineEnd === -1 ? source.length : nextLineEnd + 1;
    }
    cursor = nextLineEnd === -1 ? source.length : nextLineEnd + 1;
  }
  return source.length;
};

const findOpaqueEnd = (source: string, tag: ParsedTag): number => {
  const close = source.indexOf(`</${tag.kind}>`, tag.end);
  return close === -1 ? source.length : close + tag.kind.length + 3;
};

const diagnostic = (
  diagnostics: DocumentDiagnostic[],
  code: DocumentDiagnosticCode,
  message: string,
  start: number,
  end: number,
  kind?: string,
) => diagnostics.push({ code, message, start, end, kind });

const isWhitespaceMarkdown = (node: DocumentIrNode) =>
  node.type === "markdown" && node.raw.trim().length === 0;

export const parseControlledMarkdown = (source: string): DocumentParseResult => {
  const diagnostics: DocumentDiagnostic[] = [];

  const parseRange = (
    start: number,
    expectedClose?: DocumentComponentKind,
  ): { nodes: DocumentIrNode[]; cursor: number; closed: boolean } => {
    const nodes: DocumentIrNode[] = [];
    let cursor = start;
    let markdownStart = start;

    const flushMarkdown = (end: number) => {
      if (end > markdownStart) {
        nodes.push({ type: "markdown", raw: source.slice(markdownStart, end), start: markdownStart, end });
      }
    };

    while (cursor < source.length) {
      const atLineStart = cursor === 0 || source[cursor - 1] === "\n";
      if (atLineStart) {
        const fenceEnd = findFenceEnd(source, cursor);
        if (fenceEnd !== null) {
          flushMarkdown(cursor);
          const firstLineEnd = source.indexOf("\n", cursor);
          const firstLine = source.slice(cursor, firstLineEnd === -1 ? source.length : firstLineEnd);
          const language = firstLine.replace(/^ {0,3}(?:`{3,}|~{3,})/, "").trim();
          nodes.push({
            type: "code-block",
            kind: "CodeBlock",
            language,
            raw: source.slice(cursor, fenceEnd),
            start: cursor,
            end: fenceEnd,
          });
          cursor = fenceEnd;
          markdownStart = cursor;
          continue;
        }
      }

      LEGACY_ANNOTATION.lastIndex = cursor;
      const legacy = LEGACY_ANNOTATION.exec(source);
      if (legacy) {
        flushMarkdown(cursor);
        const raw = legacy[0];
        const id = legacy[4] || compatibilityId(raw);
        const childStart = cursor + 2;
        const childEnd = childStart + legacy[1].length;
        nodes.push({
          type: "component",
          kind: "Annotation",
          attributes: { id, type: annotationType(legacy[2]), comment: legacy[5] },
          children: [{ type: "markdown", raw: legacy[1], start: childStart, end: childEnd }],
          start: cursor,
          end: cursor + raw.length,
        });
        cursor += raw.length;
        markdownStart = cursor;
        continue;
      }

      if (source[cursor] !== "<") {
        cursor += 1;
        continue;
      }

      const tag = parseTag(source, cursor);
      if (!tag) {
        cursor += 1;
        continue;
      }

      if (tag.closing) {
        if (expectedClose === tag.kind && tag.valid) {
          flushMarkdown(cursor);
          return { nodes, cursor: tag.end, closed: true };
        }
        cursor += 1;
        continue;
      }

      flushMarkdown(cursor);
      const spec = DocumentComponentSpecRegistry.get(tag.kind);
      if (!spec || tag.kind === "CodeBlock") {
        const end = findOpaqueEnd(source, tag);
        diagnostic(diagnostics, "unknown-component", `Unknown component ${tag.kind}.`, cursor, end, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, end), reason: "unknown-component", start: cursor, end });
        cursor = end;
        markdownStart = cursor;
        continue;
      }

      const attributeNames = Object.keys(tag.attributes);
      const attributesValid =
        tag.valid &&
        attributeNames.every((name) => spec.attributes.some((attribute) => attribute.name === name)) &&
        spec.attributes.every(
          (attribute) =>
            (!attribute.required || Object.hasOwn(tag.attributes, attribute.name)) &&
            (!Object.hasOwn(tag.attributes, attribute.name) || !attribute.validate || attribute.validate(tag.attributes[attribute.name])),
        );
      if (!attributesValid) {
        const end = findOpaqueEnd(source, tag);
        diagnostic(diagnostics, "invalid-attributes", `Invalid attributes for ${tag.kind}.`, cursor, end, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, end), reason: "invalid-attributes", start: cursor, end });
        cursor = end;
        markdownStart = cursor;
        continue;
      }

      const parsedChildren = parseRange(tag.end, tag.kind as DocumentComponentKind);
      if (!parsedChildren.closed) {
        diagnostic(diagnostics, "unbalanced-component", `Unbalanced component ${tag.kind}.`, cursor, source.length, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor), reason: "unbalanced-component", start: cursor, end: source.length });
        return { nodes, cursor: source.length, closed: false };
      }

      const expectedSpec = expectedClose
        ? DocumentComponentSpecRegistry.get(expectedClose)
        : undefined;
      const parent =
        spec.form === "inline" &&
        (!expectedSpec || expectedSpec.family === "registered-block")
          ? "text-block"
          : (expectedClose ?? "document");
      const validParent = spec.allowedParents.includes(parent);
      const componentChildren = parsedChildren.nodes.filter((node) => node.type === "component" || node.type === "code-block");
      const validChildren =
        !spec.childKinds ||
        (componentChildren.length >= (spec.minimumChildren ?? 0) &&
          componentChildren.every((node) => spec.childKinds!.includes(node.kind)) &&
          parsedChildren.nodes.every((node) => isWhitespaceMarkdown(node) || node.type === "component" || node.type === "code-block"));
      const inlineHasBlock =
        spec.form === "inline" &&
        (source.slice(tag.end, parsedChildren.cursor - tag.kind.length - 3).includes("\n") ||
          componentChildren.some((node) => DocumentComponentSpecRegistry.get(node.kind)?.form !== "inline"));

      if (!validParent || !validChildren || inlineHasBlock) {
        const opaqueEnd = parsedChildren.cursor;
        diagnostic(diagnostics, "invalid-nesting", `Invalid nesting for ${tag.kind}.`, cursor, opaqueEnd, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, opaqueEnd), reason: "invalid-nesting", start: cursor, end: opaqueEnd });
        cursor = opaqueEnd;
        markdownStart = cursor;
        continue;
      }

      const node: ComponentNode = {
        type: "component",
        kind: tag.kind as ComponentNode["kind"],
        attributes: tag.attributes,
        children: parsedChildren.nodes,
        start: cursor,
        end: parsedChildren.cursor,
      };
      nodes.push(node);
      cursor = parsedChildren.cursor;
      markdownStart = cursor;
    }

    flushMarkdown(source.length);
    return { nodes, cursor: source.length, closed: false };
  };

  const parsed = parseRange(0);
  return {
    document: { type: "document", version: 1, source, children: parsed.nodes },
    diagnostics,
    recoverable: true,
  };
};
