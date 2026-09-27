"use client"

/**
 * La entrada a la sesión del editor: abre la pestaña de la ruta, restaura la
 * sesión persistida cuando se entra sin documento y prepara una identidad
 * efímera para el borrador vacío. La identidad durable se crea al primer
 * contenido mediante el PersistenceCoordinator.
 *
 * ODE-587 — corte 3 de `components/editor/editor-shell.tsx`, entrega 1b.
 */
import { useEffect } from "react"
import { createBlankDraftIdentity, resolvePersistedSessionRestoreTransition } from "@/lib/editor/hydration-session"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { openDraftTab, openWritingTab } from "@/lib/stores/editor-session-store"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import { useRouter } from "next/navigation"
import type { DocumentHydrationInput } from "@/hooks/useDocumentHydration"
import type { LocalEditorSession } from "@/lib/local-db/schema"

export type SessionRestoreInput = {
  activateDocument: DocumentHydrationInput["activateDocument"]
  currentWritingIdRef: React.RefObject<string | null>
  desktopSessionRestoreTimingRef: React.RefObject<{ writingId: string; startedAt: number } | null>
  editorSession: LocalEditorSession
  ephemeralDraftWritingIdRef: React.RefObject<string | null>
  forceNewWriting: boolean
  isPerfHarness: () => boolean
  navigatedToDraftRef: React.RefObject<boolean>
  navigateToWriting: (
    router: Pick<ReturnType<typeof useRouter>, "push" | "replace">,
    href: string,
    options: { mode: "push" | "replace"; skipOnDesktop: boolean },
  ) => void
  routeWritingId: string | null | undefined
  router: ReturnType<typeof useRouter>
  sessionLoaded: boolean
}

export function useSessionRestore(input: SessionRestoreInput) {
  const {
    activateDocument,
    currentWritingIdRef,
    desktopSessionRestoreTimingRef,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    isPerfHarness,
    navigatedToDraftRef,
    navigateToWriting,
    routeWritingId,
    router,
    sessionLoaded,
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

    const restoreTransition = resolvePersistedSessionRestoreTransition(
      {
        activeTabId: editorSession.active_tab_id,
        tabs: editorSession.tabs.map((tab) => ({
          id: tab.id,
          writingId: tab.writing_id,
          slug: tab.slug,
        })),
      },
      {
        isDesktopRuntime: isDesktopRuntime(),
        useHistoryProjection: isPerfHarness(),
      },
    )

    if (restoreTransition.status === "restore-writing") {
      const nextHref = buildWritingRouteHref("/write", {
        id: restoreTransition.writingId,
        slug: restoreTransition.slug,
      })

      if (restoreTransition.target === "desktop-hydration") {
        desktopSessionRestoreTimingRef.current = {
          writingId: restoreTransition.writingId,
          startedAt: performance.now(),
        }
        activateDocument({ writingId: restoreTransition.writingId }, "restore")
        console.info(`[editor:session-restore] restorable ${restoreTransition.writingId}`)
      } else {
        navigateToWriting(router, nextHref, { mode: "replace", skipOnDesktop: false })
      }
      return
    }

    if (isDesktopRuntime()) {
      console.info("[editor:session-restore] no-restorable-tab")
    }

    const draftWritingId =
      ephemeralDraftWritingIdRef.current ?? createBlankDraftIdentity().writingId
    ephemeralDraftWritingIdRef.current = draftWritingId

    if (restoreTransition.status === "remain-empty") {
      return
    }

    // This marks the session restoration as handled. The draft stays
    // unmaterialized until its first content reaches PersistenceCoordinator.
    navigatedToDraftRef.current = true
    openDraftTab(draftWritingId)
  }, [
    activateDocument,
    currentWritingIdRef,
    desktopSessionRestoreTimingRef,
    editorSession.active_tab_id,
    editorSession.tabs,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    isPerfHarness,
    navigateToWriting,
    navigatedToDraftRef,
    routeWritingId,
    router,
    sessionLoaded,
  ])
}
