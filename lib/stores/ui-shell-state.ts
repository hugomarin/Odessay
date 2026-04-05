export type SidebarMode = "expanded" | "collapsed"

export const SIDEBAR_MODE_COOKIE_KEY = "odessay-sidebar-mode"
export const SIDEBAR_MODE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365

export function parseSidebarModeCookie(value: string | undefined): SidebarMode {
  return value === "expanded" ? "expanded" : "collapsed"
}
