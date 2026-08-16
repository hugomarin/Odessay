/**
 * @vitest-environment happy-dom
 */
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { act } from "react"
import type { ReactNode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import { PreviewLinkSection } from "@/components/sharing/preview-link-section"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"

/**
 * ODE-434 — the artifact preview overlay and its sharing card.
 *
 * The overlay and the card live inside `Artifact Studio Desk.dc.html`, which is
 * this issue's visual authority. Divergences from `docs/design/views/desk.md`
 * §Preview overlay are recorded in the PR.
 */

;(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children, className }: { children: ReactNode; className?: string }) => (
    <div data-testid="dialog-content" className={className}>
      {children}
    </div>
  ),
  DialogDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

const fetchPreview = vi.fn()

/**
 * One stable object, not a fresh literal per call: the real hook memoises its
 * handles, and a mock that does not would change the load effect's dependencies
 * on every render and spin forever.
 */
const previewCache = {
  fetchPreview,
  getCachedPreview: () => null,
  prefetchPreview: () => {},
  retainOnly: () => {},
  clear: () => {},
  updatePreviewTitle: () => {},
}

vi.mock("@/hooks/useWritingPreviewCache", () => ({
  useWritingPreviewCache: () => previewCache,
}))

vi.mock("@/components/settings/user-settings-provider", () => ({
  useUserSettingsContext: () => ({ settings: { disabledStatuses: [] } }),
}))

vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    getPreviewLink: vi
      .fn()
      .mockResolvedValue({ data: { active: false, token: null, link: null, createdAt: null }, error: null }),
    rotatePreviewLink: vi.fn().mockResolvedValue({
      data: {
        active: true,
        token: "preview-token",
        link: "https://app.odessay.com/preview/preview-token",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    }),
    revokePreviewLink: vi.fn().mockResolvedValue({ data: { writingId: "writing-1", revoked: true }, error: null }),
  }),
}))

vi.mock("@/components/collections/collection-assignment-menu", () => ({
  CollectionAssignmentMenu: ({ trigger }: { trigger: ReactNode }) => <>{trigger}</>,
}))

vi.mock("@/components/desk/workspace-assignment-dropdown", () => ({
  WorkspaceAssignmentDropdown: () => <button type="button">Planning Harness</button>,
}))

vi.mock("@/components/reading/writing-content-frame", () => ({
  WritingContentFrame: () => <div>Writing content</div>,
}))

vi.mock("@/components/preview/annotations-preview", () => ({
  AnnotationsPreview: () => <div>No annotations yet</div>,
}))

vi.mock("@/components/desk/delete-writing-dialog", () => ({
  DeleteWritingDialog: () => null,
}))

const row: DeskActivityRow = {
  id: "writing-1",
  title: "A clear preview",
  excerpt: "",
  localPath: "/Users/hugomarin/Documents/Tutoria/A clear preview.md",
  stateLabel: "Draft",
  stateTone: "draft",
  documentState: "synced",
  artifactType: "agent",
  recipientPreviews: [],
  dateLabel: "Today",
  isNew: false,
  destinationHref: "/write/writing-1",
  workspaceSlug: "planning-harness",
  workspaceName: "Planning Harness",
}

const secondRow: DeskActivityRow = { ...row, id: "writing-2", title: "Second preview" }

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  fetchPreview.mockResolvedValue(null)
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
  document.body.innerHTML = ""
  vi.clearAllMocks()
})

function renderOverlay(overrides: Partial<React.ComponentProps<typeof WritingPreviewModal>> = {}) {
  act(() =>
    root.render(
      <WritingPreviewModal
        open
        rows={[row, secondRow]}
        currentIndex={0}
        collectionOptions={[]}
        collectionIdsByWritingId={{}}
        onOpenChange={vi.fn()}
        onIndexChange={vi.fn()}
        onToggleCollection={vi.fn().mockResolvedValue(undefined)}
        onCreateCollection={vi.fn().mockResolvedValue(undefined)}
        onStatusChange={vi.fn().mockResolvedValue(undefined)}
        onArtifactTypeChange={vi.fn().mockResolvedValue(undefined)}
        workspaceAvailable
        onAssignWorkspace={vi.fn()}
        onUnassignWorkspace={vi.fn()}
        onCreateWorkspace={vi.fn()}
        onOpenFullWriting={vi.fn()}
        onExportMarkdown={vi.fn()}
        onExportDocument={vi.fn().mockResolvedValue(undefined)}
        onOpenWebAction={vi.fn().mockResolvedValue(undefined)}
        {...overrides}
      />,
    ),
  )
}

function press(key: string) {
  act(() => {
    window.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }))
  })
}

describe("the overlay's shell", () => {
  it("is the prototype's centred dialog, not an edge-to-edge inset:0 surface", () => {
    renderOverlay()
    const content = container.querySelector('[data-testid="dialog-content"]')
    // Prototype: width min(1160px, 100%), height min(840px, 100%), radius 14,
    // padding 0 8px 8px over the canvas colour. The prose says `inset: 0`.
    expect(content?.className).toContain("w-[min(1160px,100%)]")
    expect(content?.className).toContain("h-[min(840px,100%)]")
    expect(content?.className).toContain("rounded-bar")
    expect(content?.className).toContain("bg-bg")
  })

  it("gives the chrome row 48px", () => {
    renderOverlay()
    expect(container.querySelector('[data-testid="preview-chrome"]')?.className).toContain("h-12")
  })

  it("counts the artifacts in the chrome", () => {
    renderOverlay()
    expect(container.querySelector('[data-testid="preview-counter"]')?.textContent).toBe("1 of 2")
  })

  it("gives the properties column the prototype's 308px, not the prose's 276", () => {
    renderOverlay()
    expect(container.querySelector('[data-testid="preview-properties"]')?.className).toContain("w-[308px]")
  })
})

describe("the left sheet", () => {
  it("sets the title in Lora 500/28 under its overline", () => {
    renderOverlay()
    const title = container.querySelector('[data-testid="preview-title"]')
    expect(title?.className).toContain("font-lora")
    expect(title?.className).toContain("text-[28px]")
    expect(title?.className).toContain("font-medium")
    expect(container.querySelector('[data-testid="preview-sheet-header"]')?.textContent).toContain("Title")
  })

  it("shows the path in mono, truncated, with the full value in `title`", () => {
    renderOverlay()
    const path = container.querySelector('[data-testid="preview-path"]')
    expect(path?.className).toContain("font-mono")
    expect(path?.className).toContain("truncate")
    expect(path?.getAttribute("title")).toBe(row.localPath)
  })
})

describe("the properties column", () => {
  it("keeps the prototype's order", () => {
    renderOverlay()
    const text = container.textContent ?? ""
    const labels = ["Status", "Artifact Type", "Workspace", "Collections", "Sharing"]
    const positions = labels.map((label) => text.indexOf(label))
    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
  })
})

describe("the sharing card", () => {
  beforeEach(() => renderOverlay())

  it("is bordered at radius 10", () => {
    const card = container.querySelector('[data-testid="preview-sharing-card"]')
    expect(card?.className).toContain("rounded-[10px]")
    expect(card?.className).toContain("border-[0.5px]")
  })

  it("separates its two blocks with a rule", () => {
    const card = container.querySelector('[data-testid="preview-sharing-card"]')
    const rule = container.querySelector('[data-testid="preview-sharing-rule"]')
    expect(rule).not.toBeNull()
    expect(card?.contains(rule!)).toBe(true)
    expect(rule?.className).toContain("h-px")
  })

  it("carries the exact copy the spec fixes for both blocks", () => {
    const text = container.querySelector('[data-testid="preview-sharing-card"]')?.textContent ?? ""
    expect(text).toContain("Web publishing")
    expect(text).toContain("Publishing and link sharing continue on web.")
    expect(text).toContain("Publish on web")
    expect(text).toContain("Preview link")
    expect(text).toContain("Share with anyone — no Artifact Studio account needed.")
    expect(text).toContain("Generate link")
  })
})

describe("keyboard", () => {
  it("moves between artifacts with the arrow keys", () => {
    const onIndexChange = vi.fn()
    renderOverlay({ onIndexChange })

    press("ArrowRight")
    expect(onIndexChange).toHaveBeenCalledWith(1)
  })

  it("opens the full artifact on Enter", () => {
    const onOpenFullWriting = vi.fn()
    renderOverlay({ onOpenFullWriting })

    press("Enter")
    expect(onOpenFullWriting).toHaveBeenCalledWith("writing-1")
  })
})

describe("failure modes", () => {
  it("disables navigation at the ends of the range instead of breaking the counter", () => {
    const onIndexChange = vi.fn()
    renderOverlay({ onIndexChange, currentIndex: 0 })

    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="Previous artifact"]')!
    expect(previous.disabled).toBe(true)
    press("ArrowLeft")
    expect(onIndexChange).not.toHaveBeenCalled()

    renderOverlay({ onIndexChange, currentIndex: 1 })
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="Next artifact"]')!
    expect(next.disabled).toBe(true)
    press("ArrowRight")
    expect(onIndexChange).not.toHaveBeenCalled()
  })

  it("offers a way out when the artifact is gone, and never fabricates a draft", async () => {
    // `fetchPreview` resolving null is the artifact disappearing underneath the
    // overlay.
    renderOverlay()
    for (let turn = 0; turn < 4; turn += 1) {
      await act(async () => {})
    }

    const unavailable = container.querySelector('[data-testid="preview-unavailable"]')
    expect(unavailable?.textContent).toContain("This artifact is unavailable")
    expect(unavailable?.querySelector("button")?.textContent).toBe("Close preview")
  })
})

describe("the shared preview-link section", () => {
  it("keeps `compact` as the default, so the editor's properties panel is untouched", () => {
    const props = {
      hasRemoteWriting: true,
      isLoadingShareLink: false,
      isSavingShareLink: false,
      shareLink: { active: false, token: null, link: null, createdAt: null },
      shareError: null,
      remoteFeatureMessage: "",
      onGenerate: () => {},
      onCopy: () => {},
      onRevoke: () => {},
    }

    act(() => root.render(<PreviewLinkSection {...props} />))
    const compact = container.querySelector("button")!.className
    expect(compact).toContain("h-8")
    expect(compact).toContain("text-[11px]")

    act(() => root.render(<PreviewLinkSection {...props} size="card" />))
    const card = container.querySelector("button")!.className
    expect(card).toContain("h-9")
    expect(card).toContain("text-[13px]")
    expect(card).toContain("rounded-[8px]")
  })
})

describe("the overlay introduces no store of its own", () => {
  it("reads through the existing preview cache and sharing service only", () => {
    const source = readFileSync(
      resolve(__dirname, "../components/desk/writing-preview-modal.tsx"),
      "utf8",
    )
    for (const forbidden of ["@/lib/local-db", "@/lib/supabase", "document-catalog-factory", "@tauri-apps"]) {
      expect(source).not.toContain(forbidden)
    }
  })
})
