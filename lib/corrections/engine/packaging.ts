import {
  CORRECTION_CHARS_PER_TOKEN_ESTIMATE,
  CORRECTION_PACKAGE_MAX_BLOCKS,
  CORRECTION_PACKAGE_MAX_BLOCK_CHARS,
  CORRECTION_PACKAGE_MAX_CHARS,
  CORRECTION_PACKAGE_MAX_INPUT_TOKENS,
  CORRECTION_PACKAGE_OUTPUT_TOKENS,
} from "@/lib/ai/corrections-config";

export type PackageableBlock = {
  id: string;
  text: string;
  hash: string;
};

export type CorrectionPackage<T extends PackageableBlock = PackageableBlock> = {
  blocks: T[];
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
};

export type PackagedBlocksResult<T extends PackageableBlock = PackageableBlock> = {
  packages: CorrectionPackage<T>[];
  skippedBlocks: T[];
  skippedReasons: Map<string, string>;
};

export type PackageCorrectionBlocksOptions = {
  /** Hard ceiling on blocks per package. */
  maxBlocksPerPackage?: number;
  /** Hard ceiling on characters in the package body (block texts + ids). */
  maxCharsPerPackage?: number;
  /** Hard ceiling on characters for an individual block. */
  maxBlockChars?: number;
  /** Input-token budget used for the provider prompt. */
  maxInputTokens?: number;
  /** Output-token budget reserved for the provider response. */
  outputTokens?: number;
  /** Fixed prompt overhead in characters (system prompt + schema + instructions). */
  promptOverheadChars?: number;
  /** Additional overhead per block in characters (id wrapper + delimiter). */
  blockOverheadChars?: number;
  /** Chars-per-token estimator. */
  charsPerToken?: number;
};

const DEFAULT_PROMPT_OVERHEAD_CHARS = 1_600;
const DEFAULT_BLOCK_OVERHEAD_CHARS = 32;

/**
 * Estimate the input tokens for a list of blocks plus fixed prompt overhead.
 * This is intentionally conservative so we do not exceed provider context.
 */
export const estimatePackageTokens = (
  blocks: ReadonlyArray<PackageableBlock>,
  options?: Omit<PackageCorrectionBlocksOptions, "maxBlocksPerPackage" | "maxBlockChars">,
): number => {
  const promptOverheadChars = options?.promptOverheadChars ?? DEFAULT_PROMPT_OVERHEAD_CHARS;
  const blockOverheadChars = options?.blockOverheadChars ?? DEFAULT_BLOCK_OVERHEAD_CHARS;
  const charsPerToken = options?.charsPerToken ?? CORRECTION_CHARS_PER_TOKEN_ESTIMATE;

  const bodyChars = blocks.reduce(
    (sum, block) => sum + block.text.length + block.id.length + blockOverheadChars,
    0,
  );

  return Math.ceil((promptOverheadChars + bodyChars) / charsPerToken);
};

/**
 * Split correction blocks into token-bounded packages.
 *
 * Rules:
 * 1. Blocks whose text exceeds `maxBlockChars` are deterministically skipped
 *    and reported in `skippedBlocks` / `skippedReasons`.
 * 2. Each package respects `maxBlocksPerPackage`, `maxCharsPerPackage` and
 *    `maxInputTokens` (estimated prompt + body tokens).
 * 3. Greedy first-fit keeps package count low.
 * 4. Output tokens are reserved per package so the route can size `max_tokens`.
 */
export const packageCorrectionBlocks = <T extends PackageableBlock>(
  blocks: ReadonlyArray<T>,
  options?: PackageCorrectionBlocksOptions,
): PackagedBlocksResult<T> => {
  const maxBlocksPerPackage = options?.maxBlocksPerPackage ?? CORRECTION_PACKAGE_MAX_BLOCKS;
  const maxCharsPerPackage = options?.maxCharsPerPackage ?? CORRECTION_PACKAGE_MAX_CHARS;
  const maxBlockChars = options?.maxBlockChars ?? CORRECTION_PACKAGE_MAX_BLOCK_CHARS;
  const maxInputTokens = options?.maxInputTokens ?? CORRECTION_PACKAGE_MAX_INPUT_TOKENS;
  const outputTokens = options?.outputTokens ?? CORRECTION_PACKAGE_OUTPUT_TOKENS;
  const promptOverheadChars = options?.promptOverheadChars ?? DEFAULT_PROMPT_OVERHEAD_CHARS;
  const blockOverheadChars = options?.blockOverheadChars ?? DEFAULT_BLOCK_OVERHEAD_CHARS;
  const charsPerToken = options?.charsPerToken ?? CORRECTION_CHARS_PER_TOKEN_ESTIMATE;

  const packages: CorrectionPackage<T>[] = [];
  const skippedBlocks: T[] = [];
  const skippedReasons = new Map<string, string>();

  let currentPackage: T[] = [];
  let currentBodyChars = 0;

  const flushCurrentPackage = () => {
    if (currentPackage.length === 0) {
      return;
    }

    packages.push({
      blocks: currentPackage,
      estimatedInputTokens: estimatePackageTokens(currentPackage, {
        promptOverheadChars,
        blockOverheadChars,
        charsPerToken,
      }),
      estimatedOutputTokens: outputTokens,
    });

    currentPackage = [];
    currentBodyChars = 0;
  };

  for (const block of blocks) {
    if (block.text.length > maxBlockChars) {
      skippedBlocks.push(block);
      skippedReasons.set(
        block.id,
        `block exceeds max characters (${block.text.length} > ${maxBlockChars})`,
      );
      continue;
    }

    const blockChars = block.text.length + block.id.length + blockOverheadChars;
    const nextBodyChars = currentBodyChars + blockChars;
    const nextInputTokens = Math.ceil((promptOverheadChars + nextBodyChars) / charsPerToken);

    const wouldExceedBlocks = currentPackage.length >= maxBlocksPerPackage;
    const wouldExceedChars = nextBodyChars > maxCharsPerPackage;
    const wouldExceedTokens = nextInputTokens > maxInputTokens;

    if (wouldExceedBlocks || wouldExceedChars || wouldExceedTokens) {
      flushCurrentPackage();
    }

    currentPackage.push(block);
    currentBodyChars += blockChars;
  }

  flushCurrentPackage();

  return { packages, skippedBlocks, skippedReasons };
};
