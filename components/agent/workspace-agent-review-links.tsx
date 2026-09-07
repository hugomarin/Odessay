"use client"

import { useEffect, useMemo, useState } from "react"
import { CheckCircle2, FileText, Link as LinkIcon, Link2Off, Search } from "lucide-react"

import type { BrokenReferenceProposal } from "@/lib/agent/workspace-agent-analysis"
import { cn } from "@/lib/utils"

export type WorkspaceAgentSearchableDocument = { id: string; title: string; path?: string }

function replacementKey(messageId: string, proposal: BrokenReferenceProposal): string {
  return `${messageId}:${proposal.sourceDocumentId}:${proposal.referenceKind}:${proposal.reference}`
}

/** Wraps the first literal occurrence of `needle` inside `haystack` with the broken-reference highlight. */
function renderHighlightedQuote(quote: string, needle: string) {
  const index = quote.toLowerCase().indexOf(needle.toLowerCase())
  if (index === -1) return <>{quote}</>
  return (
    <>
      {quote.slice(0, index)}
      <span className="rounded-[5px] bg-[#FAEDE4] px-[5px] py-px text-[#96532C] decoration-[#C98A5A] decoration-wavy underline underline-offset-[3px] shadow-[0_0_0_1px_#E4C4AC]">
        {quote.slice(index, index + needle.length)}
      </span>
      {quote.slice(index + needle.length)}
    </>
  )
}

/**
 * Broken links — resolve in context (handoff §7.1): one broken reference at a
 * time, the source paragraph with the reference highlighted in place, and a
 * right rail to point it somewhere real, create the missing document, or
 * strip the link.
 */
export function BrokenLinksReviewBody({
  messageId,
  proposal,
  busy,
  busyAction,
  replacements,
  onReplacementChange,
  onApprove,
  onRemove,
  onCreate,
  documents,
  onLoadDocuments,
}: {
  messageId: string
  proposal: BrokenReferenceProposal
  busy: boolean
  busyAction: string | null
  replacements: Record<string, string>
  onReplacementChange: (key: string, value: string) => void
  onApprove: (proposal: BrokenReferenceProposal) => void
  onRemove: (proposal: BrokenReferenceProposal) => void
  onCreate: (proposal: BrokenReferenceProposal) => void
  documents: WorkspaceAgentSearchableDocument[] | null
  onLoadDocuments: () => void
}) {
  const [query, setQuery] = useState("")

  useEffect(() => {
    onLoadDocuments()
    setQuery("")
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reload the picker's document list for the newly active proposal
  }, [proposal.sourceDocumentId, proposal.reference])

  const key = replacementKey(messageId, proposal)
  const isSlug = proposal.referenceKind === "slug"
  const evidence = proposal.evidence.find((item) => item.quote) ?? proposal.evidence[0]
  const selected = replacements[key] ?? proposal.suggestedReference ?? ""

  const matches = useMemo(() => {
    if (!documents) return []
    const trimmed = query.trim().toLowerCase()
    const pool = trimmed
      ? documents.filter((document) => document.title.toLowerCase().includes(trimmed))
      : documents
    return pool.slice(0, 6)
  }, [documents, query])

  const selectDocument = (document: WorkspaceAgentSearchableDocument) => {
    onReplacementChange(key, document.path ?? document.id)
  }

  return (
    <div className="flex h-full gap-0">
      <div className="ml-4 flex min-w-0 flex-1 flex-col overflow-hidden rounded-[12px] bg-sb shadow-[0_1px_2px_rgba(35,24,15,0.05)]">
        <div className="shrink-0 border-b-[0.5px] border-[#F0EEEB] px-[34px] pb-[18px] pt-[26px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-5">Referencia rota en</p>
          <h2 className="mt-2.5 truncate text-[28px] font-medium leading-[1.12] tracking-[-0.02em] text-ink">{proposal.sourceTitle}</h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-[34px] pb-8 pt-[26px]">
          <div className="max-w-[620px]">
            <p className="text-[15px] leading-[1.85] text-ink-2">
              {evidence?.quote
                ? renderHighlightedQuote(evidence.quote, proposal.reference)
                : <>Este documento referencia <span className="rounded-[5px] bg-[#FAEDE4] px-[5px] py-px font-mono text-[#96532C] shadow-[0_0_0_1px_#E4C4AC]">{proposal.reference}</span>, que no existe en el workspace.</>}
            </p>
            <div className="mt-[22px] flex max-w-[440px] items-center gap-2.5 rounded-[10px] border-[0.5px] border-[#E4C4AC] bg-[#FDF8F4] px-3 py-2.5">
              <Link2Off className="h-4 w-4 shrink-0 text-[#96532C]" strokeWidth={1.5} />
              <p className="text-[12px] leading-[1.4] text-[#6B5F57]">
                Apunta a <b className="font-mono font-normal text-[#96532C]">{proposal.reference}</b> — no existe.
              </p>
            </div>
            {evidence?.line ? (
              <p className="mt-3 font-mono text-[11px] text-ink-5">línea {evidence.line}{evidence.detail ? ` · ${evidence.detail}` : ""}</p>
            ) : null}
          </div>
        </div>
      </div>

      <div className="flex w-[336px] shrink-0 flex-col overflow-y-auto px-5 pb-1 pt-[26px]">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Enlace roto</p>
          <div className="mt-2.5 rounded-[9px] border-[0.5px] border-border bg-sb px-3 py-2.5">
            <p className="break-all font-mono text-[12px] text-[#96532C]">{proposal.reference}</p>
            <p className="mt-1.5 text-[12px] leading-[1.4] text-ink-4">
              {proposal.candidateTitle ? `Coincidencia sugerida: ${proposal.candidateTitle}.` : "Ningún artifact tiene ese nombre."}
            </p>
          </div>
        </div>

        <div className="mt-[22px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">Apuntar a</p>
          <div className="mt-2.5 flex h-[38px] items-center gap-2 rounded-[9px] border-[0.5px] border-border bg-sb px-2.5">
            <Search className="h-4 w-4 shrink-0 text-ink-5" strokeWidth={1.5} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar un artifact…"
              aria-label="Buscar un artifact"
              className="h-full w-full bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-5"
            />
          </div>
          <div className="mt-2 flex flex-col gap-1.5">
            {matches.map((document) => {
              const value = document.path ?? document.id
              const isSelected = selected === value
              return (
                <button
                  key={document.id}
                  type="button"
                  onClick={() => selectDocument(document)}
                  className={cn(
                    "flex items-center gap-2.5 rounded-[9px] border px-2.5 py-2.5 text-left transition-colors",
                    isSelected ? "border-ink" : "border-[0.5px] border-border hover:border-[#CFC9C1]",
                  )}
                >
                  <FileText className="h-4 w-4 shrink-0 text-ink-4" strokeWidth={1.5} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[12.5px] font-medium text-ink">{document.title}</p>
                    {document.id === proposal.candidateDocumentId ? <p className="mt-0.5 text-[11px] text-ink-4">Coincidencia más cercana</p> : null}
                  </div>
                  {isSelected ? <CheckCircle2 className="h-[17px] w-[17px] shrink-0 text-ink" strokeWidth={1.5} /> : null}
                </button>
              )
            })}
          </div>
          <button
            type="button"
            disabled={busy || !selected.trim()}
            onClick={() => onApprove(proposal)}
            className="mt-2.5 flex h-[38px] w-full items-center justify-center gap-1.5 rounded-[9px] bg-ink text-[13px] font-medium text-bg transition-colors hover:bg-[#3F3731] disabled:opacity-50"
          >
            <LinkIcon className="h-4 w-4" strokeWidth={1.5} /> Apuntar el enlace aquí
          </button>
        </div>

        <div className="mt-[22px]">
          <p className="text-[10px] font-semibold uppercase tracking-[0.11em] text-ink-4">O bien</p>
          <div className="mt-2.5 flex flex-col gap-2">
            {!isSlug ? (
              <button
                type="button"
                disabled={busyAction === "create-broken-link-doc"}
                onClick={() => onCreate(proposal)}
                className="flex h-9 items-center justify-center gap-2 rounded-[9px] border-[0.5px] border-border bg-sb text-[13px] font-medium text-[#3F3731] transition-colors hover:border-[#B5ADA5] disabled:opacity-50"
              >
                <FileText className="h-4 w-4 text-ink-4" strokeWidth={1.5} /> Crear el documento faltante
              </button>
            ) : null}
            <button
              type="button"
              disabled={busyAction === "remove-broken-link"}
              onClick={() => onRemove(proposal)}
              className="flex h-9 items-center justify-center gap-2 rounded-[9px] border-[0.5px] border-border bg-sb text-[13px] font-medium text-[#3F3731] transition-colors hover:border-[#B5ADA5] disabled:opacity-50"
            >
              <Link2Off className="h-4 w-4 text-ink-4" strokeWidth={1.5} /> Quitar el enlace del texto
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
