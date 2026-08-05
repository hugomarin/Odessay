import type { DesktopWorkspaceFile } from "@/lib/services/desktop/tauri-commands"

export type WorkspaceFolderTreeNode = {
  path: string
  name: string
  kind: "folder" | "file"
  children: WorkspaceFolderTreeNode[]
  fileCount: number
}

export type WorkspaceFolderSelectionState = "checked" | "partial" | "unchecked"

function compareNodes(left: WorkspaceFolderTreeNode, right: WorkspaceFolderTreeNode) {
  if (left.kind !== right.kind) {
    return left.kind === "folder" ? -1 : 1
  }

  return left.name.localeCompare(right.name)
}

function createFolder(path: string, name: string): WorkspaceFolderTreeNode {
  return {
    path,
    name,
    kind: "folder",
    children: [],
    fileCount: 0,
  }
}

function createFile(path: string, name: string): WorkspaceFolderTreeNode {
  return {
    path,
    name,
    kind: "file",
    children: [],
    fileCount: 1,
  }
}

function finalizeNode(node: WorkspaceFolderTreeNode): WorkspaceFolderTreeNode {
  if (node.kind === "file") {
    return node
  }

  const children = node.children.map(finalizeNode).sort(compareNodes)
  const fileCount = children.reduce((total, child) => total + child.fileCount, 0)

  return {
    ...node,
    children,
    fileCount,
  }
}

export function buildWorkspaceFolderTree(files: Pick<DesktopWorkspaceFile, "relativePath" | "name">[]) {
  const root = createFolder("", "Workspace")
  const folders = new Map<string, WorkspaceFolderTreeNode>([["", root]])

  for (const file of files) {
    const segments = file.relativePath.split("/").filter(Boolean)
    let currentPath = ""

    for (let index = 0; index < segments.length - 1; index += 1) {
      const segment = segments[index]
      const nextPath = currentPath ? `${currentPath}/${segment}` : segment
      let folder = folders.get(nextPath)

      if (!folder) {
        folder = createFolder(nextPath, segment)
        folders.set(nextPath, folder)
        folders.get(currentPath)?.children.push(folder)
      }

      currentPath = nextPath
    }

    folders.get(currentPath)?.children.push(createFile(file.relativePath, file.name))
  }

  return root.children.map(finalizeNode).sort(compareNodes)
}

export function buildDefaultWorkspaceSelection(files: Pick<DesktopWorkspaceFile, "relativePath">[]) {
  return new Set(files.map((file) => file.relativePath))
}

export function collectDescendantFilePaths(node: WorkspaceFolderTreeNode): string[] {
  if (node.kind === "file") {
    return [node.path]
  }

  return node.children.flatMap(collectDescendantFilePaths)
}

export function getNodeSelectionState(
  node: WorkspaceFolderTreeNode,
  selectedFiles: ReadonlySet<string>,
): WorkspaceFolderSelectionState {
  const descendantFiles = collectDescendantFilePaths(node)
  const selectedCount = descendantFiles.filter((path) => selectedFiles.has(path)).length

  if (selectedCount === 0) {
    return "unchecked"
  }

  if (selectedCount === descendantFiles.length) {
    return "checked"
  }

  return "partial"
}

export function toggleWorkspaceNodeSelection(
  node: WorkspaceFolderTreeNode,
  selectedFiles: ReadonlySet<string>,
): Set<string> {
  const nextSelectedFiles = new Set(selectedFiles)
  const descendantFiles = collectDescendantFilePaths(node)
  const shouldSelect = descendantFiles.some((path) => !selectedFiles.has(path))

  for (const path of descendantFiles) {
    if (shouldSelect) {
      nextSelectedFiles.add(path)
    } else {
      nextSelectedFiles.delete(path)
    }
  }

  return nextSelectedFiles
}

function compressNodeSelection(
  node: WorkspaceFolderTreeNode,
  selectedFiles: ReadonlySet<string>,
  acc: string[],
) {
  const selectionState = getNodeSelectionState(node, selectedFiles)
  if (selectionState === "unchecked") {
    return
  }

  if (node.kind === "file") {
    acc.push(node.path)
    return
  }

  if (selectionState === "checked") {
    acc.push(node.path)
    return
  }

  for (const child of node.children) {
    compressNodeSelection(child, selectedFiles, acc)
  }
}

export function compressWorkspaceSelection(
  tree: WorkspaceFolderTreeNode[],
  selectedFiles: ReadonlySet<string>,
) {
  const availableFileCount = tree.reduce((total, node) => total + node.fileCount, 0)
  // An empty selectedPaths array is the durable representation of a complete
  // BindingRoot. Preserve that intent so files created later are discovered by
  // the global reconciler instead of freezing the scope to today's file list.
  if (availableFileCount > 0 && selectedFiles.size === availableFileCount) {
    return []
  }

  const compressed: string[] = []

  for (const node of tree) {
    compressNodeSelection(node, selectedFiles, compressed)
  }

  return compressed.sort((left, right) => left.localeCompare(right))
}
