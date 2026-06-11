#!/usr/bin/env node
/**
 * Linear CLI para Artifact Studio — GraphQL directo
 * Script simple para interactuar con Linear desde skills del agente.
 *
 * Uso:
 *   node scripts/linear-cli.mjs get ODE-42
 *   node scripts/linear-cli.mjs comment ODE-42 "Review aprobado"
 *   node scripts/linear-cli.mjs move ODE-42 "In Review"
 *   node scripts/linear-cli.mjs list ODE --limit 10
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Load env ──
function loadEnv(path) {
  try {
    const text = readFileSync(resolve(path), 'utf-8');
    for (const line of text.split('\n')) {
      const m = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {}
}

loadEnv('.env.local');

const API_KEY = process.env.LINEAR_API_KEY;
if (!API_KEY) {
  console.error(JSON.stringify({ error: 'LINEAR_API_KEY not found in .env.local' }));
  process.exit(1);
}

const LINEAR_API = 'https://api.linear.app/graphql';

async function gql(query, variables = {}) {
  const res = await fetch(LINEAR_API, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': API_KEY,
    },
    body: JSON.stringify({ query, variables }),
  });
  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map(e => e.message).join('; '));
  }
  return json.data;
}

// ── Helpers ──
async function issueByIdentifier(identifier) {
  const [teamKey, numberStr] = identifier.split('-');
  if (!teamKey || !numberStr) throw new Error(`Invalid identifier: ${identifier}`);

  const data = await gql(`
    query($teamKey: String!, $number: Float!) {
      issues(filter: { team: { key: { eq: $teamKey } }, number: { eq: $number } }) {
        nodes {
          id
          identifier
          title
          description
          url
          createdAt
          updatedAt
          state { id name }
          assignee { id name email }
          comments { nodes { id } }
        }
      }
    }
  `, { teamKey, number: parseInt(numberStr, 10) });

  const issue = data.issues.nodes[0];
  if (!issue) throw new Error(`Issue ${identifier} not found`);
  return issue;
}

async function teamByKey(key) {
  const data = await gql(`
    query($key: String!) {
      teams(filter: { key: { eq: $key } }) {
        nodes { id name key states { nodes { id name } } }
      }
    }
  `, { key });
  const team = data.teams.nodes[0];
  if (!team) throw new Error(`Team ${key} not found`);
  return team;
}

// ── Commands ──
const COMMANDS = {
  async get(identifier) {
    const issue = await issueByIdentifier(identifier);
    return {
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      state: issue.state?.name || null,
      assignee: issue.assignee?.name || issue.assignee?.email || null,
      url: issue.url,
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      commentCount: issue.comments?.nodes?.length || 0,
    };
  },

  async comment(identifier, ...textParts) {
    const text = textParts.join(' ');
    if (!text) throw new Error('Comment text required');
    const issue = await issueByIdentifier(identifier);
    const data = await gql(`
      mutation($input: CommentCreateInput!) {
        commentCreate(input: $input) {
          success
          comment { id }
        }
      }
    `, { input: { issueId: issue.id, body: text } });
    return { success: data.commentCreate.success, commentId: data.commentCreate.comment?.id || null };
  },

  async move(identifier, stateName) {
    const issue = await issueByIdentifier(identifier);
    const teamKey = identifier.split('-')[0];
    const team = await teamByKey(teamKey);
    const state = team.states.nodes.find(s => s.name.toLowerCase() === stateName.toLowerCase());
    if (!state) {
      const available = team.states.nodes.map(s => s.name).join(', ');
      throw new Error(`State "${stateName}" not found. Available: ${available}`);
    }
    const data = await gql(`
      mutation($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue { id identifier state { name } }
        }
      }
    `, { id: issue.id, input: { stateId: state.id } });
    return { success: data.issueUpdate.success, newState: data.issueUpdate.issue.state.name };
  },

  async list(teamKey, flags = {}) {
    const team = await teamByKey(teamKey);
    const limit = flags.limit ? parseInt(flags.limit) : 20;
    const data = await gql(`
      query($teamId: ID!, $first: Int!) {
        issues(filter: { team: { id: { eq: $teamId } } }, first: $first) {
          nodes {
            id
            identifier
            title
            state { name }
            assignee { name email }
            url
          }
        }
      }
    `, { teamId: team.id, first: limit });
    return {
      team: team.name,
      count: data.issues.nodes.length,
      issues: data.issues.nodes.map(i => ({
        identifier: i.identifier,
        title: i.title,
        state: i.state?.name || null,
        assignee: i.assignee?.name || null,
        url: i.url,
      })),
    };
  },
};

// ── Parse args ──
const [cmd, ...rest] = process.argv.slice(2);
if (!COMMANDS[cmd]) {
  console.error(JSON.stringify({
    error: `Unknown command: ${cmd}`,
    usage: 'node scripts/linear-cli.mjs <get|comment|move|list> [args...]',
  }));
  process.exit(1);
}

const flags = {};
const args = rest.filter(arg => {
  const m = arg.match(/^--(\w+)=(.*)$/);
  if (m) { flags[m[1]] = m[2]; return false; }
  return true;
});

COMMANDS[cmd](...args, flags)
  .then(result => console.log(JSON.stringify(result, null, 2)))
  .catch(err => {
    console.error(JSON.stringify({ error: err.message }));
    process.exit(1);
  });
