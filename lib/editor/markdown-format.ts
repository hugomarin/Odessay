import { normalizeMarkdownFootnotes } from "@/lib/editor/footnote-extension"
import {
  findInlineAnnotationMarkers,
  replaceInlineAnnotationMarkers,
} from "@/lib/editor/annotation-markdown"

export type MarkdownInlineToggleResult = {
  markdown: string
  selectionStart: number
  selectionEnd: number
}

const hasWrappedSelection = (value: string, marker: string) =>
  value.startsWith(marker) && value.endsWith(marker) && value.length >= marker.length * 2

const canUnwrapAroundSelection = (markdown: string, start: number, end: number, marker: string) =>
  start >= marker.length &&
  markdown.slice(start - marker.length, start) === marker &&
  markdown.slice(end, end + marker.length) === marker

export const toggleMarkdownInlineMarker = (
  markdown: string,
  start: number,
  end: number,
  marker: string,
): MarkdownInlineToggleResult => {
  const selected = markdown.slice(start, end)

  if (start === end) {
    const wrapped = `${marker}${marker}`
    return {
      markdown: `${markdown.slice(0, start)}${wrapped}${markdown.slice(end)}`,
      selectionStart: start + marker.length,
      selectionEnd: start + marker.length,
    }
  }

  if (hasWrappedSelection(selected, marker)) {
    const unwrapped = selected.slice(marker.length, selected.length - marker.length)
    return {
      markdown: `${markdown.slice(0, start)}${unwrapped}${markdown.slice(end)}`,
      selectionStart: start,
      selectionEnd: start + unwrapped.length,
    }
  }

  if (canUnwrapAroundSelection(markdown, start, end, marker)) {
    const outerStart = start - marker.length
    const outerEnd = end + marker.length

    return {
      markdown: `${markdown.slice(0, outerStart)}${selected}${markdown.slice(outerEnd)}`,
      selectionStart: outerStart,
      selectionEnd: outerStart + selected.length,
    }
  }

  return {
    markdown: `${markdown.slice(0, start)}${marker}${selected}${marker}${markdown.slice(end)}`,
    selectionStart: start + marker.length,
    selectionEnd: start + marker.length + selected.length,
  }
}

export const normalizeMarkdownHighlights = (markdown: string): string =>
  markdown.replace(/<mark(?:\s[^>]*)?>([\s\S]*?)<\/mark>/gi, "==$1==")

const BLOCK_IMAGE_TOKEN_RE = /!\[[^\]\n]*\]\([^)\n]+\)/

const normalizeBlockImageBoundaries = (markdown: string): string => {
  let result = markdown
  let previous = ""

  while (result !== previous) {
    previous = result
    result = result
      .replace(
        new RegExp(`(${BLOCK_IMAGE_TOKEN_RE.source})(?=${BLOCK_IMAGE_TOKEN_RE.source})`, "g"),
        "$1\n\n",
      )
      .replace(new RegExp(`(${BLOCK_IMAGE_TOKEN_RE.source})(?=[^\\s\\n])`, "g"), "$1\n\n")
  }

  return result
}

const mergeFragmentedHighlights = (markdown: string): string => {
  let result = markdown
  let prev = ""
  while (result !== prev) {
    prev = result
    // ==A==**==B==**==C== → ==A**B**C== (bold inside highlight)
    result = result.replace(
      /==([^=\n]*)==\*\*==([^=\n]*)==\*\*==([^=\n]*)==/g,
      "==$1**$2**$3==",
    )
    result = result.replace(/==([^=\n]*)==\*\*==([^=\n]*)==\*\*/g, "==$1**$2**==")
    result = result.replace(/\*\*==([^=\n]*)==\*\*==([^=\n]*)==/g, "==**$1**$2==")
    // ==A==***==B==***==C== → ==A***B***C== (bold+italic)
    result = result.replace(
      /==([^=\n]*)==\*\*\*==([^=\n]*)==\*\*\*==([^=\n]*)==/g,
      "==$1***$2***$3==",
    )
    result = result.replace(/==([^=\n]*)==\*\*\*==([^=\n]*)==\*\*\*/g, "==$1***$2***==")
    result = result.replace(/\*\*\*==([^=\n]*)==\*\*\*==([^=\n]*)==/g, "==***$1***$2==")
    // ==A==*==B==*==C== → ==A*B*C== (italic only — must come after ** passes)
    result = result.replace(
      /==([^=\n]*)==\*==([^=\n]*)==\*==([^=\n]*)==/g,
      "==$1*$2*$3==",
    )
    result = result.replace(/==([^=\n]*)==\*==([^=\n]*)==\*(?!\*)/g, "==$1*$2*==")
    result = result.replace(/(?<!\*)\*==([^=\n]*)==\*==([^=\n]*)==/g, "==*$1*$2==")
    result = result.replace(/\*\*\*==([^=\n]*)==\*\*\*/g, "==***$1***==")
    result = result.replace(/(?<!\*)\*\*==([^=\n]*)==\*\*(?!\*)/g, "==**$1**==")
    result = result.replace(/(?<!\*)\*==([^=\n]*)==\*(?!\*)/g, "==*$1*==")
  }
  return result
}

const normalizeTableAnnotationBoundaries = (markdown: string): string => {
  const repairs: Array<{ anchorEnd: number; markerEnd: number; markerStart: number; raw: string }> = []

  for (const marker of findInlineAnnotationMarkers(markdown)) {
    if (marker.legacyFootnote) continue

    let delimiterPos = marker.start
    while (delimiterPos > 0 && /[\t ]/.test(markdown[delimiterPos - 1])) delimiterPos -= 1
    if (markdown[delimiterPos - 1] !== "|") continue
    delimiterPos -= 1

    let anchorEnd = delimiterPos
    while (anchorEnd > 0 && /[\t ]/.test(markdown[anchorEnd - 1])) anchorEnd -= 1
    if (markdown.slice(anchorEnd - 2, anchorEnd) !== "==") continue

    const lineStart = markdown.lastIndexOf("\n", delimiterPos - 1) + 1
    if (!/^[\t ]*\|/.test(markdown.slice(lineStart, delimiterPos + 1))) continue

    repairs.push({
      anchorEnd,
      markerEnd: marker.end,
      markerStart: marker.start,
      raw: marker.raw,
    })
  }

  return repairs
    .sort((a, b) => b.markerStart - a.markerStart)
    .reduce(
      (result, repair) =>
        `${result.slice(0, repair.anchorEnd)}${repair.raw}${result.slice(repair.anchorEnd, repair.markerStart)}${result.slice(repair.markerEnd)}`,
      markdown,
    )
}

const TABLE_BLOCK_REGEX = /<table\b[\s\S]*?<\/table>/gi
const TABLE_ROW_REGEX = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
const TABLE_CELL_REGEX = /<(td|th)\b([^>]*)>([\s\S]*?)<\/\1>/gi

const decodeHtmlEntities = (value: string): string =>
  value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&(apos|#39);/gi, "'")
    .replace(/&#(\d+);/g, (_, codepoint: string) => {
      const asNumber = Number.parseInt(codepoint, 10)
      if (!Number.isFinite(asNumber)) {
        return ""
      }

      return String.fromCodePoint(asNumber)
    })

const toInlineMarkdown = (html: string): string => {
  const withInlineMarks = html
    .replace(/<\s*strong[^>]*>([\s\S]*?)<\/\s*strong\s*>/gi, "**$1**")
    .replace(/<\s*b[^>]*>([\s\S]*?)<\/\s*b\s*>/gi, "**$1**")
    .replace(/<\s*em[^>]*>([\s\S]*?)<\/\s*em\s*>/gi, "*$1*")
    .replace(/<\s*i[^>]*>([\s\S]*?)<\/\s*i\s*>/gi, "*$1*")
    .replace(/<\s*br\s*\/?>/gi, "<br>")
    .replace(/<\s*\/p\s*>\s*<\s*p[^>]*\s*>/gi, "<br>")
    .replace(/<\s*p[^>]*>/gi, "")
    .replace(/<\/\s*p\s*>/gi, "")

  return decodeHtmlEntities(withInlineMarks)
    .replace(/<[^>]+>/g, "")
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim()
}

const readColspan = (attributes: string): number => {
  const match = attributes.match(/\bcolspan\s*=\s*["']?(\d+)["']?/i)
  if (!match) {
    return 1
  }

  const parsed = Number.parseInt(match[1], 10)
  if (!Number.isFinite(parsed) || parsed < 1) {
    return 1
  }

  return parsed
}

const tableRowsFromHtml = (tableHtml: string): string[][] => {
  const rows: string[][] = []

  for (const rowMatch of tableHtml.matchAll(TABLE_ROW_REGEX)) {
    const rowMarkup = rowMatch[0]
    const cells: string[] = []

    for (const cellMatch of rowMarkup.matchAll(TABLE_CELL_REGEX)) {
      const attributes = cellMatch[2]
      const cellHtml = cellMatch[3]
      const colspan = readColspan(attributes)
      const normalizedCell = toInlineMarkdown(cellHtml)
      cells.push(normalizedCell)

      for (let index = 1; index < colspan; index += 1) {
        cells.push("")
      }
    }

    if (cells.length > 0) {
      rows.push(cells)
    }
  }

  return rows
}

const rowsToMarkdownTable = (rows: string[][]): string => {
  if (rows.length === 0) {
    return ""
  }

  const columnCount = rows.reduce((max, row) => Math.max(max, row.length), 0)
  if (columnCount === 0) {
    return ""
  }

  const normalizedRows = rows.map((row) => [...row, ...Array.from({ length: columnCount - row.length }, () => "")])
  const formatRow = (row: string[]) => `| ${row.map((cell) => cell.trim()).join(" | ")} |`
  const separator = `| ${Array.from({ length: columnCount }, () => "---").join(" | ")} |`

  return [formatRow(normalizedRows[0]), separator, ...normalizedRows.slice(1).map(formatRow)].join("\n")
}

export const convertHtmlTablesToMarkdown = (value: string): string => {
  if (!/<table\b/i.test(value)) {
    return value
  }

  return value.replace(TABLE_BLOCK_REGEX, (tableHtml) => {
    const rows = tableRowsFromHtml(tableHtml)
    const markdownTable = rowsToMarkdownTable(rows)
    return markdownTable || tableHtml
  })
}

export const normalizeMarkdownForRoundTrip = (markdown: string): string =>
  normalizeMarkdownFootnotes(
    normalizeTableAnnotationBoundaries(
      mergeFragmentedHighlights(
        normalizeBlockImageBoundaries(
          normalizeMarkdownHighlights(convertHtmlTablesToMarkdown(markdown)),
        ),
      ),
    ),
  )

const isAnnotationAnchorSeparator = (value: string) => {
  if (!value.includes("\n")) return /^[\t ]*$/.test(value)

  return value.split("\n").every((line, index) => {
    if (index === 0) return /^[\t ]*$/.test(line)
    return /^[\t ]*(?:#{1,6}[\t ]+|>[\t ]?|(?:[-+*]|\d+[.)])[\t ]+)?$/.test(line)
  })
}

const materializeAnnotationHighlightTypes = (markdown: string): string => {
  const replacements: Array<{ end: number; replacement: string; start: number }> = []

  for (const marker of findInlineAnnotationMarkers(markdown)) {
    if (marker.legacyFootnote) continue

    let highlightEnd = marker.start
    while (highlightEnd > 0 && /[\t ]/.test(markdown[highlightEnd - 1])) highlightEnd -= 1
    if (markdown.slice(highlightEnd - 2, highlightEnd) !== "==") continue

    let currentEnd = highlightEnd
    let currentStart = markdown.lastIndexOf("==", currentEnd - 3)

    while (currentStart !== -1) {
      const highlightedText = markdown.slice(currentStart + 2, currentEnd - 2)
      if (!highlightedText || highlightedText.includes("==") || highlightedText.includes("\n")) break

      replacements.push({
        end: currentEnd,
        replacement: `<mark data-annotation-type="${marker.type}">${highlightedText}</mark>`,
        start: currentStart,
      })

      const previousEnd = markdown.lastIndexOf("==", currentStart - 1)
      if (previousEnd === -1) break
      const separator = markdown.slice(previousEnd + 2, currentStart)
      if (!isAnnotationAnchorSeparator(separator)) break

      currentEnd = previousEnd + 2
      currentStart = markdown.lastIndexOf("==", previousEnd - 1)
    }
  }

  return replacements.sort((a, b) => a.start - b.start).reduceRight(
    (result, replacement) =>
      `${result.slice(0, replacement.start)}${replacement.replacement}${result.slice(replacement.end)}`,
    markdown,
  )
}

const escapeAnnotationAttribute = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")

const materializeInlineAnnotations = (markdown: string): string =>
  replaceInlineAnnotationMarkers(markdown, (marker) => {
    if (marker.legacyFootnote) return marker.raw

    const idAttributes = marker.id
      ? ` id="${escapeAnnotationAttribute(marker.id)}" annotation-id="${escapeAnnotationAttribute(marker.id)}"`
      : ""
    return `<annotation-ref${idAttributes} annotation-type="${marker.type}" index="${marker.index}" annotation-text="${escapeAnnotationAttribute(encodeURIComponent(marker.text))}"></annotation-ref>`
  })

export const materializeMarkdownForRichParser = (markdown: string): string =>
  materializeInlineAnnotations(
    materializeAnnotationHighlightTypes(normalizeMarkdownForRoundTrip(markdown)),
  ).replace(/==([^=\n]+)==/g, "<mark>$1</mark>")

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

const formatInlineMarkdown = (line: string): string => {
  const escapedLine = escapeHtml(line)

  return escapedLine.replace(/(\*\*[^*\n]+\*\*)/g, '<span class="od-markdown-strong">$1</span>')
}

export const renderMarkdownSemanticHtml = (markdown: string): string => {
  return markdown
    .split("\n")
    .map((line) => {
      const formatted = formatInlineMarkdown(line)

      if (/^\s{0,3}#{1,3}\s+/.test(line)) {
        return `<span class="od-markdown-heading">${formatted}</span>`
      }

      return formatted
    })
    .join("\n")
}
