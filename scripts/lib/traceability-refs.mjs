import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export function commitExists(commit) {
  if (!commit) return false;
  try {
    execFileSync("git", ["cat-file", "-e", `${commit}^{commit}`], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export function hasRef(ref) {
  if (!ref) return false;
  try {
    execFileSync("git", ["rev-parse", "--verify", ref], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

export function pullRequestShas(eventPath = process.env.GITHUB_EVENT_PATH) {
  if (!eventPath?.trim()) return null;
  try {
    const event = JSON.parse(readFileSync(eventPath, "utf8"));
    const base = event?.pull_request?.base?.sha;
    const head = event?.pull_request?.head?.sha;
    if (!commitExists(base) || !commitExists(head)) return null;
    return { base, head, source: "pull-request-event" };
  } catch {
    return null;
  }
}

/**
 * Resolve one immutable comparison range for the whole Traceability job.
 * ODE-466: CI pins these SHAs immediately after checking out the PR merge ref;
 * every later gate must prefer them over mutable names such as origin/main.
 * Local runs retain the historical branch-ref fallback.
 */
export function resolveTraceabilityRange(env = process.env) {
  const pinnedBase = env.TRACEABILITY_BASE_SHA?.trim();
  const pinnedHead = env.TRACEABILITY_HEAD_SHA?.trim();
  if (pinnedBase || pinnedHead) {
    if (!pinnedBase || !pinnedHead) {
      throw new Error(
        "TRACEABILITY_BASE_SHA and TRACEABILITY_HEAD_SHA must be set together.",
      );
    }
    if (!commitExists(pinnedBase) || !commitExists(pinnedHead)) {
      throw new Error("Pinned traceability SHAs are not available as commits.");
    }
    return { base: pinnedBase, head: pinnedHead, source: "pinned-environment" };
  }

  const eventRange = pullRequestShas(env.GITHUB_EVENT_PATH);
  if (eventRange) return eventRange;

  const baseFromCi = env.GITHUB_BASE_REF?.trim();
  if (baseFromCi) {
    const remoteRef = `origin/${baseFromCi}`;
    if (hasRef(remoteRef)) return { base: remoteRef, head: "HEAD", source: "ci-branch" };
    if (hasRef(baseFromCi)) return { base: baseFromCi, head: "HEAD", source: "ci-branch" };
  }
  if (hasRef("origin/main")) return { base: "origin/main", head: "HEAD", source: "local-fallback" };
  if (hasRef("main")) return { base: "main", head: "HEAD", source: "local-fallback" };
  return { base: "HEAD", head: "HEAD", source: "head-fallback" };
}

export function resolveTraceabilityBase(env = process.env) {
  return resolveTraceabilityRange(env).base;
}
