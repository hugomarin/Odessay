import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"

export const publicationSuggestionPluginKey = new PluginKey<PublicationSuggestion[]>("odessay-publication-suggestions")

const dispatchSuggestionAction = (
  target: HTMLElement,
  action: "accept" | "reject",
  suggestionId: string,
) => {
  target.dispatchEvent(
    new CustomEvent("odessay:publication-suggestion-action", {
      bubbles: true,
      composed: true,
      detail: {
        action,
        suggestionId,
      },
    }),
  )
}

const createSuggestionWidget = (suggestion: PublicationSuggestion) => {
  const widget = document.createElement("span")
  widget.className = "pub-suggestion-bubble"
  widget.dataset.suggestionId = suggestion.id
  widget.contentEditable = "false"

  const label = document.createElement("span")
  label.className = "pub-suggestion-bubble-label"
  label.textContent = suggestion.replacement_text

  const accept = document.createElement("button")
  accept.type = "button"
  accept.className = "pub-suggestion-bubble-action pub-suggestion-bubble-accept"
  accept.textContent = "Accept"
  accept.dataset.action = "accept"
  accept.dataset.suggestionId = suggestion.id

  const reject = document.createElement("button")
  reject.type = "button"
  reject.className = "pub-suggestion-bubble-action"
  reject.textContent = "Reject"
  reject.dataset.action = "reject"
  reject.dataset.suggestionId = suggestion.id

  widget.append(label, accept, reject)

  return widget
}

const buildPublicationDecorations = (doc: ProseMirrorNode, suggestions: PublicationSuggestion[]): DecorationSet => {
  const resolvedSuggestions = resolveCorrectionDecorationRanges(doc, suggestions)
  const decorations: Decoration[] = []

  for (const { suggestion, from, to } of resolvedSuggestions) {
    decorations.push(
      Decoration.inline(from, to, {
        class: "pub-suggestion-pending",
        "data-suggestion-id": suggestion.id,
        "data-replacement": suggestion.replacement_text,
      }),
      Decoration.widget(to, () => createSuggestionWidget(suggestion), {
        key: `publication-suggestion-widget-${suggestion.id}`,
        side: 1,
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
          handleDOMEvents: {
            mousedown(_view, event) {
              const target = event.target as HTMLElement | null

              if (target?.closest(".pub-suggestion-bubble")) {
                event.preventDefault()
                return true
              }

              return false
            },
            click(_view, event) {
              const target = event.target as HTMLElement | null
              const actionButton = target?.closest<HTMLButtonElement>(".pub-suggestion-bubble-action")

              if (!actionButton) {
                return false
              }

              const action = actionButton.dataset.action
              const suggestionId = actionButton.dataset.suggestionId

              if ((action !== "accept" && action !== "reject") || !suggestionId) {
                return false
              }

              event.preventDefault()
              dispatchSuggestionAction(actionButton, action, suggestionId)
              return true
            },
          },
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
