export type DesktopDraftLifecycleCounters = {
  installed: boolean
  materializations: number
  filesystemWrites: number
  manifestWrites: number
  catalogWrites: number
  syncEnqueues: number
  cloudWrites: number
}

declare global {
  interface Window {
    __ODESSAY_DESKTOP_DRAFT_LIFECYCLE__?: DesktopDraftLifecycleCounters
  }
}

export function installDesktopDraftLifecycleHarness() {
  if (typeof window === "undefined") return null
  window.__ODESSAY_DESKTOP_DRAFT_LIFECYCLE__ = {
    installed: true,
    materializations: 0,
    filesystemWrites: 0,
    manifestWrites: 0,
    catalogWrites: 0,
    syncEnqueues: 0,
    cloudWrites: 0,
  }
  return window.__ODESSAY_DESKTOP_DRAFT_LIFECYCLE__
}

export function getDesktopDraftLifecycleHarness() {
  return typeof window === "undefined" ? undefined : window.__ODESSAY_DESKTOP_DRAFT_LIFECYCLE__
}
