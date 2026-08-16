"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Layers3, LayoutGrid, PanelLeftDashed, PenLine, Plus, Search, Download, X } from "lucide-react"
import { ArtifactLockup } from "@/components/brand/artifact-mark"
import { SearchModal } from "@/components/navigation/search-modal"
import { SidebarRecentWritings } from "@/components/navigation/sidebar-recent-writings"
import { UserBar } from "@/components/navigation/user-bar"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutAction, getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { getShortcutForPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"
import { isTauriRuntime } from "@/lib/runtime/detect"
import {
  initializeUiShellStore,
  toggleSidebarMode,
  useUiShellStore,
} from "@/lib/stores/ui-shell-store"
import { type SidebarMode } from "@/lib/stores/ui-shell-state"
import { cn } from "@/lib/utils"
import {
  checkForUpdate,
  installUpdate,
  formatUpdateLabel,
  type UpdateCheckResult,
} from "@/lib/desktop/update-checker"

type SidebarProps = Readonly<{
  children: React.ReactNode
  initialSidebarMode?: SidebarMode
  user: {
    displayName: string | null
    email: string | null
    username: string | null
  }
}>

type NavItem = {
  href: string
  label: string
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>
  section: string
  shortcut?: ShortcutDisplay
}

function SquareLibraryIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 7v10" />
      <path d="M16 7v10" />
      <path d="M8 7v10" />
      <path d="M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
    </svg>
  )
}

/**
 * Rail order, from `docs/design/system-app.md` §5: New Artifact, Search ·
 * separator · Studio, Desk, Workspace · scroll · recents · user bar.
 *
 * **Collections is kept beyond the spec's inventory.** The package does not list
 * it, but `/collections` has no other entry point in the app, so removing it
 * would delete a capability rather than reorder one. Recorded as a divergence in
 * the ODE-447 PR, the same way ODE-430 kept Import in the Desk header.
 *
 * The shortcuts stay bound to their **destination**, not to the visual position:
 * the order changes, `⌘⌥1` still opens Desk. Renumbering them would break three
 * bindings to buy a coherence nobody reads off the rail.
 */
const NAV_ITEMS: NavItem[] = [
  {
    href: "/write",
    label: "Studio",
    icon: PenLine,
    section: "sidebar-nav-studio",
    shortcut: { mac: "⌘⌥3", windows: "Ctrl+Alt+3" },
  },
  {
    href: "/desk",
    label: "Desk",
    icon: LayoutGrid,
    section: "sidebar-nav-desk",
    shortcut: { mac: "⌘⌥1", windows: "Ctrl+Alt+1" },
  },
  {
    href: "/workspace",
    label: "Workspace",
    icon: Layers3,
    section: "sidebar-nav-workspace",
    shortcut: { mac: "⌘⌥2", windows: "Ctrl+Alt+2" },
  },
  {
    href: "/collections",
    label: "Collections",
    icon: SquareLibraryIcon,
    section: "sidebar-nav-collections",
  },
]

/**
 * Geometry from `docs/design/system-app.md` §3, already tokenised in
 * `globals.css` as `--size-rail-collapsed` / `--size-rail-expanded`. The numbers
 * live here too because the width is also written to a JS style and to
 * `--app-shell-left-offset`; they must not drift from the tokens.
 */
const SIDEBAR_WIDTH_EXPANDED = 244
const SIDEBAR_WIDTH_COLLAPSED = 52

/**
 * Below 900px the rail is forced collapsed (`docs/design/layout.md` §5). This is
 * a presentation override, never a write to the store: the user's own choice
 * survives the narrow window and comes back when the window does.
 */
const RAIL_FORCED_COLLAPSE_QUERY = "(max-width: 899px)"

/**
 * The rail item: a 40px box at radius 9. The horizontal padding is identical in
 * both states so the icon's X position never changes when the rail expands —
 * only the label's width and opacity animate.
 */
const SIDEBAR_ITEM_BASE_CLASS = "flex h-10 items-center gap-[9px] rounded-[9px] px-[10px]"
const SIDEBAR_ITEM_TRANSITION_CLASS =
  "transition-[width,opacity,background-color,color] duration-[300ms] ease-layout"
const SIDEBAR_LABEL_TRANSITION_CLASS =
  "overflow-hidden whitespace-nowrap transition-[width,opacity] duration-[300ms] ease-layout"
const SIDEBAR_ICON_CLASS = "h-[19px] w-[19px] shrink-0"
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

const isEditableTarget = (target: EventTarget | null) => {
  if (!(target instanceof HTMLElement)) {
    return false
  }

  if (target.isContentEditable) {
    return true
  }

  return Boolean(target.closest('input, textarea, [role="textbox"], [contenteditable="true"]'))
}

export function Sidebar({ children, initialSidebarMode = "collapsed", user }: SidebarProps) {
  const pathname = usePathname()
  const shellState = useUiShellStore()

  useIsomorphicLayoutEffect(() => {
    initializeUiShellStore({ sidebarMode: initialSidebarMode })
  }, [initialSidebarMode])

  /**
   * `docs/design/layout.md` §5: between 700 and 900px the rail is forced
   * collapsed. Below 700 the shell hides itself entirely (`#app-sidebar-shell`),
   * so this query only ever governs that band.
   */
  const [isWidthForcedCollapse, setIsWidthForcedCollapse] = useState(false)

  useEffect(() => {
    const query = window.matchMedia(RAIL_FORCED_COLLAPSE_QUERY)
    const sync = () => setIsWidthForcedCollapse(query.matches)

    sync()
    query.addEventListener("change", sync)
    return () => query.removeEventListener("change", sync)
  }, [])

  // The user's preference is never overwritten — only overridden while the
  // window is narrow, so widening it restores what they chose.
  const isCollapsed = shellState.sidebarMode === "collapsed" || isWidthForcedCollapse
  const isIconOnly = isCollapsed

  const sidebarWidth = useMemo(() => {
    return isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
  }, [isCollapsed])
  const shellLeftOffset = sidebarWidth
  const shellStyle = { "--app-shell-left-offset": `${shellLeftOffset}px` } as CSSProperties

  const userDisplayName = user.displayName ?? user.email?.split("@")[0] ?? "Writer"
  const userUsername = user.username ?? "profile"
  const [searchOpen, setSearchOpen] = useState(false)
  const [updateState, setUpdateState] = useState<UpdateCheckResult | null>(null)
  const [installing, setInstalling] = useState(false)

  // Workspace is a first-class DocumentCatalog view as of ODE-373 and belongs
  // in the normal navigation alongside Desk and Studio.
  const navItems = NAV_ITEMS

  const handleSidebarToggle = () => {
    toggleSidebarMode()
  }

  /**
   * On desktop the window has an overlay title bar: the traffic lights float
   * over the top-left corner, which is the sidebar's own column. The collapsed
   * rail is 52px and the lights reach ~72px, so the toggle cannot stay inside
   * it — it moves out to window coordinates, just right of the lights, sharing
   * their row (see docs/design/views/studio.md §Anatomy).
   */
  const [isDesktopTitlebar, setIsDesktopTitlebar] = useState(false)

  useEffect(() => {
    setIsDesktopTitlebar(isTauriRuntime())
  }, [])

  const updateCheckStartedRef = useRef(false)

  useEffect(() => {
    if (updateCheckStartedRef.current) return
    updateCheckStartedRef.current = true

    checkForUpdate().then((result) => {
      if (result.kind === "error") {
        console.error("[update] check failed:", result.message)
        return
      }
      if (result.kind === "available") {
        setUpdateState(result)
      }
    })
  }, [])

  const handleInstallUpdate = async () => {
    if (updateState?.kind !== "available") return
    setInstalling(true)
    try {
      await installUpdate(updateState.update)
    } catch (err) {
      console.error("[update] install failed:", err)
      setInstalling(false)
    }
  }

  const handleDismissUpdate = () => {
    setUpdateState(null)
  }

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented) {
        return
      }

      const action = getEditorShortcutAction(event)
      if (!action) {
        return
      }

      if (isEditableTarget(event.target)) {
        return
      }

      if (action === "newWriting") {
        event.preventDefault()
        window.location.href = "/write?new=1"
        return
      }

      if (action === "settings") {
        event.preventDefault()
        window.location.href = "/settings"
        return
      }

      if (action === "search") {
        event.preventDefault()
        setSearchOpen(true)
        return
      }

      if (action === "goDesk") {
        event.preventDefault()
        window.location.href = "/desk"
        return
      }

      if (action === "goWorkspace") {
        event.preventDefault()
        window.location.href = "/workspace"
        return
      }

      if (action === "goStudio") {
        event.preventDefault()
        window.location.href = "/write"
        return
      }
    }

    window.addEventListener("keydown", onWindowKeyDown)

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown)
    }
  }, [])

  // The editor shell (on /write) cannot reach this modal directly, so it asks
  // for search via a window event. This also lets any surface open search.
  useEffect(() => {
    const openSearch = () => setSearchOpen(true)
    window.addEventListener("odessay:open-search", openSearch)
    return () => window.removeEventListener("odessay:open-search", openSearch)
  }, [])

  return (
    <TooltipProvider delayDuration={120}>
      <div
        id="app-shell"
        className="flex h-screen overflow-hidden bg-bg"
        style={shellStyle}
      >
        <div id="app-sidebar-shell" className="flex h-full shrink-0">
          <nav
            id="sidebar"
            data-page="sidebar"
            /*
             * Layer 0: the rail has no background and no border of its own —
             * it sits on the shell (`docs/design/system-app.md` §4). The
             * separation from the content comes from the view's own sheet
             * (layer 1), not from a rule down the rail's edge.
             */
            className="flex h-screen flex-col bg-transparent transition-[width] duration-[300ms] ease-layout"
            style={{ width: sidebarWidth }}
          >
          <div
            id="sidebar-top"
            data-section="sidebar-top"
            data-testid="sidebar-top"
            data-tauri-drag-region
            className={cn(
              "SidebarTop od-drag-region flex items-center",
              // The toggle leaves this row on desktop, so it shrinks to the
              // 46px title bar and keeps its content clear of the lights.
              isDesktopTitlebar ? "h-[46px]" : "h-[70px]",
              isIconOnly
                ? "justify-center px-2"
                : isDesktopTitlebar
                  ? "justify-between gap-2 pl-[114px] pr-4"
                  : "justify-between gap-2 px-4",
            )}
          >
            <Link
              href="/desk"
              className={cn(
                "overflow-hidden transition-[width,opacity] duration-[300ms] ease-layout",
                isIconOnly ? "w-0 opacity-0" : "w-[150px] opacity-100",
              )}
              aria-label="Artifact Studio"
            >
              <ArtifactLockup markSize={22} fontSize={15} />
            </Link>

            {/*
              While the window forces the rail collapsed there is no state to
              toggle to, so the control leaves rather than sitting there doing
              nothing. The stored preference is untouched and comes back with
              the toggle when the window widens.
            */}
            {isWidthForcedCollapse ? null : (
            <ActionTooltip
              label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              side={isDesktopTitlebar ? "bottom" : "right"}
            >
              <button
                type="button"
                onClick={handleSidebarToggle}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-transparent text-ink-3 transition-[background-color,color,opacity] duration-[300ms] ease-layout hover:border-border hover:bg-muted hover:text-ink",
                  isDesktopTitlebar
                    ? // Window coordinates: 20px inset + three 12px lights + two
                      // 8px gaps ends at ~72px; 82 leaves a gap, and (46-32)/2
                      // centres the button on the title bar row.
                      "fixed left-[82px] top-[7px] z-50"
                    : isIconOnly
                      ? "mx-auto"
                      : "",
                )}
                aria-label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeftDashed className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </button>
            </ActionTooltip>
            )}
          </div>

          <div
            id="sidebar-actions"
            data-section="sidebar-actions"
            data-testid="sidebar-actions"
            className="SidebarActions space-y-1 px-[6px] pb-3 pt-4"
          >
            <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="right">
              <Link
                href="/write?new=1"
                className={cn(
                  SIDEBAR_ITEM_BASE_CLASS,
                  SIDEBAR_ITEM_TRANSITION_CLASS,
                  "text-[15px] font-medium",
                  // The spec is silent on this fill, so the repo's own treatment
                  // is preserved rather than reinvented: ink while collapsed,
                  // plain while expanded.
                  isIconOnly ? "w-10 bg-ink text-bg hover:bg-ink-2" : "w-full text-ink hover:bg-muted",
                )}
                aria-label="New writing"
              >
                <Plus className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                <span
                  className={cn(
                    SIDEBAR_LABEL_TRANSITION_CLASS,
                    isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                  )}
                >
                  New writing
                </span>
              </Link>
            </ActionTooltip>

            <ActionTooltip label="Search" side="right">
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                className={cn(
                  SIDEBAR_ITEM_BASE_CLASS,
                  SIDEBAR_ITEM_TRANSITION_CLASS,
                  "text-[15px] text-ink-2 hover:bg-muted hover:text-ink",
                  isIconOnly ? "w-10" : "w-full",
                )}
                aria-label="Search"
              >
                <Search className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                <span
                  className={cn(
                    SIDEBAR_LABEL_TRANSITION_CLASS,
                    isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                  )}
                >
                  Search
                </span>
              </button>
            </ActionTooltip>
          </div>

          {/* The separator the spec puts between the actions and the views. */}
          <div aria-hidden className="mx-[6px] mb-2 h-px bg-line-soft" />

          <div
            id="sidebar-nav"
            data-section="sidebar-nav"
            data-testid="sidebar-nav"
            /*
              The views never scroll — the rail is a closed inventory. Only the
              recents block below does, so a long list can never push the user
              bar off the bottom of the window.
            */
            className="SidebarNav flex min-h-0 flex-1 flex-col px-[6px] pb-2"
          >
            <div className="flex-shrink-0 space-y-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                const shortcut = item.shortcut ? getShortcutForPlatform(item.shortcut) : null

                return (
                  <ActionTooltip
                    key={item.href}
                    label={item.label}
                    shortcut={shortcut}
                    side="right"
                  >
                    <Link
                      href={item.href}
                      id={item.section}
                      data-section={item.section}
                      data-testid={item.section}
                      className={cn(
                        SIDEBAR_ITEM_BASE_CLASS,
                        SIDEBAR_ITEM_TRANSITION_CLASS,
                        "text-[15px]",
                        // The spec makes the active state the darker of the two
                        // (#E4E1DC active over #E9E7E3 hover); the repo had them
                        // the other way round.
                        isActive
                          ? "bg-muted-hover font-medium text-ink"
                          : "text-ink-2 hover:bg-muted hover:text-ink",
                        isIconOnly ? "w-10" : "w-full",
                      )}
                      aria-label={item.label}
                    >
                      <item.icon className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                      <span
                        className={cn(
                          SIDEBAR_LABEL_TRANSITION_CLASS,
                          isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </ActionTooltip>
                )
              })}
            </div>

            <div
              data-section="sidebar-recents-scroll"
              data-testid="sidebar-recents-scroll"
              className="od-scroll min-h-0 flex-1 overflow-y-auto"
            >
              <SidebarRecentWritings collapsed={isIconOnly} />
            </div>
          </div>

          {updateState?.kind === "available" && !isIconOnly && (
            <div
              data-section="sidebar-update-banner"
              data-testid="sidebar-update-banner"
              className="mx-2 mb-2 rounded-lg border border-border bg-muted px-3 py-2.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink">
                    {formatUpdateLabel(updateState.update)}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    Restart to apply the update.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={handleDismissUpdate}
                  className="shrink-0 text-ink-3 hover:text-ink"
                  aria-label="Dismiss update"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={1.5} />
                </button>
              </div>
              <button
                type="button"
                onClick={handleInstallUpdate}
                disabled={installing}
                className="mt-2 inline-flex w-full items-center justify-center gap-1.5 rounded-md bg-ink px-3 py-1.5 text-[13px] font-medium text-bg hover:bg-ink-2 disabled:opacity-50"
              >
                <Download className="h-3.5 w-3.5" strokeWidth={1.5} />
                {installing ? "Installing…" : "Install Update"}
              </button>
            </div>
          )}

          {updateState?.kind === "available" && isIconOnly && (
            <div className="flex justify-center pb-2">
              <ActionTooltip label={formatUpdateLabel(updateState.update)} side="right">
                <button
                  type="button"
                  onClick={handleInstallUpdate}
                  disabled={installing}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-ink text-bg hover:bg-ink-2 disabled:opacity-50"
                  aria-label="Install update"
                >
                  <Download className="h-4 w-4" strokeWidth={1.5} />
                </button>
              </ActionTooltip>
            </div>
          )}

          <UserBar collapsed={isIconOnly} displayName={userDisplayName} username={userUsername} />
          </nav>
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>

        <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </TooltipProvider>
  )
}
