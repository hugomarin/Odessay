import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"
import { isSuggestionAcceptDisabled } from "@/lib/editor/suggestion-engine"

type PublicationSuggestionPluginState = {
  suggestions: PublicationSuggestion[]
  activeSuggestionId: string | null
  decorations: DecorationSet
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
  const isStale = isSuggestionAcceptDisabled(suggestion)
  const anchor = document.createElement("span")
  anchor.className = "pub-suggestion-bubble-anchor"
  anchor.contentEditable = "false"

  const bubble = document.createElement("span")
  bubble.className = "pub-suggestion-bubble"
  bubble.dataset.suggestionId = suggestion.id
  if (isStale) {
    bubble.classList.add("pub-suggestion-bubble-stale")
  }

  const label = document.createElement("span")
  label.className = "pub-suggestion-bubble-label"
  label.textContent = suggestion.replacement_text

  const accept = document.createElement("button")
  accept.type = "button"
  accept.className = "pub-suggestion-bubble-action pub-suggestion-bubble-accept"
  accept.setAttribute("aria-label", "Aceptar")
  accept.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`
  accept.dataset.action = "accept"
  accept.dataset.suggestionId = suggestion.id
  if (isStale) {
    accept.disabled = true
    accept.title = "Recalculando…"
  }

  const reject = document.createElement("button")
  reject.type = "button"
  reject.className = "pub-suggestion-bubble-action"
  reject.setAttribute("aria-label", "Rechazar")
  reject.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>`
  reject.dataset.action = "reject"
  reject.dataset.suggestionId = suggestion.id

  bubble.append(label, accept, reject)
  anchor.append(bubble)

  return anchor
}

const buildPublicationDecorations = (doc: ProseMirrorNode, pluginState: PublicationSuggestionPluginState): DecorationSet => {
  const resolvedSuggestions = resolveCorrectionDecorationRanges(doc, pluginState.suggestions)
  const decorations: Decoration[] = []

  for (const { suggestion, from, to } of resolvedSuggestions) {
    decorations.push(
      Decoration.inline(from, to, {
        class: suggestion.status === "pending-stale" ? "pub-suggestion-pending pub-suggestion-stale" : "pub-suggestion-pending",
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
            decorations: DecorationSet.empty,
          }),
          apply: (transaction, pluginState) => {
            const meta = transaction.getMeta(publicationSuggestionPluginKey) as PublicationSuggestionMeta | undefined
            const mappedDecorations = transaction.docChanged
              ? pluginState.decorations.map(transaction.mapping, transaction.doc)
              : pluginState.decorations

            if (!Array.isArray(meta) && meta && "clear" in meta) {
              return {
                suggestions: [],
                activeSuggestionId: null,
                decorations: DecorationSet.empty,
              }
            }

            if (Array.isArray(meta)) {
              const nextIds = new Set(meta.map((suggestion) => suggestion.id))
              const activeSuggestionId = pluginState.activeSuggestionId && nextIds.has(pluginState.activeSuggestionId)
                ? pluginState.activeSuggestionId
                : null
              const nextPluginState = {
                suggestions: meta,
                activeSuggestionId,
                decorations: mappedDecorations,
              }

              return {
                ...nextPluginState,
                decorations: buildPublicationDecorations(transaction.doc, nextPluginState),
              }
            }

            if (meta && "activeSuggestionId" in meta) {
              const nextPluginState = {
                ...pluginState,
                activeSuggestionId: meta.activeSuggestionId,
                decorations: mappedDecorations,
              }

              return {
                ...nextPluginState,
                decorations: buildPublicationDecorations(transaction.doc, nextPluginState),
              }
            }

            return mappedDecorations === pluginState.decorations
              ? pluginState
              : {
                  ...pluginState,
                  decorations: mappedDecorations,
                }
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

            if (!pluginState || pluginState.decorations === DecorationSet.empty) {
              return null
            }

            return pluginState.decorations
          },
        },
      }),
    ]
  },
})
