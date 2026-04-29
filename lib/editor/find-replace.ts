import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import type { EditorState } from "@tiptap/pm/state"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"

export type FindReplaceMatch = {
  from: number
  to: number
  text: string
}

type TextRangeMatch = {
  start: number
  end: number
  text: string
}

export type FindReplacePluginState = {
  query: string
  caseSensitive: boolean
  activeIndex: number
  matches: FindReplaceMatch[]
}

type FindReplacePluginMeta = Partial<Pick<FindReplacePluginState, "query" | "caseSensitive" | "activeIndex">> & {
  clear?: boolean
}

const DEFAULT_PLUGIN_STATE: FindReplacePluginState = {
  query: "",
  caseSensitive: false,
  activeIndex: 0,
  matches: [],
}

const SEARCH_SEPARATOR = "\n"

export const findReplacePluginKey = new PluginKey<FindReplacePluginState>("odessay-find-replace")

const normalizeForSearch = (value: string, caseSensitive: boolean) => (caseSensitive ? value : value.toLocaleLowerCase())

export const clampFindReplaceIndex = (matchCount: number, activeIndex: number) => {
  if (matchCount <= 0) {
    return 0
  }

  if (activeIndex < 0) {
    return 0
  }

  if (activeIndex >= matchCount) {
    return matchCount - 1
  }

  return activeIndex
}

export const resolveNextFindReplaceIndex = (matchCount: number, activeIndex: number, direction: 1 | -1) => {
  if (matchCount <= 0) {
    return 0
  }

  const safeIndex = clampFindReplaceIndex(matchCount, activeIndex)
  return (safeIndex + direction + matchCount) % matchCount
}

export const findTextMatches = (source: string, query: string, caseSensitive: boolean): TextRangeMatch[] => {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return []
  }

  const haystack = normalizeForSearch(source, caseSensitive)
  const needle = normalizeForSearch(normalizedQuery, caseSensitive)
  const matches: TextRangeMatch[] = []

  let cursor = 0
  while (cursor <= haystack.length - needle.length) {
    const index = haystack.indexOf(needle, cursor)
    if (index === -1) {
      break
    }

    matches.push({
      start: index,
      end: index + needle.length,
      text: source.slice(index, index + needle.length),
    })
    cursor = index + needle.length
  }

  return matches
}

export const collectDocumentTextMap = (doc: ProseMirrorNode) => {
  const textParts: string[] = []
  const positions: Array<number | null> = []

  const visit = (node: ProseMirrorNode, pos: number) => {
    if (node.isText) {
      const text = node.text ?? ""
      for (let index = 0; index < text.length; index += 1) {
        textParts.push(text[index])
        positions.push(pos + index - 1)
      }
      return
    }

    node.forEach((child, offset) => {
      visit(child, pos + offset + 1)
    })

    if (node.isTextblock) {
      textParts.push(SEARCH_SEPARATOR)
      positions.push(null)
    }
  }

  visit(doc, 0)

  while (positions.length > 0 && positions[positions.length - 1] === null) {
    positions.pop()
    textParts.pop()
  }

  return {
    text: textParts.join(""),
    positions,
  }
}

export const findDocumentMatches = (
  doc: ProseMirrorNode,
  query: string,
  caseSensitive: boolean,
): FindReplaceMatch[] => {
  const normalizedQuery = query.trim()

  if (!normalizedQuery) {
    return []
  }

  const { text, positions } = collectDocumentTextMap(doc)
  const rawMatches = findTextMatches(text, normalizedQuery, caseSensitive)

  return rawMatches.flatMap((match) => {
    const mappedPositions = positions.slice(match.start, match.end)

    if (mappedPositions.some((position) => position === null)) {
      return []
    }

    const from = mappedPositions[0]
    const last = mappedPositions[mappedPositions.length - 1]

    if (typeof from !== "number" || typeof last !== "number") {
      return []
    }

    return [
      {
        from,
        to: last + 1,
        text: match.text,
      },
    ]
  })
}

export const replaceMatchInText = (source: string, match: TextRangeMatch, replacement: string) =>
  `${source.slice(0, match.start)}${replacement}${source.slice(match.end)}`

export const replaceAllMatchesInText = (source: string, query: string, replacement: string, caseSensitive: boolean) => {
  const matches = findTextMatches(source, query, caseSensitive)

  if (matches.length === 0) {
    return {
      value: source,
      replacements: 0,
    }
  }

  let cursor = 0
  let result = ""

  for (const match of matches) {
    result += source.slice(cursor, match.start)
    result += replacement
    cursor = match.end
  }

  result += source.slice(cursor)

  return {
    value: result,
    replacements: matches.length,
  }
}

const escapeHtml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")

export const renderFindReplaceOverlayHtml = (
  source: string,
  query: string,
  caseSensitive: boolean,
  activeIndex: number,
) => {
  const matches = findTextMatches(source, query, caseSensitive)

  if (matches.length === 0) {
    return `${escapeHtml(source)}\n`
  }

  const safeActiveIndex = clampFindReplaceIndex(matches.length, activeIndex)
  let html = ""
  let cursor = 0

  for (let index = 0; index < matches.length; index += 1) {
    const match = matches[index]
    const className =
      index === safeActiveIndex
        ? "od-find-match od-find-match-active"
        : "od-find-match"

    html += escapeHtml(source.slice(cursor, match.start))
    html += `<mark class="${className}">${escapeHtml(match.text)}</mark>`
    cursor = match.end
  }

  html += escapeHtml(source.slice(cursor))

  return `${html}\n`
}

const buildDecorations = (doc: ProseMirrorNode, matches: FindReplaceMatch[], activeIndex: number) => {
  if (matches.length === 0) {
    return DecorationSet.empty
  }

  const safeActiveIndex = clampFindReplaceIndex(matches.length, activeIndex)

  return DecorationSet.create(
    doc,
    matches.map((match, index) =>
      Decoration.inline(match.from, match.to, {
        class: index === safeActiveIndex ? "od-find-match od-find-match-active" : "od-find-match",
      }),
    ),
  )
}

export const getFindReplacePluginState = (editor: { state: EditorState } | null | undefined) => {
  if (!editor) {
    return DEFAULT_PLUGIN_STATE
  }

  const pluginState = findReplacePluginKey.getState(editor.state)
  return pluginState ?? DEFAULT_PLUGIN_STATE
}

export const setFindReplaceQueryState = (
  editor: TiptapEditor,
  nextState: FindReplacePluginMeta,
) => {
  const transaction = editor.state.tr
  transaction.setMeta(findReplacePluginKey, nextState)
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

export const clearFindReplaceQueryState = (
  editor: TiptapEditor,
) => {
  const transaction = editor.state.tr
  transaction.setMeta(findReplacePluginKey, { clear: true } satisfies FindReplacePluginMeta)
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

export const FindReplaceExtension = Extension.create({
  name: "findReplace",

  addProseMirrorPlugins() {
    return [
      new Plugin<FindReplacePluginState>({
        key: findReplacePluginKey,
        state: {
          init: () => ({
            ...DEFAULT_PLUGIN_STATE,
            matches: [],
            activeIndex: 0,
            query: "",
            caseSensitive: false,
          }),
          apply: (transaction, pluginState, _, nextState) => {
            const meta = transaction.getMeta(findReplacePluginKey) as FindReplacePluginMeta | undefined

            if (meta?.clear) {
              return DEFAULT_PLUGIN_STATE
            }

            const nextQuery = typeof meta?.query === "string" ? meta.query : pluginState.query
            const nextCaseSensitive =
              typeof meta?.caseSensitive === "boolean" ? meta.caseSensitive : pluginState.caseSensitive
            const nextMatches =
              transaction.docChanged || nextQuery !== pluginState.query || nextCaseSensitive !== pluginState.caseSensitive
                ? findDocumentMatches(nextState.doc, nextQuery, nextCaseSensitive)
                : pluginState.matches
            const requestedActiveIndex =
              typeof meta?.activeIndex === "number" ? meta.activeIndex : pluginState.activeIndex

            return {
              query: nextQuery,
              caseSensitive: nextCaseSensitive,
              matches: nextMatches,
              activeIndex: clampFindReplaceIndex(nextMatches.length, requestedActiveIndex),
            }
          },
        },
        props: {
          decorations(state) {
            const pluginState = findReplacePluginKey.getState(state)

            if (!pluginState || !pluginState.query.trim() || pluginState.matches.length === 0) {
              return null
            }

            return buildDecorations(state.doc, pluginState.matches, pluginState.activeIndex)
          },
        },
      }),
    ]
  },
})
