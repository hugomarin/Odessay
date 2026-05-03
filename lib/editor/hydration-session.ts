export type EditorHydrationSessionState = {
  activeWritingId: string | null
  hydrationWritingId: string | null
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
