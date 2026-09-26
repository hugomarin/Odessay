"use client"

/**
 * Abrir documentos en pestañas: crear una pestaña nueva ("New Artifact": un
 * borrador efímero en desktop, una identidad local nueva en web), abrir un
 * documento desde el árbol del workspace, pasar a la pestaña contigua con el
 * teclado y la creación forzada de `/write?new`.
 *
 * ODE-587 — corte 3 de `components/editor/editor-shell.tsx`, entrega 1c.
 * MUDANZA MECÁNICA: los cuerpos, las asignaciones a `createWorkspaceTabRef` y
 * `selectAdjacentTabRef` (en render, como antes) y el efecto de
 * `forceNewWriting` son los que vivían en la shell, en el mismo orden, y la
 * shell llama a este hook donde empezaba ese bloque. El estado y los refs
 * siguen siendo de la shell y llegan por `input`, igual que los helpers puros
 * de su módulo (`createWritingId`, `deriveAutoTitle`) y el título en blanco.
 * Dependencias: las de la shell más esos refs, helpers y constante (estables).
 */
import { useCallback, useEffect } from "react"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
import { createBlankDraftIdentity } from "@/lib/editor/hydration-session"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { type WritingRecord } from "@/lib/services/contracts/document-service"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { describeOpenOutcome, openDocumentById } from "@/lib/services/open-document-factory"
import { getEditorSessionState, openDraftTab, openWritingTab } from "@/lib/stores/editor-session-store"
import { type Editor } from "@tiptap/react"
import type { DocumentHydrationInput } from "@/hooks/useDocumentHydration"
import type { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs"
import type { PersistenceCoordinator } from "@/lib/editor/persistence-coordinator"
import type { LocalEditorSession } from "@/lib/local-db/schema"

type WorkspaceTabs = ReturnType<typeof useWorkspaceTabs>

export type WorkspaceTabOpeningInput = {
  activateDocument: DocumentHydrationInput["activateDocument"]
  activeEditorTabIdRef: React.RefObject<string | null>
  createWorkspaceTabRef: React.RefObject<((options?: { skipConfirm?: boolean }) => Promise<void>) | null>
  createWritingId: () => string
  currentWritingId: string | null
  currentWritingIdRef: React.RefObject<string | null>
  deriveAutoTitle: (bodyText: string, createdAt: string | null) => string
  editor: Editor | null
  editorSession: LocalEditorSession
  ephemeralDraftWritingIdRef: React.RefObject<string | null>
  forceNewWriting: boolean
  forceNewWritingRequestedRef: React.RefObject<boolean>
  handleSelectWorkspaceTab: WorkspaceTabs["handleSelectWorkspaceTab"]
  isApplyingContentRef: React.RefObject<boolean>
  isCreatingWorkspaceTabRef: React.RefObject<boolean>
  navigatedToDraftRef: React.RefObject<boolean>
  persistenceCoordinator: PersistenceCoordinator
  prepareDocumentExit: (steps: { flushPendingEdit: boolean; snapshotDraft: boolean; saveViewState: boolean }) => void
  selectAdjacentTabRef: React.RefObject<((direction: number) => void) | null>
  sessionLoaded: boolean
  untitledWritingTitle: string
  updateDerivedEditorState: (editorInstance: Editor) => void
}

export function useWorkspaceTabOpening(input: WorkspaceTabOpeningInput) {
  const {
    activateDocument,
    activeEditorTabIdRef,
    createWorkspaceTabRef,
    createWritingId,
    currentWritingId,
    currentWritingIdRef,
    deriveAutoTitle,
    editor,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    forceNewWritingRequestedRef,
    handleSelectWorkspaceTab,
    isApplyingContentRef,
    isCreatingWorkspaceTabRef,
    navigatedToDraftRef,
    persistenceCoordinator,
    prepareDocumentExit,
    selectAdjacentTabRef,
    sessionLoaded,
    untitledWritingTitle,
    updateDerivedEditorState,
  } = input

  const handleCreateWorkspaceTab = useCallback(async (options?: { skipConfirm?: boolean }) => {
    if (!options?.skipConfirm && editorSession.tabs.length >= 10) {
      const confirmed = window.confirm("You already have many tabs open. Open another artifact anyway?")
      if (!confirmed) {
        return
      }
    }

    // Desktop: drafts remain ephemeral until the user enters real content.
    // Just open/focus a draft tab; never persist a contentless writing here.
    if (isDesktopRuntime()) {
      // Flush/snapshot before detaching (same reasoning as
      // handleSelectWorkspaceTab/handleCloseWorkspaceTab): a still-queued rAF
      // rich-mode update or unmaterialized draft content must not be
      // discarded just because the user hit New Tab before the next
      // frame/save landed (ODE-478 follow-up — this handler never got the
      // original case 2/4 fix).
      prepareDocumentExit({ flushPendingEdit: true, snapshotDraft: true, saveViewState: true })

      // Detach the previous document before the draft tab can receive focus.
      // Merely changing the active session tab leaves TipTap and the save path
      // bound to the previous UUID until React effects run, so the first input
      // can otherwise append to (and persist over) the previous document.
      persistenceCoordinator.cancel()
      persistenceCoordinator.activateDocument(null)
      activateDocument({ writingId: null, href: "/write" }, "create")
      ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      navigatedToDraftRef.current = false

      if (editor) {
        isApplyingContentRef.current = true
        editor.commands.setContent(EMPTY_EDITOR_JSON)
        isApplyingContentRef.current = false
        updateDerivedEditorState(editor)
      }

      openDraftTab(ephemeralDraftWritingIdRef.current)
      activeEditorTabIdRef.current = getEditorSessionState().session.active_tab_id ?? EDITOR_DRAFT_TAB_ID
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
          editorEl?.focus()
        })
      })
      return
    }

    // Block publishTabState while we are mid-creation. Web claims the final id
    // synchronously so persistEditorSnapshot never races against it.
    isCreatingWorkspaceTabRef.current = true

    // Web: el volcado no aplica (la cola del editor se vacía de forma síncrona
    // en web) y el borrador no se conserva aquí; solo la vista saliente.
    prepareDocumentExit({ flushPendingEdit: false, snapshotDraft: false, saveViewState: true })
    const activeDraftTabId = currentWritingId ?? EDITOR_DRAFT_TAB_ID
    const isActiveDraft =
      !currentWritingId ||
      editorSession.tabs.some((tab) => tab.id === activeDraftTabId && tab.writing_id === null)

    const nowIso = new Date().toISOString()
    const nextWritingId = createWritingId()
    const nextTitle = deriveAutoTitle("", nowIso)

    // Claim ownership of the blank-draft -> identified-local-writing transition
    // synchronously so persistEditorSnapshot never races against it.
    activateDocument(
      { writingId: nextWritingId, href: `/write/${nextWritingId}` },
      "create",
    )

    const finishCreation = () => {
      isCreatingWorkspaceTabRef.current = false
    }

    const blankDraftRecord: WritingRecord = {
      id: nextWritingId,
      authorId: null,
      title: nextTitle,
      content: {
        richText: EMPTY_EDITOR_JSON as Record<string, unknown>,
        markdown: null,
        plainText: "",
        canonicalSource: "rich-text",
      },
      slug: null,
      status: "draft",
      artifactType: "general",
      visibility: "private",
      parentId: null,
      correspondenceId: null,
      version: 1,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      contentUpdatedAt: nowIso,
      metadataUpdatedAt: nowIso,
    }

    if (isActiveDraft) {
      try {
        await (await getDocumentService()).saveWriting({ writing: blankDraftRecord })
      } catch {
        // If save fails, revert the optimistic claim so persistEditorSnapshot
        // can fall back to identity-on-first-input.
        activateDocument({ writingId: null }, "revert")
        return
      } finally {
        finishCreation()
      }

      openWritingTab({
        writingId: currentWritingIdRef.current ?? nextWritingId,
        title: nextTitle,
        saveState: "saved",
        hasPendingSync: false,
      })
      activeEditorTabIdRef.current = currentWritingIdRef.current ?? nextWritingId
      // Double rAF: first waits for React to commit the new tab to the DOM,
      // second ensures the editor contenteditable is focusable.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
          editorEl?.focus()
        })
      })
      return
    }

    try {
      await (await getDocumentService()).saveWriting({ writing: blankDraftRecord })
    } catch {
      activateDocument({ writingId: null }, "revert")
      return
    } finally {
      finishCreation()
    }

    openWritingTab({
      writingId: currentWritingIdRef.current ?? nextWritingId,
      title: nextTitle,
      saveState: "saved",
      hasPendingSync: false,
    })
    activeEditorTabIdRef.current = currentWritingIdRef.current ?? nextWritingId
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
        editorEl?.focus()
      })
    })
  }, [
    activateDocument,
    currentWritingId,
    editor,
    editorSession.tabs,
    persistenceCoordinator,
    prepareDocumentExit,
    updateDerivedEditorState,
    activeEditorTabIdRef,
    createWritingId,
    currentWritingIdRef,
    deriveAutoTitle,
    ephemeralDraftWritingIdRef,
    isApplyingContentRef,
    isCreatingWorkspaceTabRef,
    navigatedToDraftRef,
  ])
  createWorkspaceTabRef.current = handleCreateWorkspaceTab

  const handleOpenWorkspaceDocument = useCallback(async (documentId: string) => {
    // Same reasoning as handleSelectWorkspaceTab/handleCloseWorkspaceTab/
    // handleCreateWorkspaceTab: this also detaches from whatever document is
    // currently active, so a still-queued edit or unmaterialized draft must
    // not be discarded just because the user opened a different document via
    // search/recents instead of the tab bar (ODE-478 follow-up).
    //
    // `saveViewState: false` es el comportamiento vigente, no un olvido de la
    // mudanza: a diferencia de los otros handlers, esta transición nunca guardó
    // la vista saliente (ODE-567, decisión documentada). Caracterizado en
    // tests/editor-shell-open-exit-protocol.test.tsx (ODE-580).
    prepareDocumentExit({ flushPendingEdit: true, snapshotDraft: true, saveViewState: false })

    const outcome = await openDocumentById(documentId)
    if (outcome.status !== "opened" && outcome.status !== "conflict") {
      throw new Error(describeOpenOutcome(outcome))
    }
    const openedTitle = outcome.record.title ?? untitledWritingTitle
    activateDocument({ writingId: documentId }, "open")
    openWritingTab({ writingId: documentId, slug: outcome.record.slug, title: openedTitle, saveState: "saved-local", hasPendingSync: false })
  }, [activateDocument, prepareDocumentExit, untitledWritingTitle])

  selectAdjacentTabRef.current = (direction) => {
    const tabs = editorSession.tabs
    if (tabs.length <= 1) {
      return
    }

    const activeId = editorSession.active_tab_id ?? currentWritingIdRef.current ?? EDITOR_DRAFT_TAB_ID
    const currentIndex = tabs.findIndex((tab) => tab.id === activeId)
    const baseIndex = currentIndex < 0 ? 0 : currentIndex
    const nextTab = tabs[(baseIndex + direction + tabs.length) % tabs.length]

    if (nextTab && nextTab.id !== activeId) {
      handleSelectWorkspaceTab(nextTab.id)
    }
  }

  useEffect(() => {
    if (!forceNewWriting || !sessionLoaded || forceNewWritingRequestedRef.current) {
      return
    }

    forceNewWritingRequestedRef.current = true
    void handleCreateWorkspaceTab({ skipConfirm: true })
  }, [forceNewWriting, handleCreateWorkspaceTab, sessionLoaded, forceNewWritingRequestedRef])

  return {
    handleCreateWorkspaceTab,
    handleOpenWorkspaceDocument,
  }
}
