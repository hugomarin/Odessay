/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { DeskArtifactList } from "@/components/desk/desk-artifact-list"
import { DeskArtifactRow } from "@/components/desk/desk-artifact-row"
import { DeskHeader } from "@/components/desk/desk-header"
import { DeskFilterBar, DeskFilterEmptyState } from "@/components/desk/filter-bar"
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"
import { WRITING_STATUS_VALUES } from "@/lib/writings/status"
import { getVocabularyCatalogSnapshot } from "@/lib/vocabulary/catalog"
import { getVocabularyColor } from "@/lib/vocabulary/resolve"
import { VOCABULARY_COLORS } from "@/lib/settings/vocabulary"

/**
 * ODE-430 — the redesigned Desk.
 *
 * Values are asserted against `docs/design/reference/Artifact Studio Desk.dc.html`,
 * which is this issue's visual authority. Where the render and
 * `docs/design/views/desk.md` disagree the render wins, and each of those is
 * recorded in the PR.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}))

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.restoreAllMocks()
})

function render(node: React.ReactNode) {
  act(() => root.render(node))
}

/**
 * A row draws the document-state glyph, which is a tooltip trigger. The list
 * supplies the provider in production; a row rendered on its own needs it here.
 */
function renderRow(node: React.ReactNode) {
  render(<DocumentStateTooltipProvider>{node}</DocumentStateTooltipProvider>)
}

function makeRow(overrides: Partial<DeskActivityRow> = {}): DeskActivityRow {
  return {
    id: "row-1",
    title: "Leccion 5 - Evaluacion de prompts",
    excerpt: "En la lección anterior repetimos una frase hasta el cansancio.",
    localPath: null,
    stateLabel: "Draft",
    stateTone: "draft",
    documentState: "synced",
    artifactType: "general",
    recipientPreviews: [],
    dateLabel: "2d",
    isNew: false,
    destinationHref: "/write/row-1",
    workspaceSlug: null,
    workspaceName: null,
    ...overrides,
  }
}

const FILTER_BAR_PROPS = {
  searchQuery: "",
  onSearchChange: () => {},
  selectedCollectionIds: [] as string[],
  onToggleCollection: () => {},
  selectedStatuses: [] as never[],
  onToggleStatus: () => {},
  selectedArtifactTypes: [] as never[],
  onToggleArtifactType: () => {},
  selectedWorkspaceSlugs: [] as string[],
  onToggleWorkspace: () => {},
  createdDateFilter: null,
  onCreatedDateFilterChange: () => {},
  createdDateFrom: "",
  onCreatedDateFromChange: () => {},
  createdDateTo: "",
  onCreatedDateToChange: () => {},
  groupBy: "none" as const,
  onGroupByChange: () => {},
  sortBy: "created-at-desc" as const,
  onSortByChange: () => {},
  collectionOptions: [],
  workspaceOptions: [],
  activeFilterCount: 0,
  hasActiveFilters: false,
  filteredCount: 8,
  totalCount: 8,
}

const ROW_PROPS = {
  selected: false,
  enabledStatuses: [...WRITING_STATUS_VALUES],
  workspaceOptions: [],
  workspaceAvailable: false,
}

describe("header", () => {
  beforeEach(() => render(<DeskHeader />))

  it("sets the title at 36/500 with the prototype's tracking", () => {
    const heading = container.querySelector("h1")
    expect(heading?.textContent).toBe("Desk")
    expect(heading?.className).toContain("text-[36px]")
    expect(heading?.className).toContain("font-medium")
    expect(heading?.className).toContain("tracking-[-0.02em]")
  })

  it("keeps the 12px top / 16px trailing / 16px bottom header rhythm", () => {
    const header = container.querySelector('[data-testid="desk-header"]')
    expect(header?.className).toContain("pt-3")
    expect(header?.className).toContain("pl-[var(--app-shell-content-gutter,16px)]")
    expect(header?.className).toContain("pr-4")
    expect(header?.className).toContain("pb-4")
  })

  it("names the primary action 'New Artifact' and gives it the ink 40px box", () => {
    const action = container.querySelector('[data-testid="desk-new-artifact"]')
    expect(action?.textContent).toContain("New Artifact")
    expect(action?.className).toContain("h-10")
    expect(action?.className).toContain("rounded-[9px]")
    expect(action?.className).toContain("bg-ink")
  })
})

describe("filter bar", () => {
  it("keeps one row of 38px controls", () => {
    render(<DeskFilterBar {...FILTER_BAR_PROPS} />)
    for (const testId of ["desk-filter-trigger", "desk-group-trigger", "desk-sort-trigger"]) {
      const control = container.querySelector(`[data-testid="${testId}"]`)
      expect(control?.className).toContain("h-[38px]")
      expect(control?.className).toContain("text-[14px]")
      expect(control?.className).toContain("font-medium")
      expect(control?.className).toContain("[&>svg]:text-ink-3")
    }
    expect(container.querySelector('[data-testid="desk-filter-search"]')?.parentElement?.className).toContain("h-[38px]")
    expect(container.querySelector('[data-testid="desk-filter-search"]')?.className).toContain("text-[14px]")
  })

  it("carries the prototype's placeholder", () => {
    render(<DeskFilterBar {...FILTER_BAR_PROPS} />)
    expect(container.querySelector('[data-testid="desk-filter-search"]')?.getAttribute("placeholder")).toBe(
      "Filter by name…",
    )
  })

  it("shows applied filters as a count on the trigger, and does not grow", () => {
    render(<DeskFilterBar {...FILTER_BAR_PROPS} />)
    const bar = container.querySelector('[data-testid="desk-filter-bar"]')!
    const emptyChildren = bar.children.length
    expect(container.querySelector('[data-testid="desk-filter-trigger"]')?.textContent).toContain("Filter")

    render(<DeskFilterBar {...FILTER_BAR_PROPS} activeFilterCount={6} hasActiveFilters />)
    const filtered = container.querySelector('[data-testid="desk-filter-bar"]')!
    // Same number of children with 0 and with 6 filters: the count lives on the
    // trigger, so no chip row appears underneath and the bar's height is fixed.
    expect(filtered.children.length).toBe(emptyChildren)
    expect(container.querySelector('[data-testid="desk-filter-trigger"]')?.textContent).toContain("Filter · 6")
  })
})

describe("artifact row", () => {
  it("draws the prototype's hairline and hover, not the prose's", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} />)
    const row = container.querySelector('[data-testid="desk-artifact-row"]')
    // The prototype renders #F0EEEB (--line-softer) between rows; the prose
    // writes #EDEBE8. Recorded as a divergence in the PR.
    expect(row?.className).toContain("border-line-softer")
    expect(row?.className).toContain("hover:bg-surface-row-hover")
  })

  it("keeps the checkbox visible at all times, not only on hover", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} />)
    const checkbox = container.querySelector('[data-testid="desk-artifact-row-checkbox"]')
    expect(checkbox).not.toBeNull()
    expect(checkbox?.className).not.toContain("opacity-0")
    expect(checkbox?.className).not.toContain("group-hover:")
  })

  it("titles the relative date with the absolute one", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} absoluteDate="12 August 2026 at 09:30" />)
    const date = Array.from(container.querySelectorAll("span")).find((span) => span.textContent === "2d")
    expect(date?.getAttribute("title")).toBe("12 August 2026 at 09:30")
  })

  it("caps the excerpt at 88ch on one line", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} />)
    const excerpt = container.querySelector("p")
    expect(excerpt?.className).toContain("truncate")
    expect(excerpt?.parentElement?.className).toContain("max-w-[88ch]")
  })

  it("keeps edit and preview keyboard-accessible while revealing them on row intent", () => {
    const onRenameWriting = vi.fn()
    const onPreviewWriting = vi.fn()
    renderRow(
      <DeskArtifactRow
        {...ROW_PROPS}
        row={makeRow()}
        onRenameWriting={onRenameWriting}
        onPreviewWriting={onPreviewWriting}
      />,
    )

    const rename = container.querySelector<HTMLButtonElement>('button[aria-label^="Rename"]')!
    const preview = container.querySelector<HTMLButtonElement>('button[aria-label^="Preview"]')!
    for (const button of [rename, preview]) {
      expect(button.tagName).toBe("BUTTON")
      expect(button.hasAttribute("tabindex")).toBe(false)
      expect(button.className).toContain("opacity-0")
      expect(button.className).toContain("group-hover/desk-row:opacity-100")
      expect(button.className).toContain("group-focus-within/desk-row:opacity-100")
      expect(button.className).toContain("focus-visible:opacity-100")
    }

    act(() => preview.click())
    expect(onPreviewWriting).toHaveBeenCalledWith("row-1")
  })

  it("drops the control cluster below the prototype's threshold", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} />)
    const controls = container.querySelector('[data-testid="desk-artifact-row-controls"]')
    expect(controls?.className).toContain("hidden")
    expect(controls?.className).toContain("min-[1240px]:flex")
  })

  it("surfaces a mutation failure on the row itself", () => {
    renderRow(<DeskArtifactRow {...ROW_PROPS} row={makeRow()} error="Couldn't change the status. Try again." />)
    const error = container.querySelector('[data-testid="desk-artifact-row-error"]')
    expect(error?.textContent).toContain("Couldn't change the status")
    expect(container.querySelector('[data-testid="desk-artifact-row"]')?.contains(error!)).toBe(true)
  })
})

describe("status colour (ODE-474)", () => {
  it("resolves every base status through the shared vocabulary catalog", () => {
    const catalog = getVocabularyCatalogSnapshot()
    for (const status of WRITING_STATUS_VALUES) {
      const color = getVocabularyColor(catalog, "status", status)
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
      // A user's vocabulary colour, not a design token: it must be one of
      // the six admissible palette hexes, not an arbitrary/legacy value.
      expect(VOCABULARY_COLORS.some((c) => c.hex.toLowerCase() === color.toLowerCase())).toBe(true)
    }
  })

  it.each([
    ["components/desk/desk-artifact-row.tsx"],
    ["components/desk/filter-bar.tsx"],
  ])("%s resolves status colour through the shared catalog, not a local map", (file) => {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8")
    expect(source).not.toMatch(/writings\/status-color/)
  })

  it("desk-status-dot.tsx resolves through lib/vocabulary/resolve.ts, not a local map", () => {
    const source = readFileSync(resolve(__dirname, "../components/desk/desk-status-dot.tsx"), "utf8")
    expect(source).toMatch(/vocabulary\/resolve/)
    expect(source).not.toMatch(/writings\/status-color/)
  })
})

describe("list states", () => {
  const groups = [{ label: "Today", rows: [makeRow(), makeRow({ id: "row-2", title: "Omega" })] }]

  it("renders skeleton rows, not a spinner, while it has nothing to show", () => {
    render(<DeskArtifactList groups={[]} isLoading />)
    expect(container.querySelectorAll('[data-testid="desk-artifact-row-skeleton"]').length).toBeGreaterThan(0)
    expect(container.querySelector('[data-testid="desk-artifact-skeletons"]')?.getAttribute("aria-busy")).toBe(
      "true",
    )
  })

  it("shows the rows it has rather than skeletons over them", () => {
    render(<DeskArtifactList groups={groups} isLoading />)
    expect(container.querySelector('[data-testid="desk-artifact-row-skeleton"]')).toBeNull()
    expect(container.querySelectorAll('[data-testid="desk-artifact-row"]').length).toBe(2)
  })

  it("labels a group with its count", () => {
    render(<DeskArtifactList groups={groups} />)
    const group = container.querySelector('[data-testid="desk-artifact-group"]')
    expect(group?.textContent).toContain("Today")
    expect(group?.textContent).toContain("2")
  })

  it("marks its scroll area as the sheet the selection bar pads", () => {
    render(<DeskArtifactList groups={groups} />)
    expect(container.querySelector("[data-selection-bar-sheet]")).not.toBeNull()
  })

  it("renders the empty state inside the sheet, never as a page", () => {
    render(<DeskArtifactList groups={[]} emptyState={<DeskFilterEmptyState onClear={() => {}} />} />)
    const sheet = container.querySelector("[data-selection-bar-sheet]")
    const empty = container.querySelector('[data-testid="desk-filter-empty"]')
    expect(empty).not.toBeNull()
    expect(sheet?.contains(empty!)).toBe(true)
  })
})

describe("no results", () => {
  it("offers 'Clear all', which the prose requires and the prototype does not draw", () => {
    const onClear = vi.fn()
    render(<DeskFilterEmptyState onClear={onClear} />)
    const button = container.querySelector<HTMLButtonElement>('[data-testid="desk-filter-empty-clear"]')!
    expect(container.textContent).toContain("No results")
    act(() => button.click())
    expect(onClear).toHaveBeenCalledTimes(1)
  })

  it("sets it in Lora at the prototype's 20px, not the prose's 18", () => {
    render(<DeskFilterEmptyState onClear={() => {}} />)
    const heading = container.querySelector("p")
    expect(heading?.className).toContain("font-lora")
    expect(heading?.className).toContain("text-[20px]")
  })
})

describe("the Desk introduces no new data source", () => {
  it.each([
    ["components/desk/desk-artifact-list.tsx"],
    ["components/desk/desk-artifact-row.tsx"],
  ])("%s reads nothing from storage directly", (file) => {
    const source = readFileSync(resolve(__dirname, "..", file), "utf8")
    for (const forbidden of ["@/lib/local-db", "@/lib/supabase", "document-catalog-factory", "@tauri-apps"]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
