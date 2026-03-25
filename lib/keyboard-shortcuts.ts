export type ShortcutDisplay = Readonly<{
  mac: string
  windows: string
}>

const APPLE_PLATFORM_PATTERN = /Mac|iPhone|iPad|iPod/i

export const isMacPlatform = () => {
  if (typeof navigator === "undefined") {
    return true
  }

  return APPLE_PLATFORM_PATTERN.test(navigator.platform)
}

export const getShortcutForPlatform = (shortcut: ShortcutDisplay) =>
  isMacPlatform() ? shortcut.mac : shortcut.windows
