"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Folder, Plus, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  FlowModal,
  FlowModalBody,
  FlowModalFooter,
  FlowModalHeader,
  FlowModalStep,
} from "@/components/ui/flow-modal";
import { FolderTreePicker } from "@/components/workspace/folder-tree-picker";
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service";
import {
  buildDefaultWorkspaceSelection,
  buildWorkspaceFolderTree,
  collectDescendantFilePaths,
  compressWorkspaceSelection,
  type WorkspaceFolderTreeNode,
} from "@/lib/workspace/folder-tree";
import type { WorkspaceSummary } from "@/lib/workspace/types";

type Step = "origin" | "existing" | "scratch" | "include" | "done";
type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onComplete: () => void;
  workspace?: WorkspaceSummary | null;
};

export function AddWorkspaceFlow({
  open,
  onOpenChange,
  onComplete,
  workspace,
}: Props) {
  const [step, setStep] = useState<Step>(workspace ? "include" : "origin");
  const [rootPath, setRootPath] = useState(workspace?.rootPath ?? "");
  const [tree, setTree] = useState<WorkspaceFolderTreeNode[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [name, setName] = useState("");
  const [resultName, setResultName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const total = useMemo(
    () => tree.reduce((sum, node) => sum + node.fileCount, 0),
    [tree],
  );
  const allFiles = useMemo(
    () => tree.flatMap(collectDescendantFilePaths),
    [tree],
  );

  async function inspect(path?: string) {
    setBusy(true);
    setError(null);
    try {
      const service = await getDesktopWorkspaceService();
      const nextPath = path ?? (await service.pickExistingWorkspaceRoot());
      if (!nextPath) return;
      const snapshot = await service.inspectWorkspace(nextPath);
      setRootPath(nextPath);
      setTree(buildWorkspaceFolderTree(snapshot.files));
      setSelected(buildDefaultWorkspaceSelection(snapshot.files));
      setStep("include");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not scan this folder",
      );
    } finally {
      setBusy(false);
    }
  }
  useEffect(() => {
    if (open && workspace && !tree.length && !busy)
      void inspect(workspace.rootPath);
  }, [open, workspace, tree.length, busy]);

  async function finishExisting() {
    setBusy(true);
    setError(null);
    try {
      const service = await getDesktopWorkspaceService();
      const next = await service.addExistingWorkspaceWithSelection(
        rootPath,
        compressWorkspaceSelection(tree, selected),
      );
      if (next) {
        setResultName(next.name);
        setStep("done");
        onComplete();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not add workspace",
      );
    } finally {
      setBusy(false);
    }
  }
  async function createWorkspace() {
    setBusy(true);
    setError(null);
    try {
      const service = await getDesktopWorkspaceService();
      const next = await service.createWorkspace(name.trim());
      if (next) {
        setResultName(next.name);
        setStep("done");
        onComplete();
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not create workspace",
      );
    } finally {
      setBusy(false);
    }
  }
  function close(value: boolean) {
    onOpenChange(value);
    if (!value) {
      setStep(workspace ? "include" : "origin");
      setError(null);
    }
  }

  return (
    <FlowModal
      open={open}
      onOpenChange={close}
      title="Add a workspace"
      dirty={step === "include" && selected.size > 0}
    >
      <FlowModalStep stepKey={step}>
        {step === "origin" && (
          <>
            <FlowModalHeader>
              <h2 className="text-[32px] font-medium tracking-[-0.02em]">
                Add a workspace
              </h2>
              <p className="mt-2 text-[14px] text-ink-3">
                Bring a folder of markdown into Artifact Studio.
              </p>
            </FlowModalHeader>
            <FlowModalBody className="space-y-3">
              {[
                [
                  "existing",
                  Folder,
                  "Use an existing folder",
                  "Watch markdown where it already lives.",
                ],
                [
                  "scratch",
                  Plus,
                  "Create from scratch",
                  "Start with a new empty folder.",
                ],
              ].map(([target, Icon, title, copy]) => (
                <button
                  key={String(target)}
                  className="flex w-full items-center gap-4 rounded-[12px] bg-surface-option p-4 text-left"
                  onClick={() => setStep(target as Step)}
                >
                  <span className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-bg">
                    <Icon strokeWidth={1.5} />
                  </span>
                  <span>
                    <b className="block text-[14px] font-medium">
                      {String(title)}
                    </b>
                    <small className="text-[12px] text-ink-4">
                      {String(copy)}
                    </small>
                  </span>
                </button>
              ))}
            </FlowModalBody>
          </>
        )}
        {step === "existing" && (
          <>
            <FlowModalHeader>
              <button
                className="mb-4 text-[12px] text-ink-4"
                onClick={() => setStep("origin")}
              >
                ← Back
              </button>
              <h2 className="text-[28px] font-medium">
                Choose an existing folder
              </h2>
              <p className="mt-2 max-w-[54ch] text-[13px] leading-5 text-ink-3">
                Artifact Studio watches the markdown inside it. Nothing is moved
                or copied — the folder stays exactly where it is.
              </p>
            </FlowModalHeader>
            <FlowModalBody>
              <Button onClick={() => void inspect()} disabled={busy}>
                Choose folder
              </Button>
              <p className="mt-5 font-mono text-[12px] text-ink-4">
                Recent folders will appear here.
              </p>
            </FlowModalBody>
          </>
        )}
        {step === "scratch" && (
          <>
            <FlowModalHeader>
              <button
                className="mb-4 text-[12px] text-ink-4"
                onClick={() => setStep("origin")}
              >
                ← Back
              </button>
              <h2 className="text-[28px] font-medium">Create from scratch</h2>
            </FlowModalHeader>
            <FlowModalBody>
              <Input
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="Workspace name"
                className="h-[46px]"
              />
              <div className="mt-4 flex h-[46px] items-center justify-between rounded-[10px] border-[0.5px] border-border px-3">
                <span className="text-[13px] text-ink-3">
                  Choose location when you continue
                </span>
                <Button
                  variant="ghost"
                  disabled={!name.trim() || busy}
                  onClick={() => void createWorkspace()}
                >
                  Change
                </Button>
              </div>
            </FlowModalBody>
            <FlowModalFooter>
              <Button variant="ghost" onClick={() => setStep("origin")}>
                Back
              </Button>
              <Button
                onClick={() => void createWorkspace()}
                disabled={!name.trim() || busy}
              >
                Create workspace
              </Button>
            </FlowModalFooter>
          </>
        )}
        {step === "include" && (
          <>
            <FlowModalHeader className="pb-2 pt-5">
              <div className="flex h-8 items-center gap-3">
                <button
                  onClick={() =>
                    workspace ? close(false) : setStep("existing")
                  }
                  className="text-[12px] text-ink-3"
                >
                  ← Back
                </button>
                <span className="truncate font-mono text-[12px] text-ink-4">
                  {rootPath}
                </span>
              </div>
              <h2 className="mt-2 text-[26px] font-medium">
                Choose what to include
              </h2>
              <p className="mt-1 text-[13px] leading-[1.5] text-ink-3">
                Choose the markdown Artifact Studio should track.
              </p>
              <div className="relative mt-3">
                <Search
                  className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-4"
                  strokeWidth={1.5}
                />
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="h-[38px] pl-9 pr-9"
                  placeholder="Search folders and files"
                />
                {query && (
                  <button
                    onClick={() => setQuery("")}
                    className="absolute right-3 top-1/2 -translate-y-1/2"
                    aria-label="Clear search"
                  >
                    <X className="h-4 w-4" strokeWidth={1.5} />
                  </button>
                )}
              </div>
              <div className="mt-2 flex h-10 items-center justify-between border-y-[0.5px] border-border text-[12px]">
                <span>
                  Tracking {selected.size} of {total}
                </span>
                <span className="flex gap-3">
                  <button onClick={() => setSelected(new Set(allFiles))}>
                    All
                  </button>
                  <button onClick={() => setSelected(new Set())}>None</button>
                </span>
              </div>
            </FlowModalHeader>
            <FlowModalBody>
              <FolderTreePicker
                tree={tree}
                selectedFiles={selected}
                onChange={setSelected}
                query={query}
              />
              {error && (
                <p role="alert" className="mt-2 text-[12px] text-destructive">
                  {error}
                </p>
              )}
            </FlowModalBody>
            <FlowModalFooter>
              <Button
                variant="ghost"
                onClick={() => (workspace ? close(false) : setStep("existing"))}
              >
                Back
              </Button>
              <Button
                onClick={() => void finishExisting()}
                disabled={!selected.size || busy}
              >
                Add workspace · {selected.size}
              </Button>
            </FlowModalFooter>
          </>
        )}
        {step === "done" && (
          <>
            <FlowModalHeader className="text-center">
              <span className="mx-auto flex h-[52px] w-[52px] items-center justify-center rounded-[14px] bg-success-soft text-success">
                <Check strokeWidth={1.5} />
              </span>
              <h2 className="mt-5 text-[28px] font-medium">Workspace ready</h2>
              <p className="mt-2 text-[14px] text-ink-3">
                {resultName} · {selected.size} files tracked
              </p>
            </FlowModalHeader>
            <FlowModalFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  setStep("origin");
                  setTree([]);
                  setSelected(new Set());
                }}
              >
                Add another
              </Button>
              <Button onClick={() => close(false)}>Open workspace</Button>
            </FlowModalFooter>
          </>
        )}
      </FlowModalStep>
    </FlowModal>
  );
}
