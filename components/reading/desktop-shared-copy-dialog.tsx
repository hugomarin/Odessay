"use client"

import { useEffect, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { copyDesktopSharedWritingToWorkspace } from "@/lib/services/shared-reading-service"
import { getWorkspaceAssignmentService } from "@/lib/services/workspace-service"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import type { WorkspaceDetail } from "@/lib/workspace/types"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"

type DesktopSharedCopyDialogProps = {
  open: boolean
  identifier: string
  writingTitle: string | null
  onOpenChange: (open: boolean) => void
}

type FolderOption = {
  path: string
  label: string
}

const MARKDOWN_FILE_RE = /\.mdx?$/i

function buildFolderOptions(workspace: WorkspaceDetail): FolderOption[] {
  const options = new Map<string, FolderOption>([
    ["", { path: "", label: `${workspace.name} /` }],
  ])

  for (const selectedPath of workspace.selectedPaths) {
    const normalized = selectedPath.trim().replace(/^\/+|\/+$/g, "")
    if (!normalized || MARKDOWN_FILE_RE.test(normalized)) {
      continue
    }

    options.set(normalized, { path: normalized, label: normalized })
  }

  for (const file of workspace.files) {
    const segments = file.relativePath.split("/").filter(Boolean)
    segments.pop()

    let currentPath = ""
    for (const segment of segments) {
      currentPath = currentPath ? `${currentPath}/${segment}` : segment
      options.set(currentPath, { path: currentPath, label: currentPath })
    }
  }

  return Array.from(options.values()).sort((left, right) => left.path.localeCompare(right.path))
}

export function DesktopSharedCopyDialog({
  open,
  identifier,
  writingTitle,
  onOpenChange,
}: DesktopSharedCopyDialogProps) {
  const router = useRouter()
  const [workspaceOptions, setWorkspaceOptions] = useState<WorkspaceAssignmentOption[]>([])
  const [selectedWorkspaceSlug, setSelectedWorkspaceSlug] = useState("")
  const [workspaceDetail, setWorkspaceDetail] = useState<WorkspaceDetail | null>(null)
  const [selectedFolder, setSelectedFolder] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isCreatingWorkspace, setIsCreatingWorkspace] = useState(false)

  const folderOptions = useMemo(
    () => (workspaceDetail ? buildFolderOptions(workspaceDetail) : [{ path: "", label: "Workspace root" }]),
    [workspaceDetail],
  )

  useEffect(() => {
    if (!open) {
      return
    }

    const service = getWorkspaceAssignmentService()
    if (!service.isAvailable) {
      setWorkspaceOptions([])
      setSelectedWorkspaceSlug("")
      setWorkspaceDetail(null)
      setSelectedFolder("")
      setError("Desktop workspaces are unavailable in this runtime.")
      return
    }

    setError(null)
    void service.listWorkspaces().then((options) => {
      setWorkspaceOptions(options)
      setSelectedWorkspaceSlug((current) => current || options[0]?.slug || "")
    })
  }, [open])

  useEffect(() => {
    if (!open || !selectedWorkspaceSlug) {
      setWorkspaceDetail(null)
      setSelectedFolder("")
      return
    }

    const service = getWorkspaceAssignmentService()
    void service.getWorkspaceDetail(selectedWorkspaceSlug).then((detail) => {
      setWorkspaceDetail(detail)
      setSelectedFolder("")
    })
  }, [open, selectedWorkspaceSlug])

  const handleCreateWorkspace = async () => {
    setIsCreatingWorkspace(true)
    setError(null)
    try {
      const service = getWorkspaceAssignmentService()
      const created = await service.createWorkspace()
      if (!created) {
        return
      }

      const options = await service.listWorkspaces()
      setWorkspaceOptions(options)
      setSelectedWorkspaceSlug(created.slug)
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Failed to create workspace.")
    } finally {
      setIsCreatingWorkspace(false)
    }
  }

  const handleSubmit = async () => {
    if (!selectedWorkspaceSlug) {
      setError("Choose a workspace before saving.")
      return
    }

    setIsSubmitting(true)
    setError(null)
    try {
      const result = await copyDesktopSharedWritingToWorkspace({
        identifier,
        workspaceSlug: selectedWorkspaceSlug,
        destinationFolder: selectedFolder,
      })

      if (result.error || !result.data) {
        setError(result.error?.message ?? "Failed to save shared artifact.")
        return
      }

      onOpenChange(false)
      router.push(buildWritingRouteHref("/write", { id: result.data.writingId, slug: null }))
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "Failed to save shared artifact.")
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[520px]">
        <DialogHeader>
          <DialogTitle>Save to my files</DialogTitle>
          <DialogDescription>
            Create a local editable copy of {writingTitle ? `"${writingTitle}"` : "this shared artifact"}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-ink-2">Workspace</span>
            <select
              value={selectedWorkspaceSlug}
              onChange={(event) => setSelectedWorkspaceSlug(event.target.value)}
              className="h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-ink"
            >
              {workspaceOptions.length === 0 ? (
                <option value="">No workspaces yet</option>
              ) : (
                workspaceOptions.map((option) => (
                  <option key={option.slug} value={option.slug}>
                    {option.name}
                  </option>
                ))
              )}
            </select>
          </label>

          <label className="block space-y-2">
            <span className="text-[13px] font-medium text-ink-2">Folder</span>
            <select
              value={selectedFolder}
              onChange={(event) => setSelectedFolder(event.target.value)}
              disabled={!selectedWorkspaceSlug}
              className="h-10 w-full rounded-[10px] border border-border bg-bg px-3 text-[14px] text-ink disabled:opacity-60"
            >
              {folderOptions.map((option) => (
                <option key={option.path || "__root__"} value={option.path}>
                  {option.label}
                </option>
              ))}
            </select>
          </label>

          {workspaceDetail?.status === "missing" ? (
            <p className="text-[12px] text-destructive">The selected workspace is unavailable right now.</p>
          ) : null}

          {error ? <p className="text-[12px] text-destructive">{error}</p> : null}
        </div>

        <DialogFooter className="gap-2 sm:justify-between">
          <Button type="button" variant="outline" onClick={() => void handleCreateWorkspace()} disabled={isCreatingWorkspace || isSubmitting}>
            {isCreatingWorkspace ? "Creating workspace…" : "New workspace…"}
          </Button>
          <div className="flex gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={isSubmitting}>
              Cancel
            </Button>
            <Button type="button" onClick={() => void handleSubmit()} disabled={!selectedWorkspaceSlug || isSubmitting}>
              {isSubmitting ? "Saving…" : "Save as my copy"}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
