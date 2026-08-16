"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Folder,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useState,
} from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { AddWorkspaceFlow } from "@/components/workspace/add-workspace-flow";
import {
  WorkspaceFilterBar,
  type WorkspaceFilterBarSort,
  type WorkspaceFilterBarView,
} from "@/components/workspace/workspace-filter-bar";
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
import { revealWorkspacePath } from "@/lib/workspace/reveal-path";
import type { WorkspaceSummary } from "@/lib/workspace/types";
import { buildWorkspaceHref } from "@/lib/workspace/workspace-route";
import { cn } from "@/lib/utils";
import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer";
import { ViewHeader, VIEW_HEADER_ACTION_CLASS } from "@/components/navigation/view-header";

function formatUpdatedAt(timestamp: number | null) {
  if (!timestamp) return "Recently added";
  return `Updated ${new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(timestamp))}`;
}

function workspaceMissingMessage(workspace: WorkspaceSummary) {
  return (
    workspace.missingReason ?? "This local folder is unavailable or was moved."
  );
}

type WorkspaceAction =
  | { type: "rename"; workspace: WorkspaceSummary }
  | { type: "disconnect"; workspace: WorkspaceSummary }
  | null;

function WorkspaceCardMenu({
  workspace,
  onRename,
  onDisconnect,
  onRescan,
  onManageIncluded,
}: {
  workspace: WorkspaceSummary;
  onRename: () => void;
  onDisconnect: () => void;
  onRescan: () => void;
  onManageIncluded: () => void;
}) {
  const router = useRouter();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`Manage ${workspace.name}`}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px] border-[0.5px] border-border bg-bg text-ink-4 transition-colors hover:bg-muted hover:text-ink"
        >
          <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="w-[220px] rounded-[12px] border-[0.5px] border-border bg-sb p-1.5 shadow-float-md"
      >
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px]"
          onSelect={() =>
            router.push(buildWorkspaceHref({ slug: workspace.slug }))
          }
        >
          <Folder className="h-[12px] w-[12px]" strokeWidth={1.5} />
          Open
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px]"
          onSelect={() => void revealWorkspacePath(workspace.rootPath)}
        >
          <FolderOpen className="h-[12px] w-[12px]" strokeWidth={1.5} />
          Reveal in Finder
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px]"
          onSelect={onRename}
        >
          <Pencil className="h-[12px] w-[12px]" strokeWidth={1.5} />
          Rename
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px]"
          onSelect={onRescan}
        >
          <RefreshCw className="h-[12px] w-[12px]" strokeWidth={1.5} />
          Re-scan
        </DropdownMenuItem>
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px]"
          onSelect={onManageIncluded}
        >
          Manage included files
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer gap-2 rounded-[8px] text-[13px] text-destructive focus:text-destructive"
          onSelect={onDisconnect}
        >
          <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
          Disconnect
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function WorkspaceIndex() {
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [layout, setLayout] = useState<WorkspaceFilterBarView>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [sortBy, setSortBy] = useState<WorkspaceFilterBarSort>("newest");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [action, setAction] = useState<WorkspaceAction>(null);
  const [actionValue, setActionValue] = useState("");
  const [flowOpen, setFlowOpen] = useState(false);
  const [managedWorkspace, setManagedWorkspace] =
    useState<WorkspaceSummary | null>(null);

  const loadWorkspaces = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const service = await getDesktopWorkspaceService();
      const [nextLayout, nextWorkspaces] = await Promise.all([
        service.getLayout(),
        service.listWorkspaces(),
      ]);
      setLayout(nextLayout);
      setWorkspaces(nextWorkspaces);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to load workspaces",
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadWorkspaces();
  }, [loadWorkspaces]);

  const visibleWorkspaces = useMemo(() => {
    const query = deferredQuery.trim().toLowerCase();
    let filtered = workspaces;
    if (query) {
      filtered = workspaces.filter(
        (workspace) =>
          workspace.name.toLowerCase().includes(query) ||
          workspace.rootPath.toLowerCase().includes(query),
      );
    }
    return [...filtered].sort((left, right) => {
      if (sortBy === "name") return left.name.localeCompare(right.name);
      const leftTime = left.updatedAt ?? 0;
      const rightTime = right.updatedAt ?? 0;
      return sortBy === "oldest" ? leftTime - rightTime : rightTime - leftTime;
    });
  }, [deferredQuery, sortBy, workspaces]);

  const handleLayoutChange = (nextLayout: WorkspaceFilterBarView) => {
    setLayout(nextLayout);
    void getDesktopWorkspaceService().then((service) =>
      service.setLayout(nextLayout),
    );
  };

  const handleAddWorkspace = () => {
    setManagedWorkspace(null);
    setFlowOpen(true);
  };

  const handleConfirmAction = async () => {
    if (!action) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const service = await getDesktopWorkspaceService();
      if (action.type === "rename") {
        await service.renameWorkspace(action.workspace.slug, actionValue);
      } else {
        await service.removeWorkspace(action.workspace.slug);
      }
      await loadWorkspaces();
      setAction(null);
      setActionValue("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-full flex-col bg-bg">
      <ViewTitlebarSpacer />
      <ViewHeader
        sectionId="workspace-header"
        testId="workspace-header"
        title="Workspace"
        subtitle="Synced folders, who writes in each one, and what moved last."
        actions={
          <Button
            type="button"
            onClick={handleAddWorkspace}
            disabled={isSubmitting}
            className={VIEW_HEADER_ACTION_CLASS}
          >
            <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
            Add workspace
          </Button>
        }
      />

      <WorkspaceFilterBar
        className="px-4 pb-3"
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        sortBy={sortBy}
        onSortChange={setSortBy}
        view={layout}
        onViewChange={handleLayoutChange}
      />

      <div className="flex-1 px-4 pb-4">
        {errorMessage ? (
          <div className="mb-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
            {errorMessage}
          </div>
        ) : null}

        {isLoading ? (
          <div
            className={cn(
              layout === "grid"
                ? "grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5"
                : "space-y-4",
            )}
          >
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className={cn(
                  "animate-pulse rounded-[10px] bg-muted",
                  layout === "grid" ? "h-[188px]" : "h-[116px]",
                )}
              />
            ))}
          </div>
        ) : visibleWorkspaces.length === 0 ? (
          <div className="rounded-[24px] border-[0.5px] border-dashed border-border bg-sb px-8 py-14 text-center">
            <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-[18px] border-[0.5px] border-border bg-bg text-ink-3">
              <Folder className="h-8 w-8" strokeWidth={1.5} />
            </div>
            <h2 className="mt-6 font-lora text-[28px] leading-tight text-ink">
              No workspaces yet
            </h2>
            <p className="mx-auto mt-3 max-w-[46ch] text-[16px] leading-7 text-ink-3">
              Add an existing folder to start tracking local markdown files.
            </p>
            <Button
              type="button"
              onClick={handleAddWorkspace}
              disabled={isSubmitting}
              className="mt-8 h-10 gap-2 rounded-[10px] bg-ink px-4 text-bg hover:bg-ink-2"
            >
              <Plus className="h-4 w-4" strokeWidth={1.5} />
              Add workspace
            </Button>
          </div>
        ) : layout === "grid" ? (
          <div className="grid grid-cols-[repeat(auto-fill,minmax(320px,1fr))] gap-5">
            {visibleWorkspaces.map((workspace) => (
              <div
                key={workspace.slug}
                className="rounded-[10px] bg-sb p-5 shadow-float transition-colors hover:bg-muted/40"
              >
                <div className="flex items-start gap-4">
                  <div className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-[10px] bg-muted text-ink-2">
                    <Folder className="h-[17px] w-[17px]" strokeWidth={1.5} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      {workspace.status === "ready" ? (
                        <Link
                          href={buildWorkspaceHref({ slug: workspace.slug })}
                          className="font-lora text-[19px] font-medium leading-tight tracking-[-0.02em] text-ink"
                        >
                          {workspace.name}
                        </Link>
                      ) : (
                        <h3 className="font-lora text-[19px] font-medium leading-tight tracking-[-0.02em] text-ink">
                          {workspace.name}
                        </h3>
                      )}
                      <WorkspaceCardMenu
                        workspace={workspace}
                        onRename={() => {
                          setAction({ type: "rename", workspace });
                          setActionValue(workspace.name);
                        }}
                        onDisconnect={() =>
                          setAction({ type: "disconnect", workspace })
                        }
                        onManageIncluded={() => {
                          setManagedWorkspace(workspace);
                          setFlowOpen(true);
                        }}
                        onRescan={() => void loadWorkspaces()}
                      />
                    </div>
                    <p className="mt-0.5 text-[12px] text-ink-4">
                      {workspace.status === "missing"
                        ? workspaceMissingMessage(workspace)
                        : `${workspace.fileCount} artifacts · ${workspace.folderCount} folders · ${formatUpdatedAt(workspace.updatedAt)}`}
                    </p>
                    <div
                      className="mt-2 overflow-hidden text-ellipsis whitespace-nowrap text-left font-mono text-[12px] text-ink-4"
                      style={{ direction: "rtl" }}
                      title={workspace.rootPath}
                    >
                      {workspace.rootPath}
                    </div>
                  </div>
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
                    <Folder
                      className="h-5 w-5 shrink-0 text-ink-2"
                      strokeWidth={1.5}
                    />
                    {workspace.status === "ready" ? (
                      <Link
                        href={buildWorkspaceHref({ slug: workspace.slug })}
                        className="truncate font-lora text-[19px] text-ink"
                      >
                        {workspace.name}
                      </Link>
                    ) : (
                      <span className="truncate font-lora text-[19px] text-ink">
                        {workspace.name}
                      </span>
                    )}
                  </div>
                  <div
                    className="mt-0.5 overflow-hidden text-ellipsis whitespace-nowrap pl-8 text-left font-mono text-[12px] text-ink-4"
                    style={{ direction: "rtl" }}
                    title={workspace.rootPath}
                  >
                    {workspace.rootPath}
                  </div>
                </div>
                <span className="text-[14px] text-ink-4">
                  {workspace.fileCount} artifacts
                </span>
                <span className="text-[14px] text-ink-4">
                  {workspace.folderCount} folders
                </span>
                <div className="flex items-center justify-between gap-3">
                  <span className="text-[14px] text-ink-4">
                    {formatUpdatedAt(workspace.updatedAt)}
                  </span>
                  <WorkspaceCardMenu
                    workspace={workspace}
                    onRename={() => {
                      setAction({ type: "rename", workspace });
                      setActionValue(workspace.name);
                    }}
                    onDisconnect={() =>
                      setAction({ type: "disconnect", workspace })
                    }
                    onManageIncluded={() => {
                      setManagedWorkspace(workspace);
                      setFlowOpen(true);
                    }}
                    onRescan={() => void loadWorkspaces()}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <AddWorkspaceFlow
        key={managedWorkspace?.slug ?? "new"}
        open={flowOpen}
        onOpenChange={setFlowOpen}
        workspace={managedWorkspace}
        onComplete={() => {
          void loadWorkspaces();
        }}
      />

      <Dialog
        open={action !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAction(null);
            setActionValue("");
          }
        }}
      >
        <DialogContent hideClose className="max-w-[520px] rounded-[24px] p-0">
          {action?.type === "rename" ? (
            <div className="p-8">
              <DialogHeader className="space-y-3 text-left">
                <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                  Rename workspace
                </DialogTitle>
                <DialogDescription className="text-[16px] leading-7 text-ink-3">
                  Update the workspace label in Odessay. This does not rename
                  the local folder.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-8">
                <label className="mb-3 block text-[15px] font-medium text-ink">
                  Workspace name
                </label>
                <Input
                  value={actionValue}
                  onChange={(event) => setActionValue(event.target.value)}
                  placeholder="Workspace name"
                  className="h-12 rounded-[12px]"
                />
              </div>
              <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setAction(null);
                    setActionValue("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={isSubmitting || !actionValue.trim()}
                  onClick={() => void handleConfirmAction()}
                >
                  {isSubmitting ? "Saving…" : "Save name"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}

          {action?.type === "disconnect" ? (
            <div className="p-8">
              <DialogHeader className="space-y-3 text-left">
                <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                  Disconnect workspace
                </DialogTitle>
                <DialogDescription className="text-[16px] leading-7 text-ink-3">
                  Disconnecting keeps all local files untouched. The folder will
                  stop syncing with Odessay.
                </DialogDescription>
              </DialogHeader>
              <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
                {action.workspace.name}
              </div>
              <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setAction(null)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  variant="destructive"
                  disabled={isSubmitting}
                  onClick={() => void handleConfirmAction()}
                >
                  {isSubmitting ? "Disconnecting…" : "Disconnect"}
                </Button>
              </DialogFooter>
            </div>
          ) : null}
        </DialogContent>
      </Dialog>
    </div>
  );
}
