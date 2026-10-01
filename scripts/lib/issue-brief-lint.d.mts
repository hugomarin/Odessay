export const ARCHITECTURE_CONTRACT_FIELDS: string[]
export function architectureContractSection(description: string): string | null
export function lintIssueBrief(
  description: string,
  comments?: string[],
  options?: { requireRecon?: boolean },
): string[]
