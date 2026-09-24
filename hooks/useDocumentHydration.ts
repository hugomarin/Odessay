"use client"

/**
 * Hidratación del documento activo del editor: aplica al editor, a los
 * metadatos y al viewport lo que el coordinador de hidratación resuelve.
 *
 * ODE-562 — primer corte de `components/editor/editor-shell.tsx`. Es una
 * MUDANZA MECÁNICA: el cuerpo del efecto es el mismo que vivía en la shell,
 * con las mismas dependencias, el mismo orden de `setState` y las mismas
 * guardas de generación. La propiedad del estado NO cambia: los refs espejo y
 * el estado siguen siendo de la shell y llegan aquí por `input`. Decidir qué
 * copia es canónica es el segundo tiempo, en otro issue.
 *
 * Reglas del corte (ver el issue):
 * - La shell llama a este hook en la misma posición que ocupaba el efecto:
 *   React ejecuta los efectos en orden de declaración, y moverlo cambiaría su
 *   orden respecto a los espejos y a la publicación de pestaña.
 * - Los refs llegan como `RefObject`, nunca como snapshot de `.current`: los
 *   callbacks diferidos (rAF, promesas) leen identidad viva por ellos.
 * - Sin acceso directo a la caché de bloques de corrección de `localDB`: la
 *   lectura y el borrado llegan inyectados desde la shell, donde esa deuda ya
 *   está declarada en el baseline. Moverla aquí la sacaría del radar; la
 *   regla `ui-no-direct-persistence` escanea `hooks/` para impedirlo.
 *
 * La decisión de hidratación (outcomes, retry, unified-open) no vive aquí: es
 * de `lib/editor/hydration-coordinator.ts`.
 */
import { useEffect, type Dispatch, type RefObject, type SetStateAction } from "react"
import type { Editor } from "@tiptap/react"

import { mapLocalSyncStatusToSaveState, type EditorSaveState } from "@/components/editor/save-state"
import {
  hydrateCorrectionBlocksFromRemote,
  persistCorrectionBlockRemotely,
  reconcileHydratedCorrectionBlocks,
} from "@/lib/corrections/persistence"
import { collectCorrectionBlocks, type CorrectionTriggerBlock } from "@/lib/editor/correction-trigger-plugin"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import type { EditorHydrationRecord } from "@/lib/editor/document-hydration"
import { EMPTY_EDITOR_JSON, getEditorMarkdown } from "@/lib/editor/extensions"
import { getEditorFootnotes, getMarkdownWithFootnoteDefinitions } from "@/lib/editor/footnote-node"
import { resolveHydrationOutcome } from "@/lib/editor/hydration-coordinator"
import type { createHydrationGenerationOwner, HydrationGeneration } from "@/lib/editor/hydration-generation"
import { resolveUnavailableWritingRecovery } from "@/lib/editor/hydration-session"
import { materializeMarkdownForRichParser, normalizeMarkdownForRoundTrip } from "@/lib/editor/markdown-format"
import { localDB } from "@/lib/local-db"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import type {
  ArtifactType,
  LocalCorrectionBlock,
  LocalEditorSessionTab,
  PublicationSuggestion,
  WritingLifecycle,
  WritingStatus,
  WritingVisibility,
} from "@/lib/local-db/schema"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { isUnifiedOpenEnabled, openDocumentByIdWithRetry } from "@/lib/services/open-document-factory"
import { getEditorSessionState, reconcileUnavailableWritingTab } from "@/lib/stores/editor-session-store"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

type Setter<T> = Dispatch<SetStateAction<T>>

type EditorMode = "rich" | "markdown"

type MarkdownSelectionRestoreOptions = {
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

/**
 * Cambio parcial de los metadatos del documento. Lo aplica el dueño único de
 * la shell (`applyDocumentMetadata`), que escribe estado y ref a la vez
 * (ODE-563).
 */
export type DocumentMetadataPatch = {
  title?: string
  hasExplicitTitle?: boolean
  version?: number
  createdAt?: string | null
  slug?: string | null
  status?: WritingStatus
  artifactType?: ArtifactType
  visibility?: WritingVisibility
  lifecycle?: WritingLifecycle
}

export type DocumentHydrationInput = {
  editor: Editor | null
  currentWritingId: string | null
  hydrationWritingId: string | null
  routeWritingId: string | null
  editorSession: { tabs: LocalEditorSessionTab[] }

  // Refs espejo que siguen siendo de la shell. Los de metadatos ya no llegan
  // aquí: se escriben por `applyDocumentMetadata` (ODE-563).
  modeRef: RefObject<EditorMode>
  isApplyingContentRef: RefObject<boolean>
  currentWritingIdRef: RefObject<string | null>
  hydrationGenerationOwnerRef: RefObject<ReturnType<typeof createHydrationGenerationOwner> | null>
  currentCanonicalPathRef: RefObject<string | null>
  desktopSessionRestoreTimingRef: RefObject<{ writingId: string; startedAt: number } | null>
  ephemeralDraftWritingIdRef: RefObject<string | null>
  draftContentSnapshotRef: RefObject<{ draftId: string; bodyJson: Record<string, unknown> } | null>
  suppressCorrectionAnalysisUntilRef: RefObject<number>

  setCurrentWritingId: Setter<string | null>
  setHydrationWritingId: Setter<string | null>
  setMode: Setter<EditorMode>
  setMarkdownValue: Setter<string>
  setBodyText: Setter<string>
  setSyncStatus: Setter<EditorSaveState>
  setIsBodyHydrating: Setter<boolean>
  /** Único camino para cambiar metadatos del documento (ODE-563). */
  applyDocumentMetadata: (patch: DocumentMetadataPatch) => void
  /** Este efecto solo limpia el aviso; nunca lo fija. */
  setExternalFileNotice: (notice: null) => void
  setCanonicalPath: Setter<string | null>

  updateDerivedEditorState: (editor: Editor) => void
  applyCorrectionSuggestionUpdate: (
    updater: (current: PublicationSuggestion[]) => PublicationSuggestion[],
    options?: { immediate?: boolean },
  ) => void
  flattenPersistedSuggestions: (blocks: LocalCorrectionBlock[]) => PublicationSuggestion[]
  admitCorrectionSuggestions: (
    candidates: PublicationSuggestion[],
    blocks?: CorrectionTriggerBlock[],
  ) => PublicationSuggestion[]
  flushPendingCorrectionBlocks: (writingId: string, generation?: HydrationGeneration) => Promise<void>
  queueMarkdownSelectionRestore: (
    start: number,
    end: number,
    options?: MarkdownSelectionRestoreOptions,
  ) => void
  setPersistedCorrectionBlocks: (blocks: LocalCorrectionBlock[]) => void
  readLocalCorrectionBlocks: (writingId: string) => Promise<LocalCorrectionBlock[]>
  deleteLocalCorrectionBlocks: (ids: string[]) => Promise<unknown>

  // Helpers de módulo de la shell, inyectados para no mover su cascada.
  replaceEditorHistory: (nextHref: string) => void
  untitledWritingTitle: string
  isExplicitWritingTitle: (title: string | null | undefined, bodyText: string, createdAt: string | null) => boolean
}

export function useDocumentHydration(input: DocumentHydrationInput): void {
  const {
    editor,
    currentWritingId,
    hydrationWritingId,
    routeWritingId,
    editorSession,
    modeRef,
    isApplyingContentRef,
    currentWritingIdRef,
    hydrationGenerationOwnerRef,
    currentCanonicalPathRef,
    desktopSessionRestoreTimingRef,
    ephemeralDraftWritingIdRef,
    draftContentSnapshotRef,
    suppressCorrectionAnalysisUntilRef,
    setCurrentWritingId,
    setHydrationWritingId,
    setMode,
    setMarkdownValue,
    setBodyText,
    setSyncStatus,
    setIsBodyHydrating,
    applyDocumentMetadata,
    setExternalFileNotice,
    setCanonicalPath,
    updateDerivedEditorState,
    applyCorrectionSuggestionUpdate,
    flattenPersistedSuggestions,
    admitCorrectionSuggestions,
    flushPendingCorrectionBlocks,
    queueMarkdownSelectionRestore,
    setPersistedCorrectionBlocks,
    readLocalCorrectionBlocks,
    deleteLocalCorrectionBlocks,
    replaceEditorHistory,
    untitledWritingTitle: UNTITLED_WRITING_TITLE,
    isExplicitWritingTitle,
  } = input

  useEffect(() => {
    if (!editor) {
      return
    }

    if (!currentWritingId) {
      // No tab is open — clear stale content so the editor never shows a previous
      // writing after the last tab is closed. `currentWritingId` is also null
      // while sitting on the still-blank draft, so before wiping, restore
      // whatever that draft held the last time it was left (captured by
      // handleSelectWorkspaceTab/handleCloseWorkspaceTab) instead of
      // discarding it — otherwise switching away and back erases in-progress
      // text that was never given a chance to save (ODE-478 case 4).
      const restorable =
        ephemeralDraftWritingIdRef.current &&
        draftContentSnapshotRef.current?.draftId === ephemeralDraftWritingIdRef.current
          ? draftContentSnapshotRef.current
          : null

      isApplyingContentRef.current = true
      editor.commands.setContent(restorable?.bodyJson ?? EMPTY_EDITOR_JSON)
      isApplyingContentRef.current = false
      updateDerivedEditorState(editor)
      applyDocumentMetadata({
        status: "draft",
        artifactType: "general",
        visibility: "private",
        title: UNTITLED_WRITING_TITLE,
        hasExplicitTitle: false,
        version: 1,
        createdAt: null,
        slug: null,
        lifecycle: "local-only",
      })
      setSyncStatus("saved")
      setExternalFileNotice(null)
      setPersistedCorrectionBlocks([])
      applyCorrectionSuggestionUpdate(() => [], { immediate: true })
      currentCanonicalPathRef.current = null
      setCanonicalPath(null)
      window.requestAnimationFrame(() => {
        editor.commands.focus("start")
      })
      return
    }

    updateDerivedEditorState(editor)

    if (!hydrationWritingId) {
      return
    }

    const targetWritingId = hydrationWritingId
    const generationOwner = hydrationGenerationOwnerRef.current!
    const generation = generationOwner.start(targetWritingId)

    // Marking hydration "done" flips `hydrationWritingId` to null, which is
    // this effect's own dependency — so calling it cancels this exact
    // generation (see the cleanup below) once React processes the state
    // update. The scroll/selection restore further down is deliberately
    // deferred a frame (twice, for rich mode; markdown mode's own queue has
    // its own deferred re-applies) so the DOM has settled after setContent;
    // calling finishHydration() before that deferred work has actually run
    // cancels its own generation out from under it, racing the still-queued
    // requestAnimationFrame callback against React's cleanup with no
    // ordering guarantee. Confirmed live (ODE-555): when the cleanup won
    // that race, `generation.run()` silently no-op'd and the scroll restore
    // was dropped in ~30-50% of runs, with no error and no other visible
    // symptom. Every path through `hydrateEditor` below must call this
    // exactly once — including its own failure paths (e.g. `open-error`,
    // ODE-555 follow-up) — synchronously when there's no deferred restore to
    // wait for, or from inside the deepest deferred callback that actually
    // performs one. (Paths that `return` on staleness, e.g. `outcomeResult.
    // status === "stale"`, are the one exception: staleness means a newer
    // generation already owns `hydrationWritingId`, so this one has nothing
    // left to clear.)
    const finishHydration = () => {
      generation.run(() => {
        const restoreTiming = desktopSessionRestoreTimingRef.current
        if (restoreTiming?.writingId === targetWritingId) {
          console.info(
            `[editor:session-restore] hydrated ${targetWritingId} duration_ms=${Math.round(performance.now() - restoreTiming.startedAt)}`,
          )
          desktopSessionRestoreTimingRef.current = null
        }
        setHydrationWritingId(null)
      })
    }

    const hydrateEditor = async () => {
      let hydratedWriting: EditorHydrationRecord | null = null
      const localCorrectionBlocksResult = await generation.runAsync(
        () => readLocalCorrectionBlocks(targetWritingId),
      )
      if (localCorrectionBlocksResult.status === "stale") return
      let localCorrectionBlocks = localCorrectionBlocksResult.value

      // openWriting handles local read + optional remote hydration in one call.
      // Skeleton surfaces only when the call takes longer than 200 ms.
      const skeletonTimer = setTimeout(() => {
        generation.run(() => {
          setIsBodyHydrating(true)
        })
      }, 200)

      // Recovers the tab for an unavailable/unopenable writing WITHOUT persisting
      // a new draft (invariant #10 / requirement 7): drop the invalid tab and
      // fall back to a sibling tab or an in-memory blank draft tab.
      const recoverUnavailableTab = () => {
        console.info(`[editor] unavailable writing ${targetWritingId}; reconciling session`)
        const reconciliation = reconcileUnavailableWritingTab(targetWritingId)
        const sessionTabs = getEditorSessionState().session.tabs
        const recovery = resolveUnavailableWritingRecovery(reconciliation, sessionTabs.map((tab) => ({
          id: tab.id,
          writingId: tab.writing_id,
          slug: tab.slug,
        })))
        setHydrationWritingId(null)

        if (recovery.status === "activate-writing") {
          currentWritingIdRef.current = recovery.writingId
          setCurrentWritingId(recovery.writingId)
          setHydrationWritingId(recovery.writingId)
          replaceEditorHistory(
            buildWritingRouteHref("/write", { id: recovery.writingId, slug: recovery.slug }),
          )
        } else if (recovery.status === "show-empty-editor") {
          currentWritingIdRef.current = null
          setCurrentWritingId(null)
          replaceEditorHistory("/write")
        }
      }

      // Unified opener (ODE-375 M3): every id entry point — Desk, Search,
      // Recent and the sidebar all navigate to /write?id= and funnel through
      // this hydration — resolves identity through the DocumentCatalog first
      // and consumes the opener's explicit outcomes. A `failed` outcome the
      // opener classified as retryable (ODE-454) rearms itself with a bounded
      // backoff + jitter — no click, navigation or web event involved — before
      // falling back. `orphaned`, an exhausted retry loop, or a terminal
      // `failed` recover the tab without a draft; `conflict` opens the local
      // copy (visible conflict UX is owned by ODE-373); `opened` continues to
      // content hydration below. The decision logic itself is the pure,
      // dependency-injected coordinator extracted in ODE-455 — this effect
      // only supplies the runtime adapters and reacts to its outcome.
      const outcomeResult = await generation.runAsync(() =>
        resolveHydrationOutcome(targetWritingId, {
          isDesktopRuntime,
          isUnifiedOpenEnabled,
          isCancelled: () => !generation.isCurrent(),
          openDocumentByIdWithRetry,
          openWriting: async (id) => (await getDocumentService()).openWriting(id),
          getLocalWriting: async (id) => {
            // Explicit translation, not structural reuse: the coordinator's
            // boundary is domain-shaped (HydrationLocalMetadata), not
            // storage-shaped — this adapter is where the IndexedDB/SQLite
            // column names (`canonical_path`, `sync_status`) stop.
            const localWriting = await localDB.writings.get(id)
            if (!localWriting) return null
            return {
              canonicalPath: localWriting.canonical_path,
              lifecycle: localWriting.lifecycle,
              syncStatus: localWriting.sync_status,
            }
          },
        }),
      )

      clearTimeout(skeletonTimer)
      generation.run(() => {
        setIsBodyHydrating(false)
      })

      // The generation owner checks the result again after every awaited
      // boundary. A document switch (A -> B) can land during unified open,
      // openWriting or local metadata; a late A result must never act on B's
      // session, editor, correction cache or route.
      if (outcomeResult.status === "stale") return
      const outcome = outcomeResult.value

      if (outcome.status === "unavailable") {
        if (outcome.source === "unified-open") {
          console.info(
            `[editor] unified-open unavailable documentId=${targetWritingId} status=${outcome.openStatus} reasonCode=${outcome.reasonCode} attempt=${outcome.attempt} next=unavailable`,
          )
        }
        recoverUnavailableTab()
        return
      }

      if (outcome.status === "open-error") {
        console.error(`[editor] openWriting failed for ${targetWritingId}`, outcome.error)
        finishHydration()
        return
      }

      hydratedWriting = outcome.record

      if (localCorrectionBlocks.length === 0) {
        try {
          const correctionBlocksResult = await generation.runAsync(
            () => hydrateCorrectionBlocksFromRemote(targetWritingId),
          )
          if (correctionBlocksResult.status === "stale") return
          localCorrectionBlocks = correctionBlocksResult.value
        } catch (error) {
          if (!generation.isCurrent()) return
          console.error(`[editor] correction hydration failed for ${targetWritingId}`, error)
          localCorrectionBlocks = []
        }
      } else {
        void flushPendingCorrectionBlocks(targetWritingId, generation)
      }

      if (!generation.isCurrent()) return

      if (hydratedWriting) {
        const { writing, canonicalPath, lifecycle: hydratedLifecycle, syncStatus: hydratedSyncStatus } =
          hydratedWriting
        // Local image node views resolve relative sources during setContent, so
        // the document path must be available before ProseMirror creates them.
        currentCanonicalPathRef.current = canonicalPath
        setCanonicalPath(canonicalPath)
        isApplyingContentRef.current = true
        // Load JSON first to get the markdown serialization, then re-parse as markdown
        // so that footnote references are converted to footnoteReference nodes.
        editor.commands.setContent(writing.content.richText ?? EMPTY_EDITOR_JSON)
        const serialized = isDesktopRuntime()
          ? desktopDocumentEngine.richToSource(editor)
          : null
        const loadedMarkdown = serialized?.success
          ? serialized.markdown
          : normalizeMarkdownForRoundTrip(
              getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
            )
        if (loadedMarkdown) {
          const parsed = isDesktopRuntime() ? desktopDocumentEngine.sourceToRich(loadedMarkdown) : null
          editor.commands.setContent(
            parsed?.success ? parsed.snapshot.bodyJson : materializeMarkdownForRichParser(loadedMarkdown),
          )
        }
        isApplyingContentRef.current = false
        const currentDocBlocks = collectCorrectionBlocks(editor.state.doc)
        const hydratedReconciliation = reconcileHydratedCorrectionBlocks(
          localCorrectionBlocks,
          currentDocBlocks.map((block) => block.hash),
        )

        if (hydratedReconciliation.stale.length > 0) {
          const staleIds = hydratedReconciliation.stale.map((block) => block.id)

          const deleteResult = await generation.runAsync(() => deleteLocalCorrectionBlocks(staleIds))
          if (deleteResult.status === "stale") return
          void persistCorrectionBlockRemotely({
            writingId: targetWritingId,
            deletedBlockIds: staleIds,
          }).catch((error) => {
            generation.run(() => {
              console.info(
                `[corrections] hydrate cleanup skipped message=${error instanceof Error ? error.message : String(error)}`,
              )
            })
          })
        }

        localCorrectionBlocks = hydratedReconciliation.fresh
        setPersistedCorrectionBlocks(localCorrectionBlocks)
        applyCorrectionSuggestionUpdate(() => admitCorrectionSuggestions(
          flattenPersistedSuggestions(localCorrectionBlocks),
          currentDocBlocks,
        ), {
          immediate: true,
        })

        if (localCorrectionBlocks.length > 0) {
          suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        }

        const loadedTitle = writing.title?.trim() || UNTITLED_WRITING_TITLE
        const loadedHasExplicitTitle = isExplicitWritingTitle(
          loadedTitle,
          writing.content.plainText,
          writing.createdAt,
        )
        applyDocumentMetadata({
          title: loadedTitle,
          hasExplicitTitle: loadedHasExplicitTitle,
          version: writing.version,
          createdAt: writing.createdAt,
          slug: writing.slug ?? null,
          status: writing.status ?? "draft",
          artifactType: writing.artifactType ?? "general",
          visibility: writing.visibility ?? "private",
          lifecycle: hydratedLifecycle,
        })
        setExternalFileNotice(null)
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            hydratedSyncStatus,
            hydratedLifecycle,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
        updateDerivedEditorState(editor)

        const activeTab =
          editorSession.tabs.find((tab) => tab.writing_id === writing.id) ??
          editorSession.tabs.find((tab) => tab.id === routeWritingId) ??
          editorSession.tabs.find((tab) => tab.id === EDITOR_DRAFT_TAB_ID)
        const viewState = activeTab?.view_state

        if (viewState?.mode === "markdown") {
          let nextMarkdown: string
          if (isDesktopRuntime()) {
            const result = desktopDocumentEngine.richToSource(editor)
            if (!result.success) {
              console.error("[ODE-209] DesktopDocumentEngine.richToSource failed:", result.error)
              nextMarkdown = normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)))
            } else {
              nextMarkdown = result.markdown
            }
          } else {
            nextMarkdown = normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)))
          }
          modeRef.current = "markdown"
          setMode("markdown")
          setMarkdownValue(nextMarkdown)

          window.requestAnimationFrame(() => {
            generation.run(() => {
              queueMarkdownSelectionRestore(
                viewState.markdownSelectionStart ?? 0,
                viewState.markdownSelectionEnd ?? viewState.markdownSelectionStart ?? 0,
                {
                  scrollTop: viewState.scrollTop,
                  scrollLeft: viewState.scrollLeft,
                  editorScrollTop: viewState.scrollTop,
                  editorScrollLeft: viewState.scrollLeft,
                  shellScrollTop: viewState.shellScrollTop,
                  shellScrollLeft: viewState.shellScrollLeft,
                  windowScrollX: viewState.windowScrollX,
                  windowScrollY: viewState.windowScrollY,
                  // queueMarkdownSelectionRestore's own deferred writes (its
                  // rAF, plus each scroll target's second re-apply frame)
                  // are not otherwise generation-aware — without this, a
                  // restore queued for A that hasn't fired yet could still
                  // apply to B's now-current DOM after a fast A->B switch
                  // (found on review, ODE-555). finishHydration only fires
                  // once the restore has genuinely settled (applied or
                  // skipped as stale), never before or twice.
                  isStillValid: () => generation.isCurrent(),
                  onSettled: finishHydration,
                },
              )
            })
          })
        } else if (viewState) {
          modeRef.current = "rich"
          setMode("rich")
          window.requestAnimationFrame(() =>
            generation.run(() => {
              const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
              const shellViewport = document.querySelector<HTMLElement>("main")

              const applyEditorScroll = () => {
                if (editorViewport) {
                  editorViewport.scrollTop = viewState.scrollTop
                  editorViewport.scrollLeft = viewState.scrollLeft
                }
              }

              const applyShellScroll = () => {
                if (shellViewport) {
                  shellViewport.scrollTop = viewState.shellScrollTop ?? 0
                  shellViewport.scrollLeft = viewState.shellScrollLeft ?? 0
                }
              }

              const applyWindowScroll = () => {
                window.scrollTo(
                  typeof viewState.windowScrollX === "number" ? viewState.windowScrollX : window.scrollX,
                  typeof viewState.windowScrollY === "number" ? viewState.windowScrollY : window.scrollY,
                )
              }

              if (
                typeof viewState.selectionFrom === "number" &&
                typeof viewState.selectionTo === "number" &&
                viewState.selectionFrom >= 1 &&
                viewState.selectionTo >= viewState.selectionFrom
              ) {
                editor
                  .chain()
                  .focus(undefined, { scrollIntoView: false })
                  .setTextSelection({ from: viewState.selectionFrom, to: viewState.selectionTo })
                  .run()
              } else {
                editor.commands.focus("start")
              }

              applyWindowScroll()
              applyShellScroll()
              applyEditorScroll()

              window.requestAnimationFrame(() => {
                generation.run(() => {
                  applyWindowScroll()
                  applyShellScroll()
                  applyEditorScroll()
                })
                finishHydration()
              })
            }),
          )
        } else {
          finishHydration()
        }
      } else {
        applyDocumentMetadata({
          title: UNTITLED_WRITING_TITLE,
          hasExplicitTitle: false,
          version: 0,
          createdAt: null,
          slug: null,
          status: "draft",
          artifactType: "general",
          visibility: "private",
        })
        setSyncStatus("saved")
        setExternalFileNotice(null)
        setBodyText("")
        currentCanonicalPathRef.current = null
        setCanonicalPath(null)
        finishHydration()
      }
    }

    void hydrateEditor()

    return () => {
      generationOwner.cancel(generation)
    }
    // Same dependency list as the effect had inside editor-shell.tsx (ODE-562
    // moved it verbatim). Refs, setters and injected module helpers arrive
    // through `input` and are stable, exactly as they were in the shell.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    applyCorrectionSuggestionUpdate,
    admitCorrectionSuggestions,
    currentWritingId,
    editor,
    editorSession.tabs,
    flattenPersistedSuggestions,
    flushPendingCorrectionBlocks,
    hydrationWritingId,
    queueMarkdownSelectionRestore,
    routeWritingId,
    setPersistedCorrectionBlocks,
    updateDerivedEditorState,
  ])
}
