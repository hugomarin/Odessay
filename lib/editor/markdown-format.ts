import { normalizeMarkdownFootnotes } from "@/lib/editor/footnote-extension"

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

export const normalizeMarkdownForRoundTrip = (markdown: string): string =>
  normalizeMarkdownFootnotes(normalizeMarkdownHighlights(markdown))

export const materializeMarkdownForRichParser = (markdown: string): string =>
  normalizeMarkdownForRoundTrip(markdown).replace(/==([^=\n]+)==/g, "<mark>$1</mark>")

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
