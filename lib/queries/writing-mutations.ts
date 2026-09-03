"use client";

import {
  createLocalCollection,
  getWritingForEdit,
  setLocalWritingCollections,
} from "@/lib/queries/desk-catalog-source";
import { getDocumentService } from "@/lib/services/document-service-factory";
import { enqueueWritingDelete, enqueueWritingUpsert } from "@/lib/sync/queue";
import { getSyncService } from "@/lib/sync";
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection";
import {
  dedupeCollectionIds,
  getWritingCollectionIds,
} from "@/lib/collections/collections";
import type { LocalWriting, LocalWritingCollection } from "@/lib/local-db/schema";
import type { ArtifactType } from "@/lib/writings/artifact-type";
import type { WritingStatus } from "@/lib/writings/status";

const UNTITLED_DOCUMENT_NAME = "Untitled artifact";

function nowIso() {
  return new Date().toISOString();
}

export async function changeWritingStatus(
  writingId: string,
  status: WritingStatus,
) {
  const writing = await getWritingForEdit(writingId);
  if (!writing || writing.sync_status === "deleted") {
    return;
  }
  if (writing.status === status) {
    return;
  }

  const updatedAt = nowIso();
  const result = await (await getDocumentService()).updateWritingMetadata({
    writingId,
    status,
    version: writing.version + 1,
    updatedAt,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function changeWritingArtifactType(
  writingId: string,
  artifactType: ArtifactType,
) {
  const writing = await getWritingForEdit(writingId);
  if (!writing || writing.sync_status === "deleted") {
    return;
  }
  if (writing.artifact_type === artifactType) {
    return;
  }

  const updatedAt = nowIso();
  const result = await (await getDocumentService()).updateWritingMetadata({
    writingId,
    artifactType,
    version: writing.version + 1,
    updatedAt,
  });
  if (result.error) throw new Error(result.error.message);
}

export async function renameWriting(writingId: string, title: string): Promise<boolean> {
  const writing = await getWritingForEdit(writingId);
  if (!writing || writing.sync_status === "deleted") {
    return false;
  }

  const trimmedTitle = title.trim() || UNTITLED_DOCUMENT_NAME;
  if ((writing.title?.trim() || UNTITLED_DOCUMENT_NAME) === trimmedTitle) {
    return true;
  }

  const timestamp = nowIso();

  if (isDesktopRuntime()) {
    const result = await (
      await getDocumentService()
    ).renameWriting({
      writingId: writing.id,
      title: trimmedTitle,
      updatedAt: timestamp,
    });
    return !result.error;
  }

  const next: LocalWriting = {
    ...writing,
    title: trimmedTitle,
    version: writing.version + 1,
    updated_at: timestamp,
    content_updated_at: timestamp,
    local_updated_at: Date.now(),
  };

  await enqueueWritingUpsert(next);
  return true;
}

export async function deleteWriting(writingId: string) {
  await enqueueWritingDelete(writingId);
}

export async function toggleWritingCollection(
  writingId: string,
  collectionId: string,
  writingCollections: LocalWritingCollection[],
) {
  const currentIds = getWritingCollectionIds(writingId, writingCollections);
  const nextIds = currentIds.includes(collectionId)
    ? currentIds.filter((id) => id !== collectionId)
    : [...currentIds, collectionId];

  await setLocalWritingCollections(
    writingId,
    dedupeCollectionIds(nextIds),
  );
  void getSyncService().scheduleFlush();
}

export async function createAndAssignCollection(
  writingId: string,
  name: string,
  ownerId: string | null,
  writingCollections: LocalWritingCollection[],
) {
  const collection = await createLocalCollection({ ownerId, name });
  const currentIds = getWritingCollectionIds(writingId, writingCollections);
  await setLocalWritingCollections(
    writingId,
    dedupeCollectionIds([...currentIds, collection.id]),
  );
  void getSyncService().scheduleFlush();
}

export async function bulkChangeStatus(
  writingIds: Iterable<string>,
  status: WritingStatus,
) {
  const writings = (await Promise.all([...writingIds].map(getWritingForEdit)))
    .filter((writing): writing is LocalWriting => Boolean(writing && writing.sync_status !== "deleted" && writing.status !== status));
  if (writings.length === 0) return;
  const updatedAt = nowIso();
  const result = await (await getDocumentService()).updateWritingsMetadata({
    updates: writings.map((writing) => ({ writingId: writing.id, status, version: writing.version + 1, updatedAt })),
  });
  if (result.error) throw new Error(result.error.message);
}

export async function bulkChangeArtifactType(
  writingIds: Iterable<string>,
  artifactType: ArtifactType,
) {
  const writings = (await Promise.all([...writingIds].map(getWritingForEdit)))
    .filter((writing): writing is LocalWriting => Boolean(writing && writing.sync_status !== "deleted" && writing.artifact_type !== artifactType));
  if (writings.length === 0) return;
  const updatedAt = nowIso();
  const result = await (await getDocumentService()).updateWritingsMetadata({
    updates: writings.map((writing) => ({ writingId: writing.id, artifactType, version: writing.version + 1, updatedAt })),
  });
  if (result.error) throw new Error(result.error.message);
}

export async function bulkAddToCollection(
  writingIds: Iterable<string>,
  collectionId: string,
  writingCollections: LocalWritingCollection[],
) {
  for (const writingId of writingIds) {
    const currentIds = getWritingCollectionIds(writingId, writingCollections);
    if (currentIds.includes(collectionId)) {
      continue;
    }
    await setLocalWritingCollections(
      writingId,
      dedupeCollectionIds([...currentIds, collectionId]),
    );
  }
  void getSyncService().scheduleFlush();
}

export async function bulkCreateCollection(
  writingIds: Iterable<string>,
  name: string,
  ownerId: string | null,
  writingCollections: LocalWritingCollection[],
) {
  const collection = await createLocalCollection({ ownerId, name });
  for (const writingId of writingIds) {
    const currentIds = getWritingCollectionIds(writingId, writingCollections);
    await setLocalWritingCollections(
      writingId,
      dedupeCollectionIds([...currentIds, collection.id]),
    );
  }
  void getSyncService().scheduleFlush();
}

export async function bulkDelete(writingIds: Iterable<string>) {
  for (const writingId of writingIds) {
    await deleteWriting(writingId);
  }
}
