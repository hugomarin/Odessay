"use client"

import { useState } from "react"
import Link from "next/link"
import { ChevronDown, Globe, Lock, Pencil, Trash2 } from "lucide-react"
import type { LocalCollection } from "@/lib/local-db/schema"
import type { CollectionWritingItem } from "@/lib/collections/collections"
import { cn } from "@/lib/utils"

type CollectionItemProps = {
  collection: LocalCollection
  writings: CollectionWritingItem[]
  expanded: boolean
  onToggle: () => void
  onSave: (updates: {
    name: string
    description: string
    visibility: LocalCollection["visibility"]
  }) => Promise<void>
  onDelete: () => Promise<void>
}

export function CollectionItem({
  collection,
  writings,
  expanded,
  onToggle,
  onSave,
  onDelete,
}: CollectionItemProps) {
  const [isEditing, setIsEditing] = useState(false)
  const [name, setName] = useState(collection.name)
  const [description, setDescription] = useState(collection.description ?? "")
  const [visibility, setVisibility] = useState(collection.visibility)

  return (
    <article className="overflow-hidden rounded-[10px] border-[0.5px] border-border bg-sb">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-ink-4 transition-transform duration-200",
              expanded ? "rotate-180" : "rotate-0",
            )}
            strokeWidth={1.5}
          />
          <div className="min-w-0">
            <p className="truncate text-[13px] font-medium text-ink">{collection.name}</p>
            <p className="mt-1 text-[11px] text-ink-4">
              {writings.length} writings
              {" · "}
              {collection.visibility === "public" ? "Visible in public author space" : "Private"}
            </p>
          </div>
        </button>

        <button
          type="button"
          onClick={() => setIsEditing((value) => !value)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-muted hover:text-ink"
          aria-label="Edit collection"
        >
          <Pencil className="h-4 w-4" strokeWidth={1.5} />
        </button>
        <button
          type="button"
          onClick={() => void onDelete()}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-muted hover:text-[hsl(0_72%_45%)]"
          aria-label="Delete collection"
        >
          <Trash2 className="h-4 w-4" strokeWidth={1.5} />
        </button>
      </div>

      {isEditing ? (
        <div className="border-t-[0.5px] border-border bg-bg px-4 py-4">
          <div className="grid gap-3 md:grid-cols-[1fr_auto]">
            <div className="space-y-3">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-9 w-full rounded-md border-[0.5px] border-border bg-sb px-3 text-[13px] text-ink outline-none"
              />
              <textarea
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                rows={2}
                className="w-full rounded-md border-[0.5px] border-border bg-sb px-3 py-2 text-[13px] text-ink outline-none"
              />
            </div>
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setVisibility("private")}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] px-3 text-[12px] font-medium transition-colors",
                  visibility === "private"
                    ? "border-ink bg-ink text-bg"
                    : "border-border bg-sb text-ink-3 hover:bg-muted hover:text-ink",
                )}
              >
                <Lock className="h-3.5 w-3.5" strokeWidth={1.5} />
                Private
              </button>
              <button
                type="button"
                onClick={() => setVisibility("public")}
                className={cn(
                  "inline-flex h-8 items-center gap-2 rounded-md border-[0.5px] px-3 text-[12px] font-medium transition-colors",
                  visibility === "public"
                    ? "border-ink bg-ink text-bg"
                    : "border-border bg-sb text-ink-3 hover:bg-muted hover:text-ink",
                )}
              >
                <Globe className="h-3.5 w-3.5" strokeWidth={1.5} />
                Public
              </button>
              <button
                type="button"
                onClick={() => {
                  void onSave({ name, description, visibility })
                  setIsEditing(false)
                }}
                className="mt-auto h-8 rounded-md bg-cursor px-3 text-[12px] font-medium text-bg transition-opacity hover:opacity-90"
              >
                Save
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {expanded ? (
        <div className="border-t-[0.5px] border-border">
          {writings.length === 0 ? (
            <p className="px-10 py-5 text-[13px] text-ink-4">
              No writings in this collection yet.
            </p>
          ) : (
            <div className="divide-y divide-border/70">
              {writings.map((writing) => (
                <Link
                  key={writing.id}
                  href={`/write/${writing.id}`}
                  className="block px-10 py-4 transition-colors hover:bg-muted/60"
                >
                  <p className="font-lora text-[14px] font-medium text-ink">
                    {writing.title ?? "Untitled"}
                  </p>
                  <p className="mt-1 line-clamp-1 text-[12px] text-ink-3">
                    {writing.bodyText.trim() || "No content yet."}
                  </p>
                  <p className="mt-2 text-[11px] text-ink-4">
                    {writing.status === "finished" ? "Done" : "Draft"}
                  </p>
                </Link>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </article>
  )
}
