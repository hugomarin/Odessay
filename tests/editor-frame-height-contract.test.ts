import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * The editor is a fixed-height frame, not a scrolling page: the topbar is
 * sticky, the status bar and the notes panel are `fixed`, and every content
 * area owns its own scroller. The navigation sidebar is `absolute inset-y-0`
 * inside that frame, so the moment the frame can grow past the app shell's
 * scrollable <main>, the page scrolls and the sidebar's mode controls and
 * header are dragged out of view above the frame.
 *
 * This is a source-level guard on purpose. The failing configuration only
 * exists when EditorShell is nested inside the shell's <main class="…
 * overflow-y-auto">, and no test harness can render it: the perf routes mount
 * EditorShell outside the shell (where `min-h-screen` measures the same as
 * `h-screen`, so the bug is invisible), and /write under (app) requires the
 * Tauri desktop runtime. Asserting the class contract is what actually fails
 * if someone reintroduces `min-h-screen` here.
 */
const read = (path: string) =>
  readFileSync(resolve(process.cwd(), path), "utf8")

describe("editor frame height contract", () => {
  it("locks the editor section to the frame instead of the viewport minimum", () => {
    const source = read("components/editor/editor-shell.tsx")
    const section = source.match(/<section[\s\S]*?id="editor"[\s\S]*?className="([^"]+)"/)
    const layout = source.match(/className="(EditorLayout[^"]+)"/)

    expect(section?.[1]).toBeDefined()
    expect(section?.[1]).toContain("h-screen")
    expect(section?.[1]).not.toContain("min-h-screen")
    expect(section?.[1]).toContain("overflow-hidden")

    expect(layout?.[1]).toBeDefined()
    expect(layout?.[1]).toContain("h-full")
    expect(layout?.[1]).toContain("min-h-0")
    expect(layout?.[1]).not.toContain("min-h-screen")
  })

  it("fills the shell's main on the write route rather than measuring the viewport", () => {
    const source = read("app/(app)/write/layout.tsx")
    const wrapper = source.match(/<div className="([^"]+)"/)

    expect(wrapper?.[1]).toBeDefined()
    expect(wrapper?.[1]).toContain("h-full")
    expect(wrapper?.[1]).not.toContain("min-h-screen")
  })

  it("keeps the navigation sidebar clipped and its scroll gesture contained", () => {
    const source = read(
      "components/editor/panels/editor-navigation-sidebar.tsx",
    )
    // ODE-433 turned the panel into a column of the band; the invariant it has
    // to keep is the same one: clipped, and its wheel gesture contained.
    const scroller = source.match(/className="(od-scroll min-h-0 flex-1 overflow-y-auto[^"]*)"/)

    expect(source).toContain("overflow-hidden")
    expect(source).toContain("w-[var(--size-panel-left)]")
    expect(scroller?.[1]).toContain("overscroll-contain")
  })
})
