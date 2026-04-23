import type {
  CollectionVisibility,
  LocalCollection,
  LocalWriting,
  LocalWritingCollection,
} from "@/lib/local-db/schema";
import { calculateSelectionMetrics } from "@/lib/editor/text-metrics";

export const UNCATEGORIZED_COLLECTION_ID = "uncategorized";

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

export type CollectionOption = {
  id: string;
  name: string;
};

export type CollectionDetailWritingItem = {
  id: string;
  title: string;
  excerpt: string;
  wordCount: number;
  status: LocalWriting["status"];
  updatedAt: string;
  otherCollections: CollectionOption[];
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

const buildExcerpt = (bodyText: string) => {
  const normalized = bodyText.replace(/\s+/g, " ").trim();

  if (!normalized) {
    return "No content yet.";
  }

  return normalized.length > 160 ? `${normalized.slice(0, 157)}...` : normalized;
};

const buildWritingTitle = (title: string | null | undefined) => {
  const trimmed = title?.trim();
  return trimmed?.length ? trimmed : "Untitled writing";
};

export const buildCollectionOptions = (collections: LocalCollection[]): CollectionOption[] =>
  collections
    .filter((collection) => collection.sync_status !== "deleted")
    .map((collection) => ({
      id: collection.id,
      name: collection.name,
    }))
    .sort((left, right) => left.name.localeCompare(right.name, "en", { sensitivity: "base" }));

export const buildCollectionDetailItems = ({
  collectionId,
  writings,
  collections,
  assignments,
}: {
  collectionId: string;
  writings: LocalWriting[];
  collections: LocalCollection[];
  assignments: LocalWritingCollection[];
}): CollectionDetailWritingItem[] => {
  const activeWritings = writings.filter((writing) => writing.sync_status !== "deleted");
  const optionById = new Map(buildCollectionOptions(collections).map((option) => [option.id, option]));
  const collectionIdsByWritingId = new Map<string, string[]>();

  for (const assignment of assignments) {
    const nextIds = collectionIdsByWritingId.get(assignment.writing_id) ?? [];
    nextIds.push(assignment.collection_id);
    collectionIdsByWritingId.set(assignment.writing_id, nextIds);
  }

  return activeWritings
    .filter((writing) => {
      const assignedCollectionIds = collectionIdsByWritingId.get(writing.id) ?? [];

      if (collectionId === UNCATEGORIZED_COLLECTION_ID) {
        return assignedCollectionIds.length === 0;
      }

      return assignedCollectionIds.includes(collectionId);
    })
    .map((writing) => {
      const assignedCollectionIds = collectionIdsByWritingId.get(writing.id) ?? [];
      const otherCollections = assignedCollectionIds
        .filter((assignedCollectionId) =>
          collectionId === UNCATEGORIZED_COLLECTION_ID
            ? true
            : assignedCollectionId !== collectionId,
        )
        .map((assignedCollectionId) => optionById.get(assignedCollectionId))
        .filter((option): option is CollectionOption => Boolean(option));

      return {
        id: writing.id,
        title: buildWritingTitle(writing.title),
        excerpt: buildExcerpt(writing.body_text),
        wordCount: calculateSelectionMetrics(writing.body_text).words,
        status: writing.status,
        updatedAt: writing.updated_at,
        otherCollections,
      };
    })
    .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
