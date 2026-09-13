"use client"

import { useState } from "react"
import { AlertCircle, Check, ExternalLink, Radio, Sparkles, Verified } from "lucide-react"

import type { ContradictionProposal } from "@/lib/agent/workspace-agent-analysis"
import type { WorkspaceAgentSemanticRelationSummary } from "@/lib/services/workspace-agent-service"
import type { WorkspaceAgentSemanticReviewState } from "@/lib/agent/workspace-agent-chat"
import { cn } from "@/lib/utils"

type Severity = "Alta" | "Media" | "Baja"

/** Uses semantic confidence when present; the overlap fallback only serves legacy deterministic proposals. */
function severityOf(proposal: ContradictionProposal): Severity {
  if (proposal.semanticConfidence === "high") return "Alta"
  if (proposal.semanticConfidence === "medium") return "Media"
  if (proposal.semanticConfidence === "low") return "Baja"
  const similarity = proposal.evidence.find((item) => item.kind === "similarity")
  const match = similarity?.detail.match(/(\d+)%/)
  const overlap = match ? Number(match[1]) : 0
  if (overlap >= 80) return "Alta"
  if (overlap >= 60) return "Media"
  return "Baja"
}

const RELATION_COPY: Record<WorkspaceAgentSemanticRelationSummary["verdict"], string> = {
  style_only: "Solo estilo",
  equivalent: "Equivalente",
  complementary: "Complementario",
  contradictory: "Contradicción no resoluble",
  context_dependent: "Depende del contexto",
  unrelated: "No relacionado",
  insufficient_evidence: "Evidencia insuficiente",
}

const SEVERITY_STYLE: Record<Severity, string> = {
  Alta: "bg-[#FAEDE4] text-[#96532C]",
  Media: "bg-[#F7F5F3] text-[#6B5F57]",
  Baja: "bg-[#F3F2F0] text-[#6B5F57]",
}

function ClaimOption({
  title,
  quote,
  line,
  selected,
  suggested,
  onSelect,
}: {
  title: string
  quote: string
  line: number
  selected: boolean
  suggested: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        "flex flex-1 flex-col gap-2.5 rounded-[11px] px-3.5 py-3 text-left",
        selected ? "border border-ink" : "border-[0.5px] border-[#E4E1DC]",
      )}
    >
      <div className="flex items-center gap-2">
        {selected ? <Radio className="h-4 w-4 shrink-0 fill-ink text-ink" strokeWidth={1.5} /> : <Radio className="h-4 w-4 shrink-0 text-[#CFC9C1]" strokeWidth={1.5} />}
        <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-[#6B5F57]">{title}</span>
        <span className="font-mono text-[11px] text-ink-5">línea {line}</span>
        {suggested ? <span className="h-5 shrink-0 rounded-[5px] bg-ink px-[7px] text-[10px] font-medium leading-5 tracking-[0.04em] text-bg">SUGERIDA</span> : null}
      </div>
      <p className="text-[13px] italic leading-[1.55] text-ink">“{quote}”</p>
    </button>
  )
}

function ContradictionCard({
  index,
  proposal,
  busy,
  onOpenDocument,
  onResolve,
}: {
  index: number
  proposal: ContradictionProposal
  busy: boolean
  onOpenDocument?: (documentId: string) => void
  onResolve: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
}) {
  const [selection, setSelection] = useState<"left" | "right">(
    proposal.suggestedDocumentId === proposal.right.documentId ? "right" : "left",
  )
  const severity = severityOf(proposal)
  const suggestedTitle = proposal.suggestedDocumentId === proposal.left.documentId
    ? proposal.left.title
    : proposal.suggestedDocumentId === proposal.right.documentId
      ? proposal.right.title
      : null
  const semanticSuggestion = proposal.semanticVerdict
    ? suggestedTitle && proposal.semanticSuggestedReason
      ? `Sugiero ${suggestedTitle}: ${proposal.semanticSuggestedReason}`
      : null
    : suggestedTitle
      ? `Sugiero ${suggestedTitle}: se actualizó más recientemente que el otro documento.`
      : null
  const canResolve = !proposal.semanticVerdict
    || (proposal.semanticVerdict === "contradictory" && proposal.semanticConfidence === "high")

  return (
    <div className="mb-3 rounded-[12px] bg-sb px-[18px] py-4 shadow-[0_1px_2px_rgba(35,24,15,0.06)] last:mb-0">
      <div className="mb-3.5 flex items-center gap-2.5">
        <span className="font-mono text-[12px] text-ink-5">{String(index + 1).padStart(2, "0")}</span>
        <span className="min-w-0 flex-1 truncate text-[15px] font-medium leading-[1.2] text-ink">{proposal.topic}</span>
        <span className={cn("flex h-[22px] items-center rounded-[6px] px-2 text-[11px] font-medium", SEVERITY_STYLE[severity])}>{severity}</span>
        <button
          type="button"
          disabled={!onOpenDocument}
          onClick={() => onOpenDocument?.(selection === "left" ? proposal.left.documentId : proposal.right.documentId)}
          className="flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] text-[#6B5F57] transition-colors hover:bg-muted hover:text-ink disabled:opacity-40"
        >
          <ExternalLink className="h-[15px] w-[15px]" strokeWidth={1.5} /> Ver en contexto
        </button>
      </div>

      <div className="flex items-stretch gap-2.5">
        <ClaimOption
          title={proposal.left.title}
          quote={proposal.left.fragment.text}
          line={proposal.left.fragment.line}
          selected={selection === "left"}
          suggested={proposal.suggestedDocumentId === proposal.left.documentId}
          onSelect={() => setSelection("left")}
        />
        <ClaimOption
          title={proposal.right.title}
          quote={proposal.right.fragment.text}
          line={proposal.right.fragment.line}
          selected={selection === "right"}
          suggested={proposal.suggestedDocumentId === proposal.right.documentId}
          onSelect={() => setSelection("right")}
        />
      </div>

      {semanticSuggestion ? (
        <div className="mt-3 flex items-start gap-2">
          <Sparkles className="h-[15px] w-[15px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} />
          <p className="flex-1 text-[12.5px] leading-[1.55] text-[#6B5F57]">
            {proposal.semanticVerdict && suggestedTitle ? <><b className="font-medium text-ink">{suggestedTitle}</b>{`: ${proposal.semanticSuggestedReason}`}</> : semanticSuggestion}
          </p>
        </div>
      ) : null}

      {proposal.semanticRationale ? (
        <div className="mt-3 flex items-start gap-2 rounded-[8px] bg-[#F3F1EE] px-2.5 py-2">
          <Sparkles className="mt-0.5 h-[14px] w-[14px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} />
          <p className="flex-1 text-[12px] leading-[1.5] text-[#6B5F57]" data-testid="workspace-agent-semantic-rationale">
            {proposal.semanticRationale}
          </p>
        </div>
      ) : null}

      {proposal.semanticEvidenceIds?.length ? (
        <p className="mt-2 font-mono text-[10px] leading-[1.45] text-ink-5" data-testid="workspace-agent-semantic-evidence-ids">
          Evidencia: {proposal.semanticEvidenceIds.join(" · ")}
        </p>
      ) : null}

      <div className="mt-3.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy || !canResolve}
          onClick={() => onResolve(proposal, selection)}
          className="flex h-8 items-center gap-1.5 rounded-[8px] bg-ink px-[13px] text-[12.5px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:opacity-50"
        >
          <Verified className="h-[15px] w-[15px]" strokeWidth={1.5} /> Fijar como fuente de verdad
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(proposal, "discard")}
          className="flex h-8 items-center rounded-[8px] border-[0.5px] border-[#DDD8D1] bg-sb px-3 text-[12.5px] font-medium text-[#3F3731] transition-colors hover:border-[#B5ADA5] disabled:opacity-50"
        >
          Ambas válidas · contextos distintos
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => onResolve(proposal, "discard")}
          className="flex h-8 items-center rounded-[8px] px-3 text-[12.5px] text-[#6B5F57] transition-colors hover:bg-muted hover:text-ink disabled:opacity-50"
        >
          Resolver después
        </button>
      </div>
    </div>
  )
}

/**
 * Contradictions (handoff §7.5): a scrollable list of conflict cards — every
 * unresolved finding visible at once, each resolved independently. Replaces
 * the earlier "one conflict at a time" queue.
 */
export function ContradictionReviewCard({
  proposals,
  nonActionable = [],
  semanticReview,
  resolvedIds,
  busy,
  onOpenDocument,
  onResolve,
}: {
  proposals: ContradictionProposal[]
  nonActionable?: WorkspaceAgentSemanticRelationSummary[]
  semanticReview?: WorkspaceAgentSemanticReviewState | null
  resolvedIds: Set<string>
  busy: boolean
  onOpenDocument?: (documentId: string) => void
  onResolve: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
}) {
  const active = proposals.filter((proposal) => !resolvedIds.has(proposal.id))
  const hasIncompleteReview = Boolean(semanticReview && (semanticReview.status !== "complete" || semanticReview.coverage !== "complete"))
  if (active.length === 0 && nonActionable.length === 0 && !hasIncompleteReview) {
    return (
      <div className="flex h-full items-center justify-center p-8" data-testid="workspace-agent-contradictions-empty">
        <div className="max-w-[430px] text-center">
          <Check className="mx-auto mb-2 h-5 w-5 text-[#5B5BD6]" strokeWidth={1.6} />
          <p className="text-[13px] font-medium text-ink">No hay contradicciones materiales</p>
          <p className="mt-1 text-[12px] leading-[1.5] text-ink-4">Las diferencias equivalentes, de estilo o complementarias no requieren elegir una fuente de verdad.</p>
        </div>
      </div>
    )
  }

  return (
    <div data-testid="workspace-agent-review-queue" className="od-scroll h-full overflow-y-auto p-2">
      {hasIncompleteReview ? (
        <div className="mb-3 flex items-start gap-2 rounded-[10px] border-[0.5px] border-border bg-bg px-3.5 py-3 text-[12px] leading-[1.5] text-ink-3" data-testid="workspace-agent-contradictions-incomplete">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.6} />
          <p>
            <span className="font-medium text-ink">Revisión no concluyente.</span>{" "}
            {semanticReview?.status === "provider_error"
              ? "El proveedor no estuvo disponible; las diferencias deterministas no se muestran como conflictos."
              : "La cobertura no permite afirmar que no existan más conflictos. Puedes volver a ejecutar la revisión."}
          </p>
        </div>
      ) : null}
      {nonActionable.length > 0 ? (
        <section className="mb-3 rounded-[12px] border-[0.5px] border-[#E4E1DC] bg-[#F7F5F3] p-3.5" data-testid="workspace-agent-non-actionable-relations">
          <div className="mb-2 flex items-center gap-2">
            <Check className="h-4 w-4 text-[#5B5BD6]" strokeWidth={1.6} />
            <p className="text-[12.5px] font-medium text-ink">Relaciones compatibles o no accionables</p>
          </div>
          <div className="space-y-2">
            {nonActionable.map((relation) => (
              <article key={relation.relationId} className="rounded-[9px] bg-bg px-3 py-2.5" data-testid="workspace-agent-non-actionable-relation">
                <div className="flex items-center gap-2">
                  <span className="rounded-[5px] bg-[#EDEBE7] px-1.5 py-0.5 text-[10px] font-medium text-ink-3">{RELATION_COPY[relation.verdict]}</span>
                  <span className="font-mono text-[10px] text-ink-5">{relation.confidence}</span>
                  <span className="min-w-0 flex-1 truncate text-right text-[10px] text-ink-5">{relation.left.title} vs {relation.right.title}</span>
                </div>
                <p className="mt-1.5 text-[12px] leading-[1.5] text-ink-3">{relation.rationale}</p>
                <p className="mt-1 font-mono text-[9.5px] leading-[1.4] text-ink-5">Evidencia: {relation.evidenceIds.join(" · ")}</p>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      {active.map((proposal, index) => (
        <ContradictionCard
          key={proposal.id}
          index={index}
          proposal={proposal}
          busy={busy}
          onOpenDocument={onOpenDocument}
          onResolve={onResolve}
        />
      ))}
    </div>
  )
}
