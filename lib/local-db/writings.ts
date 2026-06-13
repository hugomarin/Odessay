import type { LocalWriting, WritingListFilters } from "@/lib/local-db/schema";

const byNewestCreatedAt = (left: LocalWriting, right: LocalWriting) =>
  new Date(right.created_at).getTime() - new Date(left.created_at).getTime();

export const sortWritings = (writings: LocalWriting[]) => writings.sort(byNewestCreatedAt);

export const filterWritings = (
  writings: LocalWriting[],
  filters: WritingListFilters = {},
) =>
  writings.filter((writing) => {
    if (!filters.includeDeleted && writing.sync_status === "deleted") {
      return false;
    }

    if (filters.syncStatus && writing.sync_status !== filters.syncStatus) {
      return false;
    }

    return true;
  });
