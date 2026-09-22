"use client"

import { type ReactNode, useState } from "react"
import { Check, CornerDownLeft, Edit3, Paperclip, Sparkles } from "lucide-react"

import type { WorkflowDraftProposal } from "@/lib/agent/workspace-agent-analysis"

type MarkdownBlock =
  | { type: "h1" | "h2" | "h3"; text: string }
  | { type: "p"; text: string }
  | { type: "ul"; items: string[] }

/** Splits the workflow draft's plain markdown into the handful of block types `buildWorkflowDraft` actually emits (headings, paragraphs, `- ` lists). */
function parseMarkdownBlocks(markdown: string): MarkdownBlock[] {
  const lines = markdown.split("\n")
  const blocks: MarkdownBlock[] = []
  let listItems: string[] | null = null
  const flushList = () => {
    if (listItems && listItems.length > 0) blocks.push({ type: "ul", items: listItems })
    listItems = null
  }
  for (const rawLine of lines) {
    const line = rawLine.trimEnd()
    if (line.trim() === "") { flushList(); continue }
    if (line.startsWith("### ")) { flushList(); blocks.push({ type: "h3", text: line.slice(4) }); continue }
    if (line.startsWith("## ")) { flushList(); blocks.push({ type: "h3", text: line.slice(3) }); continue }
    if (line.startsWith("# ")) { flushList(); continue } // the document's own H1 duplicates the "workflow.md" filename already shown above it
    if (line.startsWith("- ")) {
      listItems = listItems ?? []
      listItems.push(line.slice(2))
      continue
    }
    flushList()
    blocks.push({ type: "p", text: line })
  }
  flushList()
  return blocks
}

/** Minimal inline markdown — `` `code` `` and `**bold**` — matching the two spans the draft template actually produces. */
function renderInline(text: string): ReactNode[] {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g)
  return parts.map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`") && part.length > 1) {
      return <span key={index} className="font-mono text-[12.5px] text-[#6B5F57]">{part.slice(1, -1)}</span>
    }
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <b key={index} className="font-medium">{part.slice(2, -2)}</b>
    }
    return <span key={index}>{part}</span>
  })
}

export function WorkflowReviewBody({
  proposal,
  busy,
  onApprove,
  onDiscard,
  onAskFollowUp,
}: {
  proposal: WorkflowDraftProposal
  busy: boolean
  onApprove: () => void
  onDiscard: () => void
  onAskFollowUp: (question: string) => Promise<{ ok: boolean; answer: string }>
}) {
  const [followUps, setFollowUps] = useState<{ question: string; answer: string }[]>([])
  const [draft, setDraft] = useState("")
  const [asking, setAsking] = useState(false)

  const blocks = parseMarkdownBlocks(proposal.markdown)
  const reasons = proposal.evidence.slice(0, 4)

  const submitFollowUp = () => {
    const question = draft.trim()
    if (!question || asking) return
    setDraft("")
    setAsking(true)
    void onAskFollowUp(question).then((result) => {
      setFollowUps((current) => [...current, { question, answer: result.answer }])
      setAsking(false)
    })
  }

  return (
    <div className="flex h-full gap-0">
      <div className="ml-4 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.05)]">
        <div className="shrink-0 border-b-[0.5px] border-[#F0EEEB] px-[34px] pb-[18px] pt-[26px]">
          <div className="flex items-center gap-2">
            <span className="flex h-[22px] items-center gap-1.5 rounded-[6px] bg-[#EFEFFB] px-2 text-[11px] font-medium text-[#5B5BD6]">
              <Sparkles className="h-3.5 w-3.5" strokeWidth={1.5} /> Borrador del agente
            </span>
            <span className="text-[12px] text-ink-4">sin guardar</span>
          </div>
          <h2 className="mt-3 text-[28px] font-medium leading-[1.12] tracking-[-0.02em] text-ink">workflow.md</h2>
          <p className="mt-2.5 truncate font-mono text-[11px] text-ink-4">{proposal.canonicalPath}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[34px] pb-8 pt-[26px]">
          <div className="max-w-[620px]">
            {blocks.map((block, index) => {
              if (block.type === "h3") return <h3 key={index} className="mb-2.5 mt-5 text-[19px] font-medium leading-[1.3] text-ink first:mt-0">{renderInline(block.text)}</h3>
              if (block.type === "ul") return (
                <ul key={index} className="mb-4 list-disc pl-5">
                  {block.items.map((item, itemIndex) => (
                    <li key={itemIndex} className="mb-2 text-[14.5px] leading-[1.7] text-ink-2">{renderInline(item)}</li>
                  ))}
                </ul>
              )
              return <p key={index} className="mb-4 text-[14.5px] leading-[1.75] text-ink-2">{renderInline(block.text)}</p>
            })}
          </div>
        </div>
      </div>

      <div className="flex w-[336px] shrink-0 flex-col overflow-hidden px-5 pb-1 pt-[26px]">
        <p className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Por qué quedó así</p>
        <div className="od-scroll mt-3 min-h-0 flex-1 space-y-3 overflow-y-auto">
          {reasons.map((item) => (
            <p key={item.sourceId} className="text-[13px] leading-[1.55] text-ink">
              <b className="font-medium">{item.label}:</b> {item.detail}
            </p>
          ))}
          {followUps.map((entry, index) => (
            <div key={index} className="space-y-2">
              <p className="ml-auto max-w-[80%] rounded-[12px] bg-[#EDEBE7] px-3.5 py-2.5 text-[13px] leading-[1.45] text-ink">{entry.question}</p>
              <p className="text-[13px] leading-[1.55] text-ink">{entry.answer}</p>
            </div>
          ))}
          {asking ? <p className="text-[12px] italic text-ink-4">Pensando…</p> : null}
        </div>
        <div className="mt-3.5 shrink-0 rounded-[12px] border-[0.5px] border-border bg-sb px-3 pb-2 pt-2.5">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault()
                submitFollowUp()
              }
            }}
            placeholder="Pide un cambio al borrador…"
            rows={1}
            className="max-h-24 w-full resize-none bg-transparent text-[13px] leading-[1.4] text-ink outline-none placeholder:text-ink-5"
          />
          <div className="mt-2.5 flex items-center justify-between">
            <Paperclip className="h-4 w-4 text-ink-4" strokeWidth={1.5} />
            <button type="button" aria-label="Send" onClick={submitFollowUp} disabled={!draft.trim() || asking}>
              <CornerDownLeft className="h-4 w-4 text-border disabled:opacity-40" strokeWidth={1.5} />
            </button>
          </div>
        </div>
        <div className="mt-3 flex shrink-0 flex-col gap-2 pb-1.5">
          <button
            type="button"
            disabled={busy}
            onClick={onApprove}
            className="flex h-[38px] items-center justify-center gap-2 rounded-[9px] bg-ink text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:opacity-50"
          >
            <Check className="h-4 w-4" strokeWidth={1.5} /> Aprobar y guardar
          </button>
          <button
            type="button"
            disabled
            title="Próximamente"
            className="flex h-9 items-center justify-center gap-2 rounded-[9px] border-[0.5px] border-border bg-sb text-[13px] font-medium text-[#3F3731] opacity-50"
          >
            <Edit3 className="h-4 w-4 text-ink-4" strokeWidth={1.5} /> Editar antes de guardar
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscard}
            className="flex h-8 items-center justify-center text-[12.5px] text-[#6B5F57] transition-colors hover:bg-[#EDEBE7] hover:text-ink disabled:opacity-50"
          >
            Descartar el borrador
          </button>
        </div>
      </div>
    </div>
  )
}
