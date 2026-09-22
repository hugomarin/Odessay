"use client"

import { useState } from "react"
import { Check } from "lucide-react"

import type { ArchiveCandidate } from "@/lib/agent/workspace-agent-analysis"
import { WritingStatusIcon } from "@/components/ui/writing-status-icon"
import { WritingStatusPicker } from "@/components/writings/writing-status-picker"
import { getWritingStatusLabel, type WritingStatus } from "@/lib/writings/status"
import { ReviewShellCancelButton, ReviewShellPrimaryButton } from "@/components/agent/workspace-agent-review-shell"
import { cn } from "@/lib/utils"

/**
 * Archive/Estados sugeridos (handoff §7.4): misma gramática de fila que
 * Classify pero sin expansión — "Por qué" es su propia columna, el estado
 * sugerido no siempre es Archived, y cada fila se acepta directamente.
 */
export function ArchiveReviewBody({
  candidates,
  busy,
  onApprove,
  onApproveMany,
}: {
  candidates: ArchiveCandidate[]
  busy: boolean
  onApprove: (candidate: ArchiveCandidate) => void
  onApproveMany: (candidates: ArchiveCandidate[]) => void
}) {
  const actionable = candidates.filter((candidate) => candidate.suggestedStatus)
  const [selected, setSelected] = useState<Set<string>>(() => new Set(actionable.map((candidate) => candidate.documentId)))
  const [overrides, setOverrides] = useState<Record<string, WritingStatus>>({})

  const resolvedCandidate = (candidate: ArchiveCandidate): ArchiveCandidate => {
    const override = overrides[candidate.documentId]
    return override ? { ...candidate, suggestedStatus: override } : candidate
  }

  const toggleSelected = (documentId: string) => {
    setSelected((current) => {
      const next = new Set(current)
      if (next.has(documentId)) next.delete(documentId)
      else next.add(documentId)
      return next
    })
  }

  const selectedCandidates = actionable.filter((candidate) => selected.has(candidate.documentId)).map(resolvedCandidate)

  return (
    <div className="flex h-full flex-col px-4 pb-4">
      <div className="flex shrink-0 items-baseline gap-3 px-1 pb-3.5 pt-1">
        <h2 className="text-[22px] font-medium leading-[1.15] tracking-[-0.015em] text-ink">Cambios de estado sugeridos</h2>
        <span className="min-w-0 flex-1 text-[12.5px] leading-[1.3] text-ink-4">
          {candidates.length} artifact(s) · el estado nuevo es editable y nada se mueve hasta que aceptes
        </span>
      </div>

      <div className="min-h-0 flex-1 overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.06)]">
        <div className="grid h-[38px] shrink-0 grid-cols-[18px_minmax(0,1fr)_minmax(0,1.1fr)_200px_96px] items-center gap-5 border-b-[0.5px] border-[#F0EEEB] bg-[#FCFBFA] px-5">
          <div />
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Artifact</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Por qué</span>
          <span className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Estado</span>
          <div />
        </div>
        <div className="od-scroll h-[calc(100%-38px)] overflow-y-auto">
          {candidates.length === 0 ? (
            <p className="px-5 py-6 text-[12px] leading-[1.45] text-ink-4">No stale or duplicate artifacts were found.</p>
          ) : null}
          {candidates.map((candidate) => {
            const proposedStatus = overrides[candidate.documentId] ?? candidate.suggestedStatus
            const canApprove = Boolean(candidate.suggestedStatus)
            return (
              <div
                key={candidate.documentId}
                className="grid h-16 grid-cols-[18px_minmax(0,1fr)_minmax(0,1.1fr)_200px_96px] items-center gap-5 border-b-[0.5px] border-[#F0EEEB] px-5 transition-colors last:border-b-0 hover:bg-[#FCFBFA]"
              >
                {canApprove ? (
                  <button
                    type="button"
                    onClick={() => toggleSelected(candidate.documentId)}
                    aria-label={selected.has(candidate.documentId) ? "Deselect" : "Select"}
                    className={cn(
                      "flex h-4 w-4 items-center justify-center rounded-[5px]",
                      selected.has(candidate.documentId) ? "bg-ink text-bg" : "border border-border bg-sb",
                    )}
                  >
                    {selected.has(candidate.documentId) ? <Check className="h-[13px] w-[13px]" strokeWidth={2} /> : null}
                  </button>
                ) : <div />}
                <p className="min-w-0 truncate text-[14px] font-medium leading-[1.3] text-ink">{candidate.title}</p>
                <p className="min-w-0 text-[12.5px] leading-[1.45] text-ink-3">{candidate.reason}</p>
                <div className="flex min-w-0 items-center gap-2">
                  {proposedStatus ? (
                    canApprove ? (
                      <WritingStatusPicker
                        value={proposedStatus}
                        onChange={(next) => setOverrides((current) => ({ ...current, [candidate.documentId]: next }))}
                      />
                    ) : (
                      <span className="flex h-7 items-center gap-1.5 rounded-[8px] border-[0.5px] border-[#CFC9C1] px-2.5 text-[12.5px] font-medium text-ink">
                        <WritingStatusIcon status={proposedStatus} className="h-3.5 w-3.5" />
                        {getWritingStatusLabel(proposedStatus)}
                      </span>
                    )
                  ) : <span className="text-[12px] text-ink-5">—</span>}
                </div>
                <button
                  type="button"
                  disabled={busy || !canApprove}
                  onClick={() => onApprove(resolvedCandidate(candidate))}
                  className="flex h-[30px] items-center justify-center gap-1.5 rounded-[8px] border-[0.5px] border-border bg-sb text-[12.5px] font-medium text-[#3F3731] transition-colors hover:bg-ink hover:text-bg disabled:opacity-40"
                >
                  <Check className="h-[15px] w-[15px]" strokeWidth={1.5} /> Aceptar
                </button>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mt-3.5 flex shrink-0 items-center gap-2.5 px-1">
        <span className="flex-1 text-[12.5px] leading-[1.3] text-ink-4">{selectedCandidates.length} seleccionados · reversible desde Desk</span>
        <ReviewShellCancelButton onClick={() => setSelected(new Set())} label="Cancelar" />
        <ReviewShellPrimaryButton
          onClick={() => onApproveMany(selectedCandidates)}
          disabled={busy || selectedCandidates.length === 0}
          icon={<Check className="h-4 w-4" strokeWidth={1.5} />}
        >
          Aplicar los {selectedCandidates.length} cambios
        </ReviewShellPrimaryButton>
      </div>
    </div>
  )
}
