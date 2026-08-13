/**
 * Correction package sizing and engine revision.
 *
 * ODE-415: analyses are manual and full-document. The application splits the
 * eligible blocks into token-bounded packages; the route validates each package.
 */

/** Engine revision that must be stored with every cacheable result.
 *  Results from a different revision are not admitted as current suggestions. */
export const CORRECTION_ENGINE_REVISION = "mechanical-corrections-v2:qwen3p7-plus";

/** Legacy constant kept for backwards compatibility in tests and single-block
 *  legacy routes. Manual analysis uses the token-bounded packer instead. */
export const CORRECTION_BLOCK_BATCH_SIZE = 5;
export const BLOCK_CORRECTIONS_MAX_TOKENS = 768;

/** Maximum number of blocks in a single provider package. */
export const CORRECTION_PACKAGE_MAX_BLOCKS = 25;

/** Maximum characters for a single package (prompt body, approximate). */
export const CORRECTION_PACKAGE_MAX_CHARS = 8_000;

/** Maximum characters for an individual block. Blocks that exceed this limit
 *  are skipped from analysis with a deterministic rule documented in the
 *  packaging module, so they cannot cause an unbounded request. */
export const CORRECTION_PACKAGE_MAX_BLOCK_CHARS = 4_000;

/** Estimated input-token budget per package (prompt + blocks + overhead).
 *  Used by the frontend packer and enforced by the route. */
export const CORRECTION_PACKAGE_MAX_INPUT_TOKENS = 2_048;

/** Output-token budget per package. The model returns only minimal corrections,
 *  so a modest cap keeps requests cheap and fast. */
export const CORRECTION_PACKAGE_OUTPUT_TOKENS = 512;

/** Rough chars-per-token heuristic for mixed Spanish/English prose. */
export const CORRECTION_CHARS_PER_TOKEN_ESTIMATE = 3.8;
