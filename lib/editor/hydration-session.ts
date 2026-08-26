export type EditorHydrationSessionState = {
  activeWritingId: string | null
  hydrationWritingId: string | null
}

export type PersistedSessionRestoreDecision =
  | { status: "restorable"; writingId: string }
  | { status: "no-restorable-tab" }

type PersistedSessionSnapshot = {
  activeTabId: string | null
  tabs: Array<{ id: string; writingId: string | null; slug?: string | null }>
}

export type PersistedSessionRestoreTransition =
  | {
      status: "restore-writing"
      writingId: string
      slug: string | null
      target: "desktop-hydration" | "history" | "router"
    }
  | { status: "remain-empty" }
  | { status: "open-draft-tab" }

type PersistedSessionRestoreContext = {
  isDesktopRuntime: boolean
  useHistoryProjection: boolean
}

/**
 * Resolves the persisted session before desktop is allowed to consider its
 * empty-editor fallback. Session tabs are navigation state only: a positive
 * decision hands a UUID to the unified opener, while every other shape reaches
 * one explicit terminal outcome without minting identity.
 */
export const resolvePersistedSessionRestore = (
  session: PersistedSessionSnapshot,
): PersistedSessionRestoreDecision => {
  if (!session.activeTabId) {
    return { status: "no-restorable-tab" }
  }

  const activeTab = session.tabs.find((tab) => tab.id === session.activeTabId)
  if (!activeTab?.writingId) {
    return { status: "no-restorable-tab" }
  }

  return { status: "restorable", writingId: activeTab.writingId }
}

/**
 * Converts persisted session state into one explicit shell command. The shell
 * owns React/router/store effects; this application decision owns their order
 * and guarantees that desktop reaches UUID hydration before any fallback.
 */
export const resolvePersistedSessionRestoreTransition = (
  session: PersistedSessionSnapshot,
  context: PersistedSessionRestoreContext,
): PersistedSessionRestoreTransition => {
  const restoreDecision = resolvePersistedSessionRestore(session)

  if (restoreDecision.status === "restorable") {
    const activeTab = session.tabs.find((tab) => tab.id === session.activeTabId)
    return {
      status: "restore-writing",
      writingId: restoreDecision.writingId,
      slug: activeTab?.slug ?? null,
      target: context.isDesktopRuntime
        ? "desktop-hydration"
        : context.useHistoryProjection
          ? "history"
          : "router",
    }
  }

  if (context.isDesktopRuntime && session.tabs.length === 0) {
    return { status: "remain-empty" }
  }

  return { status: "open-draft-tab" }
}

export type UnavailableTabReconciliation = {
  removed: boolean
  removedActive: boolean
  fallbackTabId: string | null
}

type ReconciledSessionTab = {
  id: string
  writingId: string | null
  slug?: string | null
}

export type UnavailableWritingRecoveryTransition =
  | { status: "clear-hydration" }
  | { status: "activate-writing"; writingId: string; slug: string | null }
  | { status: "show-empty-editor" }

/**
 * Plans the presentation response after the session-store adapter has removed
 * an unavailable tab. It deliberately consumes neutral data rather than the
 * concrete session store so recovery stays portable and independently tested.
 */
export const resolveUnavailableWritingRecovery = (
  reconciliation: UnavailableTabReconciliation,
  tabs: ReconciledSessionTab[],
): UnavailableWritingRecoveryTransition => {
  if (!reconciliation.removedActive) {
    return { status: "clear-hydration" }
  }

  const fallbackTab = reconciliation.fallbackTabId
    ? tabs.find((tab) => tab.id === reconciliation.fallbackTabId)
    : null

  if (fallbackTab?.writingId) {
    return {
      status: "activate-writing",
      writingId: fallbackTab.writingId,
      slug: fallbackTab.slug ?? null,
    }
  }

  return { status: "show-empty-editor" }
}

export const createRouteHydrationSessionState = (
  routeWritingId: string | null,
): EditorHydrationSessionState => ({
  activeWritingId: routeWritingId,
  hydrationWritingId: routeWritingId,
})

export const createNewWritingSessionState = (writingId: string): EditorHydrationSessionState => ({
  activeWritingId: writingId,
  hydrationWritingId: null,
})

export const resolveExternalWritingLoad = (
  activeWritingId: string | null,
  routeWritingId: string | null,
): EditorHydrationSessionState | null => {
  if (routeWritingId === activeWritingId) {
    return null
  }

  return createRouteHydrationSessionState(routeWritingId)
}

export type BlankDraftIdentity = {
  writingId: string
  sessionState: EditorHydrationSessionState
}

export const createBlankDraftIdentity = (): BlankDraftIdentity => {
  const writingId = crypto.randomUUID()
  return {
    writingId,
    sessionState: createNewWritingSessionState(writingId),
  }
}
