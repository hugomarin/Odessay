import type { ArtifactType, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"

type MarkdownEditor = {
  commands: {
    setContent: (content: string) => void
  }
}

type SnapshotOverrides = {
  status?: WritingStatus
  artifactType?: ArtifactType
  visibility?: WritingVisibility
}

type PanelSyncDeps = {
  clearPendingSave: () => void
  updateDerivedState: () => void
  persistSnapshot: (overrides?: SnapshotOverrides) => void
}

type PanelMetaSyncDeps = {
  persistSnapshot: (overrides?: SnapshotOverrides) => void
}

export const applyPanelMarkdownChange = (
  editor: MarkdownEditor | null,
  markdown: string,
  deps: PanelSyncDeps,
) => {
  if (!editor) {
    return false
  }

  deps.clearPendingSave()
  editor.commands.setContent(markdown)
  deps.updateDerivedState()
  deps.persistSnapshot()

  return true
}

export const applyPanelMetaChange = (
  editor: MarkdownEditor | null,
  overrides: SnapshotOverrides,
  deps: PanelMetaSyncDeps,
) => {
  if (!editor) {
    return false
  }

  deps.persistSnapshot(overrides)
  return true
}
