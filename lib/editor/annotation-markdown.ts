export type InlineAnnotationMarkerType = "footnote" | "personal" | "ai" | "highlight"

export type InlineAnnotationMarker = {
  end: number
  id?: string
  index: number
  legacyFootnote: boolean
  raw: string
  start: number
  text: string
  type: InlineAnnotationMarkerType
}

const MARKER_START_RE = /\[(?:\^|@[pch]?)(?=\d)/g
const INLINE_FOOTNOTE_HEADER_RE = /^\[\^(\d+)(?:\|([^\]:|]+))?:\s*/
const INLINE_ANNOTATION_HEADER_RE = /^\[@([pch]?)(\d+)(?:\|([^\]:|]+))?:\s*/
const LEGACY_FOOTNOTE_RE = /^\[\^(\d+)\]/

const typeFromPrefix = (prefix: string): InlineAnnotationMarkerType => {
  // Legacy collaborative annotations are personal annotations in the supported model.
  if (prefix === "p" || prefix === "c") return "personal"
  if (prefix === "h") return "highlight"
  return "ai"
}

export const escapeInlineAnnotationText = (value: string) =>
  value.replaceAll("\\", "\\\\").replaceAll("]", "\\]")

export const unescapeInlineAnnotationText = (value: string) => {
  let result = ""

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    const nextCharacter = value[index + 1]
    if (character === "\\" && (nextCharacter === "\\" || nextCharacter === "]")) {
      result += nextCharacter
      index += 1
      continue
    }
    result += character
  }

  return result
}

const nextMarkerOrBlockBoundary = (markdown: string, contentStart: number) => {
  MARKER_START_RE.lastIndex = contentStart
  const nextMarker = MARKER_START_RE.exec(markdown)?.index ?? markdown.length
  const nextBlock = markdown.indexOf("\n\n", contentStart)
  return nextBlock === -1 ? nextMarker : Math.min(nextMarker, nextBlock)
}

const findMarkerEnd = (markdown: string, contentStart: number) => {
  const boundary = nextMarkerOrBlockBoundary(markdown, contentStart)

  for (let index = contentStart; index < boundary; index += 1) {
    if (markdown[index] !== "]") continue

    let precedingBackslashes = 0
    for (let cursor = index - 1; cursor >= contentStart && markdown[cursor] === "\\"; cursor -= 1) {
      precedingBackslashes += 1
    }
    if (precedingBackslashes % 2 === 0) return index + 1
  }

  return -1
}

export const findInlineAnnotationMarkers = (markdown: string): InlineAnnotationMarker[] => {
  const markers: InlineAnnotationMarker[] = []
  MARKER_START_RE.lastIndex = 0

  let startMatch: RegExpExecArray | null
  while ((startMatch = MARKER_START_RE.exec(markdown)) !== null) {
    const start = startMatch.index
    const candidate = markdown.slice(start)
    const legacyFootnote = LEGACY_FOOTNOTE_RE.exec(candidate)

    if (legacyFootnote) {
      const raw = legacyFootnote[0]
      markers.push({
        end: start + raw.length,
        index: Number(legacyFootnote[1]),
        legacyFootnote: true,
        raw,
        start,
        text: "",
        type: "footnote",
      })
      MARKER_START_RE.lastIndex = start + raw.length
      continue
    }

    const footnoteHeader = INLINE_FOOTNOTE_HEADER_RE.exec(candidate)
    const annotationHeader = INLINE_ANNOTATION_HEADER_RE.exec(candidate)
    const header = footnoteHeader ?? annotationHeader
    if (!header) {
      MARKER_START_RE.lastIndex = start + startMatch[0].length
      continue
    }

    const headerLength = header[0].length
    const contentStart = start + headerLength
    const end = findMarkerEnd(markdown, contentStart)
    if (end === -1) {
      MARKER_START_RE.lastIndex = contentStart
      continue
    }

    const isFootnote = Boolean(footnoteHeader)
    const raw = markdown.slice(start, end)
    markers.push({
      end,
      ...(isFootnote ? (header[2] ? { id: header[2] } : {}) : header[3] ? { id: header[3] } : {}),
      index: Number(isFootnote ? header[1] : header[2]),
      legacyFootnote: false,
      raw,
      start,
      text: unescapeInlineAnnotationText(markdown.slice(contentStart, end - 1).trim()),
      type: isFootnote ? "footnote" : typeFromPrefix(header[1]),
    })
    MARKER_START_RE.lastIndex = end
  }

  return markers
}

export const replaceInlineAnnotationMarkers = (
  markdown: string,
  replacer: (marker: InlineAnnotationMarker) => string,
) => {
  const markers = findInlineAnnotationMarkers(markdown)
  if (markers.length === 0) return markdown

  let cursor = 0
  let result = ""
  for (const marker of markers) {
    result += markdown.slice(cursor, marker.start)
    result += replacer(marker)
    cursor = marker.end
  }

  return result + markdown.slice(cursor)
}
