import { localDB } from "@/lib/local-db";
import type { LocalCorrectionBlock, PublicationSuggestion } from "@/lib/local-db/schema";
import { webAIService } from "@/lib/services/web-ai-service";

type CorrectionPersistenceError = Error & {
  status?: number;
  code?: string | null;
  url?: string;
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

const isIgnorableCorrectionPersistenceError = (error: unknown) => {
  const status = (error as CorrectionPersistenceError | null | undefined)?.status;
  const code = (error as CorrectionPersistenceError | null | undefined)?.code;
  return status === 401 || status === 403 || code === "UNAUTHORIZED" || code === "FORBIDDEN";
};

const inFlightCorrectionHydrations = new Map<string, Promise<LocalCorrectionBlock[]>>();

export const hydrateCorrectionBlocksFromRemote = (writingId: string): Promise<LocalCorrectionBlock[]> => {
  const existing = inFlightCorrectionHydrations.get(writingId);

  if (existing) {
    return existing;
  }

  const promise = (async () => {
    try {
      const result = await webAIService.hydrateCorrectionBlocks(writingId);

      if (result.error || !result.data) {
        const error: CorrectionPersistenceError = new Error(result.error?.message ?? "Could not hydrate correction blocks.");
        error.code = result.error?.code ?? "UNAVAILABLE";
        error.status = result.error?.code === "UNAUTHORIZED" ? 401 : undefined;
        throw error;
      }

      const records = result.data.map((block) => ({
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
      }));
      const localBlocks = records.map((record) => mapPersistedCorrectionRecordToLocal(record));

      await localDB.correctionBlocks.saveMany(localBlocks);
      await localDB.correctionBlocks.evictOldestWriting(CORRECTION_BLOCK_CACHE_LIMIT);

      return localBlocks;
    } catch (error) {
      if (isIgnorableCorrectionPersistenceError(error)) {
        return [];
      }

      throw error;
    }
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
  try {
    const result = await webAIService.persistCorrectionBlock({
      writingId: writingId ?? block?.writingId,
      block: block
        ? {
            id: block.id,
            writingId: block.writingId,
            blockId: block.blockId,
            blockHash: block.blockHash,
            suggestions: block.suggestions,
            model: block.model,
            createdAt: block.createdAt,
            latencyMs: block.latencyMs,
            promptTokens: block.promptTokens,
            completionTokens: block.completionTokens,
            syncedAt: block.syncedAt,
          }
        : undefined,
      deletedBlockIds,
    });

    if (result.error || !result.data) {
      const error: CorrectionPersistenceError = new Error(result.error?.message ?? "Could not persist correction blocks.");
      error.code = result.error?.code ?? "UNAVAILABLE";
      error.status = result.error?.code === "UNAUTHORIZED" ? 401 : undefined;
      throw error;
    }

    if (block && result.data.persistedId) {
      await localDB.correctionBlocks.markSynced(result.data.persistedId, result.data.syncedAt);
    }

    if (result.data.deletedIds.length > 0) {
      await localDB.correctionBlocks.deleteMany(result.data.deletedIds);
    }
  } catch (error) {
    if (isIgnorableCorrectionPersistenceError(error)) {
      return;
    }

    throw error;
  }
};
