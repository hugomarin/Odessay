import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

/**
 * ODE-433 — the Studio shell's geometry and ownership rules, guarded at source
 * level. The failing configurations only exist inside the real app shell (the
 * write route requires an authenticated desktop runtime), so this is the same
 * kind of contract guard as `editor-frame-height-contract`.
 *
 * Anatomy: titlebar 46 · left panel 236 · sheet max 720 with `48 24 140` ·
 * right panel 276 · status bar 46, on the three-column grid.
 */
const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

describe("studio shell contract", () => {
  it("keeps the titlebar and the status bar as siblings of the middle band", () => {
    const titlebar = read("components/editor/editor-topbar.tsx")
    const statusBar = read("components/editor/status-bar.tsx")

    expect(titlebar).toContain("h-[46px]")
    expect(statusBar).toContain("h-[46px]")
    expect(statusBar).toContain("grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]")
    // Neither owns the format toolbar: that lives inside the sheet column.
    expect(titlebar).not.toContain("EditorFormatToolbar")
    // The status bar is in flow under the band, not pinned over the content.
    expect(statusBar).not.toContain("fixed")
  })

  it("puts the format toolbar, the breadcrumb and rename inside the sheet header", () => {
    const header = read("components/editor/editor-sheet-header.tsx")

    expect(header).toContain("EditorFormatToolbar")
    expect(header).toContain("editor-sheet-breadcrumb")
    expect(header).toContain("Rename artifact")
    expect(header).toContain("onDoubleClick={onRename}")
    expect(header).toContain("h-14")
  })

  it("draws the format toolbar at the prototype's stroke weights", () => {
    const toolbar = read("components/editor/editor-format-toolbar.tsx")

    expect(toolbar).toContain('action: "bold", icon: Bold, strokeWidth: 2')
    expect(toolbar).toContain('action: "italic", icon: Italic, strokeWidth: 2')
    expect(toolbar).toContain('action: "inlineCode", icon: Code2, strokeWidth: 1.75')
    expect(toolbar).toContain("h-[30px] w-[30px]")
  })

  it("gives the tab strip a fixed height that scrolling never shrinks", () => {
    const tabItem = read("components/editor/editor-tab-item.tsx")
    const tabs = read("components/editor/editor-tabs.tsx")

    expect(tabItem).toContain("h-[34px]")
    expect(tabItem).toContain("w-[200px]")
    expect(tabItem).toContain("min-w-[96px]")
    expect(tabs).toContain("overflow-x-auto")
    // The strip no longer recomputes a per-tab width from the available space.
    expect(tabs).not.toContain("availableWidth")
  })

  it("keeps the sheet at 720 with the padding that clears the AI bar", () => {
    const css = read("app/globals.css")

    expect(css).toContain(".odessay-editor-sheet-frame")
    expect(css).toContain("max-width: var(--size-sheet-editor)")
    expect(css).toContain("padding: 48px 24px 140px")
  })

  it("holds the sheet in place when focus mode takes the chrome away", () => {
    const shell = read("components/editor/editor-shell.tsx")

    // The band samples the chrome it will lose and pads itself by that much,
    // so entering focus mode cannot move — or re-wrap — a single line.
    expect(shell).toContain("chromeWidthsRef")
    expect(shell).toContain("focusModeCompensation")
    expect(shell).toContain("paddingLeft: `${focusModeCompensation.left}px`")
    expect(shell).toContain("paddingTop: `${focusModeCompensation.top}px`")
  })

  it("opens with both side panels closed and the ghost rail as the way in", () => {
    const shell = read("components/editor/editor-shell.tsx")

    expect(shell).toContain('useState<EditorNavigationMode>(null)')
    expect(shell).toContain("editor-ghost-rail")
    // The ghost rail is only for the state where nothing else offers the toggles.
    expect(shell).toContain("{!navigationMode && !isNarrowViewport && !isFocusMode ? (")
  })

  /**
   * Amended after review on the DMG: the desktop window opens at 1280, so the
   * "overlay below 1440" rule was the panel's normal state and it covered the
   * text. The owner asked for a column at every width.
   */
  it("keeps the right panel as a column of the band at every width", () => {
    const shell = read("components/editor/editor-shell.tsx")

    expect(shell).toContain("w-[var(--size-panel-right)]")
    expect(shell).not.toContain('isNarrowViewport &&\n                "absolute inset-y-0 right-0 z-30')
    // The narrow-viewport probe still drives the header toggles and ghost rail.
    expect(shell).toContain("setIsNarrowViewport(window.innerWidth < 1440)")
  })

  it("debounces the table of contents rebuild and always has a way out", () => {
    const shell = read("components/editor/editor-shell.tsx")

    expect(shell).toContain("TABLE_OF_CONTENTS_DEBOUNCE_MS")
    expect(shell).toContain("scheduleTableOfContentsUpdate")
    // Cleared on unmount and on document switch, so a pending rebuild can never
    // land on the next artifact.
    expect(shell).toContain("window.clearTimeout(tableOfContentsDebounceRef.current)")
    expect(shell).toContain("setTableOfContentsItems([])")
  })

  it("routes rename and shortcuts through the overlay inventory", () => {
    const rename = read("components/editor/modals/rename-writing-modal.tsx")
    const shortcuts = read("components/editor/editor-shortcuts-dialog.tsx")

    expect(rename).toContain('import { FormModal } from "@/components/ui/dialog"')
    expect(rename).toContain("width={440}")
    expect(shortcuts).toContain('import { DisplayModal } from "@/components/ui/display-modal"')
    expect(shortcuts).toContain("md:grid-cols-3")
  })
})
