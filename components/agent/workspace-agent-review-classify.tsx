"use client"

import { useState, type ReactNode } from "react"
import { Check, ChevronDown } from "lucide-react"

import type { ClassificationProposal } from "@/lib/agent/workspace-agent-analysis"
import type { WorkspaceAgentClassificationRequestedDocument } from "@/lib/services/workspace-agent-service"
import { ArtifactTypeIcon } from "@/components/desk/artifact-type-icon"
import { ArtifactTypeSelector } from "@/components/ui/artifact-type-selector"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { WritingStatusPicker } from "@/components/writings/writing-status-picker"
import { getArtifactTypeLabel, type ArtifactType } from "@/lib/writings/artifact-type"
import { getWritingStatusLabel, type WritingStatus } from "@/lib/writings/status"
import { ReviewShellCancelButton, ReviewShellPrimaryButton } from "@/components/agent/workspace-agent-review-shell"
import { cn } from "@/lib/utils"

export type ClassificationReviewToolResult = {
  summary: string
  proposals: ClassificationProposal[]
  requestedDocumentIds: string[]
  requestedDocuments: WorkspaceAgentClassificationRequestedDocument[]
}

type Override = { artifactType?: ArtifactType; status?: WritingStatus }

function StruckThrough({ children }: { children: ReactNode }) {
  return <span className="whitespace-nowrap text-[12px] text-ink-5 line-through">{children}</span>
}

/**
 * Classify — tabla con evidencia expandible (handoff §7.3): una fila por
 * documento con el par "actual (tachado) → sugerido (chip editable)" para
 * tipo y status, acordeón de una sola fila abierta con el porqué/beneficio/
 * incertidumbre y las citas de evidencia, y aplicación individual o en bloque.
 */
export function ClassificationReviewBody({
  toolResult,
  busy,
  onApprove,
  onApproveMany,
}: {
  toolResult: ClassificationReviewToolResult
  busy: boolean
  onApprove: (proposal: ClassificationProposal) => void
  onApproveMany: (proposals: ClassificationProposal[]) => void
}) {
  const actionable = toolResult.proposals.filter((proposal) => proposal.decision === "change")
  const [selected, setSelected] = useState<Set<string>>(() => new Set(actionable.map((proposal) => proposal.documentId)))
  const [overrides, setOverrides] = useState<Record<string, Override>>({})
  const [openRow, setOpenRow] = useState<string | null>(null)

  const resolvedProposal = (proposal: ClassificationProposal): ClassificationProposal => {
    const override = overrides[proposal.documentId]
    if (!override) return proposal
    return { ...proposal, artifactType: override.artifactType ?? proposal.artifactType, status: override.status ?? proposal.status }
  }

  const toggleSelected = (documentId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }

  const selectedProposals = actionable.filter((proposal) => selected.has(proposal.documentId)).map(resolvedProposal)

  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <div className="flex shrink-0 items-baseline gap-3 px-1 pb-3.5 pt-1">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.015em] text-ink">Clasificación semántica</h2>
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.3] text-ink-4">
          {toolResult.summary || "Abre una fila para ver la evidencia y aceptarla"}
        </span>
      </div>

      {toolResult.requestedDocumentIds.length > 0 ? (
        <p className="mb-3 shrink-0 rounded-[9px] border-[0.5px] border-border/70 bg-surface-selected px-3 py-2 text-[12px] leading-[1.45] text-ink-3">
          Needs {toolResult.requestedDocumentIds.length} additional catalog document(s) to reduce uncertainty. Attach them to continue.
          {toolResult.requestedDocuments.length > 0 ? (
            <span className="mt-1 block text-ink-4">{toolResult.requestedDocuments.map((document) => document.path ?? document.title).join(" · ")}</span>
          ) : null}
        </p>
      ) : null}

      <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.06)]">
        <div className="grid h-[38px] shrink-0 grid-cols-[18px_minmax(0,1fr)_178px_178px_22px] items-center gap-5 border-b-[0.5px] border-[#F0EEEB] bg-[#FCFBFA] px-5">
          <div />
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Artifact</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Tipo</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Status</span>
          <div />
        </div>
        <div className="od-scroll h-[calc(100%-38px)] overflow-y-auto">
          {toolResult.proposals.length === 0 ? (
            <p className="px-5 py-6 text-[12px] leading-[1.45] text-ink-4">No metadata change is ready. The agent needs more evidence before making a responsible classification.</p>
          ) : null}
          {toolResult.proposals.map((proposal) => {
            const isOpen = openRow === proposal.documentId
            const override = overrides[proposal.documentId] ?? {}
            const proposedType = override.artifactType ?? proposal.artifactType
            const proposedStatus = override.status ?? proposal.status
            const canChange = proposal.decision === "change"
            return (
              <div key={proposal.documentId} data-testid={`workspace-agent-classification-${proposal.documentId}`}>
                <div
                  onClick={() => setOpenRow(isOpen ? null : proposal.documentId)}
                  className="grid h-16 cursor-pointer grid-cols-[18px_minmax(0,1fr)_178px_178px_22px] items-center gap-5 border-b-[0.5px] border-[#F0EEEB] px-5 transition-colors hover:bg-[#FCFBFA]"
                >
                  {canChange ? (
                    <button
                      type="button"
                      onClick={(event) => { event.stopPropagation(); toggleSelected(proposal.documentId) }}
                      aria-label={selected.has(proposal.documentId) ? "Deselect" : "Select"}
                      className={cn(
                        "flex h-4 w-4 items-center justify-center rounded-[5px]",
                        selected.has(proposal.documentId) ? "bg-ink text-bg" : "border border-border bg-sb",
                      )}
                    >
                      {selected.has(proposal.documentId) ? <Check className="h-[13px] w-[13px]" strokeWidth={2} /> : null}
                    </button>
                  ) : <div />}
                  <div className="min-w-0">
                    <p className="truncate text-[14px] font-medium leading-[1.3] text-ink">{proposal.documentTitle}</p>
                    {proposal.documentPath ? <p className="mt-1 truncate font-mono text-[11px] leading-[1.3] text-ink-5">{proposal.documentPath}</p> : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <StruckThrough>{proposal.currentArtifactType ? getArtifactTypeLabel(proposal.currentArtifactType) : "Sin tipo"}</StruckThrough>
                    {proposedType ? (
                      canChange ? (
                        <ArtifactTypeSelector
                          value={proposedType}
                          onChange={(next) => setOverrides((current) => ({ ...current, [proposal.documentId]: { ...current[proposal.documentId], artifactType: next } }))}
                        />
                      ) : (
                        <span className="flex h-7 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#CFC9C1] px-2.5 text-[12.5px] font-medium text-ink">
                          <ArtifactTypeIcon artifactType={proposedType} className="h-3.5 w-3.5" />
                          {getArtifactTypeLabel(proposedType)}
                        </span>
                      )
                    ) : null}
                  </div>
                  <div className="flex min-w-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
                    <StruckThrough>{proposal.currentStatus ? getWritingStatusLabel(proposal.currentStatus) : "Sin status"}</StruckThrough>
                    {proposedStatus ? (
                      canChange ? (
                        <WritingStatusPicker
                          value={proposedStatus}
                          onChange={(next) => setOverrides((current) => ({ ...current, [proposal.documentId]: { ...current[proposal.documentId], status: next } }))}
                        />
                      ) : (
                        <span className="flex h-7 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#CFC9C1] px-2.5 text-[12.5px] font-medium text-ink">
                          <WritingStatusIcon status={proposedStatus} className="h-3.5 w-3.5" />
                          {getWritingStatusLabel(proposedStatus)}
                        </span>
                      )
                    ) : null}
                  </div>
                  <ChevronDown className={cn("h-[17px] w-[17px] shrink-0 text-ink-5 transition-transform", isOpen && "rotate-180")} strokeWidth={1.5} />
                </div>

                {isOpen ? (
                  <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] gap-6 bg-[#FCFBFA] px-5 py-[18px] pl-[54px]">
                    <div>
                      <p className="mb-2 text-[12.5px] leading-[1.6] text-ink-2"><b className="font-medium text-ink">Por qué:</b> {proposal.reason}</p>
                      <p className="mb-2 text-[12.5px] leading-[1.6] text-ink-2"><b className="font-medium text-ink">Beneficio:</b> {proposal.benefit}</p>
                      {proposal.uncertainty ? <p className="mb-2 text-[12.5px] leading-[1.6] text-ink-4"><b className="font-medium text-ink">Incertidumbre:</b> {proposal.uncertainty}</p> : null}
                      <div className="mt-3.5 flex items-center gap-2">
                        {canChange ? (
                          <ReviewShellPrimaryButton onClick={() => onApprove(resolvedProposal(proposal))} disabled={busy} icon={<Check className="h-[15px] w-[15px]" strokeWidth={1.5} />}>
                            Aceptar este cambio
                          </ReviewShellPrimaryButton>
                        ) : null}
                        <button type="button" onClick={() => setOpenRow(null)} className="flex h-8 items-center rounded-[8px] px-3 text-[12.5px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink">Descartar</button>
                      </div>
                    </div>
                    <div>
                      <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Evidencia</p>
                      <div className="flex flex-col gap-2">
                        {proposal.evidence.length === 0 ? (
                          <p className="text-[11px] text-ink-4">No exact evidence could be verified for this proposal.</p>
                        ) : proposal.evidence.map((evidence) => (
                          <div key={`${evidence.sourceId}:${evidence.line ?? "unknown"}:${evidence.quote ?? evidence.detail}`} className="rounded-[9px] border-[0.5px] border-border bg-sb px-2.5 py-2">
                            {evidence.quote ? <p className="text-[12.5px] italic leading-[1.5] text-ink">“{evidence.quote}”</p> : null}
                            <p className={cn("font-mono text-[11px] leading-[1.3]", evidence.quote ? "mt-1 text-ink-4" : "text-ink-3")}>
                              {evidence.line ? `línea ${evidence.line} · ` : ""}{evidence.detail}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                ) : null}
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3.5 flex shrink-0 items-center gap-2.5 px-1">
        <span className="flex-1 text-[12.5px] leading-[1.3] text-ink-4">{selectedProposals.length} seleccionados · nada cambia hasta que apliques</span>
        <ReviewShellCancelButton onClick={() => setSelected(new Set())} label="Cancelar" />
        <ReviewShellPrimaryButton
          onClick={() => onApproveMany(selectedProposals)}
          disabled={busy || selectedProposals.length === 0}
          icon={<Check className="h-4 w-4" strokeWidth={1.5} />}
        >
          Aplicar los {selectedProposals.length} cambios
        </ReviewShellPrimaryButton>
      </div>
    </div>
  )
}
