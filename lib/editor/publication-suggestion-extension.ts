import { Extension } from "@tiptap/core"
import type { Editor as TiptapEditor } from "@tiptap/core"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import type { PublicationSuggestion } from "@/lib/local-db/schema"
import { resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"
import { isSuggestionAcceptDisabled } from "@/lib/editor/suggestion-engine"
import { resolveBubblePlacement } from "@/lib/editor/suggestion-bubble-position"

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
  action: "accept" | "reject" | "learn",
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

const canLearnWord = (suggestion: PublicationSuggestion) =>
  suggestion.kind === "spelling" &&
  (
    suggestion.mechanical_type == null ||
    suggestion.mechanical_type === "spelling" ||
    suggestion.mechanical_type === "accent"
  )

const CIRCLE_CHECK_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m9 12 2 2 4-4"/></svg>`
const CIRCLE_X_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="m15 9-6 6"/><path d="m9 9 6 6"/></svg>`
const CIRCLE_PLUS_ICON = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><path d="M8 12h8"/><path d="M12 8v8"/></svg>`

/** The sheet the bubble must stay inside, newest shell class first. */
const SHEET_SELECTORS = [".odessay-editor-sheet-frame", ".odessay-editor-content"]

const findSheet = (node: HTMLElement): HTMLElement | null => {
  for (const selector of SHEET_SELECTORS) {
    const sheet = node.closest<HTMLElement>(selector)
    if (sheet) return sheet
  }
  return null
}

/**
 * Measures the bubble against the sheet and flips or nudges it so it never gets
 * clipped. Only one bubble is alive at a time (the active suggestion), so a
 * single scroll listener covers the whole document.
 */
const attachBubblePositioning = (anchor: HTMLElement, bubble: HTMLElement) => {
  let frame = 0
  let disposed = false

  const measure = () => {
    frame = 0
    if (disposed || !bubble.isConnected) return

    const sheet = findSheet(anchor)
    if (!sheet) return

    // Measure from a clean slate so a previous correction does not feed back in.
    bubble.style.setProperty("--pub-bubble-dx", "0px")
    bubble.classList.remove("pub-suggestion-bubble-below")

    const placement = resolveBubblePlacement(
      bubble.getBoundingClientRect(),
      sheet.getBoundingClientRect(),
    )

    if (placement.flip) {
      bubble.classList.add("pub-suggestion-bubble-below")
    }
    if (placement.dx !== 0) {
      bubble.style.setProperty("--pub-bubble-dx", `${Math.round(placement.dx)}px`)
    }
  }

  const schedule = () => {
    if (disposed || frame !== 0) return
    frame = requestAnimationFrame(measure)
  }

  schedule()
  // Capture phase so any scrollable ancestor reaches us, not just the window.
  window.addEventListener("scroll", schedule, { passive: true, capture: true })
  window.addEventListener("resize", schedule, { passive: true })

  return () => {
    disposed = true
    if (frame !== 0) cancelAnimationFrame(frame)
    window.removeEventListener("scroll", schedule, { capture: true })
    window.removeEventListener("resize", schedule)
  }
}

const bubbleCleanups = new WeakMap<HTMLElement, () => void>()

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
  accept.innerHTML = CIRCLE_CHECK_ICON
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
  reject.innerHTML = CIRCLE_X_ICON
  reject.dataset.action = "reject"
  reject.dataset.suggestionId = suggestion.id

  if (canLearnWord(suggestion)) {
    const learn = document.createElement("button")
    learn.type = "button"
    learn.className = "pub-suggestion-bubble-action pub-suggestion-bubble-learn"
    learn.setAttribute("aria-label", "Learn word")
    learn.setAttribute("title", "Learn word")
    learn.innerHTML = CIRCLE_PLUS_ICON
    learn.dataset.action = "learn"
    learn.dataset.suggestionId = suggestion.id
    bubble.append(label, accept, reject, learn)
  } else {
    bubble.append(label, accept, reject)
  }
  anchor.append(bubble)
  bubbleCleanups.set(anchor, attachBubblePositioning(anchor, bubble))

  return anchor
}

const destroySuggestionWidget = (node: Node) => {
  if (!(node instanceof HTMLElement)) return
  const cleanup = bubbleCleanups.get(node)
  if (cleanup) {
    cleanup()
    bubbleCleanups.delete(node)
  }
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
          destroy: destroySuggestionWidget,
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

                if ((action !== "accept" && action !== "reject" && action !== "learn") || !suggestionId) {
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
