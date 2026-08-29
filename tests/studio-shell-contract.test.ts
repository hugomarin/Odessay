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
    expect(toolbar).toContain("text-ink-3")
    expect(toolbar).toContain("[&>svg]:text-ink")
  })

  it("uses gray neutral icons and dark active icons across the editor chrome", () => {
    const topbar = read("components/editor/editor-topbar.tsx")
    const header = read("components/editor/editor-sheet-header.tsx")
    const statusBar = read("components/editor/status-bar.tsx")

    expect(topbar).toContain("text-ink-3 transition-colors")
    expect(topbar).toContain("TITLEBAR_BUTTON_ACTIVE_CLASS = \"bg-surface-selected text-ink\"")
    expect(header).toContain("HEADER_GHOST_BUTTON_CLASS =")
    expect(header).toContain("text-ink-3 transition-colors")
    expect(statusBar).toContain("text-ink-4")
    expect(statusBar).toContain("isNotesPanelOpen ? \"bg-surface-selected text-ink\"")
  })

  it("gives the tab strip a fixed height that scrolling never shrinks", () => {
    const tabItem = read("components/editor/editor-tab-item.tsx")
    const tabs = read("components/editor/editor-tabs.tsx")

    expect(tabItem).toContain("h-[36px]")
    expect(tabItem).toContain("w-[200px]")
    expect(tabItem).toContain("min-w-[96px]")
    expect(tabs).toContain("overflow-x-auto")
    // The strip no longer recomputes a per-tab width from the available space.
    expect(tabs).not.toContain("availableWidth")
  })

  it("cancels interrupted tab drags without leaving a ghost behind", () => {
    const tabs = read("components/editor/editor-tabs.tsx")
    const css = read("app/globals.css")

    expect(tabs).toContain("event.preventDefault()")
    expect(tabs).toContain('data-editor-tab-ghost')
    expect(tabs).toContain('window.addEventListener("pagehide"')
    expect(tabs).toContain('document.querySelectorAll<HTMLElement>("[data-editor-tab-ghost]")')
    expect(css).toContain("html.od-editor-tab-dragging")
  })

  it("presents foreign frontmatter as a quiet, labeled metadata card", () => {
    const node = read("lib/editor/frontmatter-node.ts")
    const css = read("app/globals.css")

    expect(node).toContain('label.className = "odessay-frontmatter-label"')
    expect(node).toContain('label.textContent = "Frontmatter"')
    expect(css).toContain(".odessay-editor-content .odessay-frontmatter-label")
    expect(css).toContain('"Roboto Mono", ui-monospace')
  })

  it("keeps the sheet at 720 with the padding that clears the AI bar", () => {
    const css = read("app/globals.css")

    expect(css).toContain(".odessay-editor-sheet-frame")
    expect(css).toContain("max-width: var(--size-sheet-editor)")
    expect(css).toContain("padding: 48px 24px 140px")
  })

  it("makes focus mode full-bleed while reserving the native titlebar", () => {
    const shell = read("components/editor/editor-shell.tsx")

    // The editor uses the viewport edge-to-edge in focus mode. Only the
    // overlay titlebar's 46px safe area remains above the sheet.
    expect(shell).toContain("focusModeRestorationRef")
    expect(shell).toContain("setActivePanel(null)")
    expect(shell).toContain("setIsFindReplaceOpen(false)")
    expect(shell).toContain('isFocusMode ? "gap-0 px-0 pb-0 pt-[46px]"')
    expect(shell).toContain('isFocusMode ? "rounded-none shadow-none" : "rounded-[10px] shadow-float"')
  })

  it("opens with both side panels closed and one way back in", () => {
    const shell = read("components/editor/editor-shell.tsx")
    const header = read("components/editor/editor-sheet-header.tsx")

    expect(shell).toContain('useState<EditorNavigationMode>(null)')
    // The sheet header's toggles are the only entry point. A second pair used
    // to float over the sheet on the same condition, so with a panel closed the
    // author saw the two icons twice (owner review).
    expect(shell).not.toContain("editor-ghost-rail")
    expect(shell).toContain("showPanelToggles={!navigationMode}")
    expect(header).toContain("showPanelToggles ? (")
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
    // The panel is a column at every width, so nothing reads a narrow-viewport
    // probe any more — it only kept the breadcrumb toggles on screen next to an
    // open panel, which is the duplication this pass removed.
    expect(shell).not.toContain("isNarrowViewport")
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
