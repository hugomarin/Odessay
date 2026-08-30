"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { MoreHorizontal, PenSquare, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { getWritingStatusLabel, isOpenWritingStatus, type WritingStatus } from "@/lib/writings/status"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

type PublicCollectionListItem = {
  id: string
  name: string
  writingIds: string[]
}

type PublicWritingListItem = {
  id: string
  title: string | null
  bodyText: string
  updatedAt: string
  visibility: "private" | "shared" | "public"
  status: WritingStatus
  slug: string | null
  version: number
}

type PublicWritingListProps = {
  username: string
  isOwner: boolean
  writings: PublicWritingListItem[]
  collections: PublicCollectionListItem[]
}

type ViewMode = "all" | "public"

function formatRelativeDate(isoDate: string): string {
  const date = new Date(isoDate)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24))

  if (diffDays <= 0) return "Today"
  if (diffDays === 1) return "Yesterday"
  if (diffDays < 7) return `${diffDays} days ago`
  if (diffDays < 30) return `${Math.floor(diffDays / 7)} week${Math.floor(diffDays / 7) === 1 ? "" : "s"} ago`
  if (diffDays < 365) return `${Math.floor(diffDays / 30)} month${Math.floor(diffDays / 30) === 1 ? "" : "s"} ago`
  return `${Math.floor(diffDays / 365)} year${Math.floor(diffDays / 365) === 1 ? "" : "s"} ago`
}

function buildExcerpt(bodyText: string, maxWords = 100): string {
  const words = bodyText.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return "No content yet."
  if (words.length <= maxWords) return words.join(" ")
  return `${words.slice(0, maxWords).join(" ")}…`
}

function capitalize(value: string): string {
  if (!value) return value
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`
}

export function PublicWritingList({ username, isOwner, writings, collections }: PublicWritingListProps) {
  const router = useRouter()
  const [viewMode, setViewMode] = useState<ViewMode>(isOwner ? "all" : "public")
  const [items, setItems] = useState<PublicWritingListItem[]>(writings)
  const [isDeletingId, setIsDeletingId] = useState<string | null>(null)

  const displayedWritings = useMemo(() => {
    if (!isOwner || viewMode === "public") {
      return items.filter((writing) => writing.visibility === "public")
    }
    return items
  }, [isOwner, items, viewMode])

  async function handleSoftDelete(writingId: string) {
    const target = items.find((writing) => writing.id === writingId)
    if (!target) return

    const confirmed = window.confirm("Are you sure you want to delete this artifact?")
    if (!confirmed) return

    setIsDeletingId(writingId)

    const nowIso = new Date().toISOString()
    const response = await fetch(`/api/writings/${writingId}`, {
      method: "DELETE",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version: target.version + 1,
        updated_at: nowIso,
        deleted_at: nowIso,
      }),
    })

    setIsDeletingId(null)

    if (!response.ok) {
      window.alert("Could not delete this artifact right now.")
      return
    }

    setItems((previous) => previous.filter((writing) => writing.id !== writingId))
    router.refresh()
  }

  return (
    <div
      id="public-writing-list"
      data-section="public-writing-list"
      data-testid="public-writing-list"
      className="PublicWritingList mx-auto flex w-full max-w-[720px] flex-col gap-8 sm:gap-10"
    >
      {isOwner ? (
        <div className="flex justify-center">
          <div className="inline-flex items-center gap-1 rounded-lg bg-muted p-1">
            <button
              type="button"
              onClick={() => setViewMode("all")}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "all"
                  ? "bg-bg text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              All my content
            </button>
            <button
              type="button"
              onClick={() => setViewMode("public")}
              className={`rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors ${
                viewMode === "public"
                  ? "bg-bg text-ink shadow-sm"
                  : "text-ink-3 hover:text-ink-2"
              }`}
            >
              As others see me
            </button>
          </div>
        </div>
      ) : null}

      {collections.length > 0 ? (
      <section
        id="public-collections"
        data-section="public-collections"
        className="PublicCollections flex flex-col gap-2 sm:gap-3"
      >
        {collections.map((collection) => {
          const visibleCount = collection.writingIds.filter((writingId) => {
            const writing = items.find((candidate) => candidate.id === writingId)

            if (!writing) {
              return false
            }

            if (!isOwner || viewMode === "public") {
              return writing.visibility === "public"
            }

            return true
          }).length

          if (visibleCount === 0) {
            return null
          }

          return (
            <div key={collection.id} className="flex items-center gap-3">
              <span className="text-[13px] text-ink-2 sm:text-[14px]">{collection.name}</span>
              <span className="h-1 w-1 rounded-full bg-ink-4" />
              <span className="text-[12px] text-ink-4 sm:text-[13px]">{visibleCount} writings</span>
            </div>
          )
        })}
      </section>
      ) : null}

      <section
        id="public-writings"
        data-section="public-writings"
        className="PublicWritings flex flex-col gap-6 sm:gap-8"
      >
        {displayedWritings.length === 0 ? (
          <p className="py-12 text-center font-lora text-[15px] italic text-ink-3">
            Nothing here yet.
          </p>
        ) : (
          displayedWritings.map((writing) => {
            const href =
              writing.visibility === "public" && writing.slug
                ? `/${username}/${writing.slug}`
                : buildWritingRouteHref("/write", writing)

            return (
              <article key={writing.id} className="group relative">
                <div className="flex items-start justify-between gap-4">
                  <Link href={href} className="flex min-w-0 flex-1 flex-col gap-2">
                    <h2 className="font-lora text-[17px] font-medium leading-tight text-ink sm:text-[18px]">
                      {writing.title ?? "Untitled"}
                    </h2>
                    <p className="line-clamp-3 text-[14px] leading-relaxed text-ink-2 sm:text-[15px]">
                      {buildExcerpt(writing.bodyText)}
                    </p>

                    <div className="mt-1 flex items-center gap-2.5">
                      <span className="text-[12px] text-ink-4 sm:text-[13px]">{formatRelativeDate(writing.updatedAt)}</span>
                      {isOwner && viewMode === "all" ? (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-ink sm:text-[12px]">
                          {capitalize(writing.visibility)}
                        </span>
                      ) : null}
                      {isOwner && viewMode === "all" && isOpenWritingStatus(writing.status) ? (
                        <span className="text-[11px] italic text-ink-4 sm:text-[12px]">
                          {getWritingStatusLabel(writing.status)}
                        </span>
                      ) : null}
                    </div>
                  </Link>

                  {isOwner && viewMode === "all" ? (
                    <div className="opacity-0 transition-opacity group-hover:opacity-100">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-ink-3 hover:text-ink"
                            aria-label="Artifact actions"
                          >
                            <MoreHorizontal className="h-4 w-4" strokeWidth={1.5} />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-40 rounded-xl border-[0.5px] border-border bg-bg shadow-float">
                        <DropdownMenuItem asChild className="m-1 cursor-pointer rounded-lg text-[13px] text-ink-2 focus:bg-muted">
                            <Link href={buildWritingRouteHref("/write", writing)}>
                              <PenSquare className="mr-2 h-4 w-4" strokeWidth={1.5} />
                              Editar
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            disabled={isDeletingId === writing.id}
                            className="m-1 cursor-pointer rounded-lg text-[13px] text-destructive focus:bg-destructive/10 focus:text-destructive"
                            onSelect={(event) => {
                              event.preventDefault()
                              void handleSoftDelete(writing.id)
                            }}
                          >
                            <Trash2 className="mr-2 h-4 w-4" strokeWidth={1.5} />
                            Eliminar
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })
        )}
      </section>
    </div>
  )
}
