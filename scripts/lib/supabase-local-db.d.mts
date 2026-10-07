export function runLocalPsql(
  dbUrl: string | undefined,
  sql: string,
  options?: { cwd?: string },
): { output: string; via: string }

export function findMutationArtifacts(dbUrl: string | undefined, options?: { cwd?: string }): string[]
