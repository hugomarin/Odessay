"use client"

import { useEffect, useMemo, useState } from "react";
import { initializeEditorSessionStore, useEditorSessionStore } from "@/lib/stores/editor-session-store";
import { subscribeToEditorSessionChanges } from "@/lib/editor/session-persistence";
import type { DocumentCatalogRecord } from "@/lib/services/contracts/document-catalog";
import { loadCatalogRecords, subscribeToCatalog } from "@/lib/queries/document-catalog";

export type RecentWritingItem = {
  writingId: string;
  slug: string | null;
  title: string;
  updatedAt: number;
  isOpen: boolean;
};

/**
 * Recent writings read from the shared DocumentCatalog (ODE-373). Identity,
 * title and slug come from the catalog rather than a direct IndexedDB read, so
 * Recent, Search, Desk and Workspace all resolve the same UUID and metadata. The
 * editor session still supplies recency ordering and open-tab state.
 */
export function useRecentWritings(limit = 8) {
  const [records, setRecords] = useState<DocumentCatalogRecord[]>([]);
  const { session } = useEditorSessionStore();

  useEffect(() => {
    void initializeEditorSessionStore();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const next = await loadCatalogRecords();
      if (cancelled) {
        return;
      }

      setRecords(next);
    };

    void load();

    const unsubscribeCatalog = subscribeToCatalog(() => void load());
    const unsubscribeSession = subscribeToEditorSessionChanges(() => void load());

    return () => {
      cancelled = true;
      unsubscribeCatalog();
      unsubscribeSession();
    };
  }, []);

  const openWritingIds = useMemo(
    () => new Set(session.tabs.flatMap((tab) => (tab.writing_id ? [tab.writing_id] : []))),
    [session.tabs],
  );

  return useMemo(() => {
    const byId = new Map(records.map((record) => [record.id, record]));
    const items = session.recent_writings
      .map((entry) => {
        const record = byId.get(entry.writing_id);
        if (!record) {
          return null;
        }

        return {
          writingId: record.id,
          slug: record.slug ?? entry.slug ?? null,
          title: entry.title || record.title?.trim() || "Untitled writing",
          updatedAt: Math.max(entry.last_touched_at, record.modifiedAt ?? 0),
          isOpen: openWritingIds.has(record.id),
        } satisfies RecentWritingItem;
      })
      .filter((item): item is RecentWritingItem => Boolean(item));

    for (const record of records) {
      if (items.some((item) => item.writingId === record.id)) {
        continue;
      }

      items.push({
        writingId: record.id,
        slug: record.slug ?? null,
        title: record.title?.trim() || "Untitled writing",
        updatedAt: record.modifiedAt ?? 0,
        isOpen: openWritingIds.has(record.id),
      });
    }

    return items
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
  }, [limit, openWritingIds, session.recent_writings, records]);
}
