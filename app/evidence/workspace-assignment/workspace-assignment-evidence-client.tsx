"use client"

import { WorkspaceAssignmentDropdown } from "@/components/desk/workspace-assignment-dropdown"
import type { WorkspaceAssignmentOption } from "@/lib/workspace/assignment"

const OPTIONS: WorkspaceAssignmentOption[] = [
  { slug: "drafts", name: "Drafts" },
  { slug: "letters", name: "Letters" },
  { slug: "field-notes", name: "Field notes" },
]

const noop = () => {}

function Card({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3 rounded-[14px] border-[0.5px] border-border bg-sb/60 p-5">
      <p className="text-[11px] font-semibold uppercase tracking-[0.07em] text-ink-4">{label}</p>
      {children}
    </div>
  )
}

/**
 * ODE-318 Presentation Contract harness — exercises the shared Workspace
 * assignment control across both surfaces (Desk table `variant="table"`,
 * Preview rail `variant="rail"`) and both runtimes (desktop `available`, web
 * informative). The control is purely prop-driven, so no auth or seeded data is
 * required for capture.
 */
export function WorkspaceAssignmentEvidenceClient() {
  return (
    <main data-testid="ode-318-workspace-harness" className="min-h-screen bg-bg p-12">
      <h1 className="mb-8 text-[20px] font-medium text-ink">ODE-318 · Workspace assignment control</h1>
      <div className="grid max-w-[980px] grid-cols-2 gap-6">
        <Card label="Desk row · unassigned (closed)">
          <WorkspaceAssignmentDropdown
            writingId="w-unassigned"
            title="Desk unassigned"
            currentSlug={null}
            currentName={null}
            options={OPTIONS}
            available
            variant="table"
            onAssign={noop}
            onUnassign={noop}
            onCreateWorkspace={noop}
          />
        </Card>

        <Card label="Desk row · assigned (closed)">
          <WorkspaceAssignmentDropdown
            writingId="w-assigned"
            title="Desk assigned"
            currentSlug="drafts"
            currentName="Drafts"
            options={OPTIONS}
            available
            variant="table"
            onAssign={noop}
            onUnassign={noop}
            onCreateWorkspace={noop}
          />
        </Card>

        <Card label="Preview rail · assigned (closed)">
          <div className="w-[256px]">
            <WorkspaceAssignmentDropdown
              writingId="w-rail-assigned"
              title="Rail assigned"
              currentSlug="letters"
              currentName="Letters"
              options={OPTIONS}
              available
              variant="rail"
              onAssign={noop}
              onUnassign={noop}
              onCreateWorkspace={noop}
            />
          </div>
        </Card>

        <Card label="Preview rail · unassigned (closed)">
          <div className="w-[256px]">
            <WorkspaceAssignmentDropdown
              writingId="w-rail-unassigned"
              title="Rail unassigned"
              currentSlug={null}
              currentName={null}
              options={OPTIONS}
              available
              variant="rail"
              onAssign={noop}
              onUnassign={noop}
              onCreateWorkspace={noop}
            />
          </div>
        </Card>

        <Card label="Open · assigned (Current / Move to / New workspace…)">
          <WorkspaceAssignmentDropdown
            writingId="w-open-assigned"
            title="Open assigned"
            currentSlug="drafts"
            currentName="Drafts"
            options={OPTIONS}
            available
            variant="table"
            onAssign={noop}
            onUnassign={noop}
            onCreateWorkspace={noop}
          />
        </Card>

        <Card label="Open · unassigned (Add to workspace / New workspace…)">
          <WorkspaceAssignmentDropdown
            writingId="w-open-unassigned"
            title="Open unassigned"
            currentSlug={null}
            currentName={null}
            options={OPTIONS}
            available
            variant="table"
            onAssign={noop}
            onUnassign={noop}
            onCreateWorkspace={noop}
          />
        </Card>

        <Card label="Web runtime · informative (no local workspaces)">
          <WorkspaceAssignmentDropdown
            writingId="w-web"
            title="Web informative"
            currentSlug={null}
            currentName={null}
            options={[]}
            available={false}
            variant="table"
            onAssign={noop}
            onUnassign={noop}
            onCreateWorkspace={noop}
          />
        </Card>
      </div>
    </main>
  )
}
