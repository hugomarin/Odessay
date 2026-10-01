export type PrecheckViolation = {
  sha: string
  rule:
    | "test-commit-touches-production"
    | "it-fails-with-production"
    | "it-fails-flip-edits-test"
    | "map-row-cell-count"
    | "map-status-note-contradiction"
  detail: string
}

export type PrecheckCommit = {
  sha: string
  subject: string
  files: string[]
  testPatches: Record<string, string>
}

export const CAPABILITY_MAP_PATH: string
export function isTestPath(path: string): boolean
export function isDocPath(path: string): boolean
export function isProductionPath(path: string): boolean
export function commitType(subject: string): string | null
export function diffLines(patch: string): { removed: string[]; added: string[] }
export function checkCommit(commit: PrecheckCommit): PrecheckViolation[]
export function tableCells(line: string): string[]
export function checkCapabilityMap(text: string, changedLines: Set<string>): PrecheckViolation[]
