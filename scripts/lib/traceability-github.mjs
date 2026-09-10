const COMPARE_PAGE_SIZE = 100;
const MAX_COMPARE_PAGES = 50;

/**
 * Returns every commit subject in one immutable GitHub comparison.
 *
 * CI uses this instead of the runner's local revision walk because the
 * synthetic PR checkout can expose a graph that disagrees with GitHub's own
 * comparison after a force-push/history rewrite. Pagination and the final
 * count check prevent a large PR from being accepted from a partial response.
 */
export async function githubCompareCommitSubjects({
  repository,
  base,
  head,
  token = "",
  fetchImpl = fetch,
}) {
  const subjects = [];
  let expectedCommits = null;

  for (let page = 1; page <= MAX_COMPARE_PAGES; page += 1) {
    const url = new URL(
      `https://api.github.com/repos/${repository}/compare/${encodeURIComponent(base)}...${encodeURIComponent(head)}`,
    );
    url.searchParams.set("per_page", String(COMPARE_PAGE_SIZE));
    url.searchParams.set("page", String(page));

    const response = await fetchImpl(url, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "odessay-delivery-gate",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!response.ok) {
      throw new Error(`GitHub compare API failed with ${response.status}.`);
    }

    const comparison = await response.json();
    if (!Array.isArray(comparison.commits)) {
      throw new Error("GitHub compare API returned no commit list.");
    }
    if (expectedCommits === null) {
      if (!Number.isInteger(comparison.total_commits) || comparison.total_commits < 0) {
        throw new Error("GitHub compare API returned an invalid total_commits value.");
      }
      expectedCommits = comparison.total_commits;
    }

    subjects.push(
      ...comparison.commits.map((entry) => entry.commit.message.split("\n")[0]),
    );
    if (subjects.length >= expectedCommits) {
      return subjects.slice(0, expectedCommits);
    }
    if (comparison.commits.length === 0) {
      throw new Error(
        `GitHub compare API returned only ${subjects.length} of ${expectedCommits} commits.`,
      );
    }
  }

  throw new Error(
    `GitHub compare API exceeded ${MAX_COMPARE_PAGES} pages before returning every commit.`,
  );
}
