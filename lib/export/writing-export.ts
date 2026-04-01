import type { JSONContent } from "@tiptap/core"

export type WritingExportFootnote = {
  index: number
  text: string
}

export type WritingExportInline = {
  text: string
  bold?: boolean
  italic?: boolean
  strike?: boolean
  code?: boolean
  highlight?: boolean
  linkHref?: string
  footnoteRef?: number
}

export type WritingExportBlock =
  | {
      type: "paragraph"
      inlines: WritingExportInline[]
    }
  | {
      type: "heading"
      level: 1 | 2 | 3
      inlines: WritingExportInline[]
    }
  | {
      type: "blockquote"
      inlines: WritingExportInline[]
    }
  | {
      type: "bulletList"
      items: WritingExportInline[][]
    }
  | {
      type: "orderedList"
      items: WritingExportInline[][]
    }
  | {
      type: "codeBlock"
      code: string
      language: string | null
    }
  | {
      type: "separator"
    }
  | {
      type: "table"
      rows: string[][]
    }

export type WritingExportDocument = {
  blocks: WritingExportBlock[]
  footnotes: WritingExportFootnote[]
}

type ExportNode = {
  type?: string
  text?: string
  content?: ExportNode[]
  attrs?: Record<string, unknown>
  marks?: Array<{
    type?: string
    attrs?: Record<string, unknown>
  }>
}

const MARKDOWN_ESCAPE_RE = /[\\`*_{}\[\]()#+\-.!|>~=:]/g

const escapeMarkdownText = (value: string) =>
  value.replace(MARKDOWN_ESCAPE_RE, (match) => `\\${match}`)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null

const readNumber = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }

  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return null
}

const readString = (value: unknown): string | null => (typeof value === "string" ? value : null)

const normalizeInlineRuns = (runs: WritingExportInline[]) => {
  const normalized: WritingExportInline[] = []

  for (const run of runs) {
    if (!run.text) {
      continue
    }

    const previous = normalized[normalized.length - 1]
    if (
      previous &&
      previous.bold === run.bold &&
      previous.italic === run.italic &&
      previous.strike === run.strike &&
      previous.code === run.code &&
      previous.highlight === run.highlight &&
      previous.linkHref === run.linkHref &&
      previous.footnoteRef === run.footnoteRef
    ) {
      previous.text += run.text
      continue
    }

    normalized.push({ ...run })
  }

  return normalized
}

const collectInlineRuns = (nodes: ExportNode[] | undefined, footnotes: WritingExportFootnote[]): WritingExportInline[] => {
  if (!nodes?.length) {
    return []
  }

  const runs: WritingExportInline[] = []

  for (const node of nodes) {
    if (node.type === "text") {
      const text = node.text ?? ""
      if (!text) {
        continue
      }

      const run: WritingExportInline = { text }
      for (const mark of node.marks ?? []) {
        switch (mark.type) {
          case "bold":
            run.bold = true
            break
          case "italic":
            run.italic = true
            break
          case "strike":
            run.strike = true
            break
          case "code":
            run.code = true
            break
          case "highlight":
            run.highlight = true
            break
          case "link":
            run.linkHref = readString(mark.attrs?.href) ?? undefined
            break
          default:
            break
        }
      }

      runs.push(run)
      continue
    }

    if (node.type === "footnoteReference") {
      const index = readNumber(node.attrs?.index)
      if (index === null) {
        continue
      }

      const text = readString(node.attrs?.text) ?? ""
      if (text) {
        footnotes.push({ index, text })
      }

      runs.push({ text: `[^${index}]`, footnoteRef: index })
      continue
    }

    if (node.type === "hardBreak") {
      runs.push({ text: "\n" })
      continue
    }

    if (node.content?.length) {
      runs.push(...collectInlineRuns(node.content, footnotes))
    }
  }

  return normalizeInlineRuns(runs)
}

const collectBlockItems = (nodes: ExportNode[] | undefined, footnotes: WritingExportFootnote[]) => {
  if (!nodes?.length) {
    return [] as WritingExportInline[][]
  }

  return nodes
    .map((node) => {
      if (node.type === "listItem") {
        return collectInlineRuns(node.content, footnotes)
      }

      return collectInlineRuns([node], footnotes)
    })
    .filter((item) => item.length > 0)
}

const collectTableRows = (node: ExportNode, footnotes: WritingExportFootnote[]) => {
  const rows: string[][] = []
  for (const rowNode of node.content ?? []) {
    if (rowNode.type !== "tableRow") {
      continue
    }

    const row: string[] = []
    for (const cellNode of rowNode.content ?? []) {
      row.push(collectInlineRuns(cellNode.content, footnotes).map((run) => run.text).join(" ").trim())
    }

    if (row.length > 0) {
      rows.push(row)
    }
  }

  return rows
}

const collectBlocks = (nodes: ExportNode[] | undefined, footnotes: WritingExportFootnote[]): WritingExportBlock[] => {
  const blocks: WritingExportBlock[] = []

  for (const node of nodes ?? []) {
    switch (node.type) {
      case "paragraph": {
        const inlines = collectInlineRuns(node.content, footnotes)
        blocks.push({ type: "paragraph", inlines })
        break
      }
      case "heading": {
        const level = readNumber(node.attrs?.level)
        const inlines = collectInlineRuns(node.content, footnotes)
        blocks.push({
          type: "heading",
          level: level === 1 || level === 2 || level === 3 ? level : 1,
          inlines,
        })
        break
      }
      case "blockquote": {
        const inlines = collectInlineRuns(node.content, footnotes)
        blocks.push({ type: "blockquote", inlines })
        break
      }
      case "bulletList": {
        blocks.push({ type: "bulletList", items: collectBlockItems(node.content, footnotes) })
        break
      }
      case "orderedList": {
        blocks.push({ type: "orderedList", items: collectBlockItems(node.content, footnotes) })
        break
      }
      case "codeBlock": {
        const code = collectInlineRuns(node.content, footnotes).map((run) => run.text).join("")
        blocks.push({ type: "codeBlock", code, language: readString(node.attrs?.language) })
        break
      }
      case "horizontalRule": {
        blocks.push({ type: "separator" })
        break
      }
      case "table": {
        blocks.push({ type: "table", rows: collectTableRows(node, footnotes) })
        break
      }
      case "doc":
        blocks.push(...collectBlocks(node.content, footnotes))
        break
      default: {
        if (node.content?.length) {
          blocks.push(...collectBlocks(node.content, footnotes))
        }
        break
      }
    }
  }

  return blocks
}

const renderInlineRunToMarkdown = (run: WritingExportInline) => {
  if (typeof run.footnoteRef === "number") {
    return `[^${run.footnoteRef}]`
  }

  const escaped = escapeMarkdownText(run.text)

  if (run.linkHref) {
    return `[${escaped}](${escapeMarkdownText(run.linkHref)})`
  }

  if (run.code) {
    return `\`${escaped.replaceAll("`", "\\`")}\``
  }

  let value = escaped

  if (run.bold && run.italic) {
    value = `***${value}***`
  } else if (run.bold) {
    value = `**${value}**`
  } else if (run.italic) {
    value = `*${value}*`
  }

  if (run.strike) {
    value = `~~${value}~~`
  }

  if (run.highlight) {
    value = `==${value}==`
  }

  return value
}

const renderInlineRunsToMarkdown = (runs: WritingExportInline[]) => runs.map(renderInlineRunToMarkdown).join("")

const indentMarkdown = (value: string, indent = "  ") =>
  value
    .split("\n")
    .map((line, index) => (index === 0 ? line : `${indent}${line}`))
    .join("\n")

const renderBlockToMarkdown = (block: WritingExportBlock) => {
  switch (block.type) {
    case "paragraph":
      return renderInlineRunsToMarkdown(block.inlines)
    case "heading":
      return `${"#".repeat(block.level)} ${renderInlineRunsToMarkdown(block.inlines)}`
    case "blockquote":
      return block.inlines.length
        ? block
            .inlines
            .map(renderInlineRunToMarkdown)
            .join("")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        : ""
    case "bulletList":
      return block.items
        .map((item) => `- ${indentMarkdown(renderInlineRunsToMarkdown(item))}`.trimEnd())
        .join("\n")
    case "orderedList":
      return block.items
        .map((item, index) => `${index + 1}. ${indentMarkdown(renderInlineRunsToMarkdown(item))}`.trimEnd())
        .join("\n")
    case "codeBlock":
      return ["```", block.code.trimEnd(), "```"].join("\n")
    case "separator":
      return "---"
    case "table": {
      if (!block.rows.length) {
        return ""
      }

      const columnCount = block.rows.reduce((max, row) => Math.max(max, row.length), 0)
      if (!columnCount) {
        return ""
      }

      const rows = block.rows.map((row) => [...row, ...Array.from({ length: columnCount - row.length }, () => "")])
      const formatRow = (row: string[]) => `| ${row.map((cell) => escapeMarkdownText(cell.trim())).join(" | ")} |`
      const separator = `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`

      return [formatRow(rows[0]), separator, ...rows.slice(1).map(formatRow)].join("\n")
    }
    default:
      return ""
  }
}

const splitBlocks = (markdown: string) =>
  markdown
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean)

export const buildWritingExportDocument = (bodyJson: JSONContent | null | undefined): WritingExportDocument => {
  const footnotes: WritingExportFootnote[] = []
  const root = isRecord(bodyJson) ? (bodyJson as ExportNode) : null
  const blocks = root ? collectBlocks(root.content, footnotes) : []

  return {
    blocks,
    footnotes: footnotes.sort((left, right) => left.index - right.index),
  }
}

export const buildWritingMarkdown = (bodyJson: JSONContent | null | undefined) => {
  const document = buildWritingExportDocument(bodyJson)
  const body = document.blocks.map(renderBlockToMarkdown).filter(Boolean).join("\n\n").trim()

  if (!document.footnotes.length) {
    return body
  }

  const footnoteBody = document.footnotes
    .map(({ index, text }) => `[^${index}]: ${text.trim()}`)
    .join("\n")

  return [body, footnoteBody].filter(Boolean).join("\n\n").trim()
}

export const getExportFileBaseName = (params: {
  title?: string | null
  bodyText?: string | null
  writingId: string
}) => {
  const title = params.title?.trim()
  if (title) {
    return sanitizeFileName(title)
  }

  const bodyText = params.bodyText?.trim()
  if (bodyText) {
    const fallback = bodyText
      .split(/\s+/)
      .slice(0, 5)
      .join(" ")
      .trim()
    if (fallback) {
      return sanitizeFileName(fallback)
    }
  }

  return sanitizeFileName(params.writingId.slice(0, 8))
}

export const sanitizeFileName = (value: string) =>
  value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[<>:"/\\|?*\u0000-\u001F]+/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/[. ]+$/g, "")
    .replace(/\s/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 120) || "export"

export const markdownBlocksFromDocument = (bodyJson: JSONContent | null | undefined) =>
  splitBlocks(buildWritingMarkdown(bodyJson))
