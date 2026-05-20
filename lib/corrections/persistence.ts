import { localDB } from "@/lib/local-db";
import type { LocalCorrectionBlock, PublicationSuggestion } from "@/lib/local-db/schema";

type ApiEnvelope<T> = {
  data: T;
  error: { code: string; message: string } | null;
};

export type PersistedCorrectionBlockRecord = {
  id: string;
  writing_id: string;
  block_id: string;
  block_hash: string;
  suggestions: PublicationSuggestion[];
  model: string;
  created_at: string;
  latency_ms: number | null;
  prompt_tokens: number | null;
  completion_tokens: number | null;
};

export const CORRECTION_BLOCK_CACHE_LIMIT = 20;

export const createCorrectionBlockRecordId = (writingId: string, blockHash: string) =>
  `auto-correction:${writingId}:${blockHash}`;

export const parseCorrectionBlockPosition = (blockId: string) => {
  const parts = blockId.split(":");
  const rawPosition = parts.at(-1);
  const position = rawPosition ? Number.parseInt(rawPosition, 10) : Number.NaN;
  return Number.isFinite(position) ? position : null;
};

export const mapPersistedCorrectionRecordToLocal = (
  record: PersistedCorrectionBlockRecord,
  syncedAt = record.created_at,
): LocalCorrectionBlock => ({
  id: record.id,
  writingId: record.writing_id,
  blockId: record.block_id,
  blockHash: record.block_hash,
  suggestions: record.suggestions,
  model: record.model,
  createdAt: record.created_at,
  latencyMs: record.latency_ms,
  promptTokens: record.prompt_tokens,
  completionTokens: record.completion_tokens,
  syncedAt,
});

export const mapLocalCorrectionBlockToPersistedRecord = (
  block: LocalCorrectionBlock,
): PersistedCorrectionBlockRecord => ({
  id: block.id,
  writing_id: block.writingId,
  block_id: block.blockId,
  block_hash: block.blockHash,
  suggestions: block.suggestions,
  model: block.model,
  created_at: block.createdAt,
  latency_ms: block.latencyMs,
  prompt_tokens: block.promptTokens,
  completion_tokens: block.completionTokens,
});

const parseEnvelope = async <T>(response: Response): Promise<T> => {
  const envelope = (await response.json()) as ApiEnvelope<T>;

  if (!response.ok || envelope.error) {
    throw new Error(envelope.error?.message ?? `Request failed with status ${response.status}.`);
  }

  return envelope.data;
};

const inFlightCorrectionHydrations = new Map<string, Promise<LocalCorrectionBlock[]>>();

export const hydrateCorrectionBlocksFromRemote = (writingId: string): Promise<LocalCorrectionBlock[]> => {
  const existing = inFlightCorrectionHydrations.get(writingId);

  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const response = await fetch(`/api/corrections/hydrate?writingId=${encodeURIComponent(writingId)}`, {
      method: "GET",
      cache: "no-store",
    });
    const records = await parseEnvelope<PersistedCorrectionBlockRecord[]>(response);
    const localBlocks = records.map((record) => mapPersistedCorrectionRecordToLocal(record));

    await localDB.correctionBlocks.saveMany(localBlocks);
    await localDB.correctionBlocks.evictOldestWriting(CORRECTION_BLOCK_CACHE_LIMIT);

    return localBlocks;
  })().finally(() => {
    inFlightCorrectionHydrations.delete(writingId);
  });

  inFlightCorrectionHydrations.set(writingId, promise);
  return promise;
};

export const persistCorrectionBlockRemotely = async ({
  writingId,
  block,
  deletedBlockIds = [],
}: {
  writingId?: string;
  block?: LocalCorrectionBlock;
  deletedBlockIds?: string[];
}) => {
  const payload = await parseEnvelope<{
    persistedId: string | null;
    deletedIds: string[];
    syncedAt: string;
  }>(
    await fetch("/api/corrections/persist", {
      method: "POST",
      headers: {
        "content-type": "application/json",
      },
      body: JSON.stringify({
        writingId: writingId ?? block?.writingId,
        block: block ? mapLocalCorrectionBlockToPersistedRecord(block) : undefined,
        deletedBlockIds,
      }),
    }),
  );

  if (block && payload.persistedId) {
    await localDB.correctionBlocks.markSynced(payload.persistedId, payload.syncedAt);
  }

  if (payload.deletedIds.length > 0) {
    await localDB.correctionBlocks.deleteMany(payload.deletedIds);
  }
};
