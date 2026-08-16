"use client"

import * as React from "react"
import { useSearchParams } from "next/navigation"

import { DeskArtifactList } from "@/components/desk/desk-artifact-list"
import { DeskFilterBar, DeskFilterEmptyState } from "@/components/desk/filter-bar"
import { DeskHeader } from "@/components/desk/desk-header"
import { DeskViewToggle } from "@/components/desk/desk-view-toggle"
import { BulkActionBar } from "@/components/desk/bulk-action-bar"
import type { DeskActivityGroup, DeskActivityRow } from "@/lib/queries/desk-activity"
import type { ArtifactType } from "@/lib/writings/artifact-type"
import type { WritingStatus } from "@/lib/writings/status"

/**
 * Fixture rows mirroring the prototype's own data, so a side-by-side capture
 * compares like with like.
 */
type Fixture = {
  id: string
  title: string
  excerpt: string
  status: WritingStatus
  type: ArtifactType
  workspace: string | null
  when: string
  synced: boolean
}

const FIXTURES: Fixture[] = [
  {
    id: "1",
    title: "Leccion 5 - Evaluacion de prompts",
    excerpt:
      "Lección 5 — Evaluación de prompts En la lección anterior repetimos una frase hasta el cansancio: cualquier técnica que a",
    status: "draft",
    type: "general",
    workspace: "Tutoria",
    when: "5 ago",
    synced: true,
  },
  { id: "2", title: "Omega", excerpt: "Omega", status: "draft", type: "general", workspace: "ode408", when: "5 ago", synced: true },
  {
    id: "3",
    title: "Beta",
    excerpt: "Cambio offline 3 1 de /Documents/ode408/Beta.md",
    status: "draft",
    type: "general",
    workspace: "ode408",
    when: "4 ago",
    synced: false,
  },
  {
    id: "4",
    title: "Beta",
    excerpt: "Cambio offline 3 1 de /Documents/ode408/Beta.md",
    status: "draft",
    type: "general",
    workspace: "ode408",
    when: "4 ago",
    synced: true,
  },
  {
    id: "5",
    title: "05-Implementing a client",
    excerpt:
      "Implementing a client Now that we have our MCP server working, the next step is wiring a client that speaks to it",
    status: "in_review",
    type: "skill",
    workspace: "ode408",
    when: "22 jul",
    synced: true,
  },
  {
    id: "6",
    title: "Mapa-razonamiento-y-desarrollo-Leccion2",
    excerpt: "Lección 2 — Mapa de razonamiento y desarrollo Este mapa ordena las decisiones antes de escribir una sola línea",
    status: "done",
    type: "general",
    workspace: "Tutoria",
    when: "2 jul",
    synced: true,
  },
  {
    id: "7",
    title: "Alpha",
    excerpt: "Primer borrador del prompt maestro para el ejercicio de comparación",
    status: "exploring",
    type: "prompt",
    workspace: "OS",
    when: "1 jul",
    synced: false,
  },
  {
    id: "8",
    title: "transcript-llamada-2026-07-24",
    excerpt: "Transcripción de la llamada con el equipo: alcance, riesgos y siguientes pasos",
    status: "new",
    type: "general",
    workspace: "Narratif",
    when: "24 jul",
    synced: true,
  },
]

function toRow(fixture: Fixture): DeskActivityRow {
  return {
    id: fixture.id,
    title: fixture.title,
    excerpt: fixture.excerpt,
    localPath: null,
    stateLabel: fixture.status
      .replace("in_review", "In Review")
      .replace(/^./, (character) => character.toUpperCase()),
    stateTone: fixture.status,
    documentState: fixture.synced ? "synced" : "local-only",
    artifactType: fixture.type,
    recipientPreviews: [],
    dateLabel: fixture.when,
    isNew: false,
    destinationHref: `/write/${fixture.id}`,
    workspaceSlug: fixture.workspace,
    workspaceName: fixture.workspace,
  }
}

const WORKSPACE_OPTIONS = ["Tutoria", "ode408", "OS", "Skill", "Narratif"].map((name) => ({
  slug: name,
  name,
}))

export function DeskHarnessClient() {
  const params = useSearchParams()
  const state = params.get("state") ?? "populated"

  const [selected, setSelected] = React.useState<Set<string>>(
    () => new Set(state === "selection" ? ["1", "2", "3"] : []),
  )
  const [groupBy, setGroupBy] = React.useState<"none" | "status">(state === "grouped" ? "status" : "none")

  const rows = FIXTURES.map(toRow)
  const groups: DeskActivityGroup[] =
    state === "empty"
      ? []
      : groupBy === "status"
        ? Object.entries(
            rows.reduce<Record<string, DeskActivityRow[]>>((bag, row) => {
              ;(bag[row.stateLabel] ||= []).push(row)
              return bag
            }, {}),
          ).map(([label, groupRows]) => ({ label, rows: groupRows }))
        : [{ label: "", rows }]

  const filtersApplied = state === "filtered" ? 6 : 0

  return (
    <section data-page="desk" className="Desk flex h-screen min-h-0 flex-col bg-bg">
      <DeskHeader />

      <DeskFilterBar
        leading={
          <DeskViewToggle
            activeView="mine"
            counts={{ mine: 142, shared: 3 }}
            onViewChange={() => {}}
          />
        }
        searchQuery=""
        onSearchChange={() => {}}
        selectedCollectionIds={[]}
        onToggleCollection={() => {}}
        selectedStatuses={filtersApplied ? ["draft", "done"] : []}
        onToggleStatus={() => {}}
        selectedArtifactTypes={filtersApplied ? ["general", "skill"] : []}
        onToggleArtifactType={() => {}}
        selectedWorkspaceSlugs={filtersApplied ? ["Tutoria", "ode408"] : []}
        onToggleWorkspace={() => {}}
        createdDateFilter={null}
        onCreatedDateFilterChange={() => {}}
        createdDateFrom=""
        onCreatedDateFromChange={() => {}}
        createdDateTo=""
        onCreatedDateToChange={() => {}}
        groupBy={groupBy === "status" ? "status" : "none"}
        onGroupByChange={(value) => setGroupBy(value === "status" ? "status" : "none")}
        sortBy="created-at-desc"
        onSortByChange={() => {}}
        collectionOptions={[]}
        workspaceOptions={WORKSPACE_OPTIONS}
        activeFilterCount={filtersApplied}
        hasActiveFilters={filtersApplied > 0}
        filteredCount={state === "empty" ? 0 : rows.length}
        totalCount={rows.length}
        onClearFilters={() => {}}
      />

      <div
        data-testid="desk-sheet"
        className="relative mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float"
      >
        <DeskArtifactList
          groups={groups}
          isLoading={state === "loading"}
          emptyState={<DeskFilterEmptyState onClear={() => {}} />}
          selectedIds={selected}
          onToggleSelection={(id) =>
            setSelected((current) => {
              const next = new Set(current)
              if (next.has(id)) next.delete(id)
              else next.add(id)
              return next
            })
          }
          onStatusChange={async () => {}}
          onArtifactTypeChange={async () => {}}
          workspaceOptions={WORKSPACE_OPTIONS}
          workspaceAvailable
          onAssignWorkspace={() => {}}
          onUnassignWorkspace={() => {}}
          onCreateWorkspace={() => {}}
          onRenameWriting={() => {}}
          onPreviewWriting={() => {}}
          onCopyMarkdown={() => {}}
          onDownloadMarkdown={() => {}}
          onDeleteRequest={() => {}}
          absoluteDates={Object.fromEntries(rows.map((row) => [row.id, "12 August 2026 at 09:30"]))}
        />

        {selected.size > 0 ? (
          <BulkActionBar
            placement="absolute"
            selectedCount={selected.size}
            visibleCount={rows.length}
            allVisibleSelected={selected.size === rows.length}
            onSelectAll={() => setSelected(new Set(rows.map((row) => row.id)))}
            onDeselectAll={() => setSelected(new Set())}
            onDelete={() => {}}
            onStatusChange={() => {}}
            onArtifactTypeChange={() => {}}
            collectionOptions={[]}
            onAddToCollection={() => {}}
            onCreateCollection={() => {}}
          />
        ) : null}
      </div>
    </section>
  )
}
