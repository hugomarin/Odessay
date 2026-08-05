"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, FileText, Folder, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  loadContextualWorkspace,
  subscribeToContextualWorkspaceChanges,
} from "@/lib/services/workspace-service";
import type {
  ContextualWorkspace,
  ContextualWorkspaceDocument,
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
  onOpen,
}: {
  folder: WorkspaceTreeFolder;
  activeId: string | null;
  onOpen: (id: string) => Promise<void>;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <li>
      <button
        type="button"
        role="treeitem"
        aria-expanded={expanded}
        // Folders group documents; only a document can be the tree's selection.
        aria-selected={false}
        onClick={() => setExpanded((value) => !value)}
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
  const [workspace, setWorkspace] = useState<ContextualWorkspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const generation = useRef(0);
  const refreshTimer = useRef<number | null>(null);
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const unsubscribe = subscribeToContextualWorkspaceChanges(() => {
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
      refreshTimer.current = window.setTimeout(
        () => setRevision((value) => value + 1),
        100,
      );
    });
    return () => {
      unsubscribe();
      if (refreshTimer.current !== null)
        window.clearTimeout(refreshTimer.current);
    };
  }, []);

  useEffect(() => {
    const request = ++generation.current;
    if (!activeWritingId) {
      setWorkspace(null);
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
        setWorkspace(result);
        onCountChange(result?.documents.length);
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
  }, [activeWritingId, onCountChange, revision]);

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
          onClick={() => setRevision((value) => value + 1)}
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
