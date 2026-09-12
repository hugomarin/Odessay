import type { WorkspaceAgentContextAttachment } from "@/lib/agent/workspace-agent-chat"
import type { WorkspaceAgentSelection } from "@/lib/services/workspace-agent-service"

/**
 * `AgentInvocation` / `RuntimeContext` / `LocationContext` / `ContextEnvelope`
 * consolidated as real code (ODE-489 follow-up). Until now these were only
 * documented in workflow/context/features/agents/odessay-agent-context.md —
 * the actual composition/precedence logic lived scattered across three
 * near-identical functions in workspace-agent-panel.tsx
 * (`classificationSelection`, `uniqueDocumentIds`, and the inline
 * `liveOverride` block in `executeAsk`). This module is the single place
 * that composition now happens; the panel builds one `ContextEnvelope` per
 * turn and reads it, instead of re-deriving the same precedence three times.
 *
 * What this module intentionally does NOT do:
 * - It does not read document bodies, ever — `availableSources` are
 *   references only. Whether a reference actually gets read is decided by
 *   explicit selection and the host action; this module only composes the
 *   references and policy, not the acquisition itself.
 * - It does not infer a target from recency, catalog order, or an ambiguous
 *   name. `availableSources` contains only the focused/attached references
 *   supplied by the host; body acquisition remains an explicit action.
 * - `RuntimeContext.capabilities` mirrors the single real signal the
 *   codebase tracks today (whether a Workspace `service` exists at all),
 *   not per-capability flags from an actual runtime adapter. Documented as
 *   a simplification, not hidden.
 */

export type WorkspaceAgentScope =
  | { kind: "document"; id: string }
  | { kind: "workspace"; rootId: string }

export type WorkspaceAgentDocumentSnapshot = {
  /** Null for a still-blank draft with no identity yet (ODE-490 follow-up). */
  documentId: string | null
  title: string | null
  markdown: string
}

export type AgentInvocationSource = "chat" | "card" | "modal" | "command"

export type RuntimeKind = "desktop" | "web" | "cloud"

export type RuntimeCapabilities = {
  localCatalog: boolean
  localFilesystem: boolean
  read: boolean
  write: boolean
  edit: boolean
  move: boolean
  delete: boolean
}

export type RuntimeContext = {
  kind: RuntimeKind
  ai: "remote"
  capabilities: RuntimeCapabilities
}

export type ContextSourceOrigin = "focused-document" | "explicit-attachment"

export type ContextSourceDescriptor = {
  kind: "file" | "folder"
  documentId?: string
  path?: string
  label?: string
  origin: ContextSourceOrigin
}

export type LiveDocumentSnapshot = {
  documentId: string
  title: string | null
  markdown: string
}

export type LocationContext = {
  surface: "writing" | "workspace"
  scopeLabel: string | null
  /**
   * Populated whenever a Workspace root is available, independent of
   * `surface` — a Writing focused *within* a Workspace carries both
   * `focusedDocument` and `visibleWorkspace` at once (DoD: "Un Writing
   * persistido dentro de un Workspace incluye ambos niveles de contexto").
   * `rootId` is only known when the Workspace itself is the active scope;
   * a focused Writing only has the root path, not a resolved Workspace id.
   */
  visibleWorkspace?: { rootId: string | null; rootPath: string | null }
  focusedDocument?: { documentId: string }
  /** Only set when it's the live content of the document actually in focus — see `buildContextEnvelope`. */
  liveSnapshot?: LiveDocumentSnapshot
}

export type AgentInvocation = {
  input: { text: string }
  source: AgentInvocationSource
  location: LocationContext
  runtime: RuntimeContext
  session: { recentActions: readonly string[] }
}

export type ContextPolicies = {
  /** @deprecated Kept for host compatibility; empty scope never falls back to recent artifacts. */
  autoSelectRecent: boolean
  /**
   * Whether a focused Writing is included when the host action builds its
   * explicit selection. This does not authorize the model to expand scope;
   * an empty selection remains empty.
   */
  eagerlyLoadFocusedDocument: boolean
}

export type ContextEnvelope = {
  invocation: AgentInvocation
  /** The primary source this turn is grounded in, if any — the first entry of `availableSources`. */
  focus: ContextSourceDescriptor | null
  /** References only, not bodies — see the module doc comment. */
  availableSources: ContextSourceDescriptor[]
  policies: ContextPolicies
}

/**
 * The composition step shared by chat, Classify, and the comparison-style
 * actions (Contradictions, Merge): the focused Writing (if any) first, then
 * explicit attachments. Callers that need a bare id list should use
 * `documentIdsFromSources`, which dedupes.
 */
export function deriveAvailableSources(
  scope: WorkspaceAgentScope,
  attachments: readonly WorkspaceAgentContextAttachment[],
): ContextSourceDescriptor[] {
  const sources: ContextSourceDescriptor[] = []
  if (scope.kind === "document") {
    sources.push({ kind: "file", documentId: scope.id, origin: "focused-document" })
  }
  for (const attachment of attachments) {
    sources.push({
      kind: attachment.kind,
      documentId: attachment.id,
      path: attachment.path,
      label: attachment.label,
      origin: "explicit-attachment",
    })
  }
  return sources
}

/**
 * Deduped document ids from a set of sources, `file` sources only — for
 * callers that compare or read individual document bodies directly
 * (Contradictions, Merge, scoped read approvals) and can't operate on a
 * `folder` reference the way a selection sent to askAgent/suggestClassification
 * can (those get expanded server-side; a bare id list has nothing to expand).
 */
export function documentIdsFromSources(sources: readonly ContextSourceDescriptor[]): string[] {
  return [...new Set(
    sources
      .filter((source): source is ContextSourceDescriptor & { documentId: string } => source.kind === "file" && Boolean(source.documentId))
      .map((source) => source.documentId),
  )]
}

export function buildContextEnvelope(input: {
  text: string
  source: AgentInvocationSource
  scope: WorkspaceAgentScope
  scopeLabel?: string | null
  workspaceRootPath?: string | null
  attachments: readonly WorkspaceAgentContextAttachment[]
  /** The live editor snapshot, if one is available in this runtime — regardless of whether it matches the focused document (that check happens here). */
  liveSnapshot?: WorkspaceAgentDocumentSnapshot | null
  /** Whether a Workspace `service` is available — the one real capability signal this codebase tracks today. */
  hasService: boolean
  recentSessionActions: readonly string[]
  policies?: Partial<ContextPolicies>
}): ContextEnvelope {
  const availableSources = deriveAvailableSources(input.scope, input.attachments)
  const focus = availableSources[0] ?? null

  // The live snapshot only grounds the turn when it's actually the focused
  // document's content — asking about a Workspace with an unrelated live
  // draft open elsewhere must not substitute that draft's text for the
  // artifact actually being asked about.
  const liveSnapshot: LiveDocumentSnapshot | undefined =
    input.scope.kind === "document" && input.liveSnapshot?.documentId === input.scope.id
      ? { documentId: input.scope.id, title: input.liveSnapshot.title, markdown: input.liveSnapshot.markdown }
      : undefined

  // Local catalog/filesystem capability is desktop-only in this codebase
  // today (odessay-desktop-document-catalog.md) — a Workspace root path is
  // the signal that's actually available here.
  const runtimeKind: RuntimeKind = input.workspaceRootPath ? "desktop" : "web"
  const capabilities: RuntimeCapabilities = {
    localCatalog: input.hasService,
    localFilesystem: input.hasService,
    read: input.hasService,
    write: input.hasService,
    edit: input.hasService,
    move: input.hasService,
    delete: input.hasService,
  }

  return {
    invocation: {
      input: { text: input.text },
      source: input.source,
      location: {
        surface: input.scope.kind === "document" ? "writing" : "workspace",
        scopeLabel: input.scopeLabel ?? null,
        visibleWorkspace: input.workspaceRootPath
          ? { rootId: input.scope.kind === "workspace" ? input.scope.rootId : null, rootPath: input.workspaceRootPath }
          : undefined,
        focusedDocument: input.scope.kind === "document" ? { documentId: input.scope.id } : undefined,
        liveSnapshot,
      },
      runtime: { kind: runtimeKind, ai: "remote", capabilities },
      session: { recentActions: input.recentSessionActions },
    },
    focus,
    availableSources,
    policies: {
      autoSelectRecent: input.policies?.autoSelectRecent ?? false,
      eagerlyLoadFocusedDocument: input.policies?.eagerlyLoadFocusedDocument ?? false,
    },
  }
}

/**
 * The explicit selection to hand to askAgent/suggestClassification —
 * envelope sources translated to the service's own selection shape. A
 * focused source is included only when the host action opts into it; no
 * catalog fallback is added here.
 */
export function selectionFromEnvelope(envelope: ContextEnvelope): WorkspaceAgentSelection[] {
  return envelope.availableSources
    .filter((source) => envelope.policies.eagerlyLoadFocusedDocument || source.origin !== "focused-document")
    .map((source) => ({
      kind: source.kind,
      documentId: source.documentId,
      path: source.path,
    }))
}

/** The live override to hand to askAgent — only when the live snapshot actually belongs to the turn's focused source, never a stand-in for an unrelated selection. */
export function liveOverrideFromEnvelope(envelope: ContextEnvelope): { documentId: string; markdown: string } | undefined {
  const snapshot = envelope.invocation.location.liveSnapshot
  if (!snapshot || envelope.focus?.documentId !== snapshot.documentId) return undefined
  return { documentId: snapshot.documentId, markdown: snapshot.markdown }
}
