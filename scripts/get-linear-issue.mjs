#!/usr/bin/env node

import { linearGraphQL } from "./lib/linear-client.mjs";

const ISSUE_QUERY = `
  query Issue($id: String!) {
    issue(id: $id) {
      id
      identifier
      title
      description
      url
      state {
        name
      }
      assignee {
        name
      }
      project {
        name
      }
      priorityLabel
    }
  }
`;

async function main() {
  const identifier = process.argv[2]?.trim();

  if (!identifier) {
    console.error("Usage: node scripts/get-linear-issue.mjs <ISSUE_ID>");
    process.exit(1);
  }

  const data = await linearGraphQL(ISSUE_QUERY, {
    variables: { id: identifier },
  });

  if (!data?.issue) {
    console.error(`Issue not found: ${identifier}`);
    process.exit(1);
  }

  console.log(JSON.stringify(data.issue, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
