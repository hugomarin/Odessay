"use client"

import { useEffect, useLayoutEffect, useMemo, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { FileText, LibraryBig, Mails, PanelLeftClose, Plus, Search } from "lucide-react"
import { SidebarListPanel } from "@/components/navigation/sidebar-list-panel"
import { UserBar } from "@/components/navigation/user-bar"
import {
  initializeUiShellStore,
  setSidebarPanel,
  syncSidebarPanelWithPath,
  toggleSidebarMode,
  useUiShellStore,
} from "@/lib/stores/ui-shell-store"
import { cn } from "@/lib/utils"

type SidebarProps = Readonly<{
  children: React.ReactNode
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
}

const NAV_ITEMS: NavItem[] = [
  { href: "/desk", label: "Desk", icon: FileText, section: "sidebar-nav-desk" },
  { href: "/collections", label: "Collections", icon: LibraryBig, section: "sidebar-nav-collections" },
  { href: "/correspondences", label: "Correspondences", icon: Mails, section: "sidebar-nav-correspondences" },
]

const SIDEBAR_WIDTH_EXPANDED = 292
const SIDEBAR_WIDTH_COLLAPSED = 52
const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect

export function Sidebar({ children, user }: SidebarProps) {
  const pathname = usePathname()
  const shellState = useUiShellStore()

  useIsomorphicLayoutEffect(() => {
    initializeUiShellStore()
    syncSidebarPanelWithPath(pathname)
  }, [pathname])

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

  return (
    <div
      className="flex h-screen overflow-hidden bg-bg"
      style={shellStyle}
    >
      <div className="flex h-full shrink-0">
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
              "SidebarTop flex h-[46px] items-center gap-2 border-b-[0.5px] border-border",
              isIconOnly ? "justify-center px-2" : "justify-between px-3",
            )}
          >
            <Link
              href="/desk"
              className={cn(
                "overflow-hidden font-lora text-[17px] text-ink transition-[width,opacity] duration-200",
                isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
              )}
            >
              Odessay
            </Link>

            <button
              type="button"
              onClick={handleSidebarToggle}
              className="inline-flex h-8 w-8 items-center justify-center rounded-[6px] border-[0.5px] border-transparent text-ink-3 transition-colors hover:border-border hover:bg-muted hover:text-ink"
              aria-label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
            >
              <PanelLeftClose className="h-[14px] w-[14px]" strokeWidth={1.5} />
            </button>
          </div>

          <div
            id="sidebar-actions"
            data-section="sidebar-actions"
            data-testid="sidebar-actions"
            className="SidebarActions border-b-[0.5px] border-border p-2"
          >
            <Link
              href="/write"
              className={cn(
                "flex h-8 items-center rounded-md text-[15px] font-medium transition-colors",
                isIconOnly
                  ? "justify-center bg-ink text-bg hover:bg-ink-2"
                  : "gap-2 px-2 text-ink hover:bg-muted",
              )}
              aria-label="New writing"
              title="New writing"
            >
              <Plus className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
              <span
                className={cn(
                  "overflow-hidden transition-[width,opacity] duration-200",
                  isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                )}
              >
                New writing
              </span>
            </Link>

            <button
              type="button"
              className={cn(
                "mt-2 flex h-8 w-full items-center rounded-md text-[15px] text-ink-2 transition-colors hover:bg-muted hover:text-ink",
                isIconOnly ? "justify-center" : "gap-2 px-2",
              )}
              aria-label="Search"
              title="Search"
            >
              <Search className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
              <span
                className={cn(
                  "overflow-hidden transition-[width,opacity] duration-200",
                  isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                )}
              >
                Search
              </span>
            </button>
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

                if (item.href === "/collections") {
                  return (
                    <Link
                      key={item.href}
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
                      title={item.label}
                    >
                      <item.icon className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
                      <span
                        className={cn(
                          "overflow-hidden transition-[width,opacity] duration-200",
                          isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  )
                }

                return (
                  <Link
                    key={item.href}
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
                    title={item.label}
                  >
                    <item.icon className="h-[14px] w-[14px] shrink-0" strokeWidth={1.5} />
                    <span
                      className={cn(
                        "overflow-hidden transition-[width,opacity] duration-200",
                        isIconOnly ? "w-0 opacity-0" : "w-auto opacity-100",
                      )}
                    >
                      {item.label}
                    </span>
                  </Link>
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
  )
}
