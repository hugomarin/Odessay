"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { startTransition, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useState } from "react"
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Circle,
  ExternalLink,
  FileText,
  Folder,
  Layers,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  TriangleAlert,
  Trash2,
} from "lucide-react"
import { FolderTreePicker } from "@/components/workspace/folder-tree-picker"
import { LibraryControlsBar } from "@/components/library/library-controls-bar"
import { useWorkspaceTableFilters } from "@/hooks/useWorkspaceTableFilters"
import { DocumentStateBadge } from "@/components/ui/document-state-badge"
import { DocumentStateIcon } from "@/components/ui/document-state-icon"
import { ArtifactTable } from "@/components/shared/artifact-table"
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types"
import { TablePropertySelector } from "@/components/ui/table-property-selector"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service"
import {
  buildDefaultWorkspaceSelection,
  buildWorkspaceFolderTree,
  compressWorkspaceSelection,
  type WorkspaceFolderTreeNode,
} from "@/lib/workspace/folder-tree"
import type { WorkspaceDetail, WorkspaceFile, WorkspaceLayout, WorkspaceSummary } from "@/lib/workspace/types"
import { buildWorkspaceHref } from "@/lib/workspace/workspace-route"
import type { LocalWriting } from "@/lib/local-db/schema"
import {
  deriveDocumentStateForLocalWriting,
  deriveDocumentStateFromSignals,
  type DocumentState,
} from "@/lib/writings/document-state"
import { cn } from "@/lib/utils"

type AddWorkspaceStep = "chooser" | "existing" | "existingSelection" | "scratch"

type WorkspaceActionState =
  | { type: "rename"; workspace: WorkspaceSummary | WorkspaceDetail }
  | { type: "remove"; workspace: WorkspaceSummary | WorkspaceDetail }
  | null

function formatUpdatedAt(timestamp: number | null) {
  if (!timestamp) {
    return "Recently added"
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  })

  return `Updated ${formatter.format(new Date(timestamp))}`
}

function formatFileTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp))
}

function fileSecondaryLabel(file: WorkspaceFile) {
  return file.relativePath === file.name ? "Root folder" : file.relativePath.replace(`/${file.name}`, "")
}

function pickPinnedFile(files: WorkspaceFile[]) {
  return files.find((file) => file.name.toLowerCase() === "instructions.md") ?? null
}

function matchesWorkspaceQuery(workspace: WorkspaceSummary, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return [workspace.name, workspace.rootPath].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  )
}

function matchesFileQuery(file: WorkspaceFile, query: string) {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) {
    return true
  }

  return [file.name, file.relativePath].some((value) => value.toLowerCase().includes(normalizedQuery))
}

function WorkspaceSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string
  onChange: (value: string) => void
  placeholder: string
}) {
  return (
    <div className="relative flex-1 min-w-[200px] max-w-[560px]">
      <Search className="absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-4" strokeWidth={1.5} />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-[8px] border-transparent bg-muted/70 pl-9 pr-4 text-[13px] font-sans text-ink placeholder:text-ink-4 shadow-none"
      />
    </div>
  )
}

function WorkspaceControlChip({
  active = false,
  onClick,
  children,
}: {
  active?: boolean
  onClick?: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-[8px] px-5 text-[13px] text-ink-2 transition-colors",
        active ? "bg-muted text-ink" : "bg-muted/70 hover:bg-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  )
}

function WorkspaceControlOption({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "w-full rounded-[7px] px-2.5 py-2 text-left text-[12px] transition-colors",
        active ? "bg-muted text-ink" : "text-ink-2 hover:bg-muted/70",
      )}
    >
      {children}
    </button>
  )
}

function workspaceMissingMessage(workspace: WorkspaceSummary | WorkspaceDetail) {
  return workspace.missingReason ?? "This local folder is unavailable or was moved."
}

function buildWritingByCanonicalPath(writings: LocalWriting[]) {
  const map = new Map<string, LocalWriting>()

  for (const writing of writings) {
    const canonicalPath = writing.canonical_path?.trim()
    if (canonicalPath) {
      map.set(canonicalPath, writing)
    }
  }

  return map
}

function deriveWorkspaceFileDocumentState(
  file: WorkspaceFile,
  writingByCanonicalPath: Map<string, LocalWriting>,
): DocumentState {
  const writing = writingByCanonicalPath.get(file.path)

  if (writing) {
    return deriveDocumentStateForLocalWriting(writing)
  }

  return deriveDocumentStateFromSignals({
    hasCloudRecord: false,
    hasLocalFile: true,
    isPending: false,
  })
}

export function WorkspaceIndexPrototype() {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <WorkspaceLoadingShell />
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />
  }

  return <DesktopWorkspaceIndex />
}

export function WorkspaceDetailPrototype({
  workspaceSlug,
}: {
  workspaceSlug: string
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <WorkspaceLoadingShell />
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />
  }

  return <DesktopWorkspaceDetail workspaceSlug={workspaceSlug} />
}

export function WorkspaceFilePrototype({
  workspaceSlug,
  fileId,
}: {
  workspaceSlug: string
  fileId: string
}) {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
  }, [])

  if (!mounted) {
    return <WorkspaceLoadingShell />
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />
  }

  return <DesktopWorkspaceFile workspaceSlug={workspaceSlug} fileId={fileId} />
}

function WorkspaceLoadingShell() {
  return (
    <div className="min-h-full bg-bg px-10 py-10">
      <div className="h-11 w-56 rounded-[12px] bg-muted/60" />
      <div className="mt-4 h-5 w-80 rounded-[10px] bg-muted/50" />
      <div className="mt-10 grid grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="h-[220px] rounded-[20px] border-[0.5px] border-border bg-sb" />
        ))}
      </div>
    </div>
  )
}

function DesktopWorkspaceIndex() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [layout, setLayout] = useState<WorkspaceLayout>("grid")
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isDialogOpen, setIsDialogOpen] = useState(false)
  const [step, setStep] = useState<AddWorkspaceStep>("chooser")
  const [newWorkspaceName, setNewWorkspaceName] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workspaceAction, setWorkspaceAction] = useState<WorkspaceActionState>(null)
  const [workspaceActionValue, setWorkspaceActionValue] = useState("")
  const [pendingWorkspaceRootPath, setPendingWorkspaceRootPath] = useState<string | null>(null)
  const [pendingWorkspaceTree, setPendingWorkspaceTree] = useState<WorkspaceFolderTreeNode[]>([])
  const [selectedWorkspaceFiles, setSelectedWorkspaceFiles] = useState<Set<string>>(new Set())

  const loadIndex = async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const [nextLayout, nextWorkspaces] = await Promise.all([
        service.getLayout(),
        service.listWorkspaces(),
      ])
      setLayout(nextLayout)
      setWorkspaces(nextWorkspaces)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load workspaces")
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    void loadIndex()
  }, [])

  const visibleWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) => matchesWorkspaceQuery(workspace, deferredQuery))
  }, [deferredQuery, workspaces])

  useEffect(() => {
    const readyWorkspaces = workspaces.filter((workspace) => workspace.status === "ready")
    if (!isDesktopRuntime() || readyWorkspaces.length === 0) {
      return
    }

    let cancelled = false
    let stopWatching: (() => Promise<void>) | null = null

    void getDesktopWorkspaceService().then(async (service) => {
      stopWatching = await service.watchWorkspaces(
        readyWorkspaces,
        () => {
          if (!cancelled) {
            void loadIndex()
          }
        },
      )
      if (cancelled && stopWatching) {
        void stopWatching()
      }
    })

    return () => {
      cancelled = true
      if (stopWatching) {
        void stopWatching()
      }
    }
  }, [workspaces])

  const handleLayoutChange = (nextLayout: WorkspaceLayout) => {
    startTransition(() => {
      setLayout(nextLayout)
    })
    void getDesktopWorkspaceService().then((service) => service.setLayout(nextLayout))
  }

  const handleAddExistingWorkspace = async () => {
    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const rootPath = await service.pickExistingWorkspaceRoot()
      if (!rootPath) {
        return
      }

      const snapshot = await service.inspectWorkspace(rootPath)
      const tree = buildWorkspaceFolderTree(snapshot.files)
      setPendingWorkspaceRootPath(rootPath)
      setPendingWorkspaceTree(tree)
      setSelectedWorkspaceFiles(buildDefaultWorkspaceSelection(snapshot.files))
      setStep("existingSelection")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to add workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleConfirmExistingWorkspace = async () => {
    if (!pendingWorkspaceRootPath) {
      return
    }

    const selectedPaths = compressWorkspaceSelection(pendingWorkspaceTree, selectedWorkspaceFiles)
    if (!selectedPaths.length) {
      setErrorMessage("Select at least one markdown file or folder to include.")
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const workspace = await service.addExistingWorkspaceWithSelection(
        pendingWorkspaceRootPath,
        selectedPaths,
      )
      if (!workspace) {
        return
      }

      await loadIndex()
      setIsDialogOpen(false)
      setStep("chooser")
      setPendingWorkspaceRootPath(null)
      setPendingWorkspaceTree([])
      setSelectedWorkspaceFiles(new Set())
      router.push(buildWorkspaceHref({ slug: workspace.slug }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to add workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const workspace = await service.createWorkspace(newWorkspaceName.trim())
      if (!workspace) {
        return
      }

      setNewWorkspaceName("")
      await loadIndex()
      setIsDialogOpen(false)
      setStep("chooser")
      router.push(buildWorkspaceHref({ slug: workspace.slug }))
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleWorkspaceAction = async () => {
    if (!workspaceAction) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()

      if (workspaceAction.type === "rename") {
        await service.renameWorkspace(workspaceAction.workspace.slug, workspaceActionValue)
      } else {
        await service.removeWorkspace(workspaceAction.workspace.slug)
      }

      await loadIndex()
      setWorkspaceAction(null)
      setWorkspaceActionValue("")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  const pendingWorkspaceFileCount = useMemo(
    () => pendingWorkspaceTree.reduce((total, node) => total + node.fileCount, 0),
    [pendingWorkspaceTree],
  )

  return (
    <>
      <div className="flex min-h-full flex-col bg-bg">
        <div className="border-b-[0.5px] border-border px-10 py-7">
          <div className="flex items-start justify-between gap-6">
            <div className="max-w-[620px]">
              <h1 className="text-[24px] font-medium tracking-[-0.03em] text-ink">
                Workspace
              </h1>
              <p className="mt-1 text-[14px] text-ink-4">
                Local workspaces that keep your files in context.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep("chooser")
                  setIsDialogOpen(true)
                }}
                className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-border bg-transparent px-[14px] text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              >
                <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} />
                Add workspace
              </button>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center justify-end gap-3">
            <WorkspaceSearchInput
              value={searchQuery}
              onChange={setSearchQuery}
              placeholder="Filter by name..."
            />
            <div className="flex items-center gap-2">
              <WorkspaceControlChip active={layout === "grid"} onClick={() => handleLayoutChange("grid")}>
                <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
                Grid
              </WorkspaceControlChip>
              <WorkspaceControlChip active={layout === "list"} onClick={() => handleLayoutChange("list")}>
                <List className="h-4 w-4" strokeWidth={1.5} />
                List
              </WorkspaceControlChip>
            </div>
          </div>
        </div>

        <div className="px-10 py-8">
          {errorMessage ? (
            <div className="mb-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
              {errorMessage}
            </div>
          ) : null}

          {isLoading ? (
            <div className={cn(layout === "grid" ? "grid grid-cols-2 gap-6" : "space-y-4")}>
              {Array.from({ length: 4 }).map((_, index) => (
                <div
                  key={index}
                  className={cn(
                    "rounded-[20px] border-[0.5px] border-border bg-sb",
                    layout === "grid" ? "h-[220px]" : "h-[116px]",
                  )}
                />
              ))}
            </div>
          ) : visibleWorkspaces.length === 0 ? (
            <div className="rounded-[24px] border-[0.5px] border-dashed border-border bg-sb px-8 py-14 text-center">
              <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] border-[0.5px] border-border bg-bg text-ink-3">
                <Folder className="h-8 w-8" strokeWidth={1.5} />
              </div>
              <h2 className="mt-6 font-lora text-[28px] leading-tight text-ink">No workspaces yet</h2>
              <p className="mx-auto mt-3 max-w-[46ch] text-[16px] leading-7 text-ink-3">
                Add an existing folder or create a new workspace to start tracking local markdown files.
              </p>
              <Button
                type="button"
                className="mt-8 h-10 rounded-[10px] px-4"
                onClick={() => {
                  setStep("chooser")
                  setIsDialogOpen(true)
                }}
              >
                <Plus className="h-4 w-4" strokeWidth={1.5} />
                Add workspace
              </Button>
            </div>
          ) : layout === "grid" ? (
            <div className="grid grid-cols-2 gap-6">
              {visibleWorkspaces.map((workspace) => (
                <div
                  key={workspace.slug}
                  className={cn(
                    "rounded-[20px] border-[0.5px] border-border bg-sb p-6",
                    workspace.status === "ready" ? "transition-colors hover:bg-muted/40" : "",
                  )}
                >
                  <div className="flex items-start gap-5">
                    <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-[14px] border-[0.5px] border-border bg-bg text-ink-2">
                      {workspace.status === "missing" ? (
                        <TriangleAlert className="h-7 w-7" strokeWidth={1.5} />
                      ) : (
                        <Folder className="h-7 w-7" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          {workspace.status === "ready" ? (
                            <Link
                              href={buildWorkspaceHref({ slug: workspace.slug })}
                              className="font-lora text-[20px] leading-tight tracking-[-0.02em] text-ink"
                            >
                              {workspace.name}
                            </Link>
                          ) : (
                            <h2 className="font-lora text-[20px] leading-tight tracking-[-0.02em] text-ink">
                              {workspace.name}
                            </h2>
                          )}
                          <p className="mt-1 truncate text-sm text-ink-4">{workspace.rootPath}</p>
                        </div>
                        <WorkspaceActionsMenu
                          workspace={workspace}
                          triggerClassName="shrink-0 border-[0.5px] border-border bg-bg"
                          onRename={() => {
                            setWorkspaceAction({ type: "rename", workspace })
                            setWorkspaceActionValue(workspace.name)
                          }}
                          onRemove={() => {
                            setWorkspaceAction({ type: "remove", workspace })
                            setWorkspaceActionValue(workspace.name)
                          }}
                        />
                      </div>
                      {workspace.status === "missing" ? (
                        <p className="mt-4 max-w-[44ch] text-sm leading-6 text-ink-3">
                          {workspaceMissingMessage(workspace)}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="mt-8 flex items-center gap-5 border-t-[0.5px] border-border pt-5 text-sm text-ink-4">
                    <span>{workspace.fileCount} files</span>
                    <span>{workspace.folderCount} folders</span>
                    <span>{formatUpdatedAt(workspace.updatedAt)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-[18px] border-[0.5px] border-border bg-sb">
              {visibleWorkspaces.map((workspace, index) => (
                <div
                  key={workspace.slug}
                  className={cn(
                    "grid grid-cols-[minmax(0,1fr)_120px_120px_180px] items-center gap-4 px-6 py-5 transition-colors hover:bg-muted/40",
                    index > 0 ? "border-t-[0.5px] border-border" : "",
                  )}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-3">
                      {workspace.status === "missing" ? (
                        <TriangleAlert className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} />
                      ) : (
                        <Folder className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} />
                      )}
                      {workspace.status === "ready" ? (
                        <Link
                          href={buildWorkspaceHref({ slug: workspace.slug })}
                          className="truncate font-lora text-[19px] text-ink"
                        >
                          {workspace.name}
                        </Link>
                      ) : (
                        <span className="truncate font-lora text-[19px] text-ink">{workspace.name}</span>
                      )}
                    </div>
                    <div className="mt-1 truncate pl-8 text-sm text-ink-4">{workspace.rootPath}</div>
                  </div>
                  <span className="text-sm text-ink-4">{workspace.fileCount} files</span>
                  <span className="text-sm text-ink-4">{workspace.folderCount} folders</span>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink-4">{formatUpdatedAt(workspace.updatedAt)}</span>
                    <WorkspaceActionsMenu
                      workspace={workspace}
                      onRename={() => {
                        setWorkspaceAction({ type: "rename", workspace })
                        setWorkspaceActionValue(workspace.name)
                      }}
                      onRemove={() => {
                        setWorkspaceAction({ type: "remove", workspace })
                        setWorkspaceActionValue(workspace.name)
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(nextOpen) => {
          setIsDialogOpen(nextOpen)
          if (!nextOpen) {
            setStep("chooser")
            setNewWorkspaceName("")
            setPendingWorkspaceRootPath(null)
            setPendingWorkspaceTree([])
            setSelectedWorkspaceFiles(new Set())
            setErrorMessage(null)
          }
        }}
      >
        <DialogContent hideClose className="max-w-[720px] rounded-[28px] p-0">
          {step === "chooser" ? (
            <AddWorkspaceChooser onSelect={setStep} />
          ) : null}
          {step === "existing" ? (
            <UseExistingFolderStep
              isSubmitting={isSubmitting}
              errorMessage={errorMessage}
              onBack={() => setStep("chooser")}
              onSelect={handleAddExistingWorkspace}
            />
          ) : null}
          {step === "existingSelection" ? (
            <ConfirmWorkspaceSelectionStep
              rootPath={pendingWorkspaceRootPath}
              tree={pendingWorkspaceTree}
              selectedFiles={selectedWorkspaceFiles}
              fileCount={pendingWorkspaceFileCount}
              isSubmitting={isSubmitting}
              errorMessage={errorMessage}
              onBack={() => setStep("existing")}
              onChange={setSelectedWorkspaceFiles}
              onConfirm={handleConfirmExistingWorkspace}
            />
          ) : null}
          {step === "scratch" ? (
            <CreateFromScratchStep
              value={newWorkspaceName}
              isSubmitting={isSubmitting}
              errorMessage={errorMessage}
              onBack={() => setStep("chooser")}
              onChange={setNewWorkspaceName}
              onCreate={handleCreateWorkspace}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <WorkspaceActionDialog
        action={workspaceAction}
        value={workspaceActionValue}
        isSubmitting={isSubmitting}
        onValueChange={setWorkspaceActionValue}
        onConfirm={() => void handleWorkspaceAction()}
        onOpenChange={(open) => {
          if (!open) {
            setWorkspaceAction(null)
            setWorkspaceActionValue("")
          }
        }}
      />
    </>
  )
}

function DesktopWorkspaceDetail({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const deferredQuery = useDeferredValue(searchQuery)
  const [isLoading, setIsLoading] = useState(true)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newFileName, setNewFileName] = useState("")
  const [isCreatingFile, setIsCreatingFile] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workspaceAction, setWorkspaceAction] = useState<WorkspaceActionState>(null)
  const [workspaceActionValue, setWorkspaceActionValue] = useState("")
  const [writingByCanonicalPath, setWritingByCanonicalPath] = useState<Map<string, LocalWriting>>(new Map())
  const {
    dateFilter: fileDateFilter,
    setDateFilter: setFileDateFilter,
    groupBy: fileGroupBy,
    setGroupBy: setFileGroupBy,
    sortBy: fileSortBy,
    setSortBy: setFileSortBy,
  } = useWorkspaceTableFilters()

  const loadWorkspace = useCallback(async () => {
    setIsLoading(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const [{ localDB }, nextWorkspace] = await Promise.all([
        import("@/lib/local-db"),
        service.getWorkspace(workspaceSlug),
      ])
      if (!nextWorkspace) {
        setWorkspace(null)
        setErrorMessage("Workspace not found")
        return
      }

      const localWritings = await localDB.writings.getAll()
      setWorkspace(nextWorkspace)
      setWritingByCanonicalPath(buildWritingByCanonicalPath(localWritings))
      await service.markWorkspaceOpened(workspaceSlug)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to load workspace")
    } finally {
      setIsLoading(false)
    }
  }, [workspaceSlug])

  useEffect(() => {
    void loadWorkspace()
  }, [loadWorkspace])

  const visibleFiles = useMemo(() => {
    const files = workspace?.files.filter((file) => {
      if (!matchesFileQuery(file, deferredQuery)) return false
      if (fileDateFilter === "last-7") return file.modifiedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000
      return true
    }) ?? []
    return files.sort((left, right) => {
      if (fileSortBy === "name") return left.name.localeCompare(right.name)
      return fileSortBy === "oldest" ? left.modifiedAt - right.modifiedAt : right.modifiedAt - left.modifiedAt
    })
  }, [deferredQuery, fileDateFilter, fileSortBy, workspace])

  const pinnedFile = useMemo(() => {
    return workspace ? pickPinnedFile(workspace.files) : null
  }, [workspace])

  const fileGroups = useMemo(() => {
    if (fileGroupBy === "none") return [{ items: visibleFiles }]
    const groups = new Map<string, WorkspaceFile[]>()
    for (const file of visibleFiles) {
      const label = fileSecondaryLabel(file)
      groups.set(label, [...(groups.get(label) ?? []), file])
    }
    return Array.from(groups.entries()).map(([label, items]) => ({ label, items }))
  }, [fileGroupBy, visibleFiles])

  const watchedWorkspace = workspace?.status === "ready" ? workspace : null

  useEffect(() => {
    if (!watchedWorkspace) {
      return
    }

    let cancelled = false
    let stopWatching: (() => Promise<void>) | null = null

    void getDesktopWorkspaceService()
      .then(async (service) => {
        stopWatching = await service.watchWorkspace(
          watchedWorkspace.rootPath,
          watchedWorkspace.selectedPaths,
          () => {
          if (!cancelled) {
            void loadWorkspace()
          }
          },
        )
        if (cancelled && stopWatching) {
          void stopWatching()
        }
      })
      .catch((error) => {
        console.warn("[workspace] file watcher setup failed:", error)
      })

    return () => {
      cancelled = true
      if (stopWatching) {
        void stopWatching()
      }
    }
  }, [loadWorkspace, watchedWorkspace])

  useEffect(() => {
    const handleFocus = () => void loadWorkspace()
    window.addEventListener("focus", handleFocus)
    return () => window.removeEventListener("focus", handleFocus)
  }, [loadWorkspace])

  const openInEditor = useCallback(
    async (file: WorkspaceFile) => {
      setErrorMessage(null)

      try {
        const service = await getDesktopWorkspaceService()
        const writingId = await service.openFileInEditor(file.path, file.id)
        router.push(`/write?id=${encodeURIComponent(writingId)}`)
      } catch (error) {
        setErrorMessage(error instanceof Error ? error.message : "Failed to open file")
      }
    },
    [router],
  )

  const fileColumns = useMemo<ArtifactTableColumn<WorkspaceFile>[]>(
    () => [
      {
        id: "title",
        label: "Writing",
        width: "w-[55%]",
        className: "min-w-0 px-10",
        render: (file) => (
          <div
            style={{
              WebkitMaskImage: "linear-gradient(90deg, #000 86%, transparent)",
              maskImage: "linear-gradient(90deg, #000 86%, transparent)",
            }}
          >
            <div className="flex min-w-0 items-center gap-2">
              <p className="truncate font-lora text-[15px] font-medium leading-[1.3] text-ink">
                {file.name}
              </p>
              <DocumentStateIcon state={deriveWorkspaceFileDocumentState(file, writingByCanonicalPath)} />
            </div>
            {fileSecondaryLabel(file) !== "Root folder" ? (
              <p className="truncate pt-1 text-[12px] text-ink-3">{fileSecondaryLabel(file)}</p>
            ) : null}
          </div>
        ),
      },
      {
        id: "status",
        label: "Status",
        width: "w-[12%]",
        className: "px-2",
        render: () => (
          <TablePropertySelector
            readOnly
            ariaLabel="Local file"
            icon={<Circle className="h-[13px] w-[13px] shrink-0 text-ink-4" strokeWidth={1.5} />}
            label="Local file"
          />
        ),
      },
      {
        id: "artifact",
        label: "Artifact",
        width: "w-[14%]",
        className: "px-2",
        render: () => (
          <TablePropertySelector
            readOnly
            ariaLabel="Markdown"
            icon={<FileText className="h-[13px] w-[13px] shrink-0 text-ink-4" strokeWidth={1.5} />}
            label="Markdown"
          />
        ),
      },
      {
        id: "workspace",
        label: "Workspace",
        width: "w-[17%]",
        className: "px-2",
        render: () => (
          <TablePropertySelector
            readOnly
            ariaLabel={`Workspace ${workspace?.name ?? ""}`}
            icon={<Layers className="h-[13px] w-[13px] shrink-0 text-ink-4" strokeWidth={1.5} />}
            label={workspace?.name ?? "Workspace"}
          />
        ),
      },
      {
        id: "actions",
        label: "",
        align: "end",
        width: "w-14",
        className: "px-4",
        render: (file) => (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" aria-label={`Actions for ${file.name}`} onClick={(event) => event.stopPropagation()} className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-border text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3">
                <MoreHorizontal className="h-[14px] w-[14px]" strokeWidth={1.5} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" onClick={(event) => event.stopPropagation()}>
              <DropdownMenuItem className="cursor-pointer gap-2 text-[13px]" onClick={() => void openInEditor(file)}>
                <ExternalLink className="h-[12px] w-[12px]" strokeWidth={1.5} />Open in editor
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ),
      },
    ],
    [openInEditor, workspace?.name, writingByCanonicalPath],
  )

  const handleCreateFile = async () => {
    if (!workspace || !newFileName.trim()) {
      return
    }

    setIsCreatingFile(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()
      const file = await service.createFile(workspace, newFileName)
      setNewFileName("")
      setIsCreateDialogOpen(false)
      await loadWorkspace()
      await openInEditor(file)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to create file")
    } finally {
      setIsCreatingFile(false)
    }
  }

  const handleWorkspaceAction = async () => {
    if (!workspaceAction) {
      return
    }

    setIsSubmitting(true)
    setErrorMessage(null)

    try {
      const service = await getDesktopWorkspaceService()

      if (workspaceAction.type === "rename") {
        await service.renameWorkspace(workspaceAction.workspace.slug, workspaceActionValue)
        await loadWorkspace()
      } else {
        await service.removeWorkspace(workspaceAction.workspace.slug)
        router.push("/workspace")
      }

      setWorkspaceAction(null)
      setWorkspaceActionValue("")
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Failed to update workspace")
    } finally {
      setIsSubmitting(false)
    }
  }

  if (isLoading) {
    return <WorkspaceLoadingShell />
  }

  if (!workspace) {
    return (
      <div className="min-h-full bg-bg px-10 py-10">
        <div className="rounded-[18px] border-[0.5px] border-border bg-sb px-6 py-5 text-sm text-ink-3">
          {errorMessage ?? "Workspace not found"}
        </div>
      </div>
    )
  }

  if (workspace.status === "missing") {
    return (
      <>
        <div className="min-h-full bg-bg px-10 py-10">
          <div className="max-w-[760px] rounded-[24px] border-[0.5px] border-border bg-sb px-8 py-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-[16px] border-[0.5px] border-border bg-bg text-ink-3">
              <TriangleAlert className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <h1 className="mt-6 font-lora text-[38px] leading-[1.08] tracking-[-0.03em] text-ink">
              {workspace.name}
            </h1>
            <p className="mt-3 max-w-[58ch] text-[16px] leading-7 text-ink-3">
              This workspace is still registered in Artifact Studio, but its local folder is unavailable right
              now.
            </p>
            <div className="mt-4 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
              <div>{workspace.rootPath}</div>
              <div className="mt-2">{workspaceMissingMessage(workspace)}</div>
            </div>
            <div className="mt-8 flex items-center gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setWorkspaceAction({ type: "rename", workspace })
                  setWorkspaceActionValue(workspace.name)
                }}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
                Rename workspace
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setWorkspaceAction({ type: "remove", workspace })
                  setWorkspaceActionValue(workspace.name)
                }}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                Remove from Artifact Studio
              </Button>
            </div>
          </div>
        </div>

        <WorkspaceActionDialog
          action={workspaceAction}
          value={workspaceActionValue}
          isSubmitting={isSubmitting}
          onValueChange={setWorkspaceActionValue}
          onConfirm={() => void handleWorkspaceAction()}
          onOpenChange={(open) => {
            if (!open) {
              setWorkspaceAction(null)
              setWorkspaceActionValue("")
            }
          }}
        />
      </>
    )
  }

  return (
    <>
      <div className="min-h-full bg-bg">
        <div className="border-b-[0.5px] border-border px-10 py-7">
          <div className="flex items-start justify-between gap-8">
            <div className="min-w-0">
              <div className="flex min-w-0 items-center gap-2">
                <Link
                  href="/workspace"
                  className="inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                >
                  <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                  Workspace
                </Link>
                <span className="text-[13px] text-ink-4/50">/</span>
                <span className="truncate text-[13px] text-ink-4">{workspace.rootPath}</span>
              </div>
              <div className="mt-2 flex items-center gap-3">
                <h1 className="text-[24px] font-medium tracking-[-0.03em] text-ink">
                  {workspace.name}
                </h1>
                <WorkspaceActionsMenu
                  workspace={workspace}
                  triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                  onRename={() => {
                    setWorkspaceAction({ type: "rename", workspace })
                    setWorkspaceActionValue(workspace.name)
                  }}
                  onRemove={() => {
                    setWorkspaceAction({ type: "remove", workspace })
                    setWorkspaceActionValue(workspace.name)
                  }}
                />
              </div>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setIsCreateDialogOpen(true)}
                className="inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] border-border bg-transparent px-[14px] text-[13px] text-ink-3 transition-colors hover:bg-muted hover:text-ink-2"
              >
                <Plus className="h-[14px] w-[14px]" strokeWidth={1.5} />
                New file
              </button>
            </div>
          </div>

          <LibraryControlsBar
            className="mt-6"
            searchQuery={searchQuery}
            onSearchChange={setSearchQuery}
            filterActive={fileDateFilter !== "all"}
            groupActive={fileGroupBy !== "none"}
            sortLabel={fileSortBy === "newest" ? "Newest first" : fileSortBy === "oldest" ? "Oldest first" : "Name"}
            filterContent={<div className="space-y-1"><WorkspaceControlOption active={fileDateFilter === "all"} onClick={() => setFileDateFilter("all")}>All files</WorkspaceControlOption><WorkspaceControlOption active={fileDateFilter === "last-7"} onClick={() => setFileDateFilter("last-7")}>Modified in the last 7 days</WorkspaceControlOption></div>}
            groupContent={<div className="space-y-1"><WorkspaceControlOption active={fileGroupBy === "none"} onClick={() => setFileGroupBy("none")}>None</WorkspaceControlOption><WorkspaceControlOption active={fileGroupBy === "folder"} onClick={() => setFileGroupBy("folder")}>Folder</WorkspaceControlOption></div>}
            sortContent={<div className="space-y-1"><WorkspaceControlOption active={fileSortBy === "newest"} onClick={() => setFileSortBy("newest")}>Newest first</WorkspaceControlOption><WorkspaceControlOption active={fileSortBy === "oldest"} onClick={() => setFileSortBy("oldest")}>Oldest first</WorkspaceControlOption><WorkspaceControlOption active={fileSortBy === "name"} onClick={() => setFileSortBy("name")}>Name</WorkspaceControlOption></div>}
          />
        </div>

        <div className="px-10 py-8">
          {errorMessage ? (
            <div className="mb-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
            {errorMessage}
            </div>
          ) : null}

          {pinnedFile ? (
            <section>
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-4">
              Pinned
            </div>
            <button
              type="button"
              onClick={() => void openInEditor(pinnedFile)}
              className="flex w-full items-center gap-4 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-left transition-colors hover:bg-muted/40"
            >
              <FileText className="h-5 w-5 shrink-0 text-ink-2" strokeWidth={1.5} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-3">
                  <span className="text-[17px] text-ink">{pinnedFile.name}</span>
                  <DocumentStateBadge
                    state={deriveWorkspaceFileDocumentState(pinnedFile, writingByCanonicalPath)}
                    variant="compact"
                  />
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] text-ink-4">
                    Pinned
                  </span>
                </div>
                <p className="mt-1 truncate text-sm text-ink-4">
                  {fileSecondaryLabel(pinnedFile)}
                </p>
              </div>
              <span className="text-sm text-ink-4">{formatFileTimestamp(pinnedFile.modifiedAt)}</span>
            </button>
            </section>
          ) : null}

          <section className={cn("mt-8", pinnedFile ? "" : "mt-0")}>
            <div className="mb-3 text-[12px] font-medium uppercase tracking-[0.12em] text-ink-4">
              Files
            </div>
            {visibleFiles.length === 0 ? (
              <div className="rounded-[18px] border-[0.5px] border-dashed border-border bg-sb px-6 py-10 text-center text-sm text-ink-3">
                {workspace.fileCount === 0
                  ? "This workspace does not have any .md or .mdx files yet. Create one to start working from this local folder."
                  : "No files match your search."}
              </div>
            ) : (
              <div className="overflow-hidden">
                <ArtifactTable
                  groups={fileGroups}
                  columns={fileColumns}
                  getRowId={(file) => file.id}
                  getRowAriaLabel={(file) => `Open ${file.name} in editor`}
                  onRowClick={(file) => void openInEditor(file)}
                  showHeader={false}
                />
              </div>
            )}
          </section>
        </div>
      </div>

      <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <DialogContent hideClose className="max-w-[560px] rounded-[24px] p-0">
          <div className="p-10">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="text-[36px] leading-[1.08] tracking-[-0.03em]">
                New file
              </DialogTitle>
              <DialogDescription className="text-[16px] leading-7 text-ink-3">
                Create a markdown file directly inside this workspace.
              </DialogDescription>
            </DialogHeader>

            <div className="mt-8">
              <label className="mb-3 block text-[15px] font-medium text-ink">File name</label>
              <Input
                value={newFileName}
                onChange={(event) => setNewFileName(event.target.value)}
                placeholder="brief.md"
                className="h-12 rounded-[12px]"
              />
            </div>

            <DialogFooter className="mt-10 flex-row items-center justify-end gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => setIsCreateDialogOpen(false)}>
                Cancel
              </Button>
              <Button type="button" onClick={handleCreateFile} disabled={isCreatingFile || !newFileName.trim()}>
                {isCreatingFile ? "Creating..." : "Create file"}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <WorkspaceActionDialog
        action={workspaceAction}
        value={workspaceActionValue}
        isSubmitting={isSubmitting}
        onValueChange={setWorkspaceActionValue}
        onConfirm={() => void handleWorkspaceAction()}
        onOpenChange={(open) => {
          if (!open) {
            setWorkspaceAction(null)
            setWorkspaceActionValue("")
          }
        }}
      />
    </>
  )
}

function WorkspaceActionsMenu({
  workspace,
  onRename,
  onRemove,
  triggerClassName,
}: {
  workspace: WorkspaceSummary | WorkspaceDetail
  onRename: () => void
  onRemove: () => void
  triggerClassName?: string
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Manage ${workspace.name}`}
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink",
            triggerClassName,
          )}
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-[220px] rounded-[12px] border-[0.5px] border-border bg-sb p-1.5 shadow-float-md">
        <DropdownMenuItem
          className="cursor-pointer rounded-[8px]"
          onSelect={(event) => {
            event.preventDefault()
            onRename()
          }}
        >
          <Pencil className="mr-2 h-4 w-4" strokeWidth={1.5} />
          Rename workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer rounded-[8px] text-red-600 focus:text-red-600"
          onSelect={(event) => {
            event.preventDefault()
            onRemove()
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
          Remove from Artifact Studio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function WorkspaceActionDialog({
  action,
  value,
  isSubmitting,
  onValueChange,
  onConfirm,
  onOpenChange,
}: {
  action: WorkspaceActionState
  value: string
  isSubmitting: boolean
  onValueChange: (value: string) => void
  onConfirm: () => void
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={action !== null} onOpenChange={onOpenChange}>
      <DialogContent hideClose className="max-w-[520px] rounded-[24px] p-0">
        {action?.type === "rename" ? (
          <div className="p-8">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                Rename workspace
              </DialogTitle>
              <DialogDescription className="text-[16px] leading-7 text-ink-3">
                Update the workspace label in Artifact Studio. This does not rename the local folder.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-8">
              <label className="mb-3 block text-[15px] font-medium text-ink">Workspace name</label>
              <Input
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="Workspace name"
                className="h-12 rounded-[12px]"
              />
            </div>
            <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={isSubmitting || !value.trim()} onClick={onConfirm}>
                {isSubmitting ? "Saving..." : "Save name"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}

        {action?.type === "remove" ? (
          <div className="p-8">
            <DialogHeader className="space-y-3 text-left">
              <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                Remove workspace
              </DialogTitle>
              <DialogDescription className="text-[16px] leading-7 text-ink-3">
                Artifact Studio will forget this workspace, but the local folder and its files stay untouched.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
              {action.workspace.name}
            </div>
            <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="button" disabled={isSubmitting} onClick={onConfirm}>
                {isSubmitting ? "Removing..." : "Remove from Artifact Studio"}
              </Button>
            </DialogFooter>
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}

function DesktopWorkspaceFile({
  workspaceSlug,
  fileId,
}: {
  workspaceSlug: string
  fileId: string
}) {
  const router = useRouter()
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null)
  const [file, setFile] = useState<WorkspaceFile | null>(null)
  const [content, setContent] = useState("")

  useEffect(() => {
    let cancelled = false

    const load = async () => {
      const service = await getDesktopWorkspaceService()
      const nextWorkspace = await service.getWorkspace(workspaceSlug)
      if (!nextWorkspace || cancelled) {
        return
      }
      const nextFile = nextWorkspace.files.find((candidate) => candidate.id === fileId) ?? null
      if (!nextFile) {
        return
      }

      const preview = await service.readFilePreview(nextFile.path)
      if (cancelled) {
        return
      }

      setWorkspace(nextWorkspace)
      setFile(nextFile)
      setContent(preview.content)
    }

    void load()

    return () => {
      cancelled = true
    }
  }, [fileId, workspaceSlug])

  if (!workspace || !file) {
    return <WorkspaceLoadingShell />
  }

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <div className="flex h-[60px] items-center justify-between border-b-[0.5px] border-border px-6">
        <div className="flex min-w-0 items-center gap-3">
          <Link
            href={buildWorkspaceHref({ slug: workspace.slug })}
            className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
          </Link>
          <div className="min-w-0">
            <div className="truncate text-[15px] font-medium text-ink">{file.name}</div>
            <div className="truncate text-xs text-ink-4">{workspace.name}</div>
          </div>
        </div>
        <Button type="button" onClick={() => void getDesktopWorkspaceService().then((service) => service.openFileInEditor(file.path, file.id).then((writingId) => router.push(`/write?id=${encodeURIComponent(writingId)}`)))}>
          Open in editor
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[980px] flex-1 px-10 py-14">
        <div className="mb-10 flex items-center gap-2 text-sm text-ink-4">
          <Link href="/workspace" className="transition-colors hover:text-ink">
            Workspace
          </Link>
          <span>/</span>
          <Link href={buildWorkspaceHref({ slug: workspace.slug })} className="transition-colors hover:text-ink">
            {workspace.name}
          </Link>
          <span>/</span>
          <span className="text-ink-3">{file.name}</span>
        </div>

        <article className="prose prose-neutral max-w-none">
          <h1 className="font-lora text-[40px] font-medium leading-[1.08] tracking-[-0.03em] text-ink">
            {file.name.replace(/\.(md|txt)$/i, "")}
          </h1>
          <div className="mt-10 whitespace-pre-wrap text-[20px] leading-[2.05rem] text-ink">
            {content}
          </div>
        </article>
      </div>
    </div>
  )
}

function AddWorkspaceChooser({ onSelect }: { onSelect: (step: AddWorkspaceStep) => void }) {
  return (
    <div className="p-12">
      <DialogHeader className="space-y-4 text-left">
        <DialogTitle className="text-[44px] leading-[1.05] tracking-[-0.03em]">
          Add a workspace
        </DialogTitle>
        <DialogDescription className="max-w-[560px] text-[17px] leading-8 text-ink-3">
          Work with a folder you already use, or create a fresh workspace for a new writing context.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-10 space-y-4">
        <ChooserOption
          icon={<Folder className="h-7 w-7" strokeWidth={1.5} />}
          title="Use an existing folder"
          description="Connect a folder you already work from."
          onClick={() => onSelect("existing")}
        />
        <ChooserOption
          icon={<Plus className="h-7 w-7" strokeWidth={1.5} />}
          title="Create from scratch"
          description="Create a new folder and start clean."
          onClick={() => onSelect("scratch")}
        />
      </div>
    </div>
  )
}

function ChooserOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode
  title: string
  description: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-5 rounded-[24px] border-[0.5px] border-border bg-bg px-8 py-7 text-left transition-colors hover:bg-muted/40"
    >
      <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-[18px] border-[0.5px] border-border bg-sb text-ink-2">
        {icon}
      </div>
      <div className="flex-1">
        <div className="text-[18px] font-medium text-ink">{title}</div>
        <div className="mt-1 text-[16px] leading-7 text-ink-3">{description}</div>
      </div>
      <ChevronDown className="h-5 w-5 rotate-[-90deg] text-ink-4" strokeWidth={1.5} />
    </button>
  )
}

function UseExistingFolderStep({
  isSubmitting,
  errorMessage,
  onBack,
  onSelect,
}: {
  isSubmitting: boolean
  errorMessage: string | null
  onBack: () => void
  onSelect: () => void
}) {
  return (
    <div className="p-12">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <DialogHeader className="space-y-3 text-left">
        <DialogTitle className="text-[42px] leading-[1.05] tracking-[-0.03em]">
          Use an existing folder
        </DialogTitle>
        <DialogDescription className="max-w-[580px] text-[17px] leading-8 text-ink-3">
          Pick a folder and Artifact Studio will treat its markdown files as a workspace.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-10">
        <label className="mb-3 block text-[15px] font-medium text-ink">Choose folder</label>
        <button
          type="button"
          onClick={onSelect}
          disabled={isSubmitting}
          className="flex h-[84px] w-full items-center gap-4 rounded-[18px] border-[0.5px] border-border bg-bg px-6 text-left text-ink-3 transition-colors hover:bg-muted/40 disabled:cursor-wait disabled:opacity-70"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-sb text-ink-2">
            {isSubmitting ? <Check className="h-6 w-6" strokeWidth={1.5} /> : <Folder className="h-6 w-6" strokeWidth={1.5} />}
          </div>
          <div className="text-[17px]">
            {isSubmitting ? "Connecting workspace..." : "Select a folder..."}
          </div>
        </button>
      </div>

      {errorMessage ? (
        <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
          {errorMessage}
        </div>
      ) : null}
    </div>
  )
}

function CreateFromScratchStep({
  value,
  isSubmitting,
  errorMessage,
  onBack,
  onChange,
  onCreate,
}: {
  value: string
  isSubmitting: boolean
  errorMessage: string | null
  onBack: () => void
  onChange: (value: string) => void
  onCreate: () => void
}) {
  return (
    <div className="p-12">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <DialogHeader className="space-y-3 text-left">
        <DialogTitle className="text-[42px] leading-[1.05] tracking-[-0.03em]">
          Create a workspace
        </DialogTitle>
        <DialogDescription className="max-w-[580px] text-[17px] leading-8 text-ink-3">
          Create a new local folder and initialize it with the workspace tracking foundation.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-10 space-y-7">
        <div>
          <label className="mb-3 block text-[15px] font-medium text-ink">Workspace name</label>
          <Input
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder="Workspace name"
            className="h-14 rounded-[16px] px-5 text-[17px]"
          />
        </div>
      </div>

      {errorMessage ? (
        <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
          {errorMessage}
        </div>
      ) : null}

      <DialogFooter className="mt-12 flex-row items-center justify-end gap-3 sm:space-x-0">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" disabled={isSubmitting || !value.trim()} onClick={onCreate}>
          {isSubmitting ? "Creating..." : "Choose location"}
        </Button>
      </DialogFooter>
    </div>
  )
}

function ConfirmWorkspaceSelectionStep({
  rootPath,
  tree,
  selectedFiles,
  fileCount,
  isSubmitting,
  errorMessage,
  onBack,
  onChange,
  onConfirm,
}: {
  rootPath: string | null
  tree: WorkspaceFolderTreeNode[]
  selectedFiles: ReadonlySet<string>
  fileCount: number
  isSubmitting: boolean
  errorMessage: string | null
  onBack: () => void
  onChange: (nextSelectedFiles: Set<string>) => void
  onConfirm: () => void
}) {
  const isLargeWorkspace = fileCount > 50

  return (
    <div className="p-12">
      <button
        type="button"
        onClick={onBack}
        className="mb-8 inline-flex h-10 w-10 items-center justify-center rounded-[10px] text-ink-3 transition-colors hover:bg-muted hover:text-ink"
      >
        <ChevronLeft className="h-5 w-5" strokeWidth={1.5} />
      </button>

      <DialogHeader className="space-y-3 text-left">
        <DialogTitle className="text-[42px] leading-[1.05] tracking-[-0.03em]">
          Choose what to include
        </DialogTitle>
        <DialogDescription className="max-w-[620px] text-[17px] leading-8 text-ink-3">
          {isLargeWorkspace
            ? `${fileCount} markdown files found. Select which folders or files this workspace should watch.`
            : "Review the markdown files in this folder and keep only the ones this workspace should watch."}
        </DialogDescription>
      </DialogHeader>

      {rootPath ? (
        <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
          {rootPath}
        </div>
      ) : null}

      <div className="mt-8">
        <FolderTreePicker
          tree={tree}
          selectedFiles={selectedFiles}
          onChange={onChange}
          autoExpandAll={!isLargeWorkspace}
        />
      </div>

      {errorMessage ? (
        <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
          {errorMessage}
        </div>
      ) : null}

      <DialogFooter className="mt-12 flex-row items-center justify-end gap-3 sm:space-x-0">
        <Button type="button" variant="outline" onClick={onBack}>
          Back
        </Button>
        <Button type="button" disabled={isSubmitting || selectedFiles.size === 0} onClick={onConfirm}>
          {isSubmitting ? "Connecting workspace..." : "Add workspace"}
        </Button>
      </DialogFooter>
    </div>
  )
}

function WorkspaceWebUnavailable() {
  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-bg px-10 py-24 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-[18px] border-[0.5px] border-border bg-sb text-ink-3">
        <Folder className="h-8 w-8" strokeWidth={1.5} />
      </div>
      <h1 className="mt-8 font-lora text-[32px] leading-tight tracking-[-0.03em] text-ink">
        Workspace is desktop-only
      </h1>
      <p className="mx-auto mt-3 max-w-[46ch] text-[16px] leading-7 text-ink-3">
        Workspaces keep local folders in context using filesystem access and watched
        folders that the web app cannot provide. Open Artifact Studio on desktop to use them.
      </p>
    </div>
  )
}
