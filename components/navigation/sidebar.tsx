"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { Layers3, LayoutGrid, PanelLeftDashed, PenLine, Plus, Search, Download, X } from "lucide-react"
import { SearchModal } from "@/components/navigation/search-modal"
import { SidebarRecentWritings } from "@/components/navigation/sidebar-recent-writings"
import { UserBar } from "@/components/navigation/user-bar"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutAction, getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { getShortcutForPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"
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

const NAV_ITEMS: NavItem[] = [
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
    href: "/write",
    label: "Studio",
    icon: PenLine,
    section: "sidebar-nav-studio",
    shortcut: { mac: "⌘⌥3", windows: "Ctrl+Alt+3" },
  },
  {
    href: "/collections",
    label: "Collections",
    icon: SquareLibraryIcon,
    section: "sidebar-nav-collections",
  },
]

const SIDEBAR_WIDTH_EXPANDED = 292
const SIDEBAR_WIDTH_COLLAPSED = 52
const SIDEBAR_ITEM_TRANSITION_CLASS =
  "transition-[width,padding,gap,opacity,background-color,color] duration-[300ms] ease-layout"
const SIDEBAR_LABEL_TRANSITION_CLASS =
  "overflow-hidden whitespace-nowrap transition-[width,opacity] duration-[300ms] ease-layout"
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

  const isCollapsed = shellState.sidebarMode === "collapsed"
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
            className="flex h-screen flex-col border-r-[0.5px] border-border bg-sb transition-[width] duration-[300ms] ease-layout"
            style={{ width: sidebarWidth }}
          >
          <div
            id="sidebar-top"
            data-section="sidebar-top"
            data-testid="sidebar-top"
            className={cn(
              "SidebarTop flex h-[70px] items-center",
              isIconOnly ? "justify-center px-2" : "justify-between gap-2 px-4",
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
              <span className="font-sans text-[15px] font-bold tracking-tight text-foreground whitespace-nowrap">Artifact Studio</span>
            </Link>

            <ActionTooltip
              label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              side="right"
            >
              <button
                type="button"
                onClick={handleSidebarToggle}
                className={cn(
                  "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-transparent text-ink-3 transition-[background-color,color,opacity] duration-[300ms] ease-layout hover:border-border hover:bg-muted hover:text-ink",
                  isIconOnly ? "mx-auto" : "",
                )}
                aria-label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeftDashed className="h-[17px] w-[17px]" strokeWidth={1.5} />
              </button>
            </ActionTooltip>
          </div>

          <div
            id="sidebar-actions"
            data-section="sidebar-actions"
            data-testid="sidebar-actions"
            className="SidebarActions px-2 pb-3 pt-6"
          >
            <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="right">
              <Link
                href="/write?new=1"
                className={cn(
                  `flex h-8 items-center rounded-[8px] text-[15px] font-medium ${SIDEBAR_ITEM_TRANSITION_CLASS}`,
                  isIconOnly
                    ? "w-8 justify-start bg-ink pl-2 pr-0 text-bg hover:bg-ink-2"
                    : "w-full justify-start gap-2 px-2 text-ink hover:bg-muted",
                )}
                aria-label="New writing"
              >
                <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
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
                  `mt-3 flex h-8 items-center rounded-[8px] text-[15px] text-ink-2 hover:bg-muted hover:text-ink ${SIDEBAR_ITEM_TRANSITION_CLASS}`,
                  isIconOnly ? "w-8 justify-start pl-2 pr-0" : "w-full justify-start gap-2 px-2",
                )}
                aria-label="Search"
              >
                <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
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

          <div
            id="sidebar-nav"
            data-section="sidebar-nav"
            data-testid="sidebar-nav"
            className="SidebarNav flex-1 overflow-y-auto px-2 pb-2 pt-4"
          >
            <div className="space-y-2">
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
                        `flex h-10 items-center rounded-[8px] text-[15px] ${SIDEBAR_ITEM_TRANSITION_CLASS}`,
                        isActive ? "bg-muted font-medium text-ink" : "text-ink-2 hover:bg-muted-hover hover:text-ink",
                        isIconOnly ? "w-8 justify-start pl-2 pr-0" : "w-full justify-start gap-2 px-2",
                      )}
                      aria-label={item.label}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
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

            <SidebarRecentWritings collapsed={isIconOnly} />
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
