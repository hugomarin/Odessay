"use client"

/**
 * La entrada a la sesión del editor: abrir la pestaña del documento de la
 * ruta, restaurar la sesión persistida cuando se entra sin documento, y la
 * identidad ansiosa de un `/write` en blanco en web (en desktop el borrador
 * sigue efímero hasta la primera escritura real, ODE-405).
 *
 * ODE-587 — corte 3 de `components/editor/editor-shell.tsx`, entrega 1b.
 * MUDANZA MECÁNICA: los tres efectos son los que vivían en la shell, en el
 * mismo orden, y la shell llama a este hook en la posición del primero, así
 * que el orden de efectos no cambia. El estado y los refs siguen siendo de la
 * shell y llegan por `input`, igual que los helpers puros de su módulo
 * (`navigateToWriting`, `deriveAutoTitle`, `isPerfHarness`) y la constante del
 * título en blanco de desktop. Dependencias: las de la shell más esos refs,
 * setters y helpers (identidades estables).
 */
import { useEffect } from "react"
import { type EditorSaveState } from "@/components/editor/save-state"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
import { createBlankDraftIdentity, resolvePersistedSessionRestoreTransition } from "@/lib/editor/hydration-session"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { openDraftTab, openWritingTab } from "@/lib/stores/editor-session-store"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { useRouter } from "next/navigation"
import type { DocumentHydrationInput } from "@/hooks/useDocumentHydration"
import type { createDesktopDraft } from "@/lib/services/document-service-factory"
import type { LocalEditorSession } from "@/lib/local-db/schema"

export type SessionRestoreInput = {
  activateDocument: DocumentHydrationInput["activateDocument"]
  applyDocumentMetadata: DocumentHydrationInput["applyDocumentMetadata"]
  createDesktopDraftFn: typeof createDesktopDraft
  currentWritingIdRef: React.RefObject<string | null>
  deriveAutoTitle: (bodyText: string, createdAt: string | null) => string
  desktopSessionRestoreTimingRef: React.RefObject<{ writingId: string; startedAt: number } | null>
  desktopUntitledWritingTitle: string
  editorSession: LocalEditorSession
  ephemeralDraftWritingIdRef: React.RefObject<string | null>
  forceNewWriting: boolean
  identityEnsuredRef: React.RefObject<boolean>
  isPerfHarness: () => boolean
  navigatedToDraftRef: React.RefObject<boolean>
  navigateToWriting: (router: Pick<ReturnType<typeof useRouter>, "push" | "replace">, href: string, options: { mode: "push" | "replace"; skipOnDesktop: boolean }) => void
  routeWritingId: string | null | undefined
  router: ReturnType<typeof useRouter>
  sessionLoaded: boolean
  setBodyText: React.Dispatch<React.SetStateAction<string>>
  setSyncStatus: React.Dispatch<React.SetStateAction<EditorSaveState>>
}

export function useSessionRestore(input: SessionRestoreInput) {
  const {
    activateDocument,
    applyDocumentMetadata,
    createDesktopDraftFn,
    currentWritingIdRef,
    deriveAutoTitle,
    desktopSessionRestoreTimingRef,
    desktopUntitledWritingTitle,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    identityEnsuredRef,
    isPerfHarness,
    navigatedToDraftRef,
    navigateToWriting,
    routeWritingId,
    router,
    sessionLoaded,
    setBodyText,
    setSyncStatus,
  } = input

  useEffect(() => {
    if (!sessionLoaded || !routeWritingId) {
      return
    }

    openWritingTab({ writingId: routeWritingId, replaceDraft: false })
  }, [routeWritingId, sessionLoaded])

  useEffect(() => {
    if (
      forceNewWriting ||
      !sessionLoaded ||
      routeWritingId ||
      currentWritingIdRef.current ||
      navigatedToDraftRef.current
    ) {
      return
    }

    const restoreTransition = resolvePersistedSessionRestoreTransition({
      activeTabId: editorSession.active_tab_id,
      tabs: editorSession.tabs.map((tab) => ({
        id: tab.id,
        writingId: tab.writing_id,
        slug: tab.slug,
      })),
    }, {
      isDesktopRuntime: isDesktopRuntime(),
      useHistoryProjection: isPerfHarness(),
    })

    if (restoreTransition.status === "restore-writing") {
      const nextHref = buildWritingRouteHref("/write", {
        id: restoreTransition.writingId,
        slug: restoreTransition.slug,
      })

      if (restoreTransition.target === "desktop-hydration") {
        // Explicit desktop handoff: history is only a projection in the static
        // bundle, so identity must transition before hydration/fallback effects.
        desktopSessionRestoreTimingRef.current = {
          writingId: restoreTransition.writingId,
          startedAt: performance.now(),
        }
        activateDocument(
          { writingId: restoreTransition.writingId },
          "restore",
        )
        console.info(`[editor:session-restore] restorable ${restoreTransition.writingId}`)
      } else {
        // "history" y "router" son las dos ramas de `navigateToWriting`: el
        // resolver elige "history" exactamente cuando `isPerfHarness()`.
        navigateToWriting(router, nextHref, { mode: "replace", skipOnDesktop: false })
      }
      return
    }

    if (isDesktopRuntime()) {
      console.info("[editor:session-restore] no-restorable-tab")
    }

    if (restoreTransition.status === "remain-empty") {
      return
    }

    navigatedToDraftRef.current = true
    openDraftTab(ephemeralDraftWritingIdRef.current)
  }, [activateDocument, createDesktopDraftFn, editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded, currentWritingIdRef, desktopSessionRestoreTimingRef, ephemeralDraftWritingIdRef, isPerfHarness, navigateToWriting, navigatedToDraftRef])

  // Eagerly create a stable local identity for blank /write so the first
  // paste/input never races against identity creation. This is the explicit
  // owner of the blank-draft -> identified-local-writing transition.
  // Desktop drafts stay ephemeral until real content is entered, so this eager
  // materialization is skipped there; identity is created on the first input/paste.
  useEffect(() => {
    if (isDesktopRuntime()) {
      if (
        sessionLoaded &&
        !routeWritingId &&
        !currentWritingIdRef.current &&
        !ephemeralDraftWritingIdRef.current
      ) {
        ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      }
      return
    }

    if (forceNewWriting || !sessionLoaded || routeWritingId || identityEnsuredRef.current || currentWritingIdRef.current) {
      return
    }

    // If the session store already has an active non-draft tab, let the
    // openDraftTab effect above handle redirection.
    if (editorSession.active_tab_id && editorSession.active_tab_id !== EDITOR_DRAFT_TAB_ID) {
      return
    }

    identityEnsuredRef.current = true

    const ensureIdentity = async () => {
      const { writingId: nextId } = createBlankDraftIdentity()
      const nowIso = new Date().toISOString()
      const nextTitle = isDesktopRuntime()
        ? desktopUntitledWritingTitle
        : deriveAutoTitle("", nowIso)

      try {
        if (isDesktopRuntime()) {
          const result = await createDesktopDraftFn({ title: nextTitle })
          if (result.error || !result.data) {
            throw new Error(result.error?.message ?? "Failed to create desktop draft")
          }
          activateDocument({ writingId: result.data.id }, "identity")
        } else {
          await (await getDocumentService()).saveWriting({
            writing: {
              id: nextId,
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
            },
          })
          activateDocument({ writingId: nextId }, "identity")
        }
      } catch {
        // If the save fails (e.g., scope change in progress), fall back to
        // the identity-on-first-input path in persistEditorSnapshot.
        identityEnsuredRef.current = false
        return
      }

      openWritingTab({
        writingId: currentWritingIdRef.current ?? nextId,
        title: nextTitle,
        saveState: "saved-local",
        hasPendingSync: false,
        replaceDraft: true,
      })

      applyDocumentMetadata({
        title: nextTitle,
        hasExplicitTitle: false,
        version: 1,
        createdAt: nowIso,
        slug: null,
        status: "draft",
        artifactType: "general",
        visibility: "private",
        lifecycle: "local-only",
      })
      setBodyText("")
      setSyncStatus("saved-local")
      navigatedToDraftRef.current = true
      navigateToWriting(router, `/write/${currentWritingIdRef.current ?? nextId}`, {
        mode: "replace",
        skipOnDesktop: true,
      })
    }

    void ensureIdentity()
  }, [activateDocument, applyDocumentMetadata, createDesktopDraftFn, editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded, currentWritingIdRef, deriveAutoTitle, desktopUntitledWritingTitle, ephemeralDraftWritingIdRef, identityEnsuredRef, navigateToWriting, navigatedToDraftRef, setBodyText, setSyncStatus])
}
