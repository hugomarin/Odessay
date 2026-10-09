import { DocumentComponentSpecRegistry } from "@/lib/document-components/registry";
import type { DocumentIrNode } from "@/lib/document-components/types";

const fenceBody = (raw: string): string => {
  const lines = raw.replace(/\n$/, "").split("\n");
  const closing = lines.length > 1 && /^ {0,3}(`{3,}|~{3,})\s*$/.test(lines[lines.length - 1]);
  return lines.slice(1, closing ? -1 : undefined).join("\n");
};

/**
 * Conservative visible text for an IR node that a surface renders without a
 * dedicated adapter (surface-projections.md, `body_text`). A block title comes
 * before its body; child text keeps reading order; IDs, comments, reasons and
 * refs never contribute. Opaque source has no trustworthy structure, so it
 * projects its exact raw text.
 */
export const projectIrNodePlainText = (node: DocumentIrNode): string => {
  if (node.type === "markdown" || node.type === "opaque") return node.raw;
  if (node.type === "code-block") return fenceBody(node.raw);

  const body = node.children.map(projectIrNodePlainText).join("");
  if (DocumentComponentSpecRegistry.get(node.kind)?.form === "inline") return body;
  const title = node.attributes.title?.trim() ?? "";
  return [title, body.trim()].filter(Boolean).join("\n");
};
