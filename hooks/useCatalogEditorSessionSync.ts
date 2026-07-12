"use client"

import { useEffect } from "react"
import { getDocumentCatalog } from "@/lib/services/document-catalog-factory"
import { subscribeToCatalog } from "@/lib/queries/document-catalog"
import { emitCatalogTitleChange } from "@/lib/events/catalog-title-events"
import {
  initializeEditorSessionStore,
  syncWritingTitlesFromCatalog,
} from "@/lib/stores/editor-session-store"

const CATALOG_SESSION_SYNC_DELAY_MS = 75

/**
 * Keeps editor-session presentation metadata aligned with DocumentCatalog.
 * Catalog bursts are coalesced so one filesystem transaction produces at most
 * one session persistence write, even when several documents changed.
 */
export function useCatalogEditorSessionSync() {
  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null
    const pendingDocumentIds = new Set<string>()

    const syncTitles = async (documentIds?: string[]) => {
      await initializeEditorSessionStore()
      const catalog = await getDocumentCatalog()
      const records = documentIds
        ? await Promise.all(documentIds.map((documentId) => catalog.getById(documentId)))
        : await catalog.list()

      if (cancelled) {
        return
      }

      const titles = new Map<string, string>()
      records.forEach((record) => {
        const title = record?.title?.trim()
        if (record && title) {
          titles.set(record.id, title)
        }
      })
      syncWritingTitlesFromCatalog(titles)
      emitCatalogTitleChange(titles)
    }

    void syncTitles()

    const unsubscribe = subscribeToCatalog((change) => {
      change.documentIds.forEach((documentId) => pendingDocumentIds.add(documentId))
      if (timer) {
        clearTimeout(timer)
      }
      timer = setTimeout(() => {
        timer = null
        const documentIds = [...pendingDocumentIds]
        pendingDocumentIds.clear()
        void syncTitles(documentIds)
      }, CATALOG_SESSION_SYNC_DELAY_MS)
    })

    return () => {
      cancelled = true
      if (timer) {
        clearTimeout(timer)
      }
      unsubscribe()
    }
  }, [])
}
