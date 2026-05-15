import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"

type PublicationSuggestionPluginState = {
  suggestions: PublicationSuggestion[]
  activeSuggestionId: string | null
}

type PublicationSuggestionMeta =
  | PublicationSuggestion[]
  | { clear: true }
  | { activeSuggestionId: string | null }

export const publicationSuggestionPluginKey = new PluginKey<PublicationSuggestionPluginState>("odessay-publication-suggestions")

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

const buildPublicationDecorations = (doc: ProseMirrorNode, pluginState: PublicationSuggestionPluginState): DecorationSet => {
  const resolvedSuggestions = resolveCorrectionDecorationRanges(doc, pluginState.suggestions)
  const decorations: Decoration[] = []

  for (const { suggestion, from, to } of resolvedSuggestions) {
    decorations.push(
      Decoration.inline(from, to, {
        class: "pub-suggestion-pending",
        "data-suggestion-id": suggestion.id,
        "data-replacement": suggestion.replacement_text,
      }),
    )

    if (pluginState.activeSuggestionId === suggestion.id) {
      decorations.push(
        Decoration.widget(to, () => createSuggestionWidget(suggestion), {
          key: `publication-suggestion-widget-${suggestion.id}`,
          side: 1,
        }),
      )
    }
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

const setActivePublicationSuggestion = (
  view: EditorView,
  activeSuggestionId: string | null,
) => {
  const transaction = view.state.tr
  transaction.setMeta(publicationSuggestionPluginKey, { activeSuggestionId })
  transaction.setMeta("addToHistory", false)
  view.dispatch(transaction)
}

export const PublicationSuggestionExtension = Extension.create({
  name: "publicationSuggestions",

  addProseMirrorPlugins() {
    return [
      new Plugin<PublicationSuggestionPluginState>({
        key: publicationSuggestionPluginKey,
        state: {
          init: () => ({
            suggestions: [],
            activeSuggestionId: null,
          }),
          apply: (transaction, pluginState) => {
            const meta = transaction.getMeta(publicationSuggestionPluginKey) as PublicationSuggestionMeta | undefined

            if (!Array.isArray(meta) && meta && "clear" in meta) {
              return {
                suggestions: [],
                activeSuggestionId: null,
              }
            }

            if (Array.isArray(meta)) {
              const nextIds = new Set(meta.map((suggestion) => suggestion.id))

              return {
                suggestions: meta,
                activeSuggestionId: pluginState.activeSuggestionId && nextIds.has(pluginState.activeSuggestionId)
                  ? pluginState.activeSuggestionId
                  : null,
              }
            }

            if (meta && "activeSuggestionId" in meta) {
              return {
                ...pluginState,
                activeSuggestionId: meta.activeSuggestionId,
              }
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
            keydown(view, event) {
              if (event.key !== "Escape") {
                return false
              }

              const pluginState = publicationSuggestionPluginKey.getState(view.state)

              if (!pluginState?.activeSuggestionId) {
                return false
              }

              setActivePublicationSuggestion(view, null)
              return false
            },
            click(view, event) {
              const target = event.target as HTMLElement | null
              const actionButton = target?.closest<HTMLButtonElement>(".pub-suggestion-bubble-action")

              if (actionButton) {
                const action = actionButton.dataset.action
                const suggestionId = actionButton.dataset.suggestionId

                if ((action !== "accept" && action !== "reject") || !suggestionId) {
                  return false
                }

                event.preventDefault()
                dispatchSuggestionAction(actionButton, action, suggestionId)
                setActivePublicationSuggestion(view, null)
                return true
              }

              const decoratedRange = target?.closest<HTMLElement>("[data-suggestion-id]")
              const suggestionId = decoratedRange?.dataset.suggestionId

              if (suggestionId) {
                setActivePublicationSuggestion(view, suggestionId)
                return false
              }

              const pluginState = publicationSuggestionPluginKey.getState(view.state)

              if (pluginState?.activeSuggestionId) {
                setActivePublicationSuggestion(view, null)
              }

              return false
            },
          },
          decorations(state) {
            const pluginState = publicationSuggestionPluginKey.getState(state)

            if (!pluginState || pluginState.suggestions.length === 0) {
              return null
            }

            return buildPublicationDecorations(state.doc, pluginState)
          },
        },
      }),
    ]
  },
})
