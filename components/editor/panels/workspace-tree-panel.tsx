"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { WorkspaceTree } from "@/components/workspace/workspace-tree";
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
          : "No se pudo cargar el Workspace",
      );
    }
  }, [applyOutcome]);

  useEffect(() => {
    const unsubscribe = subscribeToContextualWorkspaceChanges((change) => {
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
            : "No se pudo cargar el Workspace",
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
      })),
    [workspace],
  );

  const rootDocumentCount = useMemo(() => {
    if (!workspace) return 0;
    return workspace.documents.filter((doc) => {
      const parts = doc.relativePath.split(/[\\/]/).filter(Boolean);
      return parts.length <= 1;
    }).length;
  }, [workspace]);

  const handleOpen = async (id: string) => {
    setOpenError(null);
    try {
      await onOpenDocument(id);
    } catch (reason) {
      setOpenError(
        reason instanceof Error
          ? reason.message
          : "No se pudo abrir el writing",
      );
    }
  };

  if (loading)
    return (
      <p className="px-2 py-4 text-[11px] text-ink-4">Cargando Workspace…</p>
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
          Reintentar
        </button>
      </div>
    );
  if (!activeWritingId)
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic text-ink-4">
        No hay un writing activo.
      </p>
    );
  // Web cannot read the filesystem, so it cannot know whether this writing
  // belongs to a Workspace. Saying it does not would be a claim we cannot make.
  if (outcome?.kind === "unsupported-runtime")
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic leading-relaxed text-ink-4">
        El Workspace de un writing solo está disponible en la app de escritorio.
      </p>
    );
  if (!workspace)
    return (
      <p className="px-2 py-4 font-lora text-[12px] italic leading-relaxed text-ink-4">
        Este writing no pertenece a un Workspace.
      </p>
    );
  if (workspace.status === "missing")
    return (
      <p className="px-2 py-4 text-[11px] leading-relaxed text-ink-3">
        {workspace.name} no está disponible. {workspace.missingReason}
      </p>
    );
  return (
    <div>
      {openError ? (
        <p role="alert" className="mx-2 mb-2 text-[10px] text-destructive">
          {openError}
        </p>
      ) : null}
      {/* The tree opens on the workspace root, the way Desk does. The "all
          workspaces" row that used to sit above it went nowhere — it was never
          wired to a handler — and it pushed the home row out of first place
          (owner review). */}
      <WorkspaceTree
        aria-label={`${workspace.name} documents`}
        mode="studio"
        items={treeItems}
        activeId={activeWritingId}
        rootLabel={workspace.name}
        rootIcon="home"
        rootCount={rootDocumentCount}
        onOpenFile={(id) => void handleOpen(id)}
      />
    </div>
  );
}
