"use client"

import { useState } from "react"
import { ExternalLink, Radio, Sparkles, Verified } from "lucide-react"

import type { ContradictionProposal } from "@/lib/agent/workspace-agent-analysis"
import { cn } from "@/lib/utils"

type Severity = "Alta" | "Media" | "Baja"

/** Derives a severity bucket from the matcher's own overlap score — real signal, not a fabricated rating. */
function severityOf(proposal: ContradictionProposal): Severity {
  const similarity = proposal.evidence.find((item) => item.kind === "similarity")
  const match = similarity?.detail.match(/(\d+)%/)
  const overlap = match ? Number(match[1]) : 0
  if (overlap >= 80) return "Alta"
  if (overlap >= 60) return "Media"
  return "Baja"
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

      {suggestedTitle ? (
        <div className="mt-3 flex items-start gap-2">
          <Sparkles className="h-[15px] w-[15px] shrink-0 text-[#5B5BD6]" strokeWidth={1.5} />
          <p className="flex-1 text-[12.5px] leading-[1.55] text-[#6B5F57]">
            Sugiero <b className="font-medium text-ink">{suggestedTitle}</b>: se actualizó más recientemente que el otro documento.
          </p>
        </div>
      ) : null}

      <div className="mt-3.5 flex items-center gap-2">
        <button
          type="button"
          disabled={busy}
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
  resolvedIds,
  busy,
  onOpenDocument,
  onResolve,
}: {
  proposals: ContradictionProposal[]
  resolvedIds: Set<string>
  busy: boolean
  onOpenDocument?: (documentId: string) => void
  onResolve: (proposal: ContradictionProposal, resolution: "left" | "right" | "discard") => void
}) {
  const active = proposals.filter((proposal) => !resolvedIds.has(proposal.id))
  if (active.length === 0) return null

  return (
    <div data-testid="workspace-agent-review-queue" className="od-scroll h-full overflow-y-auto p-2">
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
