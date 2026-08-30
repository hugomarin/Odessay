/**
 * @vitest-environment happy-dom
 */
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import type { ReactNode } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal"
import type { DeskActivityRow } from "@/lib/queries/desk-activity"

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogDescription: ({ children }: { children: ReactNode }) => <>{children}</>,
  DialogTitle: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/components/ui/popover", () => ({
  Popover: ({ children }: { children: ReactNode }) => <>{children}</>,
  PopoverContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  PopoverTrigger: ({ children }: { children: ReactNode }) => <>{children}</>,
}))

vi.mock("@/hooks/useWritingPreviewCache", () => ({
  useWritingPreviewCache: () => ({
    fetchPreview: vi.fn().mockResolvedValue(null),
    getCachedPreview: vi.fn().mockReturnValue(null),
    prefetchPreview: vi.fn(),
    retainOnly: vi.fn(),
    clear: vi.fn(),
    updatePreviewTitle: vi.fn(),
  }),
}))

vi.mock("@/components/settings/user-settings-provider", () => ({
  useUserSettingsContext: () => ({ settings: { disabledStatuses: [] } }),
}))

vi.mock("@/lib/services/sharing-service-factory", () => ({
  createSharingService: () => ({
    getPreviewLink: vi.fn().mockResolvedValue({
      data: {
        active: false,
        token: null,
        link: null,
        createdAt: null,
      },
      error: null,
    }),
    rotatePreviewLink: vi.fn().mockResolvedValue({
      data: {
        active: true,
        token: "preview-token",
        link: "https://app.odessay.com/preview/preview-token",
        createdAt: "2026-07-02T00:00:00.000Z",
      },
      error: null,
    }),
    revokePreviewLink: vi.fn().mockResolvedValue({
      data: { writingId: "writing-1", revoked: true },
      error: null,
    }),
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
  localPath: null,
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

let container: HTMLDivElement
let root: Root | null = null

beforeEach(() => {
  container = document.createElement("div")
  document.body.appendChild(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root?.unmount())
  root = null
  container.remove()
})

describe("WritingPreviewModal", () => {
  it("keeps the header minimal and renders the single-column rail in the approved order", () => {
    act(() => {
      root?.render(
        <WritingPreviewModal
          open
          rows={[row]}
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
          onShare={vi.fn().mockResolvedValue({ ok: true, message: "Copied" })}
          onOpenWebAction={vi.fn().mockResolvedValue(undefined)}
        />,
      )
    })

    const content = container.textContent ?? ""
    const railLabels = ["Status", "Artifact Type", "Workspace", "Collections", "Sharing", "Export", "Metadata", "Annotations"]
    const positions = railLabels.map((label) => content.indexOf(label))

    expect(positions.every((position) => position >= 0)).toBe(true)
    expect(positions).toEqual([...positions].sort((a, b) => a - b))
    expect(content).toContain("Open full artifact")
    expect(content).toContain("Publish on web")
    expect(content).toContain("Preview link")
    expect(content).toContain("Generate link")
    expect(content).not.toContain("Share with link")
    expect(content).toContain("Export as…")
    expect(container.querySelector('[aria-label="More options"]')).toBeNull()
  })
})
