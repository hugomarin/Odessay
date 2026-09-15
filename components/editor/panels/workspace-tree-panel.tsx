"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WorkspaceTree, type WorkspaceTreeGroupBy } from "@/components/workspace/workspace-tree";
import { WorkspaceTreeToolbar } from "@/components/editor/panels/workspace-tree-toolbar";
import { WritingPreviewModal } from "@/components/desk/writing-preview-modal";
import {
  loadContextualWorkspace,
  refreshContextualWorkspaceDocuments,
  subscribeToContextualWorkspaceChanges,
} from "@/lib/services/workspace-service";
import type {
  ContextualWorkspace,
  ContextualWorkspaceDocument,
  ContextualWorkspaceOutcome,
} from "@/lib/workspace/types";
import type { DeskActivityRow } from "@/lib/queries/desk-activity";
import {
  getLocalDBScope,
  loadCollectionState,
} from "@/lib/queries/desk-catalog-source";
import {
  buildCollectionOptions,
  type CollectionOption,
} from "@/lib/collections/collections";
import {
  changeWritingArtifactType,
  changeWritingStatus,
  createAndAssignCollection,
  deleteWriting,
  renameWriting,
  toggleWritingCollection as toggleWritingCollectionMutation,
} from "@/lib/queries/writing-mutations";
import type { LocalWritingCollection } from "@/lib/local-db/schema";
import { getWritingStatusLabel, normalizeWritingStatus } from "@/lib/writings/status";
import { normalizeArtifactType } from "@/lib/writings/artifact-type";
import { buildWritingRouteHref } from "@/lib/writings/writing-route";

function formatFileTimestamp(timestamp: number) {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(timestamp));
}

export type WorkspaceTreeFolder = {
  name: string;
  path: string;
  folders: WorkspaceTreeFolder[];
  documents: ContextualWorkspaceDocument[];
};

export function buildWorkspaceTree(
  documents: ContextualWorkspaceDocument[],
): WorkspaceTreeFolder {
  const root: WorkspaceTreeFolder = {
    name: "",
    path: "",
    folders: [],
    documents: [],
  };
  for (const document of documents) {
    const parts = document.relativePath.split(/[\\/]/).filter(Boolean);
    let cursor = root;
    for (const part of parts.slice(0, -1)) {
      const path = cursor.path ? `${cursor.path}/${part}` : part;
      let folder = cursor.folders.find((candidate) => candidate.name === part);
      if (!folder) {
        folder = { name: part, path, folders: [], documents: [] };
        cursor.folders.push(folder);
      }
      cursor = folder;
    }
    cursor.documents.push(document);
  }
  return root;
}

export function WorkspaceTreePanel({
  activeWritingId,
  onOpenDocument,
  onCountChange,
}: {
  activeWritingId: string | null;
  onOpenDocument: (id: string) => Promise<void>;
  /** No caller renders the total since the panel's title row went away. */
  onCountChange?: (count?: number) => void;
}) {
  const [outcome, setOutcome] = useState<ContextualWorkspaceOutcome | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const pendingIds = useRef<Set<string>>(new Set());
  const pendingStructural = useRef(false);
  const workspaceRef = useRef<ContextualWorkspace | null>(null);
  const activeWritingIdRef = useRef(activeWritingId);
  const [retryToken, setRetryToken] = useState(0);
  const [previewWritingId, setPreviewWritingId] = useState<string | null>(null);
  const [collectionOptions, setCollectionOptions] = useState<CollectionOption[]>([]);
  const [collectionIdsByWritingId, setCollectionIdsByWritingId] = useState<
    Record<string, string[]>
  >({});
  const [groupBy, setGroupBy] = useState<WorkspaceTreeGroupBy>("folder");
  const [selectedStatuses, setSelectedStatuses] = useState<Set<string>>(() => new Set());
  const [selectedArtifactTypes, setSelectedArtifactTypes] = useState<Set<string>>(() => new Set());

  const toggleStatusFilter = useCallback((status: string) => {
    setSelectedStatuses((current) => {
      const next = new Set(current);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  }, []);

  const toggleArtifactTypeFilter = useCallback((artifactType: string) => {
    setSelectedArtifactTypes((current) => {
      const next = new Set(current);
      if (next.has(artifactType)) next.delete(artifactType);
      else next.add(artifactType);
      return next;
    });
  }, []);

  const clearFilters = useCallback(() => {
    setSelectedStatuses(new Set());
    setSelectedArtifactTypes(new Set());
  }, []);

  const workspace = outcome?.kind === "workspace" ? outcome.workspace : null;
  workspaceRef.current = workspace;
  activeWritingIdRef.current = activeWritingId;

  const applyOutcome = useCallback(
    (next: ContextualWorkspaceOutcome) => {
      setOutcome(next);
      // Only a readable root has a document count. An unavailable root has no
      // count at all: rendering `0` next to its name reads as "this Workspace
      // is empty", which is the exact confusion the unavailable state exists to
      // prevent.
      onCountChange?.(
        next.kind === "workspace" && next.workspace.status === "ready"
          ? next.workspace.documents.length
          : undefined,
      );
    },
    [onCountChange],
  );

  // Collections are user-wide, not workspace-scoped — loaded once and
  // refreshed after a mutation from the preview modal, the same shape
  // `workspace-detail.tsx` uses for the same modal.
  const loadCollections = useCallback(async () => {
    try {
      const collectionState = await loadCollectionState();
      const idsByWritingId: Record<string, string[]> = {};
      for (const assignment of collectionState.writingCollections) {
        idsByWritingId[assignment.writing_id] = [
          ...(idsByWritingId[assignment.writing_id] ?? []),
          assignment.collection_id,
        ];
      }
      setCollectionOptions(buildCollectionOptions(collectionState.collections));
      setCollectionIdsByWritingId(idsByWritingId);
    } catch {
      // The preview modal's collection picker just stays empty — it is not
      // this panel's job to surface a collections-service outage.
    }
  }, []);

  useEffect(() => {
    void loadCollections();
  }, [loadCollections]);

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

  // A catalog notification never resolves through the scanning loader: the
  // active writing emits an `upsert` on every autosave, and rescanning the root
  // for each one duplicates the scan `persist` just did, blanks the tree behind
  // a loading state and discards the author's expand/collapse. Only a change we
  // cannot express as a document patch falls back to a full reload, and even
  // that one refreshes in the background.
  const runBackgroundRefresh = useCallback(async () => {
    const request = generation.current;
    const writingId = activeWritingIdRef.current;
    if (!writingId) return;

    const changedIds = Array.from(pendingIds.current);
    const structural = pendingStructural.current;
    pendingIds.current.clear();
    pendingStructural.current = false;

    const current = workspaceRef.current;
    try {
      if (current && !structural) {
        const patched = await refreshContextualWorkspaceDocuments(
          current,
          changedIds,
        );
        if (request !== generation.current) return;
        // `null` means nothing the tree renders moved — no re-render at all.
        if (patched) applyOutcome({ kind: "workspace", workspace: patched });
        return;
      }
      const result = await loadContextualWorkspace(writingId);
      if (request !== generation.current) return;
      applyOutcome(result);
    } catch (reason: unknown) {
      if (request !== generation.current) return;
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load the workspace",
      );
    }
  }, [applyOutcome]);

  useEffect(() => {
    const unsubscribe = subscribeToContextualWorkspaceChanges((change) => {
      // "excerpt" is the hydration pipeline finishing a background preview
      // fetch, and "content" is a body-only autosave — neither changes
      // anything this tree renders (title/status/path), so reacting would
      // only call back into the catalog for no visible difference.
      if (change.reason === "excerpt" || change.reason === "content") return;
      if (change.reason === "upsert" || change.reason === "bulk") {
        for (const id of change.documentIds) pendingIds.current.add(id);
      } else {
        pendingStructural.current = true;
      }
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(() => {
        refreshTimer.current = null;
        void runBackgroundRefresh();
      }, 100);
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    };
  }, [runBackgroundRefresh]);

  useEffect(() => {
    const request = ++generation.current;
    pendingIds.current.clear();
    pendingStructural.current = false;
    if (!activeWritingId) {
      setOutcome(null);
      setLoading(false);
      setError(null);
      onCountChange?.();
      return;
    }
    setLoading(true);
    setError(null);
    void loadContextualWorkspace(activeWritingId)
      .then((result) => {
        if (request !== generation.current) return;
        applyOutcome(result);
        setLoading(false);
      })
      .catch((reason: unknown) => {
        if (request !== generation.current) return;
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not load the workspace",
        );
        setLoading(false);
        onCountChange?.();
      });
  }, [activeWritingId, applyOutcome, onCountChange, retryToken]);

  const treeItems = useMemo(
    () =>
      (workspace?.documents ?? []).map((document) => ({
        id: document.id ?? "",
        name: document.name,
        relativePath: document.relativePath,
        kind: "file" as const,
        openable: document.openable,
        status: document.status,
        artifactType: document.artifactType,
      })),
    [workspace],
  );

  const filteredTreeItems = useMemo(() => {
    if (selectedStatuses.size === 0 && selectedArtifactTypes.size === 0) return treeItems;
    return treeItems.filter((item) => {
      const statusOk =
        selectedStatuses.size === 0 || selectedStatuses.has(normalizeWritingStatus(item.status));
      const typeOk =
        selectedArtifactTypes.size === 0 ||
        selectedArtifactTypes.has(normalizeArtifactType(item.artifactType));
      return statusOk && typeOk;
    });
  }, [treeItems, selectedStatuses, selectedArtifactTypes]);

  const statusCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of treeItems) {
      const key = normalizeWritingStatus(item.status);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [treeItems]);

  const artifactTypeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const item of treeItems) {
      const key = normalizeArtifactType(item.artifactType);
      counts[key] = (counts[key] ?? 0) + 1;
    }
    return counts;
  }, [treeItems]);

  const rootDocumentCount = useMemo(() => {
    return filteredTreeItems.filter((item) => {
      const parts = item.relativePath.split(/[\\/]/).filter(Boolean);
      return parts.length <= 1;
    }).length;
  }, [filteredTreeItems]);

  // Feeds the same WritingPreviewModal Desk and the full Workspace view use —
  // built from this panel's own already-loaded documents rather than a
  // second query.
  const previewRows = useMemo<DeskActivityRow[]>(
    () =>
      (workspace?.documents ?? [])
        .filter((document): document is ContextualWorkspaceDocument & { id: string } =>
          Boolean(document.id),
        )
        .map((document) => {
          const status = document.status ?? "draft";
          return {
            id: document.id,
            title: document.name.replace(/\.(md|mdx)$/i, ""),
            excerpt: document.excerpt ?? "",
            localPath: document.relativePath,
            stateLabel: getWritingStatusLabel(status),
            stateTone: normalizeWritingStatus(status),
            documentState: document.state,
            artifactType: normalizeArtifactType(document.artifactType),
            recipientPreviews: [],
            dateLabel: formatFileTimestamp(document.modifiedAt),
            isNew: false,
            destinationHref: buildWritingRouteHref("/write", {
              id: document.id,
              slug: null,
            }),
            workspaceSlug: workspace?.slug ?? null,
            workspaceName: workspace?.name ?? null,
          };
        }),
    [workspace],
  );

  const previewIndex = useMemo(
    () =>
      previewWritingId === null
        ? null
        : previewRows.findIndex((row) => row.id === previewWritingId),
    [previewRows, previewWritingId],
  );

  const handleOpen = async (id: string) => {
    setOpenError(null);
    try {
      await onOpenDocument(id);
    } catch (reason) {
      setOpenError(
        reason instanceof Error
          ? reason.message
          : "Could not open the artifact",
      );
    }
  };

  if (loading)
    return (
      <p className="px-2 py-4 text-[11px] text-ink-4">Loading workspace…</p>
    );
  if (error)
    return (
      <div className="px-2 py-4 text-[11px] text-ink-3">
        <p>{error}</p>
        <button
          type="button"
          onClick={() => setRetryToken((value) => value + 1)}
          className="mt-2 flex items-center gap-1 text-ink"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={1.5} />
          Retry
        </button>
      </div>
    );
  if (!activeWritingId)
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic text-ink-4">
        No active artifact.
      </p>
    );
  // Web cannot read the filesystem, so it cannot know whether this artifact
  // belongs to a Workspace. Saying it does not would be a claim we cannot make.
  if (outcome?.kind === "unsupported-runtime")
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic leading-relaxed text-ink-4">
        An artifact’s workspace is only available in the desktop app.
      </p>
    );
  if (!workspace)
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic leading-relaxed text-ink-4">
        This artifact does not belong to a workspace.
      </p>
    );
  if (workspace.status === "missing")
    return (
      <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-3">
        {workspace.name} is unavailable. {workspace.missingReason}
      </p>
    );
  return (
    <div>
      {openError ? (
        <p role="alert" className="mx-2 mb-2 text-[10px] text-destructive">
          {openError}
        </p>
      ) : null}
      <WorkspaceTreeToolbar
        groupBy={groupBy}
        onGroupByChange={setGroupBy}
        selectedStatuses={selectedStatuses}
        onToggleStatus={toggleStatusFilter}
        selectedArtifactTypes={selectedArtifactTypes}
        onToggleArtifactType={toggleArtifactTypeFilter}
        onClearFilters={clearFilters}
        statusCounts={statusCounts}
        artifactTypeCounts={artifactTypeCounts}
      />
      {/* The tree opens on the workspace root, the way Desk does. The "all
          workspaces" row that used to sit above it went nowhere — it was never
          wired to a handler — and it pushed the home row out of first place
          (owner review). */}
      <WorkspaceTree
        key={workspace.slug}
        aria-label={`${workspace.name} documents`}
        mode="studio"
        groupBy={groupBy}
        items={filteredTreeItems}
        activeId={activeWritingId}
        rootLabel={workspace.name}
        rootIcon="home"
        rootCount={rootDocumentCount}
        onOpenFile={(id) => void handleOpen(id)}
        onPreviewFile={(id) => setPreviewWritingId(id)}
      />
      <WritingPreviewModal
        open={previewWritingId !== null && previewIndex !== null && previewIndex !== -1}
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
          await toggleWritingCollectionMutation(writingId, collectionId, writingCollections);
          await loadCollections();
        }}
        onCreateCollection={async (writingId, name) => {
          const ownerId = getLocalDBScope();
          await createAndAssignCollection(
            writingId,
            name,
            ownerId === "anonymous" ? null : ownerId,
            writingCollections,
          );
          await loadCollections();
        }}
        onStatusChange={async (writingId, status) => {
          await changeWritingStatus(writingId, status);
        }}
        onArtifactTypeChange={async (writingId, artifactType) => {
          await changeWritingArtifactType(writingId, artifactType);
        }}
        onTitleChange={async (writingId, title) => {
          await renameWriting(writingId, title);
        }}
        onOpenFullWriting={(writingId) => {
          setPreviewWritingId(null);
          void handleOpen(writingId);
        }}
        onDelete={async (writingId) => {
          await deleteWriting(writingId);
          setPreviewWritingId(null);
        }}
      />
    </div>
  );
}
