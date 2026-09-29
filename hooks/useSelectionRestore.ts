"use client"

/**
 * La restauración diferida de la selección markdown del editor: la cola que
 * coalesce las solicitudes (la última gana) y las aplica en un frame de
 * animación, con la re-aplicación de los scrolls un frame después, más la
 * identidad por documento de la selección cacheada.
 *
 * ODE-607 — corte 6, paso 1 de `components/editor/editor-shell.tsx`.
 * MUDANZA MECÁNICA, como ODE-602/603/605: el cuerpo de
 * `queueMarkdownSelectionRestore` es el que vivía en la shell, con las mismas
 * dependencias (`[]`), y la propiedad del estado NO cambia: el estado y los
 * refs siguen siendo de la shell y llegan por `input` (identidades estables,
 * así que la memoización no cambia). El hook se llama donde estaba el
 * `useCallback`, así que el orden de efectos no cambia.
 *
 * Los helpers puros (`markdownSelectionOwnerId` y
 * `readMarkdownSelectionForActiveDocument`) viven aquí y la shell los importa:
 * los sigue usando fuera de la cola (comandos, find/replace, la salida de
 * documento, link, imagen y el panel de notas), así que no se duplican.
 *
 * Red: `tests/editor-shell-selection-restore.test.tsx` (STATE-06/07, ODE-625)
 * y `tests/editor-shell-markdown-hydration-coalesce.test.tsx` (ODE-582; la
 * cola encadena los `onSettled` al coalescer) pasan idénticas antes y después
 * de esta mudanza.
 */
import { useCallback, type RefObject } from "react"

import type { PendingMarkdownSelection } from "@/hooks/useDocumentExit"
import type { MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { getEditorSessionState } from "@/lib/stores/editor-session-store"

export type OwnedMarkdownSelectionSnapshot = MarkdownSelectionSnapshot & {
  writingId: string
}

export type MarkdownSelectionRead = {
  selection: MarkdownSelectionSnapshot | null
  belongsToOtherDocument: boolean
}

export const markdownSelectionOwnerId = (writingId: string | null) => writingId ?? EDITOR_DRAFT_TAB_ID

export function readMarkdownSelectionForActiveDocument(
  cached: OwnedMarkdownSelectionSnapshot | null,
  activeWritingId: string | null,
  source?: string,
): MarkdownSelectionRead {
  const ownerId = markdownSelectionOwnerId(activeWritingId)
  if (!cached || cached.writingId === ownerId) {
    return { selection: cached, belongsToOtherDocument: false }
  }

  // A cached selection belongs to a different document. Use the active tab's
  // own saved selection while its deferred restore is pending; never fall back
  // to the shared textarea's selection, which can still hold the prior tab's
  // range.
  const viewState = getEditorSessionState().session.tabs.find((tab) => tab.id === ownerId)?.view_state
  const start = viewState?.markdownSelectionStart
  const end = viewState?.markdownSelectionEnd
  if (typeof start === "number" && typeof end === "number") {
    return {
      selection: { start, end, text: source?.slice(start, end) ?? "" },
      belongsToOtherDocument: true,
    }
  }

  return { selection: null, belongsToOtherDocument: true }
}

export type SelectionRestoreInput = {
  currentWritingIdRef: RefObject<string | null>
  markdownSelectionRafRef: RefObject<number | null>
  markdownSelectionRef: RefObject<OwnedMarkdownSelectionSnapshot | null>
  markdownTextareaRef: RefObject<HTMLTextAreaElement | null>
  pendingMarkdownSelectionRef: RefObject<PendingMarkdownSelection | null>
}

export function useSelectionRestore(input: SelectionRestoreInput) {
  const {
    currentWritingIdRef,
    markdownSelectionRafRef,
    markdownSelectionRef,
    markdownTextareaRef,
    pendingMarkdownSelectionRef,
  } = input

  const queueMarkdownSelectionRestore = useCallback(
    (
      start: number,
      end: number,
      options?: {
        scrollTop?: number
        scrollLeft?: number
        editorScrollTop?: number
        editorScrollLeft?: number
        shellScrollTop?: number
        shellScrollLeft?: number
        windowScrollX?: number
        windowScrollY?: number
        isStillValid?: () => boolean
        onSettled?: () => void
      },
    ) => {
      const writingId = markdownSelectionOwnerId(currentWritingIdRef.current)
      const requestedIsStillValid = options?.isStillValid
      const isStillValid = () =>
        markdownSelectionOwnerId(currentWritingIdRef.current) === writingId &&
        (!requestedIsStillValid || requestedIsStillValid())

      // The latest selection wins, but a pending completion callback is never
      // dropped with the request it came with: hydration finishes through
      // this queue (`onSettled: finishHydration`), and a plain restore
      // coalescing over it used to leave the phase on "loading" (ODE-582).
      // Only callbacks carry over; each request keeps its own validity check.
      const supersededOnSettled = pendingMarkdownSelectionRef.current?.onSettled
      const onSettled =
        supersededOnSettled && options?.onSettled
          ? () => {
              supersededOnSettled()
              options.onSettled?.()
            }
          : supersededOnSettled ?? options?.onSettled
      pendingMarkdownSelectionRef.current = { start, end, ...options, writingId, isStillValid, onSettled }

      if (markdownSelectionRafRef.current !== null) {
        return
      }

      markdownSelectionRafRef.current = window.requestAnimationFrame(() => {
        markdownSelectionRafRef.current = null

        const pendingSelection = pendingMarkdownSelectionRef.current
        pendingMarkdownSelectionRef.current = null

        if (!pendingSelection) {
          return
        }

        // Checked at fire time, not schedule time: the document this
        // restore was queued for may no longer be current by the time this
        // frame actually runs (see the ref's own comment above).
        if (pendingSelection.isStillValid && !pendingSelection.isStillValid()) {
          pendingSelection.onSettled?.()
          return
        }

        const nextTextarea = markdownTextareaRef.current

        if (!nextTextarea) {
          pendingSelection.onSettled?.()
          return
        }

        if (document.activeElement !== nextTextarea) {
          nextTextarea.focus()
        }

        if (nextTextarea.selectionStart !== pendingSelection.start || nextTextarea.selectionEnd !== pendingSelection.end) {
          nextTextarea.setSelectionRange(pendingSelection.start, pendingSelection.end)
        }

        if (typeof pendingSelection.scrollTop === "number") {
          nextTextarea.scrollTop = pendingSelection.scrollTop
        }

        if (typeof pendingSelection.scrollLeft === "number") {
          nextTextarea.scrollLeft = pendingSelection.scrollLeft
        }

        // Each scroll target re-applies itself a second frame later (layout
        // can still settle after the first write) — that second write is
        // the true "last write wins" moment, so it needs the same validity
        // re-check (time has passed since the outer frame ran) and is what
        // onSettled must actually wait for, not the outer frame itself.
        let pendingNestedFrames = 0
        const scheduleNestedApply = (apply: () => void) => {
          pendingNestedFrames += 1
          window.requestAnimationFrame(() => {
            if (!pendingSelection.isStillValid || pendingSelection.isStillValid()) {
              apply()
            }
            pendingNestedFrames -= 1
            if (pendingNestedFrames === 0) {
              pendingSelection.onSettled?.()
            }
          })
        }

        const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')

        if (
          editorViewport &&
          (typeof pendingSelection.editorScrollTop === "number" || typeof pendingSelection.editorScrollLeft === "number")
        ) {
          const applyViewportScroll = () => {
            if (typeof pendingSelection.editorScrollTop === "number") {
              editorViewport.scrollTop = pendingSelection.editorScrollTop
            }

            if (typeof pendingSelection.editorScrollLeft === "number") {
              editorViewport.scrollLeft = pendingSelection.editorScrollLeft
            }
          }

          applyViewportScroll()
          scheduleNestedApply(applyViewportScroll)
        }

        const shellViewport = document.querySelector<HTMLElement>("main")
        if (
          shellViewport &&
          (typeof pendingSelection.shellScrollTop === "number" || typeof pendingSelection.shellScrollLeft === "number")
        ) {
          const applyShellScroll = () => {
            if (typeof pendingSelection.shellScrollTop === "number") {
              shellViewport.scrollTop = pendingSelection.shellScrollTop
            }

            if (typeof pendingSelection.shellScrollLeft === "number") {
              shellViewport.scrollLeft = pendingSelection.shellScrollLeft
            }
          }

          applyShellScroll()
          scheduleNestedApply(applyShellScroll)
        }

        if (typeof pendingSelection.windowScrollX === "number" || typeof pendingSelection.windowScrollY === "number") {
          const applyWindowScroll = () => {
            window.scrollTo(
              typeof pendingSelection.windowScrollX === "number" ? pendingSelection.windowScrollX : window.scrollX,
              typeof pendingSelection.windowScrollY === "number" ? pendingSelection.windowScrollY : window.scrollY,
            )
          }

          applyWindowScroll()
          scheduleNestedApply(applyWindowScroll)
        }

        markdownSelectionRef.current = {
          start: pendingSelection.start,
          end: pendingSelection.end,
          text: nextTextarea.value.slice(pendingSelection.start, pendingSelection.end),
          writingId: pendingSelection.writingId,
        }

        // No scroll target was scheduled (a plain selection-only restore) —
        // this frame's write was the last one, so settle now.
        if (pendingNestedFrames === 0) {
          pendingSelection.onSettled?.()
        }
      })
    },
    [],
  )

  return { queueMarkdownSelectionRestore }
}
