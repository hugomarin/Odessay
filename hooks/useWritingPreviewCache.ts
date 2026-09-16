"use client"

import { useCallback, useRef } from "react"
import type { JSONContent } from "@tiptap/core"
import { renderWritingBodyHtml } from "@/lib/reading/render-body-html-client"
import { hasLocalImageSources, resolveLocalImageSources } from "@/lib/reading/resolve-local-image-sources"
import { getDesktopWritingCanonicalPath, getDocumentService } from "@/lib/services/document-service-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import {
  extractWritingAnnotationNodes,
  type WritingAnnotationNode,
} from "@/lib/editor/footnote-extension"
import type {
  WritingLifecycle,
  WritingRecord,
  WritingVisibility,
} from "@/lib/services/contracts/document-service"
import type { WritingStatus } from "@/lib/writings/status"

export type CachedWritingPreview = {
  id: string
  title: string
  bodyHtml: string
  bodyText: string
  status: WritingStatus
  updatedAt: string
  createdAt: string
  contentUpdatedAt: string
  wordCount: number
  annotations: WritingAnnotationNode[]
  lifecycle: WritingLifecycle
  visibility: WritingVisibility
  /** blob: URLs created to display local images — revoke when evicted. */
  objectUrls: string[]
}

const buildTitle = (value: string | null | undefined) => {
  const trimmed = value?.trim()
  return trimmed?.length ? trimmed : "Untitled writing"
}

const buildWordCount = (bodyText: string) => {
  const trimmed = bodyText.trim()
  return trimmed ? trimmed.split(/\s+/).length : 0
}

export function useWritingPreviewCache() {
  const cache = useRef<Map<string, CachedWritingPreview>>(new Map())
  const pending = useRef<Map<string, Promise<CachedWritingPreview | null>>>(new Map())

  const getCachedPreview = useCallback((id: string) => cache.current.get(id) ?? null, [])

  const fetchPreview = useCallback(async (id: string): Promise<CachedWritingPreview | null> => {
    const cached = cache.current.get(id)
    if (cached) {
      return cached
    }

    const inFlight = pending.current.get(id)
    if (inFlight) {
      return inFlight
    }

    const request = (async () => {
      const result = await (await getDocumentService()).openWriting(id)
      const writing = result.data
      if (!writing || writing.deletedAt) {
        return null
      }

      const bodyJson = (writing.content.richText ?? { type: "doc", content: [] }) as JSONContent
      const bodyText = writing.content.plainText
      const { bodyHtml: renderedHtml } = renderWritingBodyHtml(bodyJson, bodyText, {
        onRichRenderError: (message) =>
          console.warn(`[writing-preview] rich render failed for ${id}, falling back:`, message),
      })

      // The live editor resolves local image sources itself, per image, via
      // a NodeView — this read-only render goes straight to an HTML string,
      // so nothing else ever resolves them. Desktop-only, matching the
      // editor's own gating (web can't read local files at all).
      let bodyHtml = renderedHtml
      let objectUrls: string[] = []
      if (isDesktopRuntime() && hasLocalImageSources(renderedHtml)) {
        const documentPath = await getDesktopWritingCanonicalPath(id)
        if (documentPath) {
          const resolved = await resolveLocalImageSources(renderedHtml, documentPath)
          bodyHtml = resolved.html
          objectUrls = resolved.objectUrls
        }
      }

      const updatedAt = writing.updatedAt || writing.createdAt
      const preview: CachedWritingPreview = {
        id: writing.id,
        title: buildTitle(writing.title),
        bodyHtml,
        bodyText,
        status: writing.status,
        updatedAt,
        createdAt: writing.createdAt,
        contentUpdatedAt: writing.contentUpdatedAt || updatedAt,
        wordCount: buildWordCount(bodyText),
        annotations: extractWritingAnnotationNodes(bodyJson),
        lifecycle: writing.lifecycle ?? inferLifecycle(writing),
        visibility: writing.visibility,
        objectUrls,
      }

      cache.current.set(id, preview)
      return preview
    })().finally(() => {
      pending.current.delete(id)
    })

    pending.current.set(id, request)
    return request
  }, [])

  const prefetchPreview = useCallback(
    (id: string) => {
      void fetchPreview(id)
    },
    [fetchPreview],
  )

  const retainOnly = useCallback((ids: string[]) => {
    const allowed = new Set(ids)
    for (const [id, cached] of cache.current) {
      if (!allowed.has(id)) {
        for (const objectUrl of cached.objectUrls) URL.revokeObjectURL(objectUrl)
        cache.current.delete(id)
      }
    }
  }, [])

  const clear = useCallback(() => {
    for (const cached of cache.current.values()) {
      for (const objectUrl of cached.objectUrls) URL.revokeObjectURL(objectUrl)
    }
    cache.current.clear()
    pending.current.clear()
  }, [])

  const updatePreviewTitle = useCallback((id: string, title: string) => {
    const cached = cache.current.get(id)
    if (!cached) {
      return
    }

    cache.current.set(id, { ...cached, title: buildTitle(title) })
  }, [])

  return { fetchPreview, getCachedPreview, prefetchPreview, retainOnly, clear, updatePreviewTitle }
}

function inferLifecycle(writing: WritingRecord): WritingLifecycle {
  return writing.authorId ? "server-confirmed" : "local-only"
}
