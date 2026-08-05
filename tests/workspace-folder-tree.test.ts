import { describe, expect, it } from "vitest"
import {
  buildDefaultWorkspaceSelection,
  buildWorkspaceFolderTree,
  collectDescendantFilePaths,
  compressWorkspaceSelection,
  getNodeSelectionState,
  toggleWorkspaceNodeSelection,
} from "@/lib/workspace/folder-tree"

const files = [
  { relativePath: "drafts/letter.md", name: "letter.md" },
  { relativePath: "drafts/notes/context.mdx", name: "context.mdx" },
  { relativePath: "archive/old.md", name: "old.md" },
  { relativePath: "inbox.md", name: "inbox.md" },
]

describe("workspace folder tree helpers", () => {
  it("builds a nested tree from relative paths", () => {
    const tree = buildWorkspaceFolderTree(files)

    expect(tree.map((node) => node.path)).toEqual(["archive", "drafts", "inbox.md"])
    expect(tree[1]?.children.map((node) => node.path)).toEqual(["drafts/notes", "drafts/letter.md"])
    expect(tree[1]?.fileCount).toBe(2)
  })

  it("toggles folder selection in cascade", () => {
    const tree = buildWorkspaceFolderTree(files)
    const drafts = tree.find((node) => node.path === "drafts")
    expect(drafts).toBeTruthy()

    const selected = buildDefaultWorkspaceSelection(files)
    const afterToggle = toggleWorkspaceNodeSelection(drafts!, selected)

    expect(afterToggle.has("drafts/letter.md")).toBe(false)
    expect(afterToggle.has("drafts/notes/context.mdx")).toBe(false)
    expect(afterToggle.has("archive/old.md")).toBe(true)
  })

  it("reports partial folder selection", () => {
    const tree = buildWorkspaceFolderTree(files)
    const drafts = tree.find((node) => node.path === "drafts")
    const selected = new Set(["drafts/letter.md"])

    expect(getNodeSelectionState(drafts!, selected)).toBe("partial")
  })

  it("compresses fully selected folders into folder paths", () => {
    const tree = buildWorkspaceFolderTree(files)
    const selected = new Set([
      "drafts/letter.md",
      "drafts/notes/context.mdx",
      "archive/old.md",
    ])

    expect(compressWorkspaceSelection(tree, selected)).toEqual(["archive", "drafts"])
  })

  it("represents selecting the complete Workspace as an open root scope", () => {
    const tree = buildWorkspaceFolderTree(files)
    const selected = buildDefaultWorkspaceSelection(files)

    expect(compressWorkspaceSelection(tree, selected)).toEqual([])
  })

  it("collects descendant files for a nested folder", () => {
    const tree = buildWorkspaceFolderTree(files)
    const drafts = tree.find((node) => node.path === "drafts")

    expect(collectDescendantFilePaths(drafts!)).toEqual([
      "drafts/notes/context.mdx",
      "drafts/letter.md",
    ])
  })
})
