export type EscapeIntent = "close-panel" | "exit-focus" | "none"

export const resolveEscapeIntent = (params: {
  hasOpenPanel: boolean
  isFocusMode: boolean
}): EscapeIntent => {
  if (params.hasOpenPanel) {
    return "close-panel"
  }

  if (params.isFocusMode) {
    return "exit-focus"
  }

  return "none"
}
