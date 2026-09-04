"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ChevronLeft,
  Eye,
  ExternalLink,
  Folder,
  FolderPlus,
  Home,
  MoreHorizontal,
  Pencil,
  Plus,
  Tag,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { WorkspaceTree } from "@/components/workspace/workspace-tree";
import { DeskFilterBar, DeskFilterEmptyState } from "@/components/desk/filter-bar";
import { BulkActionBar } from "@/components/desk/bulk-action-bar";
import { DeleteWritingDialog } from "@/components/desk/delete-writing-dialog";
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal";
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal";
import { CollectionAssignmentMenu } from "@/components/collections/collection-assignment-menu";
import { DocumentStateTooltipProvider } from "@/components/ui/document-state-badge";
import { ArtifactTable } from "@/components/shared/artifact-table";
import { ArtifactRowSelection } from "@/components/shared/artifact-row-selection";
import {
  ArtifactWritingAction,
  ArtifactWritingCell,
} from "@/components/shared/artifact-writing-cell";
import { CollectionChips } from "@/components/desk/collection-chips";
import type { ArtifactTableColumn } from "@/components/shared/artifact-table-types";
import { TablePropertySelector } from "@/components/ui/table-property-selector";
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
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
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
import { openWorkspaceFileInEditor } from "@/lib/workspace/open-workspace-file";
import { subscribeToCatalog } from "@/lib/queries/document-catalog";
import { loadWorkspaceDocumentJoin } from "@/lib/queries/workspace-catalog-source";
import type { CollectionOption } from "@/lib/collections/collections";
import { buildCollectionOptions, UNCATEGORIZED_COLLECTION_ID } from "@/lib/collections/collections";
import {
  getLocalDBScope,
  getWritingForEdit,
  loadCollectionState,
} from "@/lib/queries/desk-catalog-source";
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
import type { WorkspaceDocumentInfo } from "@/lib/queries/workspace-catalog-source";
import type {
  DeskActivityRow,
  DeskCreatedDateFilter,
} from "@/lib/queries/desk-activity";
import type { LocalWritingCollection } from "@/lib/local-db/schema";
import { buildWritingRouteHref } from "@/lib/writings/writing-route";
import {
  getWritingStatusLabel,
  normalizeWritingStatus,
  type WritingStatus,
} from "@/lib/writings/status";
import {
  getArtifactTypeLabel,
  type ArtifactType,
} from "@/lib/writings/artifact-type";
import { useVocabulary } from "@/hooks/useVocabulary";
import { listVisibleVocabulary, orderGroupKeysByCatalog } from "@/lib/vocabulary/resolve";
import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer";
import {
  APP_SHELL_CONTENT_GUTTER_CLASS,
  ViewHeader,
  VIEW_HEADER_ACTION_CLASS,
} from "@/components/navigation/view-header";
import { useWritingSelection } from "@/hooks/useWritingSelection";
import { useDeskFilters } from "@/hooks/useDeskFilters";
import {
  deriveDocumentStateFromSignals,
  type DocumentState,
} from "@/lib/writings/document-state";
import type {
  WorkspaceDetail as WorkspaceDetailType,
  WorkspaceFile,
} from "@/lib/workspace/types";

function formatFileTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

function deriveWorkspaceFileDocumentState(
  file: WorkspaceFile,
  documentJoin: Map<string, WorkspaceDocumentInfo>,
): DocumentState {
  const info = documentJoin.get(file.path);
  if (info) return info.state;
  return deriveDocumentStateFromSignals({
    hasCloudRecord: false,
    hasLocalFile: true,
    isPending: false,
  });
}

function workspaceMissingMessage(workspace: WorkspaceDetailType) {
  return (
    workspace.missingReason ?? "This local folder is unavailable or was moved."
  );
}

function isInsideFolder(relativePath: string, folderPath: string) {
  if (folderPath === "") {
    // Root: only files directly in the root, not inside subfolders.
    return !relativePath.includes("/");
  }
  return (
    relativePath === folderPath || relativePath.startsWith(`${folderPath}/`)
  );
}

function matchesFileQuery(file: WorkspaceFile, query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    file.name.toLowerCase().includes(normalized) ||
    file.relativePath.toLowerCase().includes(normalized)
  );
}

function matchesWorkspaceDateFilter(
  timestamp: number,
  filter: DeskCreatedDateFilter | null,
  from: string,
  to: string,
): boolean {
  if (!filter) return true;
  const now = new Date();
  const date = new Date(timestamp);
  switch (filter) {
    case "today":
      return date.toDateString() === now.toDateString();
    case "last-7": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 7);
      return timestamp >= start.getTime();
    }
    case "last-30": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - 30);
      return timestamp >= start.getTime();
    }
    case "this-year":
      return date.getFullYear() === now.getFullYear();
    case "custom": {
      const fromDate = from ? new Date(from) : null;
      const toDate = to ? new Date(to) : null;
      if (fromDate && Number.isNaN(fromDate.getTime())) return true;
      if (toDate && Number.isNaN(toDate.getTime())) return true;
      if (fromDate) {
        const start = new Date(fromDate);
        start.setHours(0, 0, 0, 0);
        if (timestamp < start.getTime()) return false;
      }
      if (toDate) {
        const end = new Date(toDate);
        end.setHours(23, 59, 59, 999);
        if (timestamp > end.getTime()) return false;
      }
      return true;
    }
    default:
      return true;
  }
}

type WorkspaceHeaderAction =
  | { type: "rename"; workspace: WorkspaceDetailType }
  | { type: "remove"; workspace: WorkspaceDetailType }
  | null;

export function WorkspaceDetail({ workspaceSlug }: { workspaceSlug: string }) {
  const router = useRouter();
  const [workspace, setWorkspace] = useState<WorkspaceDetailType | null>(null);
  const [selectedFolderPath, setSelectedFolderPath] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [newFileName, setNewFileName] = useState("");
  const [isCreatingFile, setIsCreatingFile] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [headerAction, setHeaderAction] = useState<WorkspaceHeaderAction>(null);
  const [headerActionValue, setHeaderActionValue] = useState("");
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
  const catalog = useVocabulary();
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
    searchQuery,
    selectedCollectionIds,
    selectedStatuses,
    selectedArtifactTypes,
    selectedWorkspaceSlugs,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    groupBy,
    sortBy,
    setSearchQuery,
    toggleCollection,
    toggleStatus,
    toggleArtifactType,
    toggleWorkspace,
    setCreatedDateFilter,
    setCreatedDateFrom,
    setCreatedDateTo,
    setGroupBy,
    setSortBy,
    clearFilters,
    hasActiveFilters,
    activeFilterCount,
  } = useDeskFilters();

  const loadWorkspace = useCallback(async () => {
    const isInitialLoad = !hasLoadedWorkspaceRef.current;
    if (isInitialLoad) setIsLoading(true);
    setErrorMessage(null);
    try {
      const service = await getDesktopWorkspaceService();
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

  useEffect(() => {
    const handleFocus = () => void loadWorkspace();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [loadWorkspace]);

  useEffect(() => {
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
      if (timer) clearTimeout(timer);
    };
  }, [loadWorkspace]);

  const folderFilesCount = useMemo(() => {
    if (!workspace) return 0;
    return workspace.files.filter((file) =>
      isInsideFolder(file.relativePath, selectedFolderPath),
    ).length;
  }, [workspace, selectedFolderPath]);

  const visibleFiles = useMemo(() => {
    const files =
      workspace?.files.filter((file) => {
        if (!isInsideFolder(file.relativePath, selectedFolderPath))
          return false;
        if (!matchesFileQuery(file, searchQuery)) return false;

        if (selectedStatuses.length > 0) {
          const document = documentJoin.get(file.path);
          const status = normalizeWritingStatus(document?.status ?? "draft");
          if (!selectedStatuses.includes(status)) return false;
        }

        if (selectedArtifactTypes.length > 0) {
          const document = documentJoin.get(file.path);
          const artifactType = document?.artifactType ?? "general";
          if (!selectedArtifactTypes.includes(artifactType)) return false;
        }

        if (selectedCollectionIds.length > 0) {
          const document = documentJoin.get(file.path);
          const writingId = document?.id;
          const fileCollectionIds = writingId
            ? (collectionIdsByWritingId[writingId] ?? [])
            : [];
          const hasUncategorized = selectedCollectionIds.includes(
            UNCATEGORIZED_COLLECTION_ID,
          );
          const selectedReal = selectedCollectionIds.filter(
            (id) => id !== UNCATEGORIZED_COLLECTION_ID,
          );
          const hasRealCollection =
            selectedReal.length > 0 &&
            fileCollectionIds.some((id) => selectedReal.includes(id));
          const isUncategorized =
            hasUncategorized && fileCollectionIds.length === 0;
          if (!hasRealCollection && !isUncategorized) return false;
        }

        if (createdDateFilter) {
          if (
            !matchesWorkspaceDateFilter(
              file.modifiedAt,
              createdDateFilter,
              createdDateFrom,
              createdDateTo,
            )
          )
            return false;
        }

        return true;
      }) ?? [];
    return files.sort((left, right) => {
      if (sortBy === "created-at-asc")
        return left.modifiedAt - right.modifiedAt;
      return right.modifiedAt - left.modifiedAt;
    });
  }, [
    workspace,
    selectedFolderPath,
    searchQuery,
    selectedStatuses,
    selectedArtifactTypes,
    selectedCollectionIds,
    createdDateFilter,
    createdDateFrom,
    createdDateTo,
    sortBy,
    documentJoin,
    collectionIdsByWritingId,
  ]);

  const fileGroups = useMemo(() => {
    if (groupBy === "none") return [{ items: visibleFiles }];

    if (groupBy === "status") {
      const groups = new Map<string, WorkspaceFile[]>();
      for (const file of visibleFiles) {
        const document = documentJoin.get(file.path);
        const status = normalizeWritingStatus(document?.status ?? "draft");
        const rows = groups.get(status) ?? [];
        rows.push(file);
        groups.set(status, rows);
      }
      return orderGroupKeysByCatalog(catalog, "status", groups.keys()).map(
        (status) => ({
          label: getWritingStatusLabel(status),
          items: groups.get(status) ?? [],
        }),
      );
    }

    if (groupBy === "artifact") {
      const groups = new Map<string, WorkspaceFile[]>();
      for (const file of visibleFiles) {
        const document = documentJoin.get(file.path);
        const artifactType = document?.artifactType ?? "general";
        const rows = groups.get(artifactType) ?? [];
        rows.push(file);
        groups.set(artifactType, rows);
      }
      return orderGroupKeysByCatalog(catalog, "type", groups.keys()).map(
        (type) => ({
          label: getArtifactTypeLabel(type),
          items: groups.get(type) ?? [],
        }),
      );
    }

    if (groupBy === "collection") {
      const optionById = new Map(
        collectionOptions.map((option) => [option.id, option]),
      );
      const groups = new Map<string, WorkspaceFile[]>();
      for (const file of visibleFiles) {
        const document = documentJoin.get(file.path);
        const writingId = document?.id;
        const collectionIds = writingId
          ? (collectionIdsByWritingId[writingId] ?? [])
          : [];
        const primaryId = collectionIds[0] ?? UNCATEGORIZED_COLLECTION_ID;
        const rows = groups.get(primaryId) ?? [];
        rows.push(file);
        groups.set(primaryId, rows);
      }
      const entries = Array.from(groups.entries()).map(([id, items]) => ({
        label:
          id === UNCATEGORIZED_COLLECTION_ID
            ? "No collection"
            : (optionById.get(id)?.name ?? id),
        items,
      }));
      entries.sort((left, right) => {
        if (left.label === "No collection" && right.label !== "No collection")
          return 1;
        if (right.label === "No collection" && left.label !== "No collection")
          return -1;
        return left.label.localeCompare(right.label);
      });
      return entries;
    }

    const now = new Date();
    const weekInMs = 7 * 24 * 60 * 60 * 1000;
    const groups: { label: string; items: WorkspaceFile[] }[] = [
      { label: "Today", items: [] },
      { label: "This week", items: [] },
      { label: "Earlier", items: [] },
    ];
    for (const file of visibleFiles) {
      const date = new Date(file.modifiedAt);
      if (date.toDateString() === now.toDateString()) {
        groups[0].items.push(file);
      } else if (now.getTime() - file.modifiedAt < weekInMs) {
        groups[1].items.push(file);
      } else {
        groups[2].items.push(file);
      }
    }
    return groups.filter((group) => group.items.length > 0);
  }, [
    groupBy,
    visibleFiles,
    documentJoin,
    collectionIdsByWritingId,
    collectionOptions,
    catalog,
  ]);

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
      if (!document) return;
      const writing = await getWritingForEdit(document.id);
      if (!writing) return;
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
      if (!document) return;
      setPreviewWritingId(document.id);
    },
    [documentJoin],
  );

  const handleDeleteFile = useCallback(
    async (file: WorkspaceFile) => {
      const document = documentJoin.get(file.path);
      if (!document) return;
      await deleteWriting(document.id);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleRenameConfirm = useCallback(
    async (nextTitle: string): Promise<boolean> => {
      if (!renameTarget) return false;
      const succeeded = await renameWriting(renameTarget.id, nextTitle);
      await loadWorkspace();
      if (succeeded) {
        setRenameTarget(null);
      }
      return succeeded;
    },
    [renameTarget, loadWorkspace],
  );

  const handleStatusChange = useCallback(
    async (file: WorkspaceFile, status: WritingStatus) => {
      const document = documentJoin.get(file.path);
      if (!document) return;
      await changeWritingStatus(document.id, status);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleArtifactTypeChange = useCallback(
    async (file: WorkspaceFile, artifactType: ArtifactType) => {
      const document = documentJoin.get(file.path);
      if (!document) return;
      await changeWritingArtifactType(document.id, artifactType);
      await loadWorkspace();
    },
    [documentJoin, loadWorkspace],
  );

  const handleCollectionToggle = useCallback(
    async (file: WorkspaceFile, collectionId: string) => {
      const document = documentJoin.get(file.path);
      if (!document) return;
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
      if (!document) return;
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

  const openInEditor = useCallback(
    async (file: WorkspaceFile) => {
      setErrorMessage(null);
      await openWorkspaceFileInEditor(file, router, setErrorMessage);
    },
    [router],
  );

  const enabledStatuses = useMemo(
    () => listVisibleVocabulary(catalog, "status").map((item) => item.key),
    [catalog],
  );
  const enabledArtifactTypes = useMemo(
    () => listVisibleVocabulary(catalog, "type").map((item) => item.key),
    [catalog],
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
                      if (!hasDocument) return;
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
                      if (!hasDocument) return;
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
          const status = normalizeWritingStatus(document?.status ?? "draft");
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
                      {normalizeWritingStatus(document?.status ?? "draft") ===
                      status ? (
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
          const artifactType = document?.artifactType ?? "general";
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
                  enabledArtifactTypes.map((artifactType) => (
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
                      <Trash2 className="h-[12px] w-[12px]" strokeWidth={1.5} />
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
      enabledArtifactTypes,
      handleArtifactTypeChange,
      handleCollectionToggle,
      handleCreateCollection,
      handleDeleteFile,
      handleStatusChange,
      openInEditor,
      openRenameWriting,
      openWritingPreview,
    ],
  );

  const handleCreateFile = async () => {
    if (!workspace || !newFileName.trim()) return;
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

  const handleHeaderAction = async () => {
    if (!headerAction || !workspace) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    try {
      const service = await getDesktopWorkspaceService();
      if (headerAction.type === "rename") {
        await service.renameWorkspace(workspace.slug, headerActionValue);
        await loadWorkspace();
      } else {
        await service.removeWorkspace(workspace.slug);
        router.push("/workspace");
      }
      setHeaderAction(null);
      setHeaderActionValue("");
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Failed to update workspace",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const treeItems = useMemo(
    () =>
      (workspace?.files ?? []).map((file) => ({
        id: file.id,
        name: file.name,
        relativePath: file.relativePath,
        kind: "file" as const,
        openable: true,
      })),
    [workspace],
  );

  const handleOpenFileFromTree = (fileId: string) => {
    const file = workspace?.files.find((candidate) => candidate.id === fileId);
    if (file) void openInEditor(file);
  };

  if (isLoading || !workspace) {
    return (
      <div className="flex h-screen min-h-0 flex-col bg-bg">
        <ViewTitlebarSpacer />
        <div className="border-b-[0.5px] border-border px-10 py-7">
          <div className="h-8 w-48 animate-pulse rounded-[10px] bg-muted" />
          <div className="mt-4 h-[38px] w-full max-w-md animate-pulse rounded-[9px] bg-muted" />
        </div>
        <div className="grid flex-1 grid-cols-[236px_1fr]">
          <div className="border-r-[0.5px] border-line-soft" />
          <div className="p-10">
            <div className="h-8 w-64 animate-pulse rounded-[10px] bg-muted" />
            <div className="mt-6 h-[400px] animate-pulse rounded-[18px] bg-muted" />
          </div>
        </div>
      </div>
    );
  }

  if (workspace.status === "missing") {
    return (
      <div className="flex h-screen min-h-0 flex-col bg-bg">
        <ViewTitlebarSpacer />
        <div className="border-b-[0.5px] border-border px-10 py-7">
          <Link
            href="/workspace"
            className="inline-flex h-8 items-center gap-1 rounded-[8px] px-2 text-[13px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
          >
            <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
            All workspaces
          </Link>
        </div>
        <div className="flex-1 px-10 py-10">
          <div className="max-w-[760px] rounded-[24px] border-[0.5px] border-border bg-sb px-8 py-8">
            <div className="flex h-14 w-14 items-center justify-center rounded-[16px] border-[0.5px] border-border bg-bg text-ink-3">
              <Folder className="h-7 w-7" strokeWidth={1.5} />
            </div>
            <h1 className="mt-6 font-lora text-[38px] leading-[1.08] tracking-[-0.03em] text-ink">
              {workspace.name}
            </h1>
            <p className="mt-3 max-w-[58ch] text-[16px] leading-7 text-ink-3">
              This workspace is still registered in Artifact Studio, but its local
              folder is unavailable right now.
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
                  setHeaderAction({ type: "rename", workspace });
                  setHeaderActionValue(workspace.name);
                }}
              >
                <Pencil className="h-4 w-4" strokeWidth={1.5} />
                Rename workspace
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => setHeaderAction({ type: "remove", workspace })}
              >
                <Trash2 className="h-4 w-4" strokeWidth={1.5} />
                Disconnect
              </Button>
            </div>
          </div>
        </div>

        <Dialog
          open={headerAction !== null}
          onOpenChange={(open) => {
            if (!open) {
              setHeaderAction(null);
              setHeaderActionValue("");
            }
          }}
        >
          <DialogContent hideClose className="max-w-[520px] rounded-[24px] p-0">
            {headerAction?.type === "rename" ? (
              <div className="p-8">
                <DialogHeader className="space-y-3 text-left">
                  <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                    Rename workspace
                  </DialogTitle>
                  <DialogDescription className="text-[16px] leading-7 text-ink-3">
                    Update the workspace label in Artifact Studio. This does not rename
                    the local folder.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-8">
                  <label className="mb-3 block text-[15px] font-medium text-ink">
                    Workspace name
                  </label>
                  <Input
                    value={headerActionValue}
                    onChange={(event) =>
                      setHeaderActionValue(event.target.value)
                    }
                    placeholder="Workspace name"
                    className="h-12 rounded-[12px]"
                  />
                </div>
                <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setHeaderAction(null);
                      setHeaderActionValue("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={isSubmitting || !headerActionValue.trim()}
                    onClick={() => void handleHeaderAction()}
                  >
                    {isSubmitting ? "Saving…" : "Save name"}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
            {headerAction?.type === "remove" ? (
              <div className="p-8">
                <DialogHeader className="space-y-3 text-left">
                  <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                    Disconnect workspace
                  </DialogTitle>
                  <DialogDescription className="text-[16px] leading-7 text-ink-3">
                    Disconnecting keeps all local files untouched. The folder
                    will stop syncing with Artifact Studio.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
                  {workspace.name}
                </div>
                <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setHeaderAction(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() => void handleHeaderAction()}
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

  return (
    <DocumentStateTooltipProvider>
      <div className="flex h-screen min-h-0 flex-col bg-bg">
        <ViewTitlebarSpacer />
        <div className="grid min-h-0 flex-1 grid-cols-[236px_1fr]">
          {/* Tree column */}
          <div className="flex min-h-0 flex-col border-r-[0.5px] border-line-soft bg-transparent">
            <div className="flex h-8 items-center border-b-[0.5px] border-line-soft px-3">
              <Link
                href="/workspace"
                className="inline-flex items-center gap-1 text-[13px] text-ink-4 transition-colors hover:text-ink"
              >
                <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                All workspaces
              </Link>
            </div>
            <div
              className={cn(
                "flex h-10 w-full items-center justify-between px-3 transition-colors",
                selectedFolderPath === "" ? "bg-muted" : "hover:bg-muted",
              )}
            >
              <button
                type="button"
                onClick={() => setSelectedFolderPath("")}
                aria-label={`Open ${workspace.name} root`}
                className="flex min-w-0 flex-1 items-center gap-2 text-left text-[13px] font-medium text-ink"
              >
                <Home
                  className="h-4 w-4 shrink-0 text-ink-3"
                  strokeWidth={1.5}
                />
                <span className="truncate">{workspace.name}</span>
              </button>
              <button
                type="button"
                aria-label="New Artifact"
                onClick={() => {
                  setIsCreateDialogOpen(true);
                }}
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] text-ink-4 transition-colors hover:bg-surface-menu-hover hover:text-ink"
              >
                <FolderPlus className="h-4 w-4" strokeWidth={1.5} />
              </button>
            </div>
            <div className="od-scroll flex-1 overflow-y-auto px-2 py-1">
              <WorkspaceTree
                mode="detail"
                items={treeItems}
                selectedFolderPath={selectedFolderPath}
                onSelectFolder={setSelectedFolderPath}
                onOpenFile={handleOpenFileFromTree}
                foldersOnly={true}
              />
            </div>
          </div>

          {/* Sheet */}
          <div className="flex min-h-0 flex-col">
            <ViewHeader
              sectionId="workspace-detail-header"
              testId="workspace-detail-header"
              title={workspace.name}
              adornment={
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Manage ${workspace.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-[8px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
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
                      onSelect={() => {
                        setHeaderAction({ type: "rename", workspace });
                        setHeaderActionValue(workspace.name);
                      }}
                    >
                      <Pencil className="mr-2 h-4 w-4" strokeWidth={1.5} />
                      Rename workspace
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="cursor-pointer rounded-[8px] text-destructive focus:text-destructive"
                      onSelect={() => setHeaderAction({ type: "remove", workspace })}
                    >
                      <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                      Disconnect
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              }
              subtitle={
                <span className="flex min-w-0 items-center gap-2">
                  <Link
                    href="/workspace"
                    className="inline-flex shrink-0 items-center gap-1 rounded-[8px] px-2 py-1 text-[13px] text-ink-4 transition-colors hover:bg-muted hover:text-ink"
                  >
                    <ChevronLeft className="h-4 w-4" strokeWidth={1.5} />
                    Workspace
                  </Link>
                  <span className="text-[13px] text-ink-4/50">/</span>
                  <span className="truncate text-[13px] text-ink-4">{workspace.rootPath}</span>
                </span>
              }
              actions={
                <button
                  type="button"
                  onClick={() => setIsCreateDialogOpen(true)}
                  className={VIEW_HEADER_ACTION_CLASS}
                >
                  <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
                  New Artifact
                </button>
              }
            />

            <DeskFilterBar
              searchQuery={searchQuery}
              onSearchChange={setSearchQuery}
              selectedCollectionIds={selectedCollectionIds}
              onToggleCollection={toggleCollection}
              selectedStatuses={selectedStatuses}
              onToggleStatus={toggleStatus}
              selectedArtifactTypes={selectedArtifactTypes}
              onToggleArtifactType={toggleArtifactType}
              selectedWorkspaceSlugs={selectedWorkspaceSlugs}
              onToggleWorkspace={toggleWorkspace}
              createdDateFilter={createdDateFilter}
              onCreatedDateFilterChange={setCreatedDateFilter}
              createdDateFrom={createdDateFrom}
              onCreatedDateFromChange={setCreatedDateFrom}
              createdDateTo={createdDateTo}
              onCreatedDateToChange={setCreatedDateTo}
              groupBy={groupBy}
              onGroupByChange={setGroupBy}
              sortBy={sortBy}
              onSortByChange={setSortBy}
              collectionOptions={collectionOptions}
              workspaceOptions={[]}
              activeFilterCount={activeFilterCount}
              hasActiveFilters={hasActiveFilters}
              filteredCount={visibleFiles.length}
              totalCount={folderFilesCount}
              onClearFilters={clearFilters}
            />

            <div className={`od-scroll min-h-0 flex-1 overflow-y-auto ${APP_SHELL_CONTENT_GUTTER_CLASS} pb-4`}>
              {errorMessage ? (
                <div className="mb-6 rounded-[14px] border-[0.5px] border-border bg-sb px-5 py-4 text-sm text-ink-3">
                  {errorMessage}
                </div>
              ) : null}

              <div className="mb-3 flex items-center justify-between">
                <div className="text-[12px] font-medium uppercase tracking-[0.12em] text-ink-4">
                  {selectedFolderPath === "" ? "All files" : selectedFolderPath}
                </div>
                <div className="text-[12px] text-ink-4">
                  {visibleFiles.length}{" "}
                  {visibleFiles.length === 1 ? "artifact" : "artifacts"}
                </div>
              </div>

              {visibleFiles.length === 0 ? (
                hasActiveFilters ? (
                  <DeskFilterEmptyState onClear={clearFilters} />
                ) : (
                  <div className="rounded-[18px] border-[0.5px] border-dashed border-border bg-sb px-6 py-10 text-center text-sm text-ink-3">
                    {workspace.fileCount === 0
                      ? "This workspace does not have any .md or .mdx files yet. Create one to start working from this local folder."
                      : "No files in this folder."}
                  </div>
                )
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
        </div>

        <RenameWritingModal
          open={renameTarget !== null}
          title={renameTarget?.title ?? "Untitled artifact"}
          bodyText={renameTarget?.bodyText ?? ""}
          writingId={renameTarget?.id}
          onOpenChange={(open) => {
            if (!open) setRenameTarget(null);
          }}
          onConfirm={handleRenameConfirm}
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
          currentIndex={previewIndex ?? 0}
          collectionOptions={collectionOptions}
          collectionIdsByWritingId={collectionIdsByWritingId}
          onOpenChange={(open) => {
            if (!open) setPreviewWritingId(null);
          }}
          onIndexChange={(index) => {
            const nextRow = previewRows[index];
            if (nextRow) setPreviewWritingId(nextRow.id);
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
          onTitleChange={async (writingId, title) => {
            await renameWriting(writingId, title);
            await loadWorkspace();
          }}
          onOpenFullWriting={(writingId) => {
            router.push(
              buildWritingRouteHref("/write", { id: writingId, slug: null }),
            );
          }}
          onDelete={async (writingId) => {
            await deleteWriting(writingId);
            setPreviewWritingId(null);
            await loadWorkspace();
          }}
        />

        <Dialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
          <DialogContent hideClose className="max-w-[560px] rounded-[24px] p-0">
            <div className="p-10">
              <DialogHeader className="space-y-3 text-left">
                <DialogTitle className="text-[36px] leading-[1.08] tracking-[-0.03em]">
                  New Artifact
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
                  {isCreatingFile ? "Creating…" : "Create file"}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog
          open={headerAction !== null}
          onOpenChange={(open) => {
            if (!open) {
              setHeaderAction(null);
              setHeaderActionValue("");
            }
          }}
        >
          <DialogContent hideClose className="max-w-[520px] rounded-[24px] p-0">
            {headerAction?.type === "rename" ? (
              <div className="p-8">
                <DialogHeader className="space-y-3 text-left">
                  <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                    Rename workspace
                  </DialogTitle>
                  <DialogDescription className="text-[16px] leading-7 text-ink-3">
                    Update the workspace label in Artifact Studio. This does not rename
                    the local folder.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-8">
                  <label className="mb-3 block text-[15px] font-medium text-ink">
                    Workspace name
                  </label>
                  <Input
                    value={headerActionValue}
                    onChange={(event) =>
                      setHeaderActionValue(event.target.value)
                    }
                    placeholder="Workspace name"
                    className="h-12 rounded-[12px]"
                  />
                </div>
                <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setHeaderAction(null);
                      setHeaderActionValue("");
                    }}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={isSubmitting || !headerActionValue.trim()}
                    onClick={() => void handleHeaderAction()}
                  >
                    {isSubmitting ? "Saving…" : "Save name"}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
            {headerAction?.type === "remove" ? (
              <div className="p-8">
                <DialogHeader className="space-y-3 text-left">
                  <DialogTitle className="text-[32px] leading-[1.08] tracking-[-0.03em]">
                    Disconnect workspace
                  </DialogTitle>
                  <DialogDescription className="text-[16px] leading-7 text-ink-3">
                    Disconnecting keeps all local files untouched. The folder
                    will stop syncing with Artifact Studio.
                  </DialogDescription>
                </DialogHeader>
                <div className="mt-6 rounded-[14px] border-[0.5px] border-border bg-bg px-4 py-3 text-sm text-ink-3">
                  {workspace.name}
                </div>
                <DialogFooter className="mt-8 flex-row items-center justify-end gap-3 sm:space-x-0">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setHeaderAction(null)}
                  >
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    variant="destructive"
                    disabled={isSubmitting}
                    onClick={() => void handleHeaderAction()}
                  >
                    {isSubmitting ? "Disconnecting…" : "Disconnect"}
                  </Button>
                </DialogFooter>
              </div>
            ) : null}
          </DialogContent>
        </Dialog>
      </div>
    </DocumentStateTooltipProvider>
  );
}
