"use client"

/**
 * Las pestañas del editor: seleccionar, cerrar (una, las demás o todas),
 * mostrar el archivo en el sistema, renombrar (también una pestaña de fondo:
 * se selecciona primero) y reordenar, más el estado editorial de cada pestaña
 * que dibuja su glifo.
 *
 * ODE-587 — corte 3 de `components/editor/editor-shell.tsx`, entrega 1.
 * MUDANZA MECÁNICA, como ODE-562 y ODE-586: los cuerpos y los dos efectos son
 * los que vivían en la shell, en el mismo orden, y la shell llama a este hook
 * donde empezaba ese bloque (entre su primer handler y su último efecto no
 * había ningún otro efecto, así que el orden de efectos no cambia). El estado
 * del documento y los refs siguen siendo de la shell y llegan por `input`;
 * solo se mudan con el bloque el ref del renombrado pendiente y el estado
 * editorial de las pestañas de fondo, que nadie más usaba. Dependencias: las
 * de la shell más los refs y setters que ahora llegan por `input`
 * (identidades estables).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getEditorMarkdown } from "@/lib/editor/extensions"
import { getEditorFootnotes, getMarkdownWithFootnoteDefinitions } from "@/lib/editor/footnote-node"
import { type WritingStatus } from "@/lib/local-db/schema"
import { getDesktopWritingCanonicalPath } from "@/lib/services/document-service-factory"
import { closeTab, focusTab, getEditorSessionState, reorderTab, updateTabSaveState } from "@/lib/stores/editor-session-store"
import { revealWorkspacePath } from "@/lib/workspace/reveal-path"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { type Editor } from "@tiptap/react"
import type { DocumentHydrationInput, HydrationPhase } from "@/hooks/useDocumentHydration"
import type { PersistenceCoordinator } from "@/lib/editor/persistence-coordinator"
import type { LocalEditorSession } from "@/lib/local-db/schema"

export type WorkspaceTabsInput = {
  activateDocument: DocumentHydrationInput["activateDocument"]
  activeEditorTabIdRef: React.RefObject<string | null>
  /** Identidad del documento activo; la que fija `activateDocument` (shell). */
  currentWritingId: string | null
  editor: Editor | null
  editorSession: LocalEditorSession
  ephemeralDraftWritingIdRef: React.RefObject<string | null>
  /**
   * Fase de hidratación del documento activo (ODE-570, ADR documento activo).
   * El renombrado de una pestaña de fondo espera a que esté "ready" para que
   * el snapshot lleve el título y el cuerpo del documento pedido, no del
   * anterior (ODE-588).
   */
  hydrationPhase: HydrationPhase
  materializedDraftIdsRef: React.RefObject<Map<string, string>>
  navigatedToDraftRef: React.RefObject<boolean>
  persistenceCoordinator: PersistenceCoordinator
  prepareDocumentExit: (steps: { flushPendingEdit: boolean; snapshotDraft: boolean; saveViewState: boolean }) => void
  setRenameModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setRenameModalSnapshot: React.Dispatch<React.SetStateAction<{ title: string; bodyText: string } | null>>
  titleRef: React.RefObject<string>
  untitledWritingTitle: string
  writingStatus: WritingStatus | null
}

export function useWorkspaceTabs(input: WorkspaceTabsInput) {
  const {
    activateDocument,
    activeEditorTabIdRef,
    currentWritingId,
    editor,
    editorSession,
    ephemeralDraftWritingIdRef,
    hydrationPhase,
    materializedDraftIdsRef,
    navigatedToDraftRef,
    persistenceCoordinator,
    prepareDocumentExit,
    setRenameModalOpen,
    setRenameModalSnapshot,
    titleRef,
    untitledWritingTitle,
    writingStatus,
  } = input

  const handleSelectWorkspaceTab = useCallback(
    (tabId: string) => {
      const nextTab = editorSession.tabs.find((tab) => tab.id === tabId)
      if (!nextTab) {
        return
      }

      // A queued rich-mode update still holds the OLD tab's editor instance.
      // Flushing it here — before currentWritingIdRef changes below — makes
      // sure that content lands on the document it was actually typed into,
      // not on whatever tab we're about to switch to (ODE-478 case 2).
      prepareDocumentExit({ flushPendingEdit: true, snapshotDraft: true, saveViewState: true })
      activeEditorTabIdRef.current = tabId
      focusTab(tabId)
      navigatedToDraftRef.current = false

      if (nextTab.writing_id) {
        activateDocument(
          {
            writingId: nextTab.writing_id,
            href: buildWritingRouteHref("/write", { id: nextTab.writing_id, slug: nextTab.slug }),
          },
          "select",
        )
        return
      }

      activateDocument({ writingId: null, href: "/write" }, "select")
    },
    [activateDocument, editorSession.tabs, prepareDocumentExit, activeEditorTabIdRef, navigatedToDraftRef],
  )

  const handleCloseWorkspaceTab = useCallback(
    async (tabId: string) => {
      // Read fresh rather than the closed-over `editorSession.tabs` (same
      // reasoning as the re-resolve after the persistence await below): a
      // tab can materialize in the store between this component's last
      // render and the call, which the batch closers (Close others/all)
      // make more likely by resolving their id list from live state too.
      const targetTab = getEditorSessionState().session.tabs.find((tab) => tab.id === tabId)
      if (!targetTab) {
        return
      }

      // Same reasoning as handleSelectWorkspaceTab: flush before this tab's
      // identity can change under a still-queued update (ODE-478 case 2).
      // The view state is only worth saving for the tab being left.
      const isClosingActiveTab = activeEditorTabIdRef.current === tabId
      prepareDocumentExit({ flushPendingEdit: true, snapshotDraft: true, saveViewState: isClosingActiveTab })

      const persistenceTarget = {
        writingId: targetTab.writing_id,
        draftWritingId: targetTab.writing_id === null ? ephemeralDraftWritingIdRef.current : null,
        sourceTabId: tabId,
      }

      // A close waits for this tab's local write, including a still-debounced
      // request. It must not wait for unrelated background tabs, and the
      // existing tab save-state affordance makes the wait visible (ODE-478
      // case 5). There is intentionally no confirm/cancel race here: once the
      // user asks to close, the tab closes after its write is durable.
      if (persistenceCoordinator.hasPending(persistenceTarget)) {
        updateTabSaveState({ tabId, saveState: "saving", hasPendingSync: true })
        const settled = await persistenceCoordinator.settle(persistenceTarget)
        if (!settled) {
          return
        }
      }

      // The await above can let this very tab's own materialization complete
      // and rename it (draft id -> real writing id) via
      // reconcileMaterializedDraftTab, so the `tabId` captured before the
      // await can now point at nothing. Re-resolve it against live state
      // before closing: materializedDraftIdsRef records what the draft id
      // became, since the tab's own draft_writing_id is cleared once it's no
      // longer a draft (ODE-478 follow-up).
      const tabsAfterSettle = getEditorSessionState().session.tabs
      const resolvedTabId = tabsAfterSettle.some((tab) => tab.id === tabId)
        ? tabId
        : (persistenceTarget.draftWritingId
            ? materializedDraftIdsRef.current.get(persistenceTarget.draftWritingId)
            : undefined) ?? tabId

      const nextActiveTabId = closeTab(resolvedTabId)

      if (!isClosingActiveTab) {
        return
      }

      activeEditorTabIdRef.current = nextActiveTabId
      // Read fresh rather than the closed-over `editorSession.tabs`, which can
      // be stale after the same await (ODE-478 follow-up).
      const nextTab = getEditorSessionState().session.tabs.find((tab) => tab.id === nextActiveTabId)
      navigatedToDraftRef.current = false
      if (nextTab?.writing_id) {
        activateDocument(
          {
            writingId: nextTab.writing_id,
            href: buildWritingRouteHref("/write", { id: nextTab.writing_id, slug: nextTab.slug }),
          },
          "close",
        )
        return
      }

      activateDocument({ writingId: null, href: "/write" }, "close")
    },
    [
      activateDocument,
      persistenceCoordinator,
      prepareDocumentExit,
      activeEditorTabIdRef,
      ephemeralDraftWritingIdRef,
      materializedDraftIdsRef,
      navigatedToDraftRef,
    ],
  )

  // Closing more than one tab reuses handleCloseWorkspaceTab per id rather
  // than a batch primitive in the session store — it already re-reads fresh
  // state each call (ODE-478 follow-up), so sequencing them one at a time
  // keeps every close's persistence/active-tab bookkeeping correct.
  const handleCloseOtherWorkspaceTabs = useCallback(
    async (tabId: string) => {
      const idsToClose = getEditorSessionState()
        .session.tabs.map((tab) => tab.id)
        .filter((id) => id !== tabId)
      for (const id of idsToClose) {
        await handleCloseWorkspaceTab(id)
      }
    },
    [handleCloseWorkspaceTab],
  )

  const handleCloseAllWorkspaceTabs = useCallback(async () => {
    const ids = getEditorSessionState().session.tabs.map((tab) => tab.id)
    for (const id of ids) {
      await handleCloseWorkspaceTab(id)
    }
  }, [handleCloseWorkspaceTab])

  // Reveals the tab's file, not the tab itself: draft tabs (no writing_id
  // yet, or no local binding on this machine — cloud-only) have nothing on
  // disk to reveal, so the caller hides this action rather than no-op it.
  const handleRevealWorkspaceTab = useCallback(async (tabId: string) => {
    const tab = getEditorSessionState().session.tabs.find((candidate) => candidate.id === tabId)
    if (!tab?.writing_id) {
      return
    }
    const canonicalPath = await getDesktopWritingCanonicalPath(tab.writing_id)
    if (!canonicalPath) {
      return
    }
    const dir = canonicalPath.slice(0, canonicalPath.lastIndexOf("/"))
    try {
      await revealWorkspacePath(dir)
    } catch (reason) {
      console.error("[editor-tabs] reveal failed", reason)
    }
  }, [])

  // Renaming reads the loaded editor, so a pencil pressed on a background tab
  // selects it first and opens the modal once that tab is the active one.
  const pendingRenameTabIdRef = useRef<string | null>(null)

  const handleRenameWorkspaceTab = useCallback(
    (tabId: string) => {
      if (tabId !== editorSession.active_tab_id) {
        pendingRenameTabIdRef.current = tabId
        handleSelectWorkspaceTab(tabId)
        return
      }

      setRenameModalSnapshot({
        title: titleRef.current.trim() || untitledWritingTitle,
        bodyText: editor ? getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)) : "",
      })
      setRenameModalOpen(true)
    },
    [editor, editorSession.active_tab_id, handleSelectWorkspaceTab, setRenameModalOpen, setRenameModalSnapshot, titleRef, untitledWritingTitle],
  )

  useEffect(() => {
    const pendingTabId = pendingRenameTabIdRef.current
    if (!pendingTabId || pendingTabId !== editorSession.active_tab_id) return
    // El switch de pestaña ya aterrizó, pero el snapshot del renombrado lee el
    // editor y el título cargados: abrir aquí, en cuanto `active_tab_id` cambia,
    // tomaría todavía el título y el cuerpo del documento anterior (ODE-588).
    // Se espera a que termine la hidratación del documento pedido.
    if (hydrationPhase !== "ready") return
    // Y a que la hidratación terminada sea la de ESA pestaña, no la de otro
    // documento que terminó mientras tanto (failure mode de ODE-588).
    const pendingTab = editorSession.tabs.find((tab) => tab.id === pendingTabId)
    if (currentWritingId !== (pendingTab?.writing_id ?? null)) return
    pendingRenameTabIdRef.current = null
    handleRenameWorkspaceTab(pendingTabId)
  }, [editorSession.active_tab_id, editorSession.tabs, hydrationPhase, currentWritingId, handleRenameWorkspaceTab])

  const handleRenameActiveWriting = useCallback(() => {
    const activeTabId = editorSession.active_tab_id
    if (!activeTabId) {
      return
    }

    handleRenameWorkspaceTab(activeTabId)
  }, [editorSession.active_tab_id, handleRenameWorkspaceTab])

  const handleReorderWorkspaceTab = useCallback((tabId: string, targetTabId: string) => {
    reorderTab(tabId, targetTabId)
  }, [])

  /**
   * Editorial state per tab, so each tab draws the same glyph the properties
   * panel shows (`WritingStatusIcon`). The active tab reads live local state so
   * a change in Properties is reflected without a round trip; the rest come
   * from the catalog, refreshed when the open set changes.
   */
  const [catalogTabStatuses, setCatalogTabStatuses] = useState<Record<string, WritingStatus | null>>({})

  const openWritingIds = useMemo(
    () => editorSession.tabs.map((tab) => tab.writing_id).filter((id): id is string => Boolean(id)),
    [editorSession.tabs],
  )
  const openWritingIdsKey = openWritingIds.join(",")

  useEffect(() => {
    if (openWritingIds.length === 0) {
      setCatalogTabStatuses({})
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null

    // Imported lazily: pulling the catalog into the shell's module graph drags
    // the Tauri filesystem watcher with it, which breaks any suite that mounts
    // the editor without the desktop mocks.
    void import("@/lib/queries/document-catalog")
      .then(({ getCatalogRecord, subscribeToCatalog }) => {
        if (cancelled) return

        const wanted = new Set(openWritingIds)
        const refresh = (documentIds: string[], replace: boolean) => {
          void Promise.all(documentIds.map((id) => getCatalogRecord(id)))
            .then((records) => {
              if (cancelled) return
              setCatalogTabStatuses((current) => {
                const next: Record<string, WritingStatus | null> = replace ? {} : { ...current }
                documentIds.forEach((id, index) => {
                  const record = records[index]
                  if (record) next[id] = record.status ?? null
                  else delete next[id]
                })
                return next
              })
            })
            .catch(() => {
              // A catalog miss just leaves the glyph on its fallback.
            })
        }

        refresh(openWritingIds, true)
        unsubscribe = subscribeToCatalog((change) => {
          const affected = change.documentIds.filter((id) => wanted.has(id))
          if (affected.length > 0) refresh(affected, false)
        })
      })
      .catch(() => {
        // No catalog in this runtime: the glyphs stay on their fallback.
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWritingIdsKey])

  const tabStatuses = useMemo(() => {
    const next: Record<string, WritingStatus | null> = {}
    for (const tab of editorSession.tabs) {
      next[tab.id] =
        tab.id === editorSession.active_tab_id
          ? writingStatus
          : tab.writing_id
            ? catalogTabStatuses[tab.writing_id] ?? null
            : null
    }
    return next
  }, [catalogTabStatuses, editorSession.active_tab_id, editorSession.tabs, writingStatus])

  return {
    handleSelectWorkspaceTab,
    handleCloseWorkspaceTab,
    handleCloseOtherWorkspaceTabs,
    handleCloseAllWorkspaceTabs,
    handleRevealWorkspaceTab,
    handleRenameWorkspaceTab,
    handleRenameActiveWriting,
    handleReorderWorkspaceTab,
    tabStatuses,
  }
}
