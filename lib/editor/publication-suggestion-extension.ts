import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { findDocumentMatches } from "@/lib/editor/find-replace"

export const publicationSuggestionPluginKey = new PluginKey<PublicationSuggestion[]>("odessay-publication-suggestions")

const buildPublicationDecorations = (doc: ProseMirrorNode, suggestions: PublicationSuggestion[]): DecorationSet => {
  const decorations: Decoration[] = []

  for (const suggestion of suggestions) {
    if (suggestion.status !== "pending") {
      continue
    }

    const matches = findDocumentMatches(doc, suggestion.original_text, true)
    const firstMatch = matches[0]

    if (!firstMatch) {
      continue
    }

    decorations.push(
      Decoration.inline(firstMatch.from, firstMatch.to, {
        class: "pub-suggestion-pending",
      }),
    )
  }

  if (decorations.length === 0) {
    return DecorationSet.empty
  }

  return DecorationSet.create(doc, decorations)
}

export const setPublicationSuggestions = (
  editor: TiptapEditor,
  suggestions: PublicationSuggestion[],
) => {
  const transaction = editor.state.tr
  transaction.setMeta(publicationSuggestionPluginKey, suggestions)
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

export const clearPublicationSuggestions = (
  editor: TiptapEditor,
) => {
  const transaction = editor.state.tr
  transaction.setMeta(publicationSuggestionPluginKey, { clear: true })
  transaction.setMeta("addToHistory", false)
  editor.view.dispatch(transaction)
}

export const PublicationSuggestionExtension = Extension.create({
  name: "publicationSuggestions",

  addProseMirrorPlugins() {
    return [
      new Plugin<PublicationSuggestion[]>({
        key: publicationSuggestionPluginKey,
        state: {
          init: () => [],
          apply: (transaction, pluginState) => {
            const meta = transaction.getMeta(publicationSuggestionPluginKey)

            if (meta?.clear) {
              return []
            }

            if (Array.isArray(meta)) {
              return meta
            }

            return pluginState
          },
        },
        props: {
          decorations(state) {
            const pluginState = publicationSuggestionPluginKey.getState(state)

            if (!pluginState || pluginState.length === 0) {
              return null
            }

            return buildPublicationDecorations(state.doc, pluginState)
          },
        },
      }),
    ]
  },
})
