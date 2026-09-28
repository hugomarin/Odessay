"use client"

/**
 * La salida del documento activo del editor: el protocolo
 * `prepareDocumentExit` (volcado de la edición en cola, snapshot del borrador
 * saliente y vista del workspace), sus dos pasos internos
 * (`snapshotOutgoingDraftContent` y `persistCurrentWorkspaceViewState`) y el
 * cleanup de desmontaje que cancela las colas pendientes y guarda la vista.
 *
 * ODE-605 — corte 5, paso 2 de `components/editor/editor-shell.tsx`. Es una
 * MUDANZA MECÁNICA: los cuerpos son los que vivían en la shell, con las
 * mismas dependencias, y la propiedad del estado NO cambia: el estado y los
 * refs siguen siendo de la shell y llegan aquí por `input` (identidades
 * estables, así que la memoización no cambia). El helper puro de la shell
 * (`readMarkdownSelectionForActiveDocument`) llega por `input` para no crear
 * un ciclo de imports, como en ODE-587.
 *
 * Reglas del corte:
 * - El ref, nunca un snapshot de `.current`: `persistCurrentWorkspaceViewState`
 *   y el cleanup de desmontaje leen la fase de hidratación y la identidad
 *   vigentes.
 * - El orden de efectos no cambia: este hook se llama donde estaba el efecto
 *   de unmount de la shell (después de la suscripción a sync y antes de
 *   `applyMarkdownFromPanel`), así que su cleanup sigue corriendo después del
 *   volcado de `useEditorPersistence` (ODE-573).
 * - La red de ODE-604/ODE-567/ODE-600/ODE-624 pasa idéntica; la mutación de
 *   `flushQueuedRichModeUpdate` en `prepareDocumentExit` la pone roja
 *   (`tests/editor-shell-exit-protocol.test.tsx`, bloque DOC-05).
 */
import { useCallback, useEffect, type RefObject } from "react"
import type { Editor } from "@tiptap/react"

import type { HydrationPhase } from "@/hooks/useDocumentHydration"
import type { MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { getEditorSessionState, saveTabViewState } from "@/lib/stores/editor-session-store"

type OwnedMarkdownSelectionSnapshot = MarkdownSelectionSnapshot & {
  writingId: string
}

type MarkdownSelectionRead = {
  selection: MarkdownSelectionSnapshot | null
  belongsToOtherDocument: boolean
}

/**
 * La cola de restauración diferida de selección markdown. Se expone aquí
 * porque el contrato de `input` la expone; la shell importa el tipo.
 */
export type PendingMarkdownSelection = {
  start: number
  end: number
  writingId: string
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
}

export type DocumentExitInput = {
  correctionToastDismissRef: RefObject<number | null>
  currentWritingIdRef: RefObject<string | null>
  draftContentSnapshotRef: RefObject<{ draftId: string; bodyJson: Record<string, unknown> } | null>
  editor: Editor | null
  ephemeralDraftWritingIdRef: RefObject<string | null>
  flushQueuedRichModeUpdate: () => void
  hydrationPhaseRef: RefObject<HydrationPhase>
  markdownSaveTimeoutRef: RefObject<number | null>
  markdownSelectionRafRef: RefObject<number | null>
  markdownSelectionRef: RefObject<OwnedMarkdownSelectionSnapshot | null>
  markdownTextareaRef: RefObject<HTMLTextAreaElement | null>
  modeRef: RefObject<"rich" | "markdown">
  pendingMarkdownSelectionRef: RefObject<PendingMarkdownSelection | null>
  readMarkdownSelectionForActiveDocument: (
    cached: OwnedMarkdownSelectionSnapshot | null,
    activeWritingId: string | null,
    source?: string,
  ) => MarkdownSelectionRead
  richUpdateDebounceRef: RefObject<number | null>
  richUpdateEditorRef: RefObject<Editor | null>
  richUpdateRafRef: RefObject<number | null>
}

export function useDocumentExit(input: DocumentExitInput) {
  const {
    correctionToastDismissRef,
    currentWritingIdRef,
    draftContentSnapshotRef,
    editor,
    ephemeralDraftWritingIdRef,
    flushQueuedRichModeUpdate,
    hydrationPhaseRef,
    markdownSaveTimeoutRef,
    markdownSelectionRafRef,
    markdownSelectionRef,
    markdownTextareaRef,
    modeRef,
    pendingMarkdownSelectionRef,
    readMarkdownSelectionForActiveDocument,
    richUpdateDebounceRef,
    richUpdateEditorRef,
    richUpdateRafRef,
  } = input

  // Captures the still-blank draft's live content right before leaving it, so
  // the "no active document" effect can restore it on return instead of
  // wiping it (ODE-478 case 4). No-op when the outgoing tab isn't the draft.
  const snapshotOutgoingDraftContent = useCallback(() => {
    if (currentWritingIdRef.current || !editor || !ephemeralDraftWritingIdRef.current) {
      return
    }
    draftContentSnapshotRef.current = {
      draftId: ephemeralDraftWritingIdRef.current,
      bodyJson: editor.getJSON() as Record<string, unknown>,
    }
  }, [currentWritingIdRef, draftContentSnapshotRef, editor, ephemeralDraftWritingIdRef])

  const persistCurrentWorkspaceViewState = useCallback(() => {
    // ODE-624: mientras la hidratación del documento activo no terminó, lo que
    // hay en el editor todavía no es la vista del documento. `setContent` dejó
    // el cursor al final y el scroll/selección del documento se restauran en
    // frames diferidos; `hydrationPhase` sigue en "loading" hasta que esos
    // frames corren — rich mode llama a `finishHydration` (la única transición
    // a "ready") dentro del segundo frame, después de aplicar los scrolls
    // (`useDocumentHydration.ts`), y markdown en el `onSettled` del restore,
    // tras sus re-aplicaciones. Guardar aquí la vista previa a restaurar pisa
    // la vista propia que la pestaña ya tenía (hallazgo de ODE-600).
    // El ref, no el estado: este callback es de larga vida (cleanup de
    // unmount) y no debe recrearse con cada transición de fase.
    if (hydrationPhaseRef.current !== "ready") {
      return
    }

    const tabId = currentWritingIdRef.current ?? EDITOR_DRAFT_TAB_ID
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    const shellViewport = document.querySelector<HTMLElement>("main")
    const currentTab = getEditorSessionState().session.tabs.find((tab) => tab.id === tabId)
    const markdownSelection = readMarkdownSelectionForActiveDocument(
      markdownSelectionRef.current,
      currentWritingIdRef.current,
    )

    saveTabViewState({
      tabId,
      viewState: {
        mode: modeRef.current,
        scrollTop: editorViewport?.scrollTop ?? 0,
        scrollLeft: editorViewport?.scrollLeft ?? 0,
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
        shellScrollTop: shellViewport?.scrollTop ?? 0,
        shellScrollLeft: shellViewport?.scrollLeft ?? 0,
        selectionFrom: modeRef.current === "rich" && editor ? editor.state.selection.from : null,
        selectionTo: modeRef.current === "rich" && editor ? editor.state.selection.to : null,
        markdownSelectionStart:
          modeRef.current === "markdown"
            ? markdownSelection.selection?.start ??
              (markdownSelection.belongsToOtherDocument
                ? currentTab?.view_state?.markdownSelectionStart ?? null
                : markdownTextareaRef.current?.selectionStart ?? null)
            : null,
        markdownSelectionEnd:
          modeRef.current === "markdown"
            ? markdownSelection.selection?.end ??
              (markdownSelection.belongsToOtherDocument
                ? currentTab?.view_state?.markdownSelectionEnd ?? null
                : markdownTextareaRef.current?.selectionEnd ?? null)
            : null,
      },
    })
  }, [
    currentWritingIdRef,
    editor,
    hydrationPhaseRef,
    markdownSelectionRef,
    markdownTextareaRef,
    modeRef,
    readMarkdownSelectionForActiveDocument,
  ])

  /**
   * Protocolo de salida del documento activo (ADR documento activo, Hecho 4;
   * Fase 1 — ODE-567). Antes estaba copiado en cada handler de transición.
   *
   * Los tres pasos son explícitos porque hoy NO todas las transiciones hacen
   * los mismos, y la Fase 1 es una mudanza, no un cambio de comportamiento:
   * cada sitio declara lo que ya hacía. Uniformizarlos es una decisión aparte.
   * Va separado de `activateDocument` porque algunas transiciones (cerrar,
   * abrir) salen ANTES de un `await` y activan DESPUÉS.
   */
  const prepareDocumentExit = useCallback(
    (steps: { flushPendingEdit: boolean; snapshotDraft: boolean; saveViewState: boolean }) => {
      // La edición en cola todavía apunta al editor del documento saliente:
      // volcarla antes de que cambie la identidad (ODE-478 caso 2).
      if (steps.flushPendingEdit) {
        flushQueuedRichModeUpdate()
      }
      if (steps.snapshotDraft) {
        snapshotOutgoingDraftContent()
      }
      if (steps.saveViewState) {
        persistCurrentWorkspaceViewState()
      }
    },
    [flushQueuedRichModeUpdate, persistCurrentWorkspaceViewState, snapshotOutgoingDraftContent],
  )

  useEffect(() => {
    return () => {
      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      if (richUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(richUpdateRafRef.current)
      }

      if (richUpdateDebounceRef.current !== null) {
        window.clearTimeout(richUpdateDebounceRef.current)
      }

      if (markdownSelectionRafRef.current !== null) {
        window.cancelAnimationFrame(markdownSelectionRafRef.current)
      }

      // El timer del toast lo arma `showCorrectionToast` (useCorrectionActions)
      // en cualquier momento; hay que leer su valor al desmontar, no al montar.
      if (correctionToastDismissRef.current !== null) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        window.clearTimeout(correctionToastDismissRef.current)
      }

      richUpdateRafRef.current = null
      richUpdateDebounceRef.current = null
      richUpdateEditorRef.current = null
      markdownSelectionRafRef.current = null
      pendingMarkdownSelectionRef.current = null
      persistCurrentWorkspaceViewState()
    }
  }, [
    correctionToastDismissRef,
    markdownSaveTimeoutRef,
    markdownSelectionRafRef,
    persistCurrentWorkspaceViewState,
    pendingMarkdownSelectionRef,
    richUpdateDebounceRef,
    richUpdateEditorRef,
    richUpdateRafRef,
  ])

  return { prepareDocumentExit }
}
