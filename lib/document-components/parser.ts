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
  hasLineBreak: boolean;
};

export type ControlledMarkdownParseOptions = {
  /**
   * Rich projection treats an unclosed unknown root tag as a literal token so
   * the rest of the Markdown remains editable. The default core parse keeps
   * the complete suffix opaque.
   */
  recoverUnclosedUnknownTags?: boolean;
};

type ParsedRange = {
  nodes: DocumentIrNode[];
  cursor: number;
  closed: boolean;
  hasLineBreak: boolean;
  closingTagHasLineBreak?: boolean;
};

const TAG_NAME_PREFIX = /[A-Z][A-Za-z0-9]*/y;
const ATTRIBUTE_NAME = /^[A-Za-z][A-Za-z0-9-]*$/;
const WHITESPACE_CHARACTER = /\s/;
const LEGACY_ANNOTATION =
  /==([^=\n]+)==[\t ]*(?:\[\^(\d+)(?:\|([^\]:|]+))?:\s*((?:\\.|[^\]])*)\]|\[@([pchn]?)(\d*)(?:\|([^\]:|]+))?:\s*((?:\\.|[^\]])*)\])/y;

const unescapeLegacyComment = (value: string) =>
  value.replace(/\\([\\\]])/g, "$1");

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
  if (prefix === "n") return "footnote";
  return "ai";
};

const isWhitespaceAt = (source: string, index: number) =>
  WHITESPACE_CHARACTER.test(source.charAt(index));

const parseTag = (
  source: string,
  start: number,
  close: number,
  hasLineBreakForClose: (close: number) => boolean,
  lastNonWhitespaceBeforeClose: (end: number) => number,
): ParsedTag | null => {
  const closing = source.charAt(start + 1) === "/";
  const nameStart = start + (closing ? 2 : 1);
  TAG_NAME_PREFIX.lastIndex = nameStart;
  const nameMatch = TAG_NAME_PREFIX.exec(source);
  if (!nameMatch) return null;

  if (close === -1 || nameStart + nameMatch[0].length > close) return null;
  const hasLineBreak = hasLineBreakForClose(close);
  const kind = nameMatch[0];
  const restStart = nameStart + kind.length;
  if (closing) {
    let valid = true;
    for (let index = restStart; index < close; index += 1) {
      if (!isWhitespaceAt(source, index)) {
        valid = false;
        break;
      }
    }
    return {
      kind,
      attributes: {},
      end: close + 1,
      closing: true,
      valid,
      hasLineBreak,
    };
  }

  const lastNonWhitespace = lastNonWhitespaceBeforeClose(close);
  if (lastNonWhitespace >= restStart && source.charAt(lastNonWhitespace) === "/") {
    return { kind, attributes: {}, end: close + 1, closing: false, valid: false, hasLineBreak };
  }

  const attributes: Record<string, string> = {};
  let cursor = restStart;
  while (cursor < close) {
    while (cursor < close && isWhitespaceAt(source, cursor)) cursor += 1;
    if (cursor >= close) break;
    const nameStart = cursor;
    while (cursor < close && /[-A-Za-z0-9]/.test(source.charAt(cursor))) cursor += 1;
    const name = source.slice(nameStart, cursor);
    if (!ATTRIBUTE_NAME.test(name) || Object.hasOwn(attributes, name)) {
      return { kind, attributes, end: close + 1, closing: false, valid: false, hasLineBreak };
    }
    while (cursor < close && isWhitespaceAt(source, cursor)) cursor += 1;
    if (source.charAt(cursor) !== "=") {
      return { kind, attributes, end: close + 1, closing: false, valid: false, hasLineBreak };
    }
    cursor += 1;
    while (cursor < close && isWhitespaceAt(source, cursor)) cursor += 1;
    if (source.charAt(cursor) !== '"') {
      return { kind, attributes, end: close + 1, closing: false, valid: false, hasLineBreak };
    }
    cursor += 1;
    const valueStart = cursor;
    while (cursor < close && source.charAt(cursor) !== '"') cursor += 1;
    if (cursor >= close) {
      return { kind, attributes, end: close + 1, closing: false, valid: false, hasLineBreak };
    }
    attributes[name] = decodeControlledAttribute(source.slice(valueStart, cursor));
    cursor += 1;
  }

  return { kind, attributes, end: close + 1, closing: false, valid: true, hasLineBreak };
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

// Inline code is pure Markdown: tags inside a code span are literal text, the
// same way fenced code is opaque to the component scanner. An unmatched
// backtick run is literal and only skips itself. Spans never cross a blank
// line (a paragraph boundary).
const findCodeSpanEnd = (source: string, start: number): number => {
  let runEnd = start;
  while (source[runEnd] === "`") runEnd += 1;
  const length = runEnd - start;
  let cursor = runEnd;
  while (cursor < source.length) {
    const next = source.indexOf("`", cursor);
    if (next === -1 || /\n[\t ]*\n/.test(source.slice(cursor, next))) break;
    let closeEnd = next;
    while (source[closeEnd] === "`") closeEnd += 1;
    if (closeEnd - next === length) return closeEnd;
    cursor = closeEnd;
  }
  return runEnd;
};

type ClosingTagIndex = {
  next: (kind: string, from: number) => number | null;
};

const isTagNameCharacter = (character: string | undefined) =>
  character !== undefined &&
  ((character >= "A" && character <= "Z") ||
    (character >= "a" && character <= "z") ||
    (character >= "0" && character <= "9"));

const indexClosingTags = (source: string): ClosingTagIndex => {
  const positionsByKind = new Map<string, number[]>();
  const nextPositionByKind = new Map<string, number>();

  for (let cursor = 0; cursor < source.length - 2; cursor += 1) {
    if (source[cursor] !== "<" || source[cursor + 1] !== "/") continue;
    const nameStart = cursor + 2;
    let nameEnd = nameStart;
    while (isTagNameCharacter(source[nameEnd])) nameEnd += 1;
    if (nameEnd === nameStart || source[nameEnd] !== ">") continue;

    const kind = source.slice(nameStart, nameEnd);
    const positions = positionsByKind.get(kind) ?? [];
    positions.push(cursor);
    positionsByKind.set(kind, positions);
    cursor = nameEnd;
  }

  return {
    next(kind, from) {
      const positions = positionsByKind.get(kind);
      if (!positions) return null;
      let position = nextPositionByKind.get(kind) ?? 0;
      while (position < positions.length && positions[position] < from) position += 1;
      nextPositionByKind.set(kind, position);
      return positions[position] ?? null;
    },
  };
};

const findOpaqueEnd = (
  source: string,
  tag: ParsedTag,
  closingTagIndex?: ClosingTagIndex,
): { end: number; hasClosingTag: boolean } => {
  const close = closingTagIndex
    ? closingTagIndex.next(tag.kind, tag.end)
    : source.indexOf(`</${tag.kind}>`, tag.end);
  return close === -1 || close === null
    ? { end: source.length, hasClosingTag: false }
    : { end: close + tag.kind.length + 3, hasClosingTag: true };
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

const parseControlledMarkdownInternal = (
  source: string,
  stopAfterFirstTopLevelComponent: boolean,
  topLevelStart = 0,
  options: ControlledMarkdownParseOptions = {},
): DocumentParseResult => {
  const diagnostics: DocumentDiagnostic[] = [];
  let nextGreaterThan: number | undefined;
  let closingTagIndex: ClosingTagIndex | undefined;
  let trailingScanEnd = 0;
  let trailingLastNonWhitespace = -1;
  // Tag close offsets advance with the shared `>` cursor, so scan only new text.
  const lastNonWhitespaceBeforeClose = (end: number) => {
    for (let index = end - 1; index >= trailingScanEnd; index -= 1) {
      if (!isWhitespaceAt(source, index)) {
        trailingLastNonWhitespace = index;
        break;
      }
    }
    trailingScanEnd = end;
    return trailingLastNonWhitespace;
  };

  type LineSummary = {
    end: number;
    firstNonWhitespace: number;
    lastNonWhitespace: number;
  };
  type LineCursor = { start: number };
  const tagStartLineCursor: LineCursor = { start: 0 };
  const tagEndLineCursor: LineCursor = { start: 0 };
  const lineSummaries = new Map<number, LineSummary>();
  // Reuse one summary for every tag on the same line instead of trimming overlapping slices.
  const scanLine = (start: number): LineSummary => {
    let end = start;
    let firstNonWhitespace = -1;
    let lastNonWhitespace = -1;
    while (end < source.length) {
      const character = source.charAt(end);
      if (character === "\n") break;
      if (!WHITESPACE_CHARACTER.test(character)) {
        if (firstNonWhitespace === -1) firstNonWhitespace = end;
        lastNonWhitespace = end;
      }
      end += 1;
    }
    return { end, firstNonWhitespace, lastNonWhitespace };
  };
  const getLineSummary = (position: number, cursor: LineCursor): LineSummary => {
    let summary = lineSummaries.get(cursor.start);
    if (!summary) {
      summary = scanLine(cursor.start);
      lineSummaries.set(cursor.start, summary);
    }
    while (position > summary.end && summary.end < source.length) {
      cursor.start = summary.end + 1;
      summary = lineSummaries.get(cursor.start) ?? scanLine(cursor.start);
      lineSummaries.set(cursor.start, summary);
    }
    return summary;
  };
  const occupiesOwnLine = (start: number, end: number) => {
    const startLine = getLineSummary(start, tagStartLineCursor);
    if (startLine.firstNonWhitespace !== -1 && startLine.firstNonWhitespace < start) return false;
    const endLine = getLineSummary(end, tagEndLineCursor);
    return endLine.lastNonWhitespace < end;
  };

  // Parsing advances through the source; each `>` is crossed once and reused by later candidates.
  const parseTagAt = (start: number) => {
    if (nextGreaterThan === undefined) {
      nextGreaterThan = source.indexOf(">", start + 1);
    } else {
      while (nextGreaterThan !== -1 && nextGreaterThan < start) {
        nextGreaterThan = source.indexOf(">", nextGreaterThan + 1);
      }
    }
    return parseTag(
      source,
      start,
      nextGreaterThan,
      (close) => close > getLineSummary(start, tagStartLineCursor).end,
      lastNonWhitespaceBeforeClose,
    );
  };

  const resolveOpaqueEnd = (tag: ParsedTag) => {
    let opaqueEnd = findOpaqueEnd(source, tag, closingTagIndex);
    if (options.recoverUnclosedUnknownTags && !opaqueEnd.hasClosingTag && !closingTagIndex) {
      closingTagIndex = indexClosingTags(source);
      opaqueEnd = findOpaqueEnd(source, tag, closingTagIndex);
    }
    return opaqueEnd;
  };

  const rangeHasLineBreak = (start: number, end: number) => {
    if (start >= end) return false;
    return source.slice(start, end).includes("\n");
  };

  const parseRange = (
    start: number,
    expectedClose?: DocumentComponentKind,
  ): ParsedRange => {
    const nodes: DocumentIrNode[] = [];
    let cursor = start;
    let markdownStart = start;
    let hasLineBreak = false;

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
          hasLineBreak ||= rangeHasLineBreak(cursor, fenceEnd);
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
        hasLineBreak ||= raw.includes("\n");
        const isFootnote = legacy[2] !== undefined;
        const id = (isFootnote ? legacy[3] : legacy[7]) || compatibilityId(raw);
        const comment = unescapeLegacyComment((isFootnote ? legacy[4] : legacy[8]) ?? "");
        const type = isFootnote ? "footnote" : annotationType(legacy[5] ?? "");
        const childStart = cursor + 2;
        const childEnd = childStart + legacy[1].length;
        nodes.push({
          type: "component",
          kind: "Annotation",
          attributes: { id, type, comment },
          children: [{ type: "markdown", raw: legacy[1], start: childStart, end: childEnd }],
          start: cursor,
          end: cursor + raw.length,
        });
        cursor += raw.length;
        markdownStart = cursor;
        continue;
      }

      if (source[cursor] === "`" && source[cursor - 1] !== "\\") {
        const codeSpanEnd = findCodeSpanEnd(source, cursor);
        hasLineBreak ||= rangeHasLineBreak(cursor, codeSpanEnd);
        cursor = codeSpanEnd;
        continue;
      }

      if (source[cursor] !== "<") {
        if (source[cursor] === "\n") hasLineBreak = true;
        cursor += 1;
        continue;
      }

      const tag = parseTagAt(cursor);
      if (!tag) {
        cursor += 1;
        continue;
      }

      if (tag.closing) {
        const expectedSpec = expectedClose
          ? DocumentComponentSpecRegistry.get(expectedClose)
          : undefined;
        const closingPositionValid =
          expectedSpec?.form === "inline" || occupiesOwnLine(cursor, tag.end);
        if (expectedClose === tag.kind && tag.valid && closingPositionValid) {
          flushMarkdown(cursor);
          return {
            nodes,
            cursor: tag.end,
            closed: true,
            hasLineBreak,
            closingTagHasLineBreak: tag.hasLineBreak,
          };
        }
        cursor += 1;
        continue;
      }

      const spec = DocumentComponentSpecRegistry.get(tag.kind);
      if (spec && tag.kind !== "CodeBlock" && spec.form !== "inline" && !occupiesOwnLine(cursor, tag.end)) {
        cursor += 1;
        continue;
      }

      flushMarkdown(cursor);
      if (!spec || tag.kind === "CodeBlock") {
        const opaqueEnd = resolveOpaqueEnd(tag);
        if (options.recoverUnclosedUnknownTags && !expectedClose && !opaqueEnd.hasClosingTag) {
          diagnostic(diagnostics, "unknown-component", `Unknown component ${tag.kind}.`, cursor, tag.end, tag.kind);
          nodes.push({ type: "opaque", raw: source.slice(cursor, tag.end), reason: "unknown-component", start: cursor, end: tag.end });
          hasLineBreak ||= tag.hasLineBreak;
          cursor = tag.end;
          markdownStart = cursor;
          continue;
        }

        const end = opaqueEnd.end;
        diagnostic(diagnostics, "unknown-component", `Unknown component ${tag.kind}.`, cursor, end, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, end), reason: "unknown-component", start: cursor, end });
        hasLineBreak ||= rangeHasLineBreak(cursor, end);
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
        const end = resolveOpaqueEnd(tag).end;
        diagnostic(diagnostics, "invalid-attributes", `Invalid attributes for ${tag.kind}.`, cursor, end, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, end), reason: "invalid-attributes", start: cursor, end });
        hasLineBreak ||= rangeHasLineBreak(cursor, end);
        cursor = end;
        markdownStart = cursor;
        continue;
      }

      const parsedChildren = parseRange(tag.end, tag.kind as DocumentComponentKind);
      if (!parsedChildren.closed) {
        diagnostic(diagnostics, "unbalanced-component", `Unbalanced component ${tag.kind}.`, cursor, source.length, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor), reason: "unbalanced-component", start: cursor, end: source.length });
        hasLineBreak ||= rangeHasLineBreak(cursor, source.length);
        return { nodes, cursor: source.length, closed: false, hasLineBreak };
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
        (parsedChildren.hasLineBreak ||
          componentChildren.some((node) => DocumentComponentSpecRegistry.get(node.kind)?.form !== "inline"));
      const inlineContentIsEmpty =
        spec.form === "inline" &&
        parsedChildren.nodes.every(isWhitespaceMarkdown);

      if (inlineContentIsEmpty) {
        const opaqueEnd = parsedChildren.cursor;
        diagnostic(diagnostics, "invalid-content", `Empty content for ${tag.kind}.`, cursor, opaqueEnd, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, opaqueEnd), reason: "invalid-content", start: cursor, end: opaqueEnd });
        hasLineBreak ||= rangeHasLineBreak(cursor, opaqueEnd);
        cursor = opaqueEnd;
        markdownStart = cursor;
        continue;
      }

      if (!validParent || !validChildren || inlineHasBlock) {
        const opaqueEnd = parsedChildren.cursor;
        diagnostic(diagnostics, "invalid-nesting", `Invalid nesting for ${tag.kind}.`, cursor, opaqueEnd, tag.kind);
        nodes.push({ type: "opaque", raw: source.slice(cursor, opaqueEnd), reason: "invalid-nesting", start: cursor, end: opaqueEnd });
        hasLineBreak ||= rangeHasLineBreak(cursor, opaqueEnd);
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
      hasLineBreak ||= tag.hasLineBreak || parsedChildren.hasLineBreak || parsedChildren.closingTagHasLineBreak === true;
      cursor = parsedChildren.cursor;
      markdownStart = cursor;
      if (!expectedClose && stopAfterFirstTopLevelComponent) {
        return { nodes, cursor, closed: false, hasLineBreak };
      }
    }

    flushMarkdown(source.length);
    return { nodes, cursor: source.length, closed: false, hasLineBreak };
  };

  const parsed = parseRange(topLevelStart);
  return {
    document: { type: "document", version: 1, source, children: parsed.nodes },
    diagnostics,
    recoverable: true,
  };
};

export const parseControlledMarkdown = (
  source: string,
  options: ControlledMarkdownParseOptions = {},
): DocumentParseResult => parseControlledMarkdownInternal(source, false, 0, options);

export const parseControlledComponentAt = (source: string, start = 0): ComponentNode | null => {
  const parsed = parseControlledMarkdownInternal(source, true, start);
  const first = parsed.document.children[0];
  return first?.type === "component" && first.start === start && parsed.diagnostics.length === 0
    ? first
    : null;
};
