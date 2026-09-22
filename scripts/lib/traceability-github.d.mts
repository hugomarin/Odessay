export type GitHubCompareCommitSubjectsOptions = {
  repository: string
  base: string
  head: string
  token?: string
  fetchImpl?: (input: URL, init?: RequestInit) => Promise<Response>
}

export function githubCompareCommitSubjects(
  options: GitHubCompareCommitSubjectsOptions,
): Promise<string[]>
