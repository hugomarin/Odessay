"use client"

import { useCallback, useRef } from "react"
import type { JSONContent } from "@tiptap/core"
import { localDB } from "@/lib/local-db"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html-client"
import type { WritingStatus } from "@/lib/writings/status"

export type CachedWritingPreview = {
  id: string
  title: string
  bodyHtml: string
  bodyText: string
  status: WritingStatus
  updatedAt: string
}

const buildTitle = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed?.length ? trimmed : "Untitled writing"
}

export function useWritingPreviewCache() {
  const cache = useRef<Map<string, CachedWritingPreview>>(new Map())

  const fetchPreview = useCallback(async (id: string): Promise<CachedWritingPreview | null> => {
    const cached = cache.current.get(id)
    if (cached) {
      return cached
    }

    const writing = await localDB.writings.get(id)
    if (!writing || writing.sync_status === "deleted") {
      return null
    }

    const { bodyHtml } = renderWritingBodyHtml(writing.body_json as JSONContent, writing.body_text)
    const preview: CachedWritingPreview = {
      id: writing.id,
      title: buildTitle(writing.title),
      bodyHtml,
      bodyText: writing.body_text,
      status: writing.status,
      updatedAt: writing.updated_at || writing.created_at,
    }

    cache.current.set(id, preview)
    return preview
  }, [])

  const prefetchPreview = useCallback(
    (id: string) => {
      void fetchPreview(id)
    },
    [fetchPreview],
  )

  const retainOnly = useCallback((ids: string[]) => {
    const allowed = new Set(ids)
    for (const id of cache.current.keys()) {
      if (!allowed.has(id)) {
        cache.current.delete(id)
      }
    }
  }, [])

  const clear = useCallback(() => {
    cache.current.clear()
  }, [])

  return { fetchPreview, prefetchPreview, retainOnly, clear }
}
