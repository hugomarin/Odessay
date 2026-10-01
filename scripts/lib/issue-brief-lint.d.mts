export const ARCHITECTURE_CONTRACT_FIELDS: string[]
export function fieldValue(text: string, field: string): string | null
export function architectureContractSection(description: string): string | null
export function lintIssueBrief(
  description: string,
  comments?: string[],
  options?: { requireRecon?: boolean; requireContract?: boolean },
): string[]
