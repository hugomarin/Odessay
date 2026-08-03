import type { DocumentState } from "@/lib/writings/document-state"

export type WorkspaceLayout = "grid" | "list"

export type WorkspaceSource = "existing-folder" | "scratch"
export type WorkspaceStatus = "ready" | "missing"

export type WorkspaceRecord = {
  slug: string
  name: string
  rootPath: string
  source: WorkspaceSource
  addedAt: string
  lastOpenedAt: string | null
}

export type WorkspaceFile = {
  id: string
  path: string
  relativePath: string
  name: string
  modifiedAt: number
  size: number
  inode: number
}

export type WorkspaceDetail = {
  slug: string
  name: string
  rootPath: string
  selectedPaths: string[]
  source: WorkspaceSource
  status: WorkspaceStatus
  missingReason: string | null
  addedAt: string
  lastOpenedAt: string | null
  fileCount: number
  folderCount: number
  updatedAt: number | null
  files: WorkspaceFile[]
}

export type WorkspaceSummary = Omit<WorkspaceDetail, "files">

export type WorkspaceViewMode = "worktree"

export type ContextualWorkspaceDocument = {
  id: string | null
  name: string
  relativePath: string
  state: DocumentState
  openable: boolean
}

export type ContextualWorkspace = {
  slug: string
  name: string
  status: WorkspaceStatus
  missingReason: string | null
  documents: ContextualWorkspaceDocument[]
}
