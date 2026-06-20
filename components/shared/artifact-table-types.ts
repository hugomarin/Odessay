import type { ReactNode } from "react"

import type { ArtifactType } from "@/lib/writings/artifact-type"
import type { WritingStatus } from "@/lib/writings/status"

export type ArtifactTableMode = "list" | "grid"

/** Canonical column identifiers from the design-system spec, plus arbitrary custom ids. */
export type ArtifactColumnId =
  | "title"
  | "workspace"
  | "artifactType"
  | "status"
  | "date"
  | "actions"
  | (string & {})

/** Contextual row actions surfaced by the `actions` column. */
export type ArtifactAction = "open" | "copy" | "delete"

/**
 * A single column definition. `render` receives the row item and returns the cell
 * content; the table never branches on column id internally — columns are pure
 * config, so enabling/disabling a column is just adding/removing it from the array.
 */
export type ArtifactTableColumn<T> = {
  id: ArtifactColumnId
  /** Visible header for list-mode tables. Omit for icon-only columns. */
  label?: string
  /** Horizontal alignment of the cell content. */
  align?: "start" | "end"
  /** Optional extra classes applied to the cell wrapper. */
  className?: string
  render: (item: T) => ReactNode
}

export type ArtifactTableGroup<T> = {
  label?: string
  items: T[]
}

/** Minimal shape consumed by the built-in standard column renderers. */
export type ArtifactTableItem = {
  id: string
  title: string
  excerpt?: string | null
  workspaceLabel?: string | null
  artifactType?: ArtifactType | null
  status?: WritingStatus | null
  dateLabel?: string | null
  href?: string | null
}
