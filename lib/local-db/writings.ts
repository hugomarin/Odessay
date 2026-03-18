import type { LocalWriting, WritingListFilters } from "@/lib/local-db/schema";

const byNewestLocalUpdate = (left: LocalWriting, right: LocalWriting) =>
  right.local_updated_at - left.local_updated_at;

export const sortWritings = (writings: LocalWriting[]) => writings.sort(byNewestLocalUpdate);

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
