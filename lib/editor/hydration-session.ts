export type EditorHydrationSessionState = {
  activeWritingId: string | null
  hydrationWritingId: string | null
}

export type PersistedSessionRestoreDecision =
  | { status: "restorable"; writingId: string }
  | { status: "no-restorable-tab" }

type PersistedSessionSnapshot = {
  activeTabId: string | null
  tabs: Array<{ id: string; writingId: string | null }>
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
