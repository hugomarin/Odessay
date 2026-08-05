"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
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

function FolderNode({
  folder,
  activeId,
  collapsedPaths,
  onToggle,
  onOpen,
}: {
  folder: WorkspaceTreeFolder;
  activeId: string | null;
  collapsedPaths: ReadonlySet<string>;
  onToggle: (path: string) => void;
  onOpen: (id: string) => Promise<void>;
}) {
  // Expansion lives in the panel, keyed by folder path: a rebuild of the tree
  // (a reconciled add/move/remove) must not reopen the folders the author
  // deliberately collapsed. Tracking the collapsed set rather than the expanded
  // one keeps "expanded by default" true for folders that appear later.
  const expanded = !collapsedPaths.has(folder.path);
  return (
    <li>
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        // Folders group documents; only a document can be the tree's selection.
        aria-selected={false}
        onClick={() => onToggle(folder.path)}
        className="flex min-h-7 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11px] text-ink-3 hover:bg-muted hover:text-ink"
      >
        <ChevronRight
          className={cn(
            "h-3 w-3 transition-transform duration-300 ease-layout",
            expanded && "rotate-90",
          )}
          strokeWidth={1.5}
        />
        <Folder className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="truncate">{folder.name}</span>
      </button>
      {expanded ? (
        <ul className="ml-3 border-l-[0.5px] border-border pl-1">
          {folder.folders.map((child) => (
            <FolderNode
              key={child.path}
              folder={child}
              activeId={activeId}
              collapsedPaths={collapsedPaths}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))}
          {folder.documents.map((document) => (
            <DocumentNode
              key={document.relativePath}
              document={document}
              activeId={activeId}
              onOpen={onOpen}
            />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

function DocumentNode({
  document,
  activeId,
  onOpen,
}: {
  document: ContextualWorkspaceDocument;
  activeId: string | null;
  onOpen: (id: string) => Promise<void>;
}) {
  const active = document.id === activeId;
  return (
    <li>
      <button
        type="button"
        role="treeitem"
        disabled={!document.openable || !document.id}
        aria-selected={active}
        aria-current={active ? "page" : undefined}
        onClick={() => document.id && void onOpen(document.id)}
        className={cn(
          "relative flex min-h-7 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-[11px] text-ink-3 hover:bg-muted hover:text-ink disabled:cursor-not-allowed disabled:opacity-50",
          active &&
            "bg-muted text-ink before:absolute before:inset-y-1 before:left-0 before:w-0.5 before:bg-cursor",
        )}
      >
        <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} />
        <span className="truncate">{document.name.replace(/\.md$/i, "")}</span>
      </button>
    </li>
  );
}

export function WorkspaceTreePanel({
  activeWritingId,
  onOpenDocument,
  onCountChange,
}: {
  activeWritingId: string | null;
  onOpenDocument: (id: string) => Promise<void>;
  onCountChange: (count?: number) => void;
}) {
  const [outcome, setOutcome] = useState<ContextualWorkspaceOutcome | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [collapsedPaths, setCollapsedPaths] = useState<ReadonlySet<string>>(
    () => new Set<string>(),
  );
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
      onCountChange(
        next.kind === "workspace" ? next.workspace.documents.length : undefined,
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
      onCountChange();
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
        onCountChange();
      });
  }, [activeWritingId, applyOutcome, onCountChange, retryToken]);

  const handleToggleFolder = useCallback((path: string) => {
    setCollapsedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }, []);

  const tree = useMemo(
    () => buildWorkspaceTree(workspace?.documents ?? []),
    [workspace],
  );
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
    <div
      role="tree"
      aria-label={`${workspace.name} documents`}
      onKeyDown={(event) => {
        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>(
            '[role="treeitem"]:not(:disabled)',
          ),
        );
        const index = items.indexOf(
          document.activeElement as HTMLButtonElement,
        );
        const next =
          event.key === "ArrowDown"
            ? Math.min(items.length - 1, index + 1)
            : Math.max(0, index - 1);
        if (items[next]) {
          event.preventDefault();
          items[next].focus();
        }
      }}
    >
      <div className="mb-1 flex min-h-8 items-center gap-1.5 px-2 text-[11px] font-medium text-ink">
        <Folder className="h-3.5 w-3.5" strokeWidth={1.5} />
        <span className="truncate">{workspace.name}</span>
      </div>
      {openError ? (
        <p role="alert" className="mx-2 mb-2 text-[10px] text-destructive">
          {openError}
        </p>
      ) : null}
      <ul>
        {tree.folders.map((folder) => (
          <FolderNode
            key={folder.path}
            folder={folder}
            activeId={activeWritingId}
            collapsedPaths={collapsedPaths}
            onToggle={handleToggleFolder}
            onOpen={handleOpen}
          />
        ))}
        {tree.documents.map((document) => (
          <DocumentNode
            key={document.relativePath}
            document={document}
            activeId={activeWritingId}
            onOpen={handleOpen}
          />
        ))}
      </ul>
    </div>
  );
}
