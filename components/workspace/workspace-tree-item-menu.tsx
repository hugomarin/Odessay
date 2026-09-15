"use client";

import type { ReactNode } from "react";
import {
  Check,
  Clipboard,
  Copy,
  FilePlus,
  Folder,
  FolderInput,
  FolderOpen,
  Link2,
  Pencil,
  Shapes,
  Trash2,
  Zap,
} from "lucide-react";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuShortcut,
  ContextMenuSub,
  ContextMenuSubContent,
  ContextMenuSubTrigger,
  ContextMenuTrigger,
} from "@/components/ui/context-menu";
import { WritingStatusIcon } from "@/components/ui/writing-status-icon";
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon";
import { useVocabulary } from "@/hooks/useVocabulary";
import { listVisibleVocabulary } from "@/lib/vocabulary/resolve";
import { normalizeWritingStatus } from "@/lib/writings/status";
import { normalizeArtifactType } from "@/lib/writings/artifact-type";

/** One flattened destination for the "Move to" submenu. `""` is the workspace root. */
export type WorkspaceTreeFolderNode = { path: string; name: string; depth: number };

export type WorkspaceTreeFileActions = {
  onRename: (id: string) => void;
  onDuplicate: (id: string) => void;
  onChangeStatus: (id: string, status: string) => void;
  onChangeArtifactType: (id: string, artifactType: string) => void;
  onMoveTo: (id: string, folderPath: string) => void;
  onCopyLink: (id: string) => void;
  onCopyPath: (id: string) => void;
  onReveal: (id: string) => void;
  onDelete: (id: string) => void;
};

export type WorkspaceTreeFolderActions = {
  onNewArtifactHere: (folderPath: string) => void;
  onReveal: (folderPath: string) => void;
};

export function WorkspaceFileContextMenu({
  id,
  status,
  artifactType,
  folders,
  actions,
  children,
}: {
  id: string;
  status?: string | null;
  artifactType?: string | null;
  folders: WorkspaceTreeFolderNode[];
  actions: WorkspaceTreeFileActions;
  children: ReactNode;
}) {
  const catalog = useVocabulary();
  const statuses = listVisibleVocabulary(catalog, "status");
  const artifactTypes = listVisibleVocabulary(catalog, "type");
  const currentStatus = normalizeWritingStatus(status);
  const currentArtifactType = normalizeArtifactType(artifactType);

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<Pencil strokeWidth={1.5} />} onSelect={() => actions.onRename(id)}>
          Rename…
          <ContextMenuShortcut>F2</ContextMenuShortcut>
        </ContextMenuItem>
        <ContextMenuItem icon={<Copy strokeWidth={1.5} />} onSelect={() => actions.onDuplicate(id)}>
          Duplicate
          <ContextMenuShortcut>⌘D</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuSub>
          <ContextMenuSubTrigger icon={<Zap strokeWidth={1.5} />}>Status</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[320px] overflow-y-auto">
            {statuses.map((item) => (
              <ContextMenuItem
                key={item.key}
                icon={<WritingStatusIcon status={item.key} className="h-[13px] w-[13px]" />}
                onSelect={() => actions.onChangeStatus(id, item.key)}
              >
                {item.name}
                {currentStatus === item.key ? <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} /> : null}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger icon={<Shapes strokeWidth={1.5} />}>Type</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[320px] overflow-y-auto">
            {artifactTypes.map((item) => (
              <ContextMenuItem
                key={item.key}
                icon={<ArtifactTypeIcon artifactType={item.key} />}
                onSelect={() => actions.onChangeArtifactType(id, item.key)}
              >
                {item.name}
                {currentArtifactType === item.key ? (
                  <Check className="ml-auto h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                ) : null}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSub>
          <ContextMenuSubTrigger icon={<FolderInput strokeWidth={1.5} />}>Move to</ContextMenuSubTrigger>
          <ContextMenuSubContent className="max-h-[320px] overflow-y-auto">
            {folders.map((folder) => (
              <ContextMenuItem
                key={folder.path || "__root__"}
                icon={<Folder strokeWidth={1.5} />}
                style={{ paddingLeft: `${10 + folder.depth * 14}px` }}
                onSelect={() => actions.onMoveTo(id, folder.path)}
              >
                {folder.name}
              </ContextMenuItem>
            ))}
          </ContextMenuSubContent>
        </ContextMenuSub>

        <ContextMenuSeparator />

        <ContextMenuItem icon={<Link2 strokeWidth={1.5} />} onSelect={() => actions.onCopyLink(id)}>
          Copy link
        </ContextMenuItem>
        <ContextMenuItem icon={<Clipboard strokeWidth={1.5} />} onSelect={() => actions.onCopyPath(id)}>
          Copy path
        </ContextMenuItem>
        <ContextMenuItem icon={<FolderOpen strokeWidth={1.5} />} onSelect={() => actions.onReveal(id)}>
          Reveal in Finder
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem variant="destructive" icon={<Trash2 strokeWidth={1.5} />} onSelect={() => actions.onDelete(id)}>
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

export function WorkspaceFolderContextMenu({
  path,
  actions,
  children,
}: {
  path: string;
  actions: WorkspaceTreeFolderActions;
  children: ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem icon={<FilePlus strokeWidth={1.5} />} onSelect={() => actions.onNewArtifactHere(path)}>
          New artifact here
          <ContextMenuShortcut>⌘N</ContextMenuShortcut>
        </ContextMenuItem>

        <ContextMenuSeparator />

        <ContextMenuItem icon={<FolderOpen strokeWidth={1.5} />} onSelect={() => actions.onReveal(path)}>
          Reveal in Finder
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}
