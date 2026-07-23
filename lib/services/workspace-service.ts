import { isTauriRuntime } from "@/lib/runtime/detect"
import { getDesktopWorkspaceService } from "@/lib/services/desktop/workspace-service"
import type {
  WorkspaceAssignmentMap,
  WorkspaceAssignmentOption,
} from "@/lib/workspace/assignment"
import type { WorkspaceDetail } from "@/lib/workspace/types"

/**
 * Runtime-agnostic entry point for document↔workspace assignment, shared by Desk
 * and Preview so both surfaces speak the same contract.
 *
 * Workspace is a desktop-first capability (`odessay-workspace.md`): only the
 * desktop runtime can register local folders and persist assignments. On web
 * there are no real local workspaces, so the service reports `isAvailable:
 * false` and returns empty data. Consumers render the same control either way;
 * the web informative state replaces real actions.
 */
export interface WorkspaceAssignmentService {
  /** True when the runtime can register workspaces and persist assignments. */
  readonly isAvailable: boolean
  /** Registered workspaces available as assignment targets. */
  listWorkspaces(): Promise<WorkspaceAssignmentOption[]>
  /** Full writing id → workspace slug map. */
  listAssignments(): Promise<WorkspaceAssignmentMap>
  /** Current workspace slug for a writing, or null. */
  getAssignment(writingId: string): Promise<string | null>
  /** Full workspace detail for destination-picking or inspection flows. */
  getWorkspaceDetail(slug: string): Promise<WorkspaceDetail | null>
  /**
   * Moves a writing to an existing workspace. For a folder-backed workspace
   * this physically relocates the canonical `.md` into the workspace folder
   * (ADR D7 amended — conscious move, same UUID); presentation-only workspaces
   * and writings without a local file stay metadata-only.
   */
  assign(writingId: string, slug: string): Promise<void>
  /**
   * Removes a writing from its workspace. When the file physically lives in a
   * folder-backed workspace, it returns to the managed root via the same
   * relocate primitive (symmetric, reversible); otherwise only the metadata
   * assignment is dropped.
   */
  clearAssignment(writingId: string): Promise<void>
  /**
   * Registers a new workspace (native folder picker on desktop) and returns it
   * so the caller can immediately assign the writing to it. Null when the user
   * cancels or the runtime cannot create workspaces.
   */
  createWorkspace(): Promise<WorkspaceAssignmentOption | null>
}

class DesktopWorkspaceAssignmentService implements WorkspaceAssignmentService {
  readonly isAvailable = true

  async listWorkspaces(): Promise<WorkspaceAssignmentOption[]> {
    const service = await getDesktopWorkspaceService()
    return service.listAssignableWorkspaces()
  }

  async listAssignments(): Promise<WorkspaceAssignmentMap> {
    const service = await getDesktopWorkspaceService()
    return service.listAssignments()
  }

  async getAssignment(writingId: string): Promise<string | null> {
    const service = await getDesktopWorkspaceService()
    return service.getAssignment(writingId)
  }

  async getWorkspaceDetail(slug: string): Promise<WorkspaceDetail | null> {
    const service = await getDesktopWorkspaceService()
    return service.getWorkspace(slug)
  }

  async assign(writingId: string, slug: string): Promise<void> {
    const service = await getDesktopWorkspaceService()
    await service.assignToWorkspace(writingId, slug)
  }

  async clearAssignment(writingId: string): Promise<void> {
    const service = await getDesktopWorkspaceService()
    await service.clearAssignment(writingId)
  }

  async createWorkspace(): Promise<WorkspaceAssignmentOption | null> {
    const service = await getDesktopWorkspaceService()
    const record = await service.addExistingWorkspace()
    return record ? { slug: record.slug, name: record.name } : null
  }
}

class UnavailableWorkspaceAssignmentService implements WorkspaceAssignmentService {
  readonly isAvailable = false

  async listWorkspaces(): Promise<WorkspaceAssignmentOption[]> {
    return []
  }

  async listAssignments(): Promise<WorkspaceAssignmentMap> {
    return {}
  }

  async getAssignment(): Promise<string | null> {
    return null
  }

  async getWorkspaceDetail(): Promise<WorkspaceDetail | null> {
    return null
  }

  async assign(): Promise<void> {
    // No real local workspaces on web — silently ignore so callers stay simple.
  }

  async clearAssignment(): Promise<void> {
    // No real local workspaces on web.
  }

  async createWorkspace(): Promise<WorkspaceAssignmentOption | null> {
    return null
  }
}

let desktopServiceSingleton: DesktopWorkspaceAssignmentService | null = null
const unavailableService = new UnavailableWorkspaceAssignmentService()

export function getWorkspaceAssignmentService(): WorkspaceAssignmentService {
  if (!isTauriRuntime()) {
    return unavailableService
  }

  if (!desktopServiceSingleton) {
    desktopServiceSingleton = new DesktopWorkspaceAssignmentService()
  }

  return desktopServiceSingleton
}
