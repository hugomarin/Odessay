"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Folder,
  FolderTree,
  LampDesk,
  LayoutGrid,
  PanelLeft,
  Plus,
  Search,
  Download,
  X,
} from "lucide-react"
import { SearchModal } from "@/components/navigation/search-modal"
import { UserBar } from "@/components/navigation/user-bar"
import { useRailWorkspaces } from "@/hooks/useRailWorkspaces"
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
 * Rail order, read from the prototypes: New Artifact, Search · Studio, Desk,
 * Workspace with its folders · user bar.
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
    icon: LampDesk,
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
    icon: FolderTree,
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
 * The rail item, read from the prototypes' `railRow`: 40px tall at radius 9,
 * `padding: 0`, `gap: 10`, 14px label.
 *
 * The icon does not live behind padding — it sits in a **fixed 40px column**
 * (`railIconWrap`). That is the mechanism behind "the icon never changes X
 * position when collapsing": at 52px the rail is 6px of padding either side of
 * that column, and expanding only adds room for the label to its right.
 */
const SIDEBAR_ITEM_BASE_CLASS =
  "flex h-10 min-h-10 w-full items-center gap-2.5 rounded-[9px] p-0 text-left text-[16px]"
const SIDEBAR_ICON_WRAP_CLASS =
  "flex h-10 w-10 min-w-10 flex-shrink-0 items-center justify-center"
const SIDEBAR_ITEM_TRANSITION_CLASS = "transition-colors duration-[180ms] ease-layout"
/**
 * The label clips horizontally to stay on one line, so its line box has to be
 * tall enough to contain descenders. The prototypes write `font: 400 14px/1`,
 * and a 14px line box over 14px text cuts the tail off a "g" — the row is 40px
 * and centres its content, so nothing is gained by squeezing the line box.
 */
const SIDEBAR_LABEL_TRANSITION_CLASS =
  "flex-shrink-0 overflow-hidden whitespace-nowrap leading-[1.45] transition-opacity duration-200 ease-out"
const SIDEBAR_ICON_CLASS = "h-[21px] w-[21px] shrink-0"
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
  const workspaces = useRailWorkspaces()

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
              // title bar and keeps its content clear of the lights. The
              // lights sit 13px lower than they used to (`trafficLightPosition`
              // y: 30), so the row grows by the same 13px to stay clear of them.
              isDesktopTitlebar ? "h-[59px]" : "h-[70px]",
              // The row carries no content of its own any more — the toggle is
              // fixed to window coordinates and the wordmark is gone — so it is
              // just the drag region over the lights' row.
              isIconOnly ? "justify-center px-2" : "justify-between gap-2 px-4",
            )}
          >
            {/*
              No wordmark here. The prototypes put nothing in this row but the
              rail toggle and empty space — the app's name belongs to the window
              chrome and the marketing surfaces, not to a column the user reads
              past a hundred times a day.
            */}

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
                    ? /*
                       * Window coordinates: 16px of leading padding, a 76px
                       * traffic-light group, then a 14px gap → 106.
                       *
                       * The Y is measured against where macOS actually draws
                       * the lights, not against `trafficLightPosition` — the
                       * system clamps that value, so the y: 30 in
                       * tauri.conf.json lands the 12px lights at ~20 (centre
                       * 26). The 32px button therefore sits at 26 - 16 = 10 to
                       * share their row. Re-measure before changing it.
                       */
                       "fixed left-[88px] top-[11px] z-50"
                    : isIconOnly
                      ? "mx-auto"
                      : "",
                )}
                aria-label={isIconOnly ? "Expand sidebar" : "Collapse sidebar"}
              >
                <PanelLeft className="h-[18px] w-[18px]" strokeWidth={1.5} />
              </button>
            </ActionTooltip>
            )}
          </div>

          <div
            id="sidebar-actions"
            data-section="sidebar-actions"
            data-testid="sidebar-actions"
            className="SidebarActions flex flex-col gap-0.5 px-[6px] pt-0.5"
          >
            <ActionTooltip label="New writing" shortcut={getEditorShortcutLabel("newWriting")} side="right">
              <Link
                href="/write?new=1"
                className={cn(
                  SIDEBAR_ITEM_BASE_CLASS,
                  SIDEBAR_ITEM_TRANSITION_CLASS,
                  "text-ink-2 hover:bg-muted hover:text-ink",
                )}
                aria-label="New writing"
              >
                <span className={SIDEBAR_ICON_WRAP_CLASS}>
                  <Plus className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                </span>
                <span className={cn(SIDEBAR_LABEL_TRANSITION_CLASS, isIconOnly ? "opacity-0" : "opacity-100")}>
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
                  "text-ink-2 hover:bg-muted hover:text-ink",
                )}
                aria-label="Search"
              >
                <span className={SIDEBAR_ICON_WRAP_CLASS}>
                  <Search className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                </span>
                <span className={cn(SIDEBAR_LABEL_TRANSITION_CLASS, isIconOnly ? "opacity-0" : "opacity-100")}>
                  Search
                </span>
              </button>
            </ActionTooltip>
          </div>

          <div
            id="sidebar-nav"
            data-section="sidebar-nav"
            data-testid="sidebar-nav"
            /*
              The views never scroll — the rail is a closed inventory. Only the
              workspace folders below do, so a long list can never push the user
              bar off the bottom of the window.

              Padding from the prototypes' nav block: 26px above, 8px below.
            */
            className="SidebarNav flex min-h-0 flex-1 flex-col gap-0.5 px-[6px] pb-2 pt-[26px]"
          >
            {navItems.map((item) => {
              const isActive = pathname === item.href || pathname.startsWith(`${item.href}/`)
              const shortcut = item.shortcut ? getShortcutForPlatform(item.shortcut) : null

              return (
                <div key={item.href} className="flex flex-shrink-0 flex-col">
                  <ActionTooltip label={item.label} shortcut={shortcut} side="right">
                    <Link
                      href={item.href}
                      id={item.section}
                      data-section={item.section}
                      data-testid={item.section}
                      className={cn(
                        SIDEBAR_ITEM_BASE_CLASS,
                        SIDEBAR_ITEM_TRANSITION_CLASS,
                        // The prototypes make the active state the darker of the
                        // two and the only one at weight 500; the repo had the
                        // two surfaces the other way round.
                        isActive
                          ? "bg-muted-hover font-medium text-ink"
                          : "font-normal text-ink-2 hover:bg-muted hover:text-ink",
                      )}
                      aria-label={item.label}
                    >
                      <span className={SIDEBAR_ICON_WRAP_CLASS}>
                        <item.icon className={SIDEBAR_ICON_CLASS} strokeWidth={1.5} />
                      </span>
                      <span
                        className={cn(
                          SIDEBAR_LABEL_TRANSITION_CLASS,
                          isIconOnly ? "opacity-0" : "opacity-100",
                        )}
                      >
                        {item.label}
                      </span>
                    </Link>
                  </ActionTooltip>

                  {/*
                    The workspace folders hang under the Workspace item, indented
                    to 50px so they line up past the icon column. This is the
                    block the prototypes draw where the repo used to list
                    "Recent" — the rail is an inventory of places, not of
                    history. It collapses to `max-height: 0` with the rail.
                  */}
                  {item.href === "/workspace" ? (
                    <div
                      data-section="sidebar-workspace-folders"
                      data-testid="sidebar-workspace-folders"
                      className={cn(
                        "od-scroll flex min-h-0 flex-col gap-px overflow-y-auto pl-[50px] pt-0.5",
                        "transition-[max-height,opacity] duration-300 ease-layout",
                        isIconOnly ? "max-h-0 opacity-0" : "max-h-[240px] opacity-100",
                      )}
                    >
                      {workspaces.map((workspace) => (
                        <Link
                          key={workspace.slug}
                          href={`/workspace?slug=${encodeURIComponent(workspace.slug)}`}
                          data-testid="sidebar-workspace-folder"
                          title={workspace.name}
                          className="flex h-8 flex-shrink-0 items-center gap-[9px] rounded-[8px] px-2.5 text-[15px] font-normal leading-[1.45] text-ink-4 transition-colors duration-[180ms] hover:bg-muted hover:text-ink"
                        >
                          <Folder className="h-[17px] w-[17px] flex-shrink-0" strokeWidth={1.5} />
                          <span className="truncate">{workspace.name}</span>
                        </Link>
                      ))}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>

          <UserBar collapsed={isIconOnly} displayName={userDisplayName} username={userUsername} />
          </nav>
        </div>

        <main className="min-w-0 flex-1 overflow-y-auto">{children}</main>

        <SearchModal open={searchOpen} onOpenChange={setSearchOpen} />
      </div>
    </TooltipProvider>
  )
}
