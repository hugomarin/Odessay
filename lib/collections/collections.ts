import type {
  CollectionVisibility,
  LocalCollection,
  LocalWriting,
  LocalWritingCollection,
} from "@/lib/local-db/schema";

export type CollectionSummary = {
  id: string;
  name: string;
  description: string | null;
  visibility: CollectionVisibility;
  writingsCount: number;
  updatedAt: string;
};

export type CollectionWritingItem = {
  id: string;
  title: string | null;
  bodyText: string;
  status: LocalWriting["status"];
  visibility: LocalWriting["visibility"];
  updatedAt: string;
};

export const getWritingCollectionIds = (
  writingId: string,
  assignments: LocalWritingCollection[],
) =>
  assignments
    .filter((assignment) => assignment.writing_id === writingId)
    .map((assignment) => assignment.collection_id);

export const getUncategorizedWritings = (
  writings: LocalWriting[],
  assignments: LocalWritingCollection[],
) => {
  const assignedWritingIds = new Set(assignments.map((assignment) => assignment.writing_id));

  return writings.filter(
    (writing) =>
      writing.sync_status !== "deleted" && !assignedWritingIds.has(writing.id),
  );
};

export const buildCollectionSummaries = (
  collections: LocalCollection[],
  writings: LocalWriting[],
  assignments: LocalWritingCollection[],
) => {
  const activeWritings = writings.filter((writing) => writing.sync_status !== "deleted");
  const writingById = new Map(activeWritings.map((writing) => [writing.id, writing]));
  const counts = new Map<string, number>();

  for (const assignment of assignments) {
    if (writingById.has(assignment.writing_id)) {
      counts.set(
        assignment.collection_id,
        (counts.get(assignment.collection_id) ?? 0) + 1,
      );
    }
  }

  return collections
    .filter((collection) => collection.sync_status !== "deleted")
    .map(
      (collection): CollectionSummary => ({
        id: collection.id,
        name: collection.name,
        description: collection.description ?? null,
        visibility: collection.visibility,
        writingsCount: counts.get(collection.id) ?? 0,
        updatedAt: collection.updated_at,
      }),
    )
    .sort((left, right) => {
      if (right.writingsCount !== left.writingsCount) {
        return right.writingsCount - left.writingsCount;
      }

      return right.updatedAt.localeCompare(left.updatedAt);
    });
};

export const buildCollectionWritingMap = (
  writings: LocalWriting[],
  assignments: LocalWritingCollection[],
) => {
  const writingById = new Map(
    writings
      .filter((writing) => writing.sync_status !== "deleted")
      .map((writing) => [writing.id, writing] as const),
  );
  const rows = new Map<string, CollectionWritingItem[]>();

  for (const assignment of assignments) {
    const writing = writingById.get(assignment.writing_id);

    if (!writing) {
      continue;
    }

    const items = rows.get(assignment.collection_id) ?? [];
    items.push({
      id: writing.id,
      title: writing.title ?? null,
      bodyText: writing.body_text,
      status: writing.status,
      visibility: writing.visibility,
      updatedAt: writing.updated_at,
    });
    rows.set(assignment.collection_id, items);
  }

  for (const items of rows.values()) {
    items.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  return rows;
};

export const dedupeCollectionIds = (collectionIds: string[]) =>
  Array.from(new Set(collectionIds.filter(Boolean)));
