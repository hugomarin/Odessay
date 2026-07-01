import { localDB } from "@/lib/local-db";
import type { LocalCorrectionBlock, PublicationSuggestion } from "@/lib/local-db/schema";
import { getAIService } from "@/lib/services/ai-service-factory";
import {
  DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
  findLogicalStaleCorrectionBlocks,
  parseCorrectionBlockLogicalId,
  parseCorrectionBlockPosition,
  partitionHydratedCorrectionBlocks,
  type CurrentCorrectionBlockIdentity,
  type PersistedCorrectionBlockIdentity,
} from "@/lib/corrections/block-invalidation";

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
export { DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW, parseCorrectionBlockLogicalId, parseCorrectionBlockPosition }

export const createCorrectionBlockRecordId = (writingId: string, blockHash: string) =>
  `auto-correction:${writingId}:${blockHash}`;

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

export const findStaleCorrectionBlockRecords = (
  candidates: PersistedCorrectionBlockIdentity[],
  current: CurrentCorrectionBlockIdentity,
  positionWindow = DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
) => findLogicalStaleCorrectionBlocks(candidates, current, positionWindow)

export const reconcileHydratedCorrectionBlocks = (
  blocks: LocalCorrectionBlock[],
  currentBlockHashes: Iterable<string>,
) => partitionHydratedCorrectionBlocks(blocks, currentBlockHashes)

const isAuthRelatedError = (error: unknown) => {
  const status = (error as CorrectionPersistenceError | null | undefined)?.status;
  const code = (error as CorrectionPersistenceError | null | undefined)?.code;
  return status === 401 || status === 403 || code === "UNAUTHORIZED" || code === "FORBIDDEN";
};

const isNotFoundError = (error: unknown) => {
  const status = (error as CorrectionPersistenceError | null | undefined)?.status;
  const code = (error as CorrectionPersistenceError | null | undefined)?.code;
  return status === 404 || code === "NOT_FOUND";
};

async function shouldUseRemoteCorrectionPersistence(
  writingId: string,
): Promise<{ allowed: boolean; reason?: string }> {
  const localWriting = await localDB.writings.get(writingId);

  if (!localWriting) {
    return { allowed: false, reason: "no local writing" };
  }

  if (localWriting.lifecycle === "local-only") {
    return { allowed: false, reason: "local-only lifecycle" };
  }

  if (localWriting.lifecycle === "syncing") {
    return { allowed: false, reason: "syncing lifecycle" };
  }

  return { allowed: true };
}

const inFlightCorrectionHydrations = new Map<string, Promise<LocalCorrectionBlock[]>>();

export const hydrateCorrectionBlocksFromRemote = (writingId: string): Promise<LocalCorrectionBlock[]> => {
  const existing = inFlightCorrectionHydrations.get(writingId);

  if (existing) {
    return existing;
  }

  const promise = (async () => {
    const lifecycleCheck = await shouldUseRemoteCorrectionPersistence(writingId);

    if (!lifecycleCheck.allowed) {
      console.info(`[corrections:hydrate] skipped remote hydration for ${writingId}: ${lifecycleCheck.reason}`);
      return [];
    }

    try {
      const result = await getAIService().hydrateCorrectionBlocks(writingId);

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
      if (isNotFoundError(error)) {
        console.info(`[corrections:hydrate] remote writing not found for ${writingId}; treating as empty.`);
        return [];
      }

      if (isAuthRelatedError(error)) {
        console.warn(`[corrections:hydrate] auth failure for ${writingId}; degrading to empty.`);
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
  const effectiveWritingId = writingId ?? block?.writingId;

  if (!effectiveWritingId) {
    return;
  }

  const lifecycleCheck = await shouldUseRemoteCorrectionPersistence(effectiveWritingId);
  if (!lifecycleCheck.allowed) {
    console.info(
      `[corrections:persist] skipped remote persist for ${effectiveWritingId}: ${lifecycleCheck.reason}`,
    );
    return;
  }

  try {
    const result = await getAIService().persistCorrectionBlock({
      writingId: effectiveWritingId,
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
    if (isAuthRelatedError(error)) {
      console.warn(`[corrections:persist] auth failure for ${effectiveWritingId}; skipping remote persist.`);
      return;
    }

    if (isNotFoundError(error)) {
      console.info(`[corrections:persist] remote writing not found for ${effectiveWritingId}; skipping remote persist.`);
      return;
    }

    throw error;
  }
};
