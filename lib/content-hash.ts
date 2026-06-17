import type { JSONContent } from "@tiptap/core"
import { blake3 } from "hash-wasm"
import { serializeWritingToMarkdown } from "@/lib/export/to-markdown"

const CONTENT_HASH_PREFIX = "blake3"

export const canonicalizeMarkdownForContentHash = (markdown: string) =>
  markdown.replace(/\r\n/g, "\n").replace(/\r/g, "\n")

export const computeMarkdownContentHash = async (markdown: string): Promise<string> => {
  const canonicalMarkdown = canonicalizeMarkdownForContentHash(markdown)
  const digest = await blake3(new TextEncoder().encode(canonicalMarkdown))
  return `${CONTENT_HASH_PREFIX}:${digest}`
}

export const computeWritingContentHash = async (
  bodyJson: JSONContent | Record<string, unknown> | null | undefined,
): Promise<string> => computeMarkdownContentHash(serializeWritingToMarkdown(bodyJson as JSONContent | null | undefined))
