/** @vitest-environment happy-dom */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { Sidebar } from "@/components/navigation/sidebar"

/**
 * ODE-447 — the app rail.
 *
 * `docs/design/layout.md` §2 and §5 and `docs/design/system-app.md` §3–§6 are
 * the authority; the four prototypes of the package draw the rail and agree on
 * it. Divergences are recorded in the PR.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

let pathname = "/desk"

vi.mock("next/navigation", () => ({
  usePathname: () => pathname,
}))

vi.mock("next/link", () => ({
  default: ({ children, href, ...rest }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...rest}>
      {children}
    </a>
  ),
}))

const recentWritings = vi.fn(() => [] as Array<{ writingId: string; slug: string | null; title: string; isOpen: boolean }>)
vi.mock("@/hooks/useRecentWritings", () => ({
  useRecentWritings: () => recentWritings(),
}))

vi.mock("@/components/navigation/search-modal", () => ({
  SearchModal: () => null,
}))

vi.mock("@/components/navigation/user-bar", () => ({
  UserBar: () => <div data-testid="user-bar" />,
}))

vi.mock("@/lib/desktop/update-checker", () => ({
  checkForUpdate: () => Promise.resolve({ kind: "none" as const }),
  installUpdate: vi.fn(),
  formatUpdateLabel: () => "",
}))

let isTauri = false
vi.mock("@/lib/runtime/detect", () => ({
  isTauriRuntime: () => isTauri,
}))

/** happy-dom has no matchMedia; the rail's forced-collapse query needs one. */
let viewportWidth = 1440
function installMatchMedia() {
  const listeners = new Set<() => void>()
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    configurable: true,
    value: (query: string) => {
      const limit = Number(/max-width:\s*(\d+)px/.exec(query)?.[1] ?? "0")
      return {
        get matches() {
          return viewportWidth <= limit
        },
        media: query,
        addEventListener: (_: string, handler: () => void) => listeners.add(handler),
        removeEventListener: (_: string, handler: () => void) => listeners.delete(handler),
      }
    },
  })
  return () => listeners.forEach((handler) => handler())
}

let container: HTMLDivElement
let root: Root
let fireMediaChange: () => void

function renderRail(mode: "collapsed" | "expanded" = "expanded") {
  act(() =>
    root.render(
      <Sidebar
        initialSidebarMode={mode}
        user={{ displayName: "Hugo", email: "hugo@z9ne.com", username: "hugomarin" }}
      >
        <div />
      </Sidebar>,
    ),
  )
}

const rail = () => container.querySelector<HTMLElement>("#sidebar")!
const navLink = (section: string) => container.querySelector<HTMLElement>(`[data-testid="${section}"]`)!

beforeEach(() => {
  pathname = "/desk"
  isTauri = false
  viewportWidth = 1440
  recentWritings.mockReturnValue([])
  fireMediaChange = installMatchMedia()
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

describe("geometry", () => {
  it("expands to 232px, not the repo's old 292", () => {
    renderRail("expanded")
    expect(rail().style.width).toBe("232px")
  })

  it("collapses to 52px", () => {
    renderRail("collapsed")
    expect(rail().style.width).toBe("52px")
  })

  it("sits on layer 0 — no background and no border of its own", () => {
    renderRail("expanded")
    expect(rail().className).toContain("bg-transparent")
    expect(rail().className).not.toContain("bg-sb")
    expect(rail().className).not.toContain("border-r")
  })

  it("gives every item a 40px box at radius 9 with 19px icons", () => {
    renderRail("expanded")
    for (const section of [
      "sidebar-nav-studio",
      "sidebar-nav-desk",
      "sidebar-nav-workspace",
      "sidebar-nav-collections",
    ]) {
      const item = navLink(section)
      expect(item.className).toContain("h-10")
      expect(item.className).toContain("rounded-[9px]")
      expect(item.querySelector("svg")?.getAttribute("class")).toContain("h-[19px]")
    }
  })

  it("keeps the icon's X position identical in both states", () => {
    // The horizontal padding of the item and of the rail are the same whether
    // the rail is open or shut, so only the label animates. This is the
    // requirement the spec words as "the icon never changes X position".
    renderRail("expanded")
    const expanded = navLink("sidebar-nav-desk").className
    renderRail("collapsed")
    const collapsed = navLink("sidebar-nav-desk").className

    expect(expanded).toContain("px-[10px]")
    expect(collapsed).toContain("px-[10px]")
    expect(expanded).toContain("w-full")
    expect(collapsed).toContain("w-10")
  })

  it("uses the 300ms layout easing on the width", () => {
    renderRail("expanded")
    expect(rail().className).toContain("duration-[300ms]")
    expect(rail().className).toContain("ease-layout")
  })
})

describe("inventory and order", () => {
  it("orders the views Studio · Desk · Workspace, as the package fixes", () => {
    renderRail("expanded")
    const order = Array.from(
      container.querySelectorAll<HTMLElement>('[data-section^="sidebar-nav-"]'),
    ).map((node) => node.dataset.section)

    expect(order).toEqual([
      "sidebar-nav-studio",
      "sidebar-nav-desk",
      "sidebar-nav-workspace",
      "sidebar-nav-collections",
    ])
  })

  it("keeps Collections, which the spec's inventory omits but nothing else reaches", () => {
    renderRail("expanded")
    expect(navLink("sidebar-nav-collections").getAttribute("href")).toBe("/collections")
  })

  it("leaves each shortcut on its own destination despite the new order", () => {
    // Reordering the rail must not silently repoint ⌘⌥1/2/3.
    renderRail("expanded")
    expect(navLink("sidebar-nav-desk").getAttribute("href")).toBe("/desk")
    expect(navLink("sidebar-nav-workspace").getAttribute("href")).toBe("/workspace")
    expect(navLink("sidebar-nav-studio").getAttribute("href")).toBe("/write")
  })

  it("marks the active view from the route, subroutes included", () => {
    pathname = "/workspace/notes"
    renderRail("expanded")
    expect(navLink("sidebar-nav-workspace").className).toContain("bg-muted-hover")
    expect(navLink("sidebar-nav-desk").className).not.toContain("bg-muted-hover")
  })
})

describe("forced collapse below 900px", () => {
  it("collapses the rail without touching the stored preference", () => {
    renderRail("expanded")
    expect(rail().style.width).toBe("232px")

    viewportWidth = 820
    act(() => fireMediaChange())
    expect(rail().style.width).toBe("52px")

    // Widening restores what the user chose, not a default.
    viewportWidth = 1440
    act(() => fireMediaChange())
    expect(rail().style.width).toBe("232px")
  })

  it("removes the toggle while the width is what decides the state", () => {
    renderRail("expanded")
    expect(container.querySelector('button[aria-label="Collapse sidebar"]')).not.toBeNull()

    viewportWidth = 820
    act(() => fireMediaChange())
    expect(container.querySelector('button[aria-label="Expand sidebar"]')).toBeNull()
    expect(container.querySelector('button[aria-label="Collapse sidebar"]')).toBeNull()
  })
})

describe("recents", () => {
  it("scrolls in its own block so a long list never pushes the user bar out", () => {
    recentWritings.mockReturnValue(
      Array.from({ length: 8 }, (_, index) => ({
        writingId: `w-${index}`,
        slug: null,
        title: `Artifact ${index}`,
        isOpen: false,
      })),
    )
    renderRail("expanded")

    const scroller = container.querySelector<HTMLElement>('[data-testid="sidebar-recents-scroll"]')!
    expect(scroller.className).toContain("overflow-y-auto")
    expect(scroller.className).toContain("min-h-0")

    // The views above it are not inside the scroller, and the user bar is not
    // inside the nav at all.
    expect(scroller.contains(navLink("sidebar-nav-desk"))).toBe(false)
    const userBar = container.querySelector('[data-testid="user-bar"]')!
    expect(container.querySelector("#sidebar-nav")!.contains(userBar)).toBe(false)
  })

  it("renders one list for one catalog change, not one per recent row", () => {
    // Reactive fan-out: the rail subscribes once through useRecentWritings and
    // paints the whole block from that single answer.
    recentWritings.mockReturnValue(
      Array.from({ length: 8 }, (_, index) => ({
        writingId: `w-${index}`,
        slug: null,
        title: `Artifact ${index}`,
        isOpen: false,
      })),
    )
    renderRail("expanded")

    expect(recentWritings).toHaveBeenCalledTimes(1)
  })
})

describe("desktop title bar", () => {
  it("keeps the toggle clear of the traffic lights in the Tauri runtime", () => {
    isTauri = true
    renderRail("expanded")

    const toggle = container.querySelector<HTMLElement>('button[aria-label="Collapse sidebar"]')!
    expect(toggle.className).toContain("fixed")
    expect(toggle.className).toContain("left-[82px]")
    expect(container.querySelector<HTMLElement>('[data-testid="sidebar-top"]')!.className).toContain(
      "h-[46px]",
    )
  })
})
