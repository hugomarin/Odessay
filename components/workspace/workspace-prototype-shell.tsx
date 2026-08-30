"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  startTransition,
  type ReactNode,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Check,
  ChevronDown,
  ChevronLeft,
  Eye,
  ExternalLink,
  FileText,
  Folder,
  LayoutGrid,
  List,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Tag,
  TriangleAlert,
  Trash2,
} from "lucide-react";
import { useWritingSelection } from "@/hooks/useWritingSelection";
import { BulkActionBar } from "@/components/desk/bulk-action-bar";
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog";
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal";
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal";
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu";
import { useUserSettingsContext } from "@/components/settings/user-settings-provider";
import { FolderTreePicker } from "@/components/workspace/folder-tree-picker";
import { LibraryControlsBar } from "@/components/library/library-controls-bar";
import { useWorkspaceTableFilters } from "@/hooks/useWorkspaceTableFilters";
import {
  DocumentStateBadge,
  DocumentStateTooltipProvider,
} from "@/components/ui/document-state-badge";
import { ArtifactTable } from "@/components/shared/artifact-table";
import { ArtifactRowSelection } from "@/components/shared/artifact-row-selection";
import {
  ArtifactWritingAction,
  ArtifactWritingCell,
} from "@/components/shared/artifact-writing-cell";
import { CollectionChips } from "@/components/desk/collection-chips";
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types";
import { TablePropertySelector } from "@/components/ui/table-property-selector";
import { ArtifactTypeIcon } from "@/components/desk/desk-activity-table";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
import {
  WRITING_STATUS_VALUES,
  getWritingStatusLabel,
  normalizeWritingStatus,
  type WritingStatus,
} from "@/lib/writings/status";
import {
  ARTIFACT_TYPE_VALUES,
  getArtifactTypeLabel,
  type ArtifactType,
} from "@/lib/writings/artifact-type";
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
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection";
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
import {
  describeOpenOutcome,
  isUnifiedOpenEnabled,
  openDocumentByPath,
} from "@/lib/services/open-document-factory";
import {
  buildDefaultWorkspaceSelection,
  buildWorkspaceFolderTree,
  compressWorkspaceSelection,
  type WorkspaceFolderTreeNode,
} from "@/lib/workspace/folder-tree";
import type {
  WorkspaceDetail,
  WorkspaceFile,
  WorkspaceLayout,
  WorkspaceSummary,
} from "@/lib/workspace/types";
import { buildWorkspaceHref } from "@/lib/workspace/workspace-route";
import { subscribeToCatalog } from "@/lib/queries/document-catalog";
import {
  loadWorkspaceDocumentJoin,
  type WorkspaceDocumentInfo,
} from "@/lib/queries/workspace-catalog-source";
import type { CollectionOption } from "@/lib/collections/collections";
import { buildCollectionOptions } from "@/lib/collections/collections";
import { getLocalDBScope, getWritingForEdit, loadCollectionState } from "@/lib/queries/desk-catalog-source";
import {
  bulkAddToCollection,
  bulkChangeArtifactType,
  bulkChangeStatus,
  bulkCreateCollection,
  bulkDelete,
  changeWritingArtifactType,
  changeWritingStatus,
  createAndAssignCollection,
  deleteWriting,
  renameWriting,
  toggleWritingCollection as toggleWritingCollectionMutation,
} from "@/lib/queries/writing-mutations";
import type { DeskActivityRow } from "@/lib/queries/desk-activity";
import type { LocalWritingCollection } from "@/lib/local-db/schema";
import { buildWritingRouteHref } from "@/lib/writings/writing-route";
import {
  deriveDocumentStateFromSignals,
  type DocumentState,
} from "@/lib/writings/document-state";
import { cn } from "@/lib/utils";

type AddWorkspaceStep =
  "chooser" | "existing" | "existingSelection" | "scratch";

type WorkspaceActionState =
  | { type: "rename"; workspace: WorkspaceSummary | WorkspaceDetail }
  | {
      type: "remove";
      workspace: WorkspaceSummary | WorkspaceDetail;
      total: number;
      cloud: number;
    }
  | null;

function formatUpdatedAt(timestamp: number | null) {
  if (!timestamp) {
    return "Recently added";
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return `Updated ${formatter.format(new Date(timestamp))}`;
}

function formatFileTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function fileSecondaryLabel(file: WorkspaceFile) {
  return file.relativePath === file.name
    ? "Root folder"
    : file.relativePath.replace(`/${file.name}`, "");
}

function pickPinnedFile(files: WorkspaceFile[]) {
  return (
    files.find((file) => file.name.toLowerCase() === "instructions.md") ?? null
  );
}

function matchesWorkspaceQuery(workspace: WorkspaceSummary, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [workspace.name, workspace.rootPath].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function matchesFileQuery(file: WorkspaceFile, query: string) {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery) {
    return true;
  }

  return [file.name, file.relativePath].some((value) =>
    value.toLowerCase().includes(normalizedQuery),
  );
}

function WorkspaceSearchInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder: string;
}) {
  return (
    <div className="relative flex-1 min-w-[200px] max-w-[560px]">
      <Search
        className="absolute left-3 top-1/2 h-[14px] w-[14px] -translate-y-1/2 text-ink-4"
        strokeWidth={1.5}
      />
      <Input
        type="text"
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-[8px] border-transparent bg-muted/70 pl-9 pr-4 text-[13px] font-sans text-ink placeholder:text-ink-4 shadow-none"
      />
    </div>
  );
}

function WorkspaceControlChip({
  active = false,
  onClick,
  children,
}: {
  active?: boolean;
  onClick?: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 items-center gap-2 rounded-[8px] px-5 text-[13px] text-ink-2 transition-colors",
        active
          ? "bg-muted text-ink"
          : "bg-muted/70 hover:bg-muted hover:text-ink",
      )}
    >
      {children}
    </button>
  );
}

function WorkspaceControlOption({
  active,
  children,
  onClick,
}: {
  active: boolean;
  children: ReactNode;
  onClick: () => void;
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
  );
}

function workspaceMissingMessage(
  workspace: WorkspaceSummary | WorkspaceDetail,
) {
  return (
    workspace.missingReason ?? "This local folder is unavailable or was moved."
  );
}

/**
 * Opens a workspace file through the one unified opener (ODE-375 M3). With the
 * catalog pipeline enabled, path → UUID goes through `openDocumentByPath`, which
 * resolves identity via the catalog/manifest before hydration and never seeds or
 * replaces IndexedDB records destructively. With the flag off, desktop keeps its
 * existing `openFileInEditor` pipeline (reversible migration, spec §Gates #2).
 */
async function openWorkspaceFileInEditor(
  file: WorkspaceFile,
  router: ReturnType<typeof useRouter>,
  onError?: (message: string) => void,
): Promise<void> {
  try {
    if (isUnifiedOpenEnabled()) {
      let result = await openDocumentByPath(file.path);
      if (result.status === "needs-binding-root-confirmation") {
        const accept = window.confirm(
          `Register “${result.parentDir}” so Artifact Studio can keep this file’s identity across moves and renames?`,
        );
        if (!accept) return;
        result = await openDocumentByPath(file.path, {
          confirmRegisterRoot: true,
        });
      }
      if (result.status === "opened") {
        router.push(`/write?id=${encodeURIComponent(result.documentId)}`);
        return;
      }
      onError?.(describeOpenOutcome(result));
      return;
    }

    const service = await getDesktopWorkspaceService();
    const writingId = await service.openFileInEditor(file.path, file.id);
    router.push(`/write?id=${encodeURIComponent(writingId)}`);
  } catch (error) {
    onError?.(error instanceof Error ? error.message : "Failed to open file");
  }
}

function deriveWorkspaceFileDocumentState(
  file: WorkspaceFile,
  documentJoin: Map<string, WorkspaceDocumentInfo>,
): DocumentState {
  const info = documentJoin.get(file.path);

  if (info) {
    return info.state;
  }

  // A file present on disk with no catalog record yet is a materialized local
  // file awaiting reconciliation — render it local-only, never as cloud/synced.
  return deriveDocumentStateFromSignals({
    hasCloudRecord: false,
    hasLocalFile: true,
    isPending: false,
  });
}

export function WorkspaceIndexPrototype() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <WorkspaceLoadingShell />;
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />;
  }

  return <DesktopWorkspaceIndex />;
}

export function WorkspaceDetailPrototype({
  workspaceSlug,
}: {
  workspaceSlug: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <WorkspaceLoadingShell />;
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />;
  }

  return <DesktopWorkspaceDetail workspaceSlug={workspaceSlug} />;
}

export function WorkspaceFilePrototype({
  workspaceSlug,
  fileId,
}: {
  workspaceSlug: string;
  fileId: string;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <WorkspaceLoadingShell />;
  }

  if (!isDesktopRuntime()) {
    return <WorkspaceWebUnavailable />;
  }

  return <DesktopWorkspaceFile workspaceSlug={workspaceSlug} fileId={fileId} />;
}

function WorkspaceLoadingShell() {
  return (
    <div className="min-h-full bg-bg px-10 py-10">
      <div className="h-11 w-56 rounded-[12px] bg-muted/60" />
      <div className="mt-4 h-5 w-80 rounded-[10px] bg-muted/50" />
      <div className="mt-10 grid grid-cols-2 gap-6">
        {Array.from({ length: 4 }).map((_, index) => (
          <div
            key={index}
            className="h-[220px] rounded-[20px] border-[0.5px] border-border bg-sb"
          />
        ))}
      </div>
    </div>
  );
}

function DesktopWorkspaceIndex() {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([]);
  const [layout, setLayout] = useState<WorkspaceLayout>("grid");
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [step, setStep] = useState<AddWorkspaceStep>("chooser");
  const [newWorkspaceName, setNewWorkspaceName] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspaceAction, setWorkspaceAction] =
    useState<WorkspaceActionState>(null);
  const [workspaceActionValue, setWorkspaceActionValue] = useState("");
  const [pendingWorkspaceRootPath, setPendingWorkspaceRootPath] = useState<
    string | null
  >(null);
  const [pendingWorkspaceTree, setPendingWorkspaceTree] = useState<
    WorkspaceFolderTreeNode[]
  >([]);
  const [selectedWorkspaceFiles, setSelectedWorkspaceFiles] = useState<
    Set<string>
  >(new Set());

  const promptRemoveWorkspace = useCallback(
    async (workspace: WorkspaceSummary) => {
      try {
        const service = await getDesktopWorkspaceService();
        const preview = await service.previewWorkspaceRemoval(workspace.slug);
        setWorkspaceAction({ type: "remove", workspace, ...preview });
        setWorkspaceActionValue(workspace.name);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to preview workspace removal",
        );
      }
    },
    [],
  );

  const loadIndex = useCallback(async () => {
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
    void loadIndex();
  }, [loadIndex]);

  const visibleWorkspaces = useMemo(() => {
    return workspaces.filter((workspace) =>
      matchesWorkspaceQuery(workspace, deferredQuery),
    );
  }, [deferredQuery, workspaces]);

  useEffect(() => {
    if (!isDesktopRuntime()) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToCatalog(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadIndex();
      }, 100);
    });
    return () => {
      unsubscribe();
      if (timer) clearTimeout(timer);
    };
  }, [loadIndex]);

  const handleLayoutChange = (nextLayout: WorkspaceLayout) => {
    startTransition(() => {
      setLayout(nextLayout);
    });
    void getDesktopWorkspaceService().then((service) =>
      service.setLayout(nextLayout),
    );
  };

  const handleAddExistingWorkspace = async () => {
    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();
      const rootPath = await service.pickExistingWorkspaceRoot();
      if (!rootPath) {
        return;
      }

      const snapshot = await service.inspectWorkspace(rootPath);
      const tree = buildWorkspaceFolderTree(snapshot.files);
      setPendingWorkspaceRootPath(rootPath);
      setPendingWorkspaceTree(tree);
      setSelectedWorkspaceFiles(buildDefaultWorkspaceSelection(snapshot.files));
      setStep("existingSelection");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to add workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleConfirmExistingWorkspace = async () => {
    if (!pendingWorkspaceRootPath) {
      return;
    }

    if (selectedWorkspaceFiles.size === 0) {
      setErrorMessage(
        "Select at least one markdown file or folder to include.",
      );
      return;
    }

    const selectedPaths = compressWorkspaceSelection(
      pendingWorkspaceTree,
      selectedWorkspaceFiles,
    );

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();
      const workspace = await service.addExistingWorkspaceWithSelection(
        pendingWorkspaceRootPath,
        selectedPaths,
      );
      if (!workspace) {
        return;
      }

      await loadIndex();
      setIsDialogOpen(false);
      setStep("chooser");
      setPendingWorkspaceRootPath(null);
      setPendingWorkspaceTree([]);
      setSelectedWorkspaceFiles(new Set());
      router.push(buildWorkspaceHref({ slug: workspace.slug }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to add workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateWorkspace = async () => {
    if (!newWorkspaceName.trim()) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();
      const workspace = await service.createWorkspace(newWorkspaceName.trim());
      if (!workspace) {
        return;
      }

      setNewWorkspaceName("");
      await loadIndex();
      setIsDialogOpen(false);
      setStep("chooser");
      router.push(buildWorkspaceHref({ slug: workspace.slug }));
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleWorkspaceAction = async () => {
    if (!workspaceAction) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();

      if (workspaceAction.type === "rename") {
        await service.renameWorkspace(
          workspaceAction.workspace.slug,
          workspaceActionValue,
        );
      } else {
        await service.removeWorkspace(workspaceAction.workspace.slug);
      }

      await loadIndex();
      setWorkspaceAction(null);
      setWorkspaceActionValue("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const pendingWorkspaceFileCount = useMemo(
    () =>
      pendingWorkspaceTree.reduce((total, node) => total + node.fileCount, 0),
    [pendingWorkspaceTree],
  );

  return (
    <>
      <div className="flex min-h-full flex-col bg-bg">
        <div data-tauri-drag-region className="od-drag-region border-b-[0.5px] border-border px-10 py-7">
          <div data-tauri-drag-region className="flex items-start justify-between gap-6">
            <div data-tauri-drag-region className="max-w-[620px]">
              <h1 data-tauri-drag-region className="text-[24px] font-medium tracking-[-0.03em] text-ink">
                Workspace
              </h1>
              <p data-tauri-drag-region className="mt-1 text-[14px] text-ink-4">
                Local workspaces that keep your files in context.
              </p>
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => {
                  setStep("chooser");
                  setIsDialogOpen(true);
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
              <WorkspaceControlChip
                active={layout === "grid"}
                onClick={() => handleLayoutChange("grid")}
              >
                <LayoutGrid className="h-4 w-4" strokeWidth={1.5} />
                Grid
              </WorkspaceControlChip>
              <WorkspaceControlChip
                active={layout === "list"}
                onClick={() => handleLayoutChange("list")}
              >
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
            <div
              className={cn(
                layout === "grid" ? "grid grid-cols-2 gap-6" : "space-y-4",
              )}
            >
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
              <h2 className="mt-6 font-lora text-[28px] leading-tight text-ink">
                No workspaces yet
              </h2>
              <p className="mx-auto mt-3 max-w-[46ch] text-[16px] leading-7 text-ink-3">
                Add an existing folder or create a new workspace to start
                tracking local markdown files.
              </p>
              <Button
                type="button"
                className="mt-8 h-10 rounded-[10px] px-4"
                onClick={() => {
                  setStep("chooser");
                  setIsDialogOpen(true);
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
                    workspace.status === "ready"
                      ? "transition-colors hover:bg-muted/40"
                      : "",
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
                              href={buildWorkspaceHref({
                                slug: workspace.slug,
                              })}
                              className="font-lora text-[20px] leading-tight tracking-[-0.02em] text-ink"
                            >
                              {workspace.name}
                            </Link>
                          ) : (
                            <h2 className="font-lora text-[20px] leading-tight tracking-[-0.02em] text-ink">
                              {workspace.name}
                            </h2>
                          )}
                          <p className="mt-1 truncate text-sm text-ink-4">
                            {workspace.rootPath}
                          </p>
                        </div>
                        <WorkspaceActionsMenu
                          workspace={workspace}
                          triggerClassName="shrink-0 border-[0.5px] border-border bg-bg"
                          onRename={() => {
                            setWorkspaceAction({ type: "rename", workspace });
                            setWorkspaceActionValue(workspace.name);
                          }}
                          onRemove={() => void promptRemoveWorkspace(workspace)}
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
                        <TriangleAlert
                          className="h-5 w-5 shrink-0 text-ink-2"
                          strokeWidth={1.5}
                        />
                      ) : (
                        <Folder
                          className="h-5 w-5 shrink-0 text-ink-2"
                          strokeWidth={1.5}
                        />
                      )}
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
                    <div className="mt-1 truncate pl-8 text-sm text-ink-4">
                      {workspace.rootPath}
                    </div>
                  </div>
                  <span className="text-sm text-ink-4">
                    {workspace.fileCount} files
                  </span>
                  <span className="text-sm text-ink-4">
                    {workspace.folderCount} folders
                  </span>
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-sm text-ink-4">
                      {formatUpdatedAt(workspace.updatedAt)}
                    </span>
                    <WorkspaceActionsMenu
                      workspace={workspace}
                      onRename={() => {
                        setWorkspaceAction({ type: "rename", workspace });
                        setWorkspaceActionValue(workspace.name);
                      }}
                      onRemove={() => void promptRemoveWorkspace(workspace)}
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
          setIsDialogOpen(nextOpen);
          if (!nextOpen) {
            setStep("chooser");
            setNewWorkspaceName("");
            setPendingWorkspaceRootPath(null);
            setPendingWorkspaceTree([]);
            setSelectedWorkspaceFiles(new Set());
            setErrorMessage(null);
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
            setWorkspaceAction(null);
            setWorkspaceActionValue("");
          }
        }}
      />
    </>
  );
}

function DesktopWorkspaceDetail({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const deferredQuery = useDeferredValue(searchQuery);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [workspaceAction, setWorkspaceAction] =
    useState<WorkspaceActionState>(null);
  const [workspaceActionValue, setWorkspaceActionValue] = useState("");
  const [documentJoin, setDocumentJoin] = useState<
    Map<string, WorkspaceDocumentInfo>
  >(new Map());
  const [collectionOptions, setCollectionOptions] = useState<
    CollectionOption[]
  >([]);
  const [collectionIdsByWritingId, setCollectionIdsByWritingId] = useState<
    Record<string, string[]>
  >({});
  const hasLoadedWorkspaceRef = useRef(false);
  const { settings } = useUserSettingsContext();
  const {
    selectedIds,
    toggleSelection,
    selectAll,
    deselectAll,
    hasSelection,
    selectedCount,
  } = useWritingSelection();
  const [renameTarget, setRenameTarget] = useState<{
    id: string;
    title: string;
    bodyText: string;
  } | null>(null);
  const [previewWritingId, setPreviewWritingId] = useState<string | null>(null);
  const [isBulkDeleteOpen, setIsBulkDeleteOpen] = useState(false);
  const {
    dateFilter: fileDateFilter,
    setDateFilter: setFileDateFilter,
    groupBy: fileGroupBy,
    setGroupBy: setFileGroupBy,
    sortBy: fileSortBy,
    setSortBy: setFileSortBy,
  } = useWorkspaceTableFilters();

  const promptRemoveWorkspace = useCallback(
    async (workspace: WorkspaceSummary | WorkspaceDetail) => {
      try {
        const service = await getDesktopWorkspaceService();
        const preview = await service.previewWorkspaceRemoval(workspace.slug);
        setWorkspaceAction({ type: "remove", workspace, ...preview });
        setWorkspaceActionValue(workspace.name);
      } catch (error) {
        setErrorMessage(
          error instanceof Error
            ? error.message
            : "Failed to preview workspace removal",
        );
      }
    },
    [],
  );

  const loadWorkspace = useCallback(async () => {
    const isInitialLoad = !hasLoadedWorkspaceRef.current;
    if (isInitialLoad) {
      setIsLoading(true);
    }
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();
      // The desktop service resolves the filesystem-backed workspace (root,
      // watched paths, on-disk files). Document identity and state for each file
      // are joined from the DocumentCatalog through the application port — the
      // same base set Desk renders — so this component reads no storage directly.
      const nextWorkspace = await service.getWorkspace(workspaceSlug);
      if (!nextWorkspace) {
        setWorkspace(null);
        setErrorMessage("Workspace not found");
        return;
      }

      const [join, collectionState] = await Promise.all([
        loadWorkspaceDocumentJoin(nextWorkspace.rootPath),
        loadCollectionState(),
      ]);
      const idsByWritingId: Record<string, string[]> = {};
      for (const assignment of collectionState.writingCollections) {
        idsByWritingId[assignment.writing_id] = [
          ...(idsByWritingId[assignment.writing_id] ?? []),
          assignment.collection_id,
        ];
      }
      setWorkspace(nextWorkspace);
      setDocumentJoin(join);
      setCollectionOptions(buildCollectionOptions(collectionState.collections));
      setCollectionIdsByWritingId(idsByWritingId);
      if (isInitialLoad) {
        await service.markWorkspaceOpened(workspaceSlug);
      }
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to load workspace",
      );
    } finally {
      if (isInitialLoad) {
        hasLoadedWorkspaceRef.current = true;
        setIsLoading(false);
      }
    }
  }, [workspaceSlug]);

  useEffect(() => {
    void loadWorkspace();
  }, [loadWorkspace]);

  const visibleFiles = useMemo(() => {
    const files =
      workspace?.files.filter((file) => {
        if (!matchesFileQuery(file, deferredQuery)) return false;
        if (fileDateFilter === "last-7")
          return file.modifiedAt >= Date.now() - 7 * 24 * 60 * 60 * 1000;
        return true;
      }) ?? [];
    return files.sort((left, right) => {
      if (fileSortBy === "name") return left.name.localeCompare(right.name);
      return fileSortBy === "oldest"
        ? left.modifiedAt - right.modifiedAt
        : right.modifiedAt - left.modifiedAt;
    });
  }, [deferredQuery, fileDateFilter, fileSortBy, workspace]);

  const pinnedFile = useMemo(() => {
    return workspace ? pickPinnedFile(workspace.files) : null;
  }, [workspace]);

  const fileGroups = useMemo(() => {
    if (fileGroupBy === "none") return [{ items: visibleFiles }];
    const groups = new Map<string, WorkspaceFile[]>();
    for (const file of visibleFiles) {
      const label = fileSecondaryLabel(file);
      groups.set(label, [...(groups.get(label) ?? []), file]);
    }
    return Array.from(groups.entries()).map(([label, items]) => ({
      label,
      items,
    }));
  }, [fileGroupBy, visibleFiles]);

  const getRowKey = useCallback(
    (file: WorkspaceFile) => documentJoin.get(file.path)?.id ?? file.id,
    [documentJoin],
  );

  const visibleWritingIds = useMemo(
    () =>
      visibleFiles
        .map((file) => documentJoin.get(file.path)?.id)
        .filter((id): id is string => Boolean(id)),
    [visibleFiles, documentJoin],
  );

  const allVisibleSelected =
    visibleWritingIds.length > 0 &&
    visibleWritingIds.every((id) => selectedIds.has(id));

  const writingCollections = useMemo<LocalWritingCollection[]>(
    () =>
      Object.entries(collectionIdsByWritingId).flatMap(([writingId, ids]) =>
        ids.map((collectionId, index) => ({
          id: `${writingId}-${collectionId}-${index}`,
          writing_id: writingId,
          collection_id: collectionId,
          added_at: "",
          local_updated_at: 0,
        })),
      ),
    [collectionIdsByWritingId],
  );

  const previewRows = useMemo<DeskActivityRow[]>(
    () =>
      visibleFiles.map((file) => {
        const document = documentJoin.get(file.path);
        const writingId = document?.id ?? file.id;
        const status = document?.status ?? "draft";
        const artifactType = document?.artifactType ?? "general";
        return {
          id: writingId,
          title: file.name.replace(/\.(md|mdx)$/i, ""),
          excerpt: document?.excerpt ?? "",
          localPath: file.path,
          stateLabel: getWritingStatusLabel(status),
          stateTone: normalizeWritingStatus(status),
          documentState: deriveWorkspaceFileDocumentState(file, documentJoin),
          artifactType,
          recipientPreviews: [],
          dateLabel: formatFileTimestamp(file.modifiedAt),
          isNew: false,
          destinationHref: buildWritingRouteHref("/write", {
            id: writingId,
            slug: null,
          }),
          workspaceSlug: workspace?.slug ?? null,
          workspaceName: workspace?.name ?? null,
        };
      }),
    [visibleFiles, documentJoin, workspace],
  );

  const previewIndex = useMemo(
    () =>
      previewWritingId === null
        ? null
        : previewRows.findIndex((row) => row.id === previewWritingId),
    [previewRows, previewWritingId],
  );

  const openRenameWriting = useCallback(
    async (file: WorkspaceFile) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      const writing = await getWritingForEdit(document.id);
      if (!writing) {
        return;
      }
      setRenameTarget({
        id: writing.id,
        title: writing.title?.trim() || "Untitled artifact",
        bodyText: writing.body_text,
      });
    },
    [documentJoin],
  );

  const openWritingPreview = useCallback(
    (file: WorkspaceFile) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      setPreviewWritingId(document.id);
    },
    [documentJoin],
  );

  const handleDeleteFile = useCallback(
    async (file: WorkspaceFile) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      await deleteWriting(document.id);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleRenameConfirm = useCallback(
    async (nextTitle: string) => {
      if (!renameTarget) {
        return;
      }
      await renameWriting(renameTarget.id, nextTitle);
      await loadWorkspace();
      setRenameTarget(null);
    },
    [renameTarget, loadWorkspace],
  );

  const handleStatusChange = useCallback(
    async (file: WorkspaceFile, status: WritingStatus) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      await changeWritingStatus(document.id, status);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleArtifactTypeChange = useCallback(
    async (file: WorkspaceFile, artifactType: ArtifactType) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      await changeWritingArtifactType(document.id, artifactType);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleCollectionToggle = useCallback(
    async (file: WorkspaceFile, collectionId: string) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      await toggleWritingCollectionMutation(
        document.id,
        collectionId,
        writingCollections,
      );
      await loadWorkspace();
    },
    [documentJoin, writingCollections, loadWorkspace],
  );

  const handleCreateCollection = useCallback(
    async (file: WorkspaceFile, name: string) => {
      const document = documentJoin.get(file.path);
      if (!document) {
        return;
      }
      const ownerId = getLocalDBScope();
      await createAndAssignCollection(
        document.id,
        name,
        ownerId === "anonymous" ? null : ownerId,
        writingCollections,
      );
      await loadWorkspace();
    },
    [documentJoin, writingCollections, loadWorkspace],
  );

  const handleTitleChange = useCallback(
    async (writingId: string, title: string) => {
      await renameWriting(writingId, title);
      await loadWorkspace();
    },
    [loadWorkspace],
  );

  const handlePreviewDelete = useCallback(
    async (writingId: string) => {
      await deleteWriting(writingId);
      setPreviewWritingId(null);
      await loadWorkspace();
    },
    [loadWorkspace],
  );

  const handleBulkDelete = useCallback(async () => {
    await bulkDelete(selectedIds);
    deselectAll();
    await loadWorkspace();
  }, [selectedIds, deselectAll, loadWorkspace]);

  const handleBulkStatusChange = useCallback(
    async (status: WritingStatus) => {
      await bulkChangeStatus(selectedIds, status);
      await loadWorkspace();
    },
    [selectedIds, loadWorkspace],
  );

  const handleBulkArtifactTypeChange = useCallback(
    async (artifactType: ArtifactType) => {
      await bulkChangeArtifactType(selectedIds, artifactType);
      await loadWorkspace();
    },
    [selectedIds, loadWorkspace],
  );

  const handleBulkAddToCollection = useCallback(
    async (collectionId: string) => {
      await bulkAddToCollection(selectedIds, collectionId, writingCollections);
      await loadWorkspace();
    },
    [selectedIds, writingCollections, loadWorkspace],
  );

  const handleBulkCreateCollection = useCallback(
    async (name: string) => {
      const ownerId = getLocalDBScope();
      await bulkCreateCollection(
        selectedIds,
        name,
        ownerId === "anonymous" ? null : ownerId,
        writingCollections,
      );
      await loadWorkspace();
    },
    [selectedIds, writingCollections, loadWorkspace],
  );

  const enabledStatuses = useMemo(
    () =>
      WRITING_STATUS_VALUES.filter(
        (status) => !settings.disabledStatuses.includes(status),
      ),
    [settings.disabledStatuses],
  );

  useEffect(() => {
    const handleFocus = () => void loadWorkspace();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadWorkspace]);

  // Keep this Workspace consistent with the global DocumentCatalog: a reconciler
  // burst that touches any document (including this root) triggers one coalesced
  // reload so Workspace and Desk share the same base set and states (ODE-373
  // parity + reactive fan-out). Desktop-only — the web boundary never mounts this.
  useEffect(() => {
    if (!isDesktopRuntime()) {
      return;
    }

    let timer: ReturnType<typeof setTimeout> | null = null;
    const unsubscribe = subscribeToCatalog(() => {
      if (timer) return;
      timer = setTimeout(() => {
        timer = null;
        void loadWorkspace();
      }, 100);
    });

    return () => {
      unsubscribe();
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [loadWorkspace]);

  const openInEditor = useCallback(
    async (file: WorkspaceFile) => {
      setErrorMessage(null);
      await openWorkspaceFileInEditor(file, router, setErrorMessage);
    },
    [router],
  );

  const fileColumns = useMemo<ArtifactTableColumn<WorkspaceFile>[]>(
    () => [
      {
        id: "title",
        label: "Artifact",
        className: "min-w-0 pl-2 pr-5",
        render: (file) => {
          const document = documentJoin.get(file.path);
          const writingTitle = file.name.replace(/\.(md|mdx)$/i, "");
          const hasDocument = Boolean(document);
          return (
            <ArtifactWritingCell
              title={writingTitle}
              documentState={deriveWorkspaceFileDocumentState(
                file,
                documentJoin,
              )}
              description={document?.excerpt ?? null}
              localPath={file.path}
              dateLabel={formatFileTimestamp(file.modifiedAt)}
              actions={
                <>
                  <ArtifactWritingAction
                    disabled={!hasDocument}
                    label={
                      hasDocument
                        ? `Rename ${writingTitle}`
                        : `Rename ${writingTitle} (not bound)`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!hasDocument) {
                        return;
                      }
                      void openRenameWriting(file);
                    }}
                  >
                    <Pencil className="h-[14px] w-[14px]" strokeWidth={1.5} />
                  </ArtifactWritingAction>
                  <ArtifactWritingAction
                    disabled={!hasDocument}
                    label={
                      hasDocument
                        ? `Preview ${writingTitle}`
                        : `Preview ${writingTitle} (not bound)`
                    }
                    onClick={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (!hasDocument) {
                        return;
                      }
                      openWritingPreview(file);
                    }}
                  >
                    <Eye className="h-[14px] w-[14px]" strokeWidth={1.5} />
                  </ArtifactWritingAction>
                  {hasDocument ? (
                    <div onClick={(event) => event.stopPropagation()}>
                      <CollectionAssignmentMenu
                        collections={collectionOptions}
                        selectedIds={
                          collectionIdsByWritingId[document!.id] ?? []
                        }
                        align="start"
                        title="Collections"
                        description="Choose labels for this artifact."
                        onToggleCollection={(collectionId) =>
                          void handleCollectionToggle(file, collectionId)
                        }
                        onCreateCollection={(name) =>
                          void handleCreateCollection(file, name)
                        }
                        trigger={
                          <ArtifactWritingAction
                            label={`Assign collections for ${writingTitle}`}
                            onClick={(event) => event.stopPropagation()}
                          >
                            <Tag
                              className="h-[14px] w-[14px]"
                              strokeWidth={1.5}
                            />
                          </ArtifactWritingAction>
                        }
                      />
                    </div>
                  ) : (
                    <ArtifactWritingAction
                      disabled
                      label={`Assign collections for ${writingTitle} (not bound)`}
                    >
                      <Tag className="h-[14px] w-[14px]" strokeWidth={1.5} />
                    </ArtifactWritingAction>
                  )}
                </>
              }
              collections={
                <CollectionChips
                  collectionIds={
                    document
                      ? (collectionIdsByWritingId[document.id] ?? [])
                      : []
                  }
                  collectionOptions={collectionOptions}
                />
              }
            />
          );
        },
      },
      {
        id: "status",
        label: "Status",
        width: "w-[144px]",
        className: "px-2",
        render: (file) => {
          const document = documentJoin.get(file.path);
          const status = normalizeWritingStatus(
            document?.status ?? "draft",
          );
          const hasDocument = Boolean(document);
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <TablePropertySelector
                variant="preview"
                readOnly={!hasDocument}
                className="min-w-[128px]"
                ariaLabel={`Change status for ${file.name}`}
                icon={<WritingStatusIcon status={status} />}
                label={getWritingStatusLabel(status)}
                contentClassName="w-[248px]"
              >
                {hasDocument &&
                  enabledStatuses.map((status) => (
                    <DropdownMenuItem
                      key={status}
                      className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleStatusChange(file, status);
                      }}
                    >
                      <span className="flex items-center gap-2">
                        <WritingStatusIcon status={status} />
                        {getWritingStatusLabel(status)}
                      </span>
                      {normalizeWritingStatus(
                        document?.status ?? "draft",
                      ) === status ? (
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-ink"
                          aria-hidden="true"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
              </TablePropertySelector>
            </div>
          );
        },
      },
      {
        id: "artifact",
        label: "Artifact",
        width: "w-[156px]",
        className: "px-2",
        render: (file) => {
          const document = documentJoin.get(file.path);
          const artifactType =
            document?.artifactType ?? "general";
          const hasDocument = Boolean(document);
          return (
            <div onClick={(event) => event.stopPropagation()}>
              <TablePropertySelector
                readOnly={!hasDocument}
                className="min-w-[140px]"
                ariaLabel={`Change artifact type for ${file.name}`}
                icon={<ArtifactTypeIcon artifactType={artifactType} />}
                label={getArtifactTypeLabel(artifactType)}
                contentClassName="w-[248px]"
              >
                {hasDocument &&
                  ARTIFACT_TYPE_VALUES.map((artifactType) => (
                    <DropdownMenuItem
                      key={artifactType}
                      className="h-11 cursor-pointer items-center justify-between rounded-[10px] px-3 text-[14px]"
                      onClick={(event) => {
                        event.stopPropagation();
                        void handleArtifactTypeChange(file, artifactType);
                      }}
                    >
                      <span className="flex items-center gap-3">
                        <ArtifactTypeIcon artifactType={artifactType} />
                        {getArtifactTypeLabel(artifactType)}
                      </span>
                      {(document?.artifactType ?? "general") ===
                      artifactType ? (
                        <span
                          className="h-2.5 w-2.5 rounded-full bg-ink"
                          aria-hidden="true"
                        />
                      ) : null}
                    </DropdownMenuItem>
                  ))}
              </TablePropertySelector>
            </div>
          );
        },
      },
      {
        id: "workspace",
        label: "Workspace",
        width: "w-[180px]",
        className: "px-2",
        render: () => (
          <TablePropertySelector
            readOnly
            ariaLabel={`Workspace ${workspace?.name ?? ""}`}
            icon={
              <Folder
                className="h-[13px] w-[13px] shrink-0 text-ink-4"
                strokeWidth={1.5}
              />
            }
            label={workspace?.name ?? "Workspace"}
          />
        ),
      },
      {
        id: "actions",
        label: "",
        align: "end",
        width: "w-[56px]",
        className: "pl-2 pr-4",
        render: (file) => {
          const document = documentJoin.get(file.path);
          return (
            <div
              className="flex items-center justify-end gap-2"
              onClick={(event) => event.stopPropagation()}
            >
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    type="button"
                    aria-label={`Actions for ${file.name}`}
                    onClick={(event) => event.stopPropagation()}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] border-[0.5px] border-transparent text-ink-4 transition-colors hover:bg-muted hover:text-ink focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ink-3"
                  >
                    <MoreHorizontal
                      className="h-[14px] w-[14px]"
                      strokeWidth={1.5}
                    />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  onClick={(event) => event.stopPropagation()}
                >
                  <DropdownMenuItem
                    className="cursor-pointer gap-2 text-[13px]"
                    onClick={() => void openInEditor(file)}
                  >
                    <ExternalLink
                      className="h-[12px] w-[12px]"
                      strokeWidth={1.5}
                    />
                    Open in editor
                  </DropdownMenuItem>
                  {document ? (
                    <DropdownMenuItem
                      className="cursor-pointer gap-2 text-[13px] text-destructive focus:text-destructive"
                      onClick={() => void handleDeleteFile(file)}
                    >
                      <Trash2
                        className="h-[12px] w-[12px]"
                        strokeWidth={1.5}
                      />
                      Delete
                    </DropdownMenuItem>
                  ) : null}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          );
        },
      },
    ],
    [
      collectionIdsByWritingId,
      collectionOptions,
      documentJoin,
      enabledStatuses,
      handleArtifactTypeChange,
      handleCollectionToggle,
      handleCreateCollection,
      handleDeleteFile,
      handleStatusChange,
      openInEditor,
      openRenameWriting,
      openWritingPreview,
      workspace?.name,
    ],
  );

  const handleCreateFile = async () => {
    if (!workspace || !newFileName.trim()) {
      return;
    }

    setIsCreatingFile(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();
      const file = await service.createFile(workspace, newFileName);
      setNewFileName("");
      setIsCreateDialogOpen(false);
      await loadWorkspace();
      await openInEditor(file);
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to create file",
      );
    } finally {
      setIsCreatingFile(false);
    }
  };

  const handleWorkspaceAction = async () => {
    if (!workspaceAction) {
      return;
    }

    setIsSubmitting(true);
    setErrorMessage(null);

    try {
      const service = await getDesktopWorkspaceService();

      if (workspaceAction.type === "rename") {
        await service.renameWorkspace(
          workspaceAction.workspace.slug,
          workspaceActionValue,
        );
        await loadWorkspace();
      } else {
        await service.removeWorkspace(workspaceAction.workspace.slug);
        router.push("/workspace");
      }

      setWorkspaceAction(null);
      setWorkspaceActionValue("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  if (isLoading) {
    return <WorkspaceLoadingShell />;
  }

  if (!workspace) {
    return (
      <div className="min-h-full bg-bg px-10 py-10">
        <div className="rounded-[18px] border-[0.5px] border-border bg-sb px-6 py-5 text-sm text-ink-3">
          {errorMessage ?? "Workspace not found"}
        </div>
      </div>
    );
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
              This workspace is still registered in Artifact Studio, but its
              local folder is unavailable right now.
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
                  setWorkspaceAction({ type: "rename", workspace });
                  setWorkspaceActionValue(workspace.name);
                }}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
                Rename workspace
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => void promptRemoveWorkspace(workspace)}
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
              setWorkspaceAction(null);
              setWorkspaceActionValue("");
            }
          }}
        />
      </>
    );
  }

  return (
    <DocumentStateTooltipProvider>
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
                  <span className="truncate text-[13px] text-ink-4">
                    {workspace.rootPath}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-3">
                  <h1 className="text-[24px] font-medium tracking-[-0.03em] text-ink">
                    {workspace.name}
                  </h1>
                  <WorkspaceActionsMenu
                    workspace={workspace}
                    triggerClassName="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                    onRename={() => {
                      setWorkspaceAction({ type: "rename", workspace });
                      setWorkspaceActionValue(workspace.name);
                    }}
                    onRemove={() => void promptRemoveWorkspace(workspace)}
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setIsCreateDialogOpen(true)}
                  className="inline-flex h-10 items-center gap-2 whitespace-nowrap rounded-[9px] bg-ink px-[17px] text-[14px] font-medium text-bg transition-opacity hover:opacity-90"
                >
                  <Plus className="h-[15px] w-[15px]" strokeWidth={1.5} />
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
              sortLabel={
                fileSortBy === "newest"
                  ? "Newest first"
                  : fileSortBy === "oldest"
                    ? "Oldest first"
                    : "Name"
              }
              filterContent={
                <div className="space-y-1">
                  <WorkspaceControlOption
                    active={fileDateFilter === "all"}
                    onClick={() => setFileDateFilter("all")}
                  >
                    All files
                  </WorkspaceControlOption>
                  <WorkspaceControlOption
                    active={fileDateFilter === "last-7"}
                    onClick={() => setFileDateFilter("last-7")}
                  >
                    Modified in the last 7 days
                  </WorkspaceControlOption>
                </div>
              }
              groupContent={
                <div className="space-y-1">
                  <WorkspaceControlOption
                    active={fileGroupBy === "none"}
                    onClick={() => setFileGroupBy("none")}
                  >
                    None
                  </WorkspaceControlOption>
                  <WorkspaceControlOption
                    active={fileGroupBy === "folder"}
                    onClick={() => setFileGroupBy("folder")}
                  >
                    Folder
                  </WorkspaceControlOption>
                </div>
              }
              sortContent={
                <div className="space-y-1">
                  <WorkspaceControlOption
                    active={fileSortBy === "newest"}
                    onClick={() => setFileSortBy("newest")}
                  >
                    Newest first
                  </WorkspaceControlOption>
                  <WorkspaceControlOption
                    active={fileSortBy === "oldest"}
                    onClick={() => setFileSortBy("oldest")}
                  >
                    Oldest first
                  </WorkspaceControlOption>
                  <WorkspaceControlOption
                    active={fileSortBy === "name"}
                    onClick={() => setFileSortBy("name")}
                  >
                    Name
                  </WorkspaceControlOption>
                </div>
              }
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
                  <FileText
                    className="h-5 w-5 shrink-0 text-ink-2"
                    strokeWidth={1.5}
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-3">
                      <span className="text-[17px] text-ink">
                        {pinnedFile.name}
                      </span>
                      <DocumentStateBadge
                        state={deriveWorkspaceFileDocumentState(
                          pinnedFile,
                          documentJoin,
                        )}
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
                  <span className="text-sm text-ink-4">
                    {formatFileTimestamp(pinnedFile.modifiedAt)}
                  </span>
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
                <div className="overflow-hidden rounded-[10px] bg-sb shadow-float">
                  <ArtifactTable
                    groups={fileGroups}
                    columns={fileColumns}
                    getRowId={getRowKey}
                    getRowAriaLabel={(file) =>
                      documentJoin.get(file.path)
                        ? `Open ${file.name} in editor`
                        : `${file.name} is read-only on Workspace`
                    }
                    onRowClick={(file) => void openInEditor(file)}
                    isRowSelected={(file) =>
                      selectedIds.has(
                        documentJoin.get(file.path)?.id ?? file.id,
                      )
                    }
                    renderLeading={(file) => {
                      const document = documentJoin.get(file.path);
                      const writingId = document?.id;
                      if (!writingId) {
                        return (
                          <ArtifactRowSelection
                            disabled
                            label={`Select ${file.name} (not bound)`}
                          />
                        );
                      }
                      const isSelected = selectedIds.has(writingId);
                      return (
                        <ArtifactRowSelection
                          selected={isSelected}
                          onToggle={() => toggleSelection(writingId)}
                          label={
                            isSelected
                              ? `Deselect ${file.name}`
                              : `Select ${file.name}`
                          }
                        />
                      );
                    }}
                    showHeader={false}
                    tableClassName="min-w-[920px] table-fixed"
                    rowCellClassName="py-4"
                    leadingColumnClassName="w-9"
                    leadingCellClassName="w-9 pl-3 pr-0 pt-[17px] sm:pl-3"
                  />
                </div>
              )}
            </section>

            {hasSelection && (
              <BulkActionBar
                selectedCount={selectedCount}
                visibleCount={visibleWritingIds.length}
                allVisibleSelected={allVisibleSelected}
                onSelectAll={() => selectAll(visibleWritingIds)}
                onDeselectAll={deselectAll}
                onDelete={() => setIsBulkDeleteOpen(true)}
                onStatusChange={handleBulkStatusChange}
                onArtifactTypeChange={handleBulkArtifactTypeChange}
                collectionOptions={collectionOptions}
                onAddToCollection={handleBulkAddToCollection}
                onCreateCollection={handleBulkCreateCollection}
              />
            )}
          </div>
        </div>

        <RenameWritingModal
          open={renameTarget !== null}
          title={renameTarget?.title ?? "Untitled artifact"}
          bodyText={renameTarget?.bodyText ?? ""}
          writingId={renameTarget?.id}
          onOpenChange={(open) => {
            if (!open) {
              setRenameTarget(null);
            }
          }}
          onConfirm={(nextTitle) => {
            void handleRenameConfirm(nextTitle);
            setRenameTarget(null);
          }}
        />

        <DeleteWritingDialog
          open={isBulkDeleteOpen}
          onOpenChange={setIsBulkDeleteOpen}
          count={selectedCount}
          onConfirm={handleBulkDelete}
        />

        <WritingPreviewModal
          open={previewWritingId !== null && previewIndex !== null}
          rows={previewRows}
          currentIndex={previewIndex}
          collectionOptions={collectionOptions}
          collectionIdsByWritingId={collectionIdsByWritingId}
          onOpenChange={(open) => {
            if (!open) {
              setPreviewWritingId(null);
            }
          }}
          onIndexChange={(index) => {
            const nextRow = previewRows[index];
            if (nextRow) {
              setPreviewWritingId(nextRow.id);
            }
          }}
          onToggleCollection={async (writingId, collectionId) => {
            await toggleWritingCollectionMutation(
              writingId,
              collectionId,
              writingCollections,
            );
            await loadWorkspace();
          }}
          onCreateCollection={async (writingId, name) => {
            const ownerId = getLocalDBScope();
            await createAndAssignCollection(
              writingId,
              name,
              ownerId === "anonymous" ? null : ownerId,
              writingCollections,
            );
            await loadWorkspace();
          }}
          onStatusChange={async (writingId, status) => {
            await changeWritingStatus(writingId, status);
            await loadWorkspace();
          }}
          onArtifactTypeChange={async (writingId, artifactType) => {
            await changeWritingArtifactType(writingId, artifactType);
            await loadWorkspace();
          }}
          onTitleChange={handleTitleChange}
          onOpenFullWriting={(writingId) => {
            router.push(
              buildWritingRouteHref("/write", { id: writingId, slug: null }),
            );
          }}
          onDelete={handlePreviewDelete}
        />

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
                <label className="mb-3 block text-[15px] font-medium text-ink">
                  File name
                </label>
                <Input
                  value={newFileName}
                  onChange={(event) => setNewFileName(event.target.value)}
                  placeholder="brief.md"
                  className="h-12 rounded-[12px]"
                />
              </div>

              <DialogFooter className="mt-10 flex-row items-center justify-end gap-3 sm:space-x-0">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setIsCreateDialogOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={handleCreateFile}
                  disabled={isCreatingFile || !newFileName.trim()}
                >
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
              setWorkspaceAction(null);
              setWorkspaceActionValue("");
            }
          }}
        />
      </>
    </DocumentStateTooltipProvider>
  );
}

function WorkspaceActionsMenu({
  workspace,
  onRename,
  onRemove,
  triggerClassName,
}: {
  workspace: WorkspaceSummary | WorkspaceDetail;
  onRename: () => void;
  onRemove: () => void;
  triggerClassName?: string;
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
      <DropdownMenuContent
        align="end"
        className="w-[220px] rounded-[12px] border-[0.5px] border-border bg-sb p-1.5 shadow-float-md"
      >
        <DropdownMenuItem
          className="cursor-pointer rounded-[8px]"
          onSelect={(event) => {
            event.preventDefault();
            onRename();
          }}
        >
          <Pencil className="mr-2 h-4 w-4" strokeWidth={1.5} />
          Rename workspace
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="cursor-pointer rounded-[8px] text-red-600 focus:text-red-600"
          onSelect={(event) => {
            event.preventDefault();
            onRemove();
          }}
        >
          <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
          Remove from Artifact Studio
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function WorkspaceActionDialog({
  action,
  value,
  isSubmitting,
  onValueChange,
  onConfirm,
  onOpenChange,
}: {
  action: WorkspaceActionState;
  value: string;
  isSubmitting: boolean;
  onValueChange: (value: string) => void;
  onConfirm: () => void;
  onOpenChange: (open: boolean) => void;
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
                Update the workspace label in Artifact Studio. This does not
                rename the local folder.
              </DialogDescription>
            </DialogHeader>
            <div className="mt-8">
              <label className="mb-3 block text-[15px] font-medium text-ink">
                Workspace name
              </label>
              <Input
                value={value}
                onChange={(event) => onValueChange(event.target.value)}
                placeholder="Workspace name"
                className="h-12 rounded-[12px]"
              />
            </div>
            <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                disabled={isSubmitting || !value.trim()}
                onClick={onConfirm}
              >
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
                {action.total === 0
                  ? "Artifact Studio will stop watching this workspace. No tracked artifacts will be affected."
                  : `This workspace has ${action.total} tracked document${action.total === 1 ? "" : "s"}.${
                      action.cloud > 0
                        ? ` ${action.cloud} synced artifact${action.cloud === 1 ? "" : "s"} will be archived in the cloud.`
                        : ""
                    }${
                      action.total > action.cloud
                        ? ` ${action.total - action.cloud} local-only artifact${action.total - action.cloud === 1 ? "" : "s"} will be hidden from the workspace.`
                        : ""
                    } The local folder, .md files, and .odessay index stay untouched.`}
              </DialogDescription>
            </DialogHeader>
            <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
              {action.workspace.name}
            </div>
            <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
              <Button
                type="button"
                variant="outline"
                onClick={() => onOpenChange(false)}
              >
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
  );
}

function DesktopWorkspaceFile({
  workspaceSlug,
  fileId,
}: {
  workspaceSlug: string;
  fileId: string;
}) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceDetail | null>(null);
  const [file, setFile] = useState<WorkspaceFile | null>(null);
  const [content, setContent] = useState("");

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const service = await getDesktopWorkspaceService();
      const nextWorkspace = await service.getWorkspace(workspaceSlug);
      if (!nextWorkspace || cancelled) {
        return;
      }
      const nextFile =
        nextWorkspace.files.find((candidate) => candidate.id === fileId) ??
        null;
      if (!nextFile) {
        return;
      }

      const preview = await service.readFilePreview(nextFile.path);
      if (cancelled) {
        return;
      }

      setWorkspace(nextWorkspace);
      setFile(nextFile);
      setContent(preview.content);
    };

    void load();

    return () => {
      cancelled = true;
    };
  }, [fileId, workspaceSlug]);

  if (!workspace || !file) {
    return <WorkspaceLoadingShell />;
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
            <div className="truncate text-[15px] font-medium text-ink">
              {file.name}
            </div>
            <div className="truncate text-xs text-ink-4">{workspace.name}</div>
          </div>
        </div>
        <Button
          type="button"
          onClick={() =>
            void openWorkspaceFileInEditor(file, router, (message) =>
              console.error("[workspace:open]", message),
            )
          }
        >
          Open in editor
        </Button>
      </div>

      <div className="mx-auto w-full max-w-[980px] flex-1 px-10 py-14">
        <div className="mb-10 flex items-center gap-2 text-sm text-ink-4">
          <Link href="/workspace" className="transition-colors hover:text-ink">
            Workspace
          </Link>
          <span>/</span>
          <Link
            href={buildWorkspaceHref({ slug: workspace.slug })}
            className="transition-colors hover:text-ink"
          >
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
  );
}

function AddWorkspaceChooser({
  onSelect,
}: {
  onSelect: (step: AddWorkspaceStep) => void;
}) {
  return (
    <div className="p-12">
      <DialogHeader className="space-y-4 text-left">
        <DialogTitle className="text-[44px] leading-[1.05] tracking-[-0.03em]">
          Add a workspace
        </DialogTitle>
        <DialogDescription className="max-w-[560px] text-[17px] leading-8 text-ink-3">
          Work with a folder you already use, or create a fresh workspace for a
          new writing context.
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
  );
}

function ChooserOption({
  icon,
  title,
  description,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  onClick: () => void;
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
        <div className="mt-1 text-[16px] leading-7 text-ink-3">
          {description}
        </div>
      </div>
      <ChevronDown
        className="h-5 w-5 rotate-[-90deg] text-ink-4"
        strokeWidth={1.5}
      />
    </button>
  );
}

function UseExistingFolderStep({
  isSubmitting,
  errorMessage,
  onBack,
  onSelect,
}: {
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onSelect: () => void;
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
          Pick a folder and Artifact Studio will treat its markdown files as a
          workspace.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-10">
        <label className="mb-3 block text-[15px] font-medium text-ink">
          Choose folder
        </label>
        <button
          type="button"
          onClick={onSelect}
          disabled={isSubmitting}
          className="flex h-[84px] w-full items-center gap-4 rounded-[18px] border-[0.5px] border-border bg-bg px-6 text-left text-ink-3 transition-colors hover:bg-muted/40 disabled:cursor-wait disabled:opacity-70"
        >
          <div className="flex h-12 w-12 items-center justify-center rounded-[12px] border-[0.5px] border-border bg-sb text-ink-2">
            {isSubmitting ? (
              <Check className="h-6 w-6" strokeWidth={1.5} />
            ) : (
              <Folder className="h-6 w-6" strokeWidth={1.5} />
            )}
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
  );
}

function CreateFromScratchStep({
  value,
  isSubmitting,
  errorMessage,
  onBack,
  onChange,
  onCreate,
}: {
  value: string;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onChange: (value: string) => void;
  onCreate: () => void;
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
          Create a new local folder and initialize it with the workspace
          tracking foundation.
        </DialogDescription>
      </DialogHeader>

      <div className="mt-10 space-y-7">
        <div>
          <label className="mb-3 block text-[15px] font-medium text-ink">
            Workspace name
          </label>
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
        <Button
          type="button"
          disabled={isSubmitting || !value.trim()}
          onClick={onCreate}
        >
          {isSubmitting ? "Creating..." : "Choose location"}
        </Button>
      </DialogFooter>
    </div>
  );
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
  rootPath: string | null;
  tree: WorkspaceFolderTreeNode[];
  selectedFiles: ReadonlySet<string>;
  fileCount: number;
  isSubmitting: boolean;
  errorMessage: string | null;
  onBack: () => void;
  onChange: (nextSelectedFiles: Set<string>) => void;
  onConfirm: () => void;
}) {
  const isLargeWorkspace = fileCount > 50;

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
        <Button
          type="button"
          disabled={isSubmitting || selectedFiles.size === 0}
          onClick={onConfirm}
        >
          {isSubmitting ? "Connecting workspace..." : "Add workspace"}
        </Button>
      </DialogFooter>
    </div>
  );
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
        Workspaces keep local folders in context using filesystem access and
        watched folders that the web app cannot provide. Open Artifact Studio on
        desktop to use them.
      </p>
    </div>
  );
}
