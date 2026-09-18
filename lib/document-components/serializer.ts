import { escapeControlledAttribute } from "@/lib/document-components/entities";
import { parseControlledMarkdown } from "@/lib/document-components/parser";
import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry";
import type { ComponentNode, DocumentIr, DocumentIrNode } from "@/lib/document-components/types";

const openingTag = (node: ComponentNode) => {
  const spec = DocumentComponentSpecRegistry.get(node.kind);
  if (!spec) throw new Error(`Missing component spec for ${node.kind}.`);
  const attributes = spec.attributes
    .filter(({ name }) => Object.hasOwn(node.attributes, name))
    .map(({ name }) => `${name}="${escapeControlledAttribute(node.attributes[name])}"`)
    .join(" ");
  return `<${node.kind}${attributes ? ` ${attributes}` : ""}>`;
};

const serializeNode = (node: DocumentIrNode): string => {
  if (node.type === "markdown" || node.type === "code-block" || node.type === "opaque") {
    return node.raw;
  }

  const spec = DocumentComponentSpecRegistry.get(node.kind);
  if (!spec) throw new Error(`Missing component spec for ${node.kind}.`);
  const content = node.children.map(serializeNode).join("");
  if (spec.form === "inline") {
    return `${openingTag(node)}${content}</${node.kind}>`;
  }
  const body = content.replace(/^\n/, "").replace(/\n$/, "");
  return `${openingTag(node)}\n${body}\n</${node.kind}>`;
};

export const serializeControlledDocument = (document: DocumentIr): string =>
  document.children.map(serializeNode).join("").replace(/\r\n?/g, "\n");

export const canonicalizeControlledMarkdown = (source: string): string => {
  return serializeControlledDocument(parseControlledMarkdown(source).document);
};
