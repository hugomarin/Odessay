"use client"

import { useEffect, useMemo, useState } from "react";
import { initializeEditorSessionStore, useEditorSessionStore } from "@/lib/stores/editor-session-store";
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db";
import { subscribeToEditorSessionChanges } from "@/lib/editor/session-persistence";
import type { LocalWriting } from "@/lib/local-db/schema";

export type RecentWritingItem = {
  writingId: string;
  slug: string | null;
  title: string;
  updatedAt: number;
  isOpen: boolean;
};

const toTimestamp = (value: string | null | undefined) => {
  if (!value) {
    return 0;
  }

  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
};

export function useRecentWritings(limit = 8) {
  const [writings, setWritings] = useState<LocalWriting[]>([]);
  const { session } = useEditorSessionStore();

  useEffect(() => {
    void initializeEditorSessionStore();
  }, []);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      const nextWritings = await localDB.writings.getAll();
      if (cancelled) {
        return;
      }

      setWritings(nextWritings);
    };

    void load();

    const unsubscribeScope = subscribeToLocalDBScopeChanges(() => void load());
    const unsubscribeSession = subscribeToEditorSessionChanges(() => void load());

    return () => {
      cancelled = true;
      unsubscribeScope();
      unsubscribeSession();
    };
  }, []);

  const openWritingIds = useMemo(
    () => new Set(session.tabs.flatMap((tab) => (tab.writing_id ? [tab.writing_id] : []))),
    [session.tabs],
  );

  return useMemo(() => {
    const byId = new Map(writings.map((writing) => [writing.id, writing]));
    const items = session.recent_writings
      .map((entry) => {
        const writing = byId.get(entry.writing_id);
        if (!writing || writing.sync_status === "deleted") {
          return null;
        }

        return {
          writingId: writing.id,
          slug: writing.slug ?? entry.slug ?? null,
          title: entry.title || writing.title?.trim() || "Untitled writing",
          updatedAt: Math.max(entry.last_touched_at, writing.local_updated_at, toTimestamp(writing.updated_at)),
          isOpen: openWritingIds.has(writing.id),
        } satisfies RecentWritingItem;
      })
      .filter((item): item is RecentWritingItem => Boolean(item));

    for (const writing of writings) {
      if (writing.sync_status === "deleted" || items.some((item) => item.writingId === writing.id)) {
        continue;
      }

      items.push({
        writingId: writing.id,
        slug: writing.slug ?? null,
        title: writing.title?.trim() || "Untitled writing",
        updatedAt: Math.max(writing.local_updated_at, toTimestamp(writing.updated_at)),
        isOpen: openWritingIds.has(writing.id),
      });
    }

    return items
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, limit);
  }, [limit, openWritingIds, session.recent_writings, writings]);
}
