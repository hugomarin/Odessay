/**
 * Document ↔ workspace assignment model.
 *
 * Architecture Contract §ODE-318:
 *  - The assignment is *contextual ownership* metadata, not physical containment.
 *    Assigning or moving a writing to a workspace never relocates the file on
 *    disk and never makes the workspace the physical owner of the substrate.
 *    "Files in place" (ADR D7) is preserved: only this logical association
 *    changes.
 *  - The map is single-valued per writing — a document has at most one primary
 *    workspace, so re-assigning replaces the previous slug instead of stacking.
 *  - These helpers are pure (no Tauri, no IO) so the invariant is unit-testable
 *    independently of the desktop adapter that persists the map.
 *
 * Persistence note: the map lives in desktop-local settings (the workspace
 * layer is desktop-first per `odessay-workspace.md`), keyed by writing id. It is
 * intentionally not a synced column on the writing record — surfacing the
 * assignment on the web/cloud library would require a separate, explicitly
 * scoped schema change.
 */

/** Maps a writing id to the slug of its single primary workspace. */
export type WorkspaceAssignmentMap = Record<string, string>

/** Minimal workspace descriptor the UI needs to render and pick targets. */
export type WorkspaceAssignmentOption = {
  slug: string
  name: string
}

/** Reads the current workspace slug for a writing, or null when unassigned. */
export function readAssignmentSlug(
  map: WorkspaceAssignmentMap | null | undefined,
  writingId: string,
): string | null {
  if (!map) {
    return null
  }

  const slug = map[writingId]
  return typeof slug === "string" && slug.length > 0 ? slug : null
}

/**
 * Returns a new map with `writingId` assigned to `slug`. Single-valued: any
 * previous assignment for the writing is replaced, never accumulated.
 */
export function withAssignment(
  map: WorkspaceAssignmentMap | null | undefined,
  writingId: string,
  slug: string,
): WorkspaceAssignmentMap {
  const next: WorkspaceAssignmentMap = { ...(map ?? {}) }
  next[writingId] = slug
  return next
}

/** Returns a new map with any assignment for `writingId` removed. */
export function withoutAssignment(
  map: WorkspaceAssignmentMap | null | undefined,
  writingId: string,
): WorkspaceAssignmentMap {
  if (!map || !(writingId in map)) {
    return { ...(map ?? {}) }
  }

  const next: WorkspaceAssignmentMap = { ...map }
  delete next[writingId]
  return next
}

/**
 * Drops assignments that point at slugs no longer present in `validSlugs`.
 * Keeps the map honest when a workspace is removed so the UI never shows a
 * dangling "current" workspace.
 */
export function pruneAssignments(
  map: WorkspaceAssignmentMap | null | undefined,
  validSlugs: Iterable<string>,
): WorkspaceAssignmentMap {
  const allowed = new Set(validSlugs)
  const next: WorkspaceAssignmentMap = {}

  for (const [writingId, slug] of Object.entries(map ?? {})) {
    if (allowed.has(slug)) {
      next[writingId] = slug
    }
  }

  return next
}

/** Builds a slug → name lookup for resolving display labels from options. */
export function buildWorkspaceNameLookup(
  options: readonly WorkspaceAssignmentOption[],
): Record<string, string> {
  const lookup: Record<string, string> = {}
  for (const option of options) {
    lookup[option.slug] = option.name
  }
  return lookup
}
