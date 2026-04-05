"use client"

import { useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileText, LibraryBig, Mails, PanelLeftClose, Plus, Search } from "lucide-react"
import { SidebarListPanel } from "@/components/navigation/sidebar-list-panel"
import { UserBar } from "@/components/navigation/user-bar"
import { ActionTooltip } from "@/components/ui/action-tooltip"
import { TooltipProvider } from "@/components/ui/tooltip"
import { getEditorShortcutAction, getEditorShortcutLabel } from "@/lib/editor/shortcuts"
import { getShortcutForPlatform, type ShortcutDisplay } from "@/lib/keyboard-shortcuts"
import {
  initializeUiShellStore,
  setSidebarPanel,
  syncSidebarPanelWithPath,
  toggleSidebarMode,
  useUiShellStore,
} from "@/lib/stores/ui-shell-store"
import { type SidebarMode } from "@/lib/stores/ui-shell-state"
import { cn } from "@/lib/utils"

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

const NAV_ITEMS: NavItem[] = [
  { href: "/desk", label: "Desk", icon: FileText, section: "sidebar-nav-desk" },
  {
    href: "/collections",
    label: "Collections",
    icon: LibraryBig,
    section: "sidebar-nav-collections",
    shortcut: { mac: "⌘⇧K", windows: "Ctrl+Shift+K" },
  },
  { href: "/correspondences", label: "Correspondences", icon: Mails, section: "sidebar-nav-correspondences" },
]

const SIDEBAR_WIDTH_EXPANDED = 292
const SIDEBAR_WIDTH_COLLAPSED = 52
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
    syncSidebarPanelWithPath(pathname)
  }, [initialSidebarMode, pathname])

  const isCollapsed = shellState.sidebarMode === "collapsed"
  const isCollectionsPanelOpen = shellState.panel === "collections"
  const isIconOnly = isCollapsed || isCollectionsPanelOpen

  const sidebarWidth = useMemo(() => {
    if (isCollectionsPanelOpen) {
      return SIDEBAR_WIDTH_COLLAPSED
    }

    return isCollapsed ? SIDEBAR_WIDTH_COLLAPSED : SIDEBAR_WIDTH_EXPANDED
  }, [isCollapsed, isCollectionsPanelOpen])
  const shellLeftOffset = sidebarWidth + (isCollectionsPanelOpen ? 240 : 0)
  const shellStyle = { "--app-shell-left-offset": `${shellLeftOffset}px` } as CSSProperties

  const userDisplayName = user.displayName ?? user.email?.split("@")[0] ?? "Writer"
  const userUsername = user.username ?? "profile"
  const handleSidebarToggle = () => {
    if (isCollectionsPanelOpen) {
      setSidebarPanel(null)
      return
    }

    toggleSidebarMode()
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
        window.location.href = "/write"
        return
      }

      if (action === "settings") {
        event.preventDefault()
        window.location.href = "/settings"
        return
      }

      if (action === "link") {
        event.preventDefault()
        setSidebarPanel(isCollectionsPanelOpen ? null : "collections")
      }
    }

    window.addEventListener("keydown", onWindowKeyDown)

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown)
    }
  }, [isCollectionsPanelOpen])

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
              "SidebarTop flex h-[46px] items-center gap-2",
              isIconOnly ? "justify-center px-2" : "justify-between px-3",
            )}
          >
            <Link
              href="/desk"
              className={cn(
                "overflow-hidden font-sans text-[19px] font-semibold text-[hsl(25_32%_28%)] transition-[width,opacity,color] duration-200 hover:text-[hsl(25_38%_22%)]",
                isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
              )}
            >
              Odessay
            </Link>

            <ActionTooltip
              label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              side="right"
            >
              <button
                type="button"
                onClick={handleSidebarToggle}
                className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border-[0.5px] border-transparent text-ink-3 transition-colors hover:border-border hover:bg-muted hover:text-ink"
                aria-label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeftClose className="h-[18px] w-[18px] -translate-x-[3px]" strokeWidth={1.5} />
              </button>
            </ActionTooltip>
          </div>

          <div
            id="sidebar-actions"
            data-section="sidebar-actions"
            data-testid="sidebar-actions"
            className="SidebarActions p-2"
          >
            <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="right">
              <Link
                href="/write"
                className={cn(
                  "flex h-8 items-center rounded-md text-[15px] font-medium transition-colors",
                  isIconOnly
                    ? "justify-center bg-ink text-bg hover:bg-ink-2"
                    : "gap-2 px-2 text-ink hover:bg-muted",
                )}
                aria-label="New writing"
              >
                <Plus className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                <span
                  className={cn(
                    "overflow-hidden transition-[width,opacity] duration-200",
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
                className={cn(
                  "mt-2 flex h-8 w-full items-center rounded-md text-[15px] text-ink-2 transition-colors hover:bg-muted hover:text-ink",
                  isIconOnly ? "justify-center" : "gap-2 px-2",
                )}
                aria-label="Search"
              >
                <Search className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                <span
                  className={cn(
                    "overflow-hidden transition-[width,opacity] duration-200",
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
            className="SidebarNav flex-1 overflow-y-auto p-2"
          >
            <div className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
                const shortcut = item.shortcut ? getShortcutForPlatform(item.shortcut) : null

                if (item.href === "/collections") {
                  return (
                    <ActionTooltip
                      key={item.href}
                      label={item.label}
                      shortcut={shortcut}
                      side="right"
                    >
                      <Link
                        href={item.href}
                        onClick={(event) => {
                          if (isActive && isCollectionsPanelOpen) {
                            event.preventDefault()
                            setSidebarPanel(null)
                            return
                          }

                          setSidebarPanel("collections")
                        }}
                        id={item.section}
                        data-section={item.section}
                        data-testid={item.section}
                        className={cn(
                          "flex w-full items-center rounded-md px-2 py-[10px] text-[15px] transition-colors",
                          isIconOnly ? "justify-center" : "gap-2",
                          isActive || isCollectionsPanelOpen
                            ? "bg-muted font-medium text-ink"
                            : "text-ink-2 hover:bg-muted-hover hover:text-ink",
                        )}
                        aria-label={item.label}
                      >
                        <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                        <span
                          className={cn(
                            "overflow-hidden transition-[width,opacity] duration-200",
                            isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                          )}
                        >
                          {item.label}
                        </span>
                      </Link>
                    </ActionTooltip>
                  )
                }

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
                        "flex items-center rounded-md px-2 py-[10px] text-[15px] transition-colors",
                        isIconOnly ? "justify-center" : "gap-2",
                        isActive ? "bg-muted font-medium text-ink" : "text-ink-2 hover:bg-muted-hover hover:text-ink",
                      )}
                      aria-label={item.label}
                    >
                      <item.icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.5} />
                      <span
                        className={cn(
                          "overflow-hidden transition-[width,opacity] duration-200",
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
          </div>

          <UserBar collapsed={isIconOnly} displayName={userDisplayName} username={userUsername} />
          </nav>

          <SidebarListPanel open={isCollectionsPanelOpen} />
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>
      </div>
    </TooltipProvider>
  )
}
