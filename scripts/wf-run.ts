import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { type AgentArtifactPaths, type WfRunConfig, runAgent } from "./wf-run-adapter";

interface CliOptions {
  issueIds: string[];
  dryRun: boolean;
  verbose: boolean;
}

interface PollResult {
  found: boolean;
  marker: string | null;
  comment: string;
  observations: PollObservation[];
}

interface IssueResult {
  issueId: string;
  outcome: "approved" | "handoff" | "dry-run";
  reason?: string;
}

interface HandoffDetails {
  issueId: string;
  stage: "BUILD" | "REVIEW" | "TRANSICIÓN";
  reason: string;
  completed: string;
  needed: string;
  artifactsPath?: string;
}

interface RecentComment {
  body: string;
  createdAt: string;
}

interface PollObservation {
  polledAt: string;
  comments: RecentComment[];
}

interface RecentCommentQuery {
  issue: {
    comments: {
      nodes: Array<{
        body: string;
        createdAt: string;
      }>;
    };
  } | null;
}

interface IssueStatusQuery {
  issue: {
    state: {
      name: string;
    };
  } | null;
}

interface PullRequestListItem {
  number: number;
  state: string;
  url: string;
  headRefName: string;
}

interface CloseGateCheckResult {
  branchName: string | null;
  openPullRequest: PullRequestListItem | null;
  issueStatus: string;
}

interface CommentCreateMutation {
  commentCreate: {
    success: boolean;
  };
}

const CONFIG_PATH = "scripts/wf-run-config.yaml";
const LOG_DIRECTORY = "logs";

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function now(): Date {
  return new Date();
}

function isoTimestamp(): string {
  return now().toISOString();
}

function localDateStamp(date = now()): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function timeStamp(date = now()): string {
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function makeRunId(date = now()): string {
  return date.toISOString().replace(/[:.]/g, "-");
}

function parseIssueIds(rawValue: string): string[] {
  const tokens = rawValue
    .split(",")
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    throw new Error("Missing issue IDs. Usage: npx tsx scripts/wf-run.ts ODE-50,51,52");
  }

  return tokens.map((token) => {
    if (/^\d+$/.test(token)) {
      return `ODE-${token}`;
    }

    if (/^ODE-\d+$/i.test(token)) {
      return token.toUpperCase();
    }

    throw new Error(`Invalid issue ID: ${token}`);
  });
}

function parseCliArgs(argv: string[]): CliOptions {
  const knownFlags = new Set(["--dry-run", "--verbose"]);
  const positionalArgs: string[] = [];

  for (const arg of argv) {
    if (arg.startsWith("--")) {
      if (!knownFlags.has(arg)) {
        throw new Error(`Unknown flag: ${arg}. Allowed: ${[...knownFlags].join(", ")}`);
      }
      continue;
    }
    positionalArgs.push(arg);
  }

  if (positionalArgs.length !== 1) {
    throw new Error("Usage: npx tsx scripts/wf-run.ts ODE-50,51,52 [--dry-run] [--verbose]");
  }

  return {
    issueIds: parseIssueIds(positionalArgs[0]),
    dryRun: argv.includes("--dry-run"),
    verbose: argv.includes("--verbose"),
  };
}

function resolveRepoRoot(): string {
  return execFileSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: process.cwd(),
    encoding: "utf8",
  }).trim();
}

function ensureCommandExists(command: string): boolean {
  const result = spawnSync("which", [command], { encoding: "utf8" });
  return result.status === 0;
}

function runGitCommand(repoRoot: string, args: string[], dryRun: boolean, log: (msg: string) => void): void {
  const printable = `git ${args.join(" ")}`;

  if (dryRun) {
    log(`[DRY-RUN] ${printable}`);
    return;
  }

  try {
    execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: "pipe",
    });
  } catch (error) {
    const stderr = (error as { stderr?: string })?.stderr?.toString().trim();
    const baseMessage = error instanceof Error ? error.message : String(error);
    throw new Error(stderr ? `${baseMessage}\n${stderr}` : baseMessage);
  }
}

function readGitCommand(repoRoot: string, args: string[]): string {
  return execFileSync("git", args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function loadConfig(repoRoot: string): WfRunConfig {
  const raw = fs.readFileSync(path.join(repoRoot, CONFIG_PATH), "utf8");
  const parsed = yaml.load(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid wf-run config");
  }

  const config = parsed as WfRunConfig;

  for (const [agentName, agent] of Object.entries(config.agents ?? {})) {
    if (!agent?.cmd) {
      throw new Error(`Missing command for agent "${agentName}"`);
    }

    if (agent.mode === "interactive_terminal" && !agent.prompt_pattern?.trim()) {
      throw new Error(`Missing prompt_pattern for interactive agent "${agentName}"`);
    }

    if (agent.mode === "codex_exec") {
      agent.output_last_message_artifact = agent.output_last_message_artifact ?? true;
      agent.required_env = Array.from(new Set([...(agent.required_env ?? []), "OPENAI_API_KEY"]));
    }

    if (agent.cwd === "repo_root") {
      agent.cwd = repoRoot;
    }
  }

  return config;
}

function createLogger(repoRoot: string): {
  runDirectory: string;
  logPath: string;
  log: (message: string) => void;
  writeBlock: (block: string) => void;
} {
  const logsDir = path.join(repoRoot, LOG_DIRECTORY);
  fs.mkdirSync(logsDir, { recursive: true });

  const runDirectory = path.join(logsDir, "wf-run", makeRunId());
  fs.mkdirSync(runDirectory, { recursive: true });

  const logPath = path.join(runDirectory, "run.log");
  const dailyLogPath = path.join(logsDir, `wf-run-${localDateStamp()}.log`);
  fs.appendFileSync(logPath, `=== Run iniciado ${isoTimestamp()} ===\n`);
  fs.appendFileSync(dailyLogPath, `=== Run iniciado ${isoTimestamp()} :: ${path.relative(repoRoot, runDirectory)} ===\n`);

  const log = (message: string): void => {
    const line = `[${timeStamp()}] ${message}`;
    console.log(line);
    fs.appendFileSync(logPath, `${line}\n`);
    fs.appendFileSync(dailyLogPath, `${line}\n`);
  };

  const writeBlock = (block: string): void => {
    console.log(block);
    fs.appendFileSync(logPath, `${block}\n`);
    fs.appendFileSync(dailyLogPath, `${block}\n`);
  };

  return { runDirectory, logPath, log, writeBlock };
}

async function linearGraphQL<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY?.trim();

  if (!apiKey) {
    throw new Error("Missing LINEAR_API_KEY");
  }

  const authHeader = apiKey.startsWith("lin_api_") ? apiKey : `Bearer ${apiKey}`;

  const response = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: authHeader,
    },
    body: JSON.stringify({ query, variables }),
  });

  const payload = (await response.json()) as {
    data?: T;
    errors?: Array<{
      message: string;
    }>;
  };

  if (!response.ok || payload.errors?.length) {
    const messages = payload.errors?.map((error) => error.message).join(" | ") || response.statusText;
    throw new Error(`Linear GraphQL error (${response.status}): ${messages}`);
  }

  if (!payload.data) {
    throw new Error("Linear GraphQL error: missing data payload");
  }

  return payload.data;
}

async function getIssueStatus(issueId: string): Promise<string> {
  const data = await linearGraphQL<IssueStatusQuery>(
    `query($id: String!) {
      issue(id: $id) {
        state {
          name
        }
      }
    }`,
    { id: issueId },
  );

  if (!data.issue?.state?.name) {
    throw new Error(`Issue not found in Linear: ${issueId}`);
  }

  return data.issue.state.name;
}

function getCurrentBranchName(repoRoot: string): string | null {
  const branchName = readGitCommand(repoRoot, ["branch", "--show-current"]);
  return branchName || null;
}

function getOpenPullRequestForBranch(repoRoot: string, branchName: string): PullRequestListItem | null {
  const output = execFileSync(
    "gh",
    ["pr", "list", "--head", branchName, "--json", "number,state,url,headRefName"],
    {
      cwd: repoRoot,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  const pullRequests = JSON.parse(output) as PullRequestListItem[];
  return pullRequests.find((pullRequest) => pullRequest.state === "OPEN") ?? null;
}

async function verifyBuildCloseGate(
  repoRoot: string,
  issueId: string,
  expectedStatus: string,
  maxChecks: number,
  intervalSec: number,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<CloseGateCheckResult> {
  if (dryRun) {
    return {
      branchName: `codex/${issueId.toLowerCase()}-dry-run`,
      openPullRequest: {
        number: 0,
        state: "OPEN",
        url: "https://example.com/dry-run",
        headRefName: `codex/${issueId.toLowerCase()}-dry-run`,
      },
      issueStatus: expectedStatus,
    };
  }

  const attempts = Math.max(maxChecks, 1);

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const branchName = getCurrentBranchName(repoRoot);
    const openPullRequest =
      branchName && branchName !== "main" ? getOpenPullRequestForBranch(repoRoot, branchName) : null;
    const issueStatus = await getIssueStatus(issueId);

    if (branchName && branchName !== "main" && openPullRequest && issueStatus === expectedStatus) {
      return {
        branchName,
        openPullRequest,
        issueStatus,
      };
    }

    if (attempt < attempts - 1) {
      log(
        `⋯ BUILD gate pendiente: branch=${branchName ?? "none"} pr=${openPullRequest ? "open" : "missing"} status=${issueStatus}`,
      );
      await sleep(intervalSec * 1000);
    }
  }

  const branchName = getCurrentBranchName(repoRoot);
  const openPullRequest =
    branchName && branchName !== "main" ? getOpenPullRequestForBranch(repoRoot, branchName) : null;
  const issueStatus = await getIssueStatus(issueId);

  return {
    branchName,
    openPullRequest,
    issueStatus,
  };
}

async function getRecentComments(issueId: string, count = 5): Promise<RecentComment[]> {
  const data = await linearGraphQL<RecentCommentQuery>(
    `query($id: String!, $count: Int!) {
      issue(id: $id) {
        comments(last: $count, orderBy: createdAt) {
          nodes {
            body
            createdAt
          }
        }
      }
    }`,
    { id: issueId, count },
  );

  return data.issue?.comments?.nodes.map((node) => ({ body: node.body, createdAt: node.createdAt })) ?? [];
}

async function pollForComment(
  issueId: string,
  markers: [string, string],
  intervalSec: number,
  timeoutSec: number,
  since: Date,
): Promise<PollResult> {
  const [approvedMarker, rejectedMarker] = markers;
  const deadline = Date.now() + timeoutSec * 1000;
  const sinceMs = since.getTime();
  const observations: PollObservation[] = [];

  while (Date.now() <= deadline) {
    const comments = await getRecentComments(issueId, 5);
    observations.push({
      polledAt: new Date().toISOString(),
      comments,
    });
    let approvedComment = "";
    let rejectedComment = "";

    for (const comment of comments) {
      if (new Date(comment.createdAt).getTime() < sinceMs) {
        continue;
      }

      if (!rejectedComment && comment.body.includes(rejectedMarker)) {
        rejectedComment = comment.body;
      }

      if (!approvedComment && comment.body.includes(approvedMarker)) {
        approvedComment = comment.body;
      }
    }

    if (rejectedComment) {
      return { found: true, marker: rejectedMarker, comment: rejectedComment, observations };
    }

    if (approvedComment) {
      return { found: true, marker: approvedMarker, comment: approvedComment, observations };
    }

    await sleep(intervalSec * 1000);
  }

  return {
    found: false,
    marker: null,
    comment: "",
    observations,
  };
}

async function postComment(issueId: string, body: string, dryRun: boolean, log: (msg: string) => void): Promise<void> {
  if (dryRun) {
    log(`[DRY-RUN] Linear comment skipped for ${issueId}`);
    return;
  }

  const data = await linearGraphQL<CommentCreateMutation>(
    `mutation($issueId: String!, $body: String!) {
      commentCreate(input: { issueId: $issueId, body: $body }) {
        success
      }
    }`,
    { issueId, body },
  );

  if (!data.commentCreate.success) {
    throw new Error(`Linear comment creation failed for ${issueId}`);
  }
}

async function safePostComment(
  issueId: string,
  body: string,
  dryRun: boolean,
  log: (msg: string) => void,
): Promise<void> {
  try {
    await postComment(issueId, body, dryRun, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`✗ No se pudo postear comentario en Linear para ${issueId}: ${message}`);
  }
}

function isInterpretableGateFailureComment(comment: string): boolean {
  const normalized = comment.toLowerCase();
  const markers = [
    "ops:delivery:gate",
    "required_failures",
    "gate de salida",
    "gate fall",
    "no puede pasar a in review",
    "handoff requerido",
  ];

  return markers.some((marker) => normalized.includes(marker));
}

function formatHandoffBlock(details: HandoffDetails): string {
  const lines = [
    "⏸ HANDOFF REQUERIDO",
    "",
    `Issue:       ${details.issueId}`,
    `Etapa:       ${details.stage}`,
    `Razón:       ${details.reason}`,
    `Completé:    ${details.completed}`,
    `Necesito:    ${details.needed}`,
    `Reanudación: npx tsx scripts/wf-run.ts ${details.issueId}`,
  ];

  if (details.artifactsPath) {
    lines.splice(lines.length - 1, 0, `Artefactos:  ${details.artifactsPath}`);
  }

  return lines.join("\n");
}

function formatHandoffLinearComment(
  details: HandoffDetails,
  cycles: number | null,
  maxRetries: number,
  logPath: string,
): string {
  const lines = [
    "🤖 wf-run — intervención requerida",
    "",
    `Resultado: HANDOFF — ${details.reason}`,
  ];

  if (cycles !== null) {
    lines.push(`Ciclos ejecutados: ${cycles}/${maxRetries}`);
  }

  lines.push(
    `Etapa: ${details.stage}`,
    `Razón: ${details.reason}`,
    `Log: ${logPath}`,
    ...(details.artifactsPath ? [`Artefactos: ${details.artifactsPath}`] : []),
    "",
    "Acción requerida: revisar manualmente y re-ejecutar:",
    `npx tsx scripts/wf-run.ts ${details.issueId}`,
  );

  return lines.join("\n");
}

function formatSummaryComment(
  approvedIssues: string[],
  attentionIssues: Array<{ issueId: string; reason: string }>,
  dryRunIssues: string[],
  logPath: string,
  runDirectory: string,
  totalIssues: number,
): string {
  const approvedText = approvedIssues.length > 0 ? approvedIssues.join(", ") : "ninguno";
  const attentionText =
    attentionIssues.length > 0
      ? attentionIssues.map(({ issueId, reason }) => `${issueId} (${reason})`).join(", ")
      : "ninguno";

  const lines = [
    `🤖 wf-run completado — ${isoTimestamp()}`,
    "",
    `✓ Aprobados: ${approvedText}`,
    `⚠ Requieren atención: ${attentionText}`,
  ];

  if (dryRunIssues.length > 0) {
    lines.push(`◌ Dry-run: ${dryRunIssues.join(", ")}`);
  }

  lines.push(
    `Total: ${totalIssues} issues · ${approvedIssues.length} aprobados · ${attentionIssues.length} requieren atención${dryRunIssues.length > 0 ? ` · ${dryRunIssues.length} dry-run` : ""}`,
    `Log: ${logPath}`,
    `Artefactos: ${runDirectory}`,
  );

  return lines.join("\n");
}

function formatSummaryBlock(
  approvedIssues: string[],
  attentionIssues: Array<{ issueId: string; reason: string }>,
  dryRunIssues: string[],
  logPath: string,
  runDirectory: string,
  totalIssues: number,
): string {
  const approvedText = approvedIssues.length > 0 ? approvedIssues.join(", ") : "ninguno";
  const attentionText =
    attentionIssues.length > 0
      ? attentionIssues.map(({ issueId, reason }) => `${issueId} (${reason})`).join(", ")
      : "ninguno";

  const lines = [
    "─────────────────────────────────────────",
    `  wf-run completado — ${localDateStamp()} ${timeStamp()}`,
    "─────────────────────────────────────────",
    `  ✓ Aprobados:          ${approvedText}`,
    `  ⚠ Requieren atención: ${attentionText}`,
  ];

  if (dryRunIssues.length > 0) {
    lines.push(`  ◌ Dry-run:            ${dryRunIssues.join(", ")}`);
  }

  lines.push(
    `  Total: ${totalIssues} issues · ${approvedIssues.length} aprobados · ${attentionIssues.length} requieren atención${dryRunIssues.length > 0 ? ` · ${dryRunIssues.length} dry-run` : ""}`,
    `  Log: ${logPath}`,
    `  Artefactos: ${runDirectory}`,
    "─────────────────────────────────────────",
  );

  return lines.join("\n");
}

async function emitHandoff(
  details: HandoffDetails,
  cycles: number | null,
  maxRetries: number,
  logPath: string,
  dryRun: boolean,
  log: (msg: string) => void,
  writeBlock: (block: string) => void,
): Promise<void> {
  writeBlock(formatHandoffBlock(details));
  await safePostComment(
    details.issueId,
    formatHandoffLinearComment(details, cycles, maxRetries, logPath),
    dryRun,
    log,
  );
}

function writeJsonArtifact(filePath: string, payload: unknown): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`);
}

function toRepoRelativePath(repoRoot: string, targetPath: string): string {
  return path.relative(repoRoot, targetPath) || ".";
}

function getIssueArtifactsDirectory(runDirectory: string, issueId: string): string {
  return path.join(runDirectory, issueId);
}

function createStageArtifactPaths(
  runDirectory: string,
  issueId: string,
  label: string,
): AgentArtifactPaths {
  const issueDirectory = getIssueArtifactsDirectory(runDirectory, issueId);

  return {
    stdoutPath: path.join(issueDirectory, `${label}.stdout.log`),
    stderrPath: path.join(issueDirectory, `${label}.stderr.log`),
    metaPath: path.join(issueDirectory, `${label}.meta.json`),
    promptPath: path.join(issueDirectory, `${label}.prompt.txt`),
    lastMessagePath: path.join(issueDirectory, `${label}.last-message.md`),
  };
}

function runPreflight(repoRoot: string, config: WfRunConfig, dryRun: boolean, log: (msg: string) => void): void {
  const activeAgents = [config.build.agent, config.review.agent]
    .map((agentName) => config.agents[agentName])
    .filter((agent): agent is NonNullable<typeof agent> => Boolean(agent));
  const requiredCommands = [
    config.agents[config.build.agent]?.cmd,
    config.agents[config.review.agent]?.cmd,
    "gh",
    ...(activeAgents.some((agent) => agent.mode === "interactive_terminal") ? ["expect"] : []),
  ];

  for (const command of requiredCommands) {
    if (!command || !ensureCommandExists(command)) {
      throw new Error(`Pre-flight failed: missing command in PATH -> ${command || "unknown"}`);
    }
  }

  if (!process.env.LINEAR_API_KEY?.trim()) {
    throw new Error("Pre-flight failed: missing LINEAR_API_KEY");
  }

  const missingEnv = Array.from(
    new Set(
      activeAgents
        .flatMap((agent) => agent.required_env ?? [])
        .filter((name) => !process.env[name]?.trim()),
    ),
  );

  if (missingEnv.length > 0) {
    throw new Error(`Pre-flight failed: missing ${missingEnv.join(", ")}`);
  }

  const statusOutput = execFileSync("git", ["status", "--porcelain"], {
    cwd: repoRoot,
    encoding: "utf8",
  }).trim();

  if (statusOutput) {
    throw new Error("Pre-flight failed: working tree is not clean");
  }

  runGitCommand(repoRoot, ["switch", "main"], dryRun, log);
  runGitCommand(repoRoot, ["pull", "--ff-only", "origin", "main"], dryRun, log);
}

async function runIssueLoop(
  repoRoot: string,
  runDirectory: string,
  issueId: string,
  config: WfRunConfig,
  dryRun: boolean,
  verbose: boolean,
  logPath: string,
  log: (msg: string) => void,
  writeBlock: (block: string) => void,
): Promise<IssueResult> {
  const issueArtifactsPath = toRepoRelativePath(repoRoot, getIssueArtifactsDirectory(runDirectory, issueId));

  if (dryRun) {
    const buildArtifacts = createStageArtifactPaths(runDirectory, issueId, "cycle-1-build");
    log(`→ BUILD iniciando: ${issueId} (intento 1/${config.loop.max_retries})`);
    await runAgent({
      stage: "build",
      issueId,
      config,
      dryRun: true,
      verbose,
      artifactPaths: buildArtifacts,
      metadata: {
        issueId,
        stage: "build",
        cycle: 1,
      },
      log,
    });

    const reviewArtifacts = createStageArtifactPaths(runDirectory, issueId, "cycle-1-review");
    log(`→ REVIEW iniciando: ${issueId} (ciclo 1)`);
    await runAgent({
      stage: "review",
      issueId,
      config,
      dryRun: true,
      verbose,
      artifactPaths: reviewArtifacts,
      metadata: {
        issueId,
        stage: "review",
        cycle: 1,
      },
      log,
    });

    log(`✓ DRY-RUN completado: ${issueId}`);
    return {
      issueId,
      outcome: "dry-run",
      reason: "dry-run",
    };
  }

  let currentStage: HandoffDetails["stage"] = "BUILD";

  try {
    const cycle = 1;
    currentStage = "BUILD";
    const buildStartedAt = new Date();
    const buildArtifacts = createStageArtifactPaths(runDirectory, issueId, `cycle-${cycle}-build`);

    log(`→ BUILD iniciando: ${issueId}`);

    const buildResult = await runAgent({
      stage: "build",
      issueId,
      config,
      dryRun,
      verbose,
      artifactPaths: buildArtifacts,
      metadata: {
        issueId,
        stage: "build",
        cycle,
      },
      log,
    });

    if (buildResult.exitCode !== 0) {
      log(`✗ BUILD proceso terminó con error (exit ${buildResult.exitCode})`);
      const comments = await getRecentComments(issueId, 5);
      const recentCommentsPath = path.join(
        getIssueArtifactsDirectory(runDirectory, issueId),
        `cycle-${cycle}-build-linear-comments.json`,
      );
      writeJsonArtifact(recentCommentsPath, {
        issueId,
        stage: "build",
        cycle,
        collectedAt: new Date().toISOString(),
        since: buildStartedAt.toISOString(),
        comments,
      });
      const gateFailure = comments.find((comment) => {
        if (new Date(comment.createdAt).getTime() < buildStartedAt.getTime()) {
          return false;
        }

        return isInterpretableGateFailureComment(comment.body);
      });

      await emitHandoff(
        {
          issueId,
          stage: "BUILD",
          reason:
            gateFailure?.body ||
            `BUILD terminó con exit ${buildResult.exitCode} y no hubo comentario interpretable en Linear.`,
          completed: "Se ejecutó wf-build una vez y se inspeccionaron los últimos 5 comentarios de Linear sin relanzar BUILD.",
          needed: "Revisar el fallo real del agente o del gate antes de reanudar manualmente.",
          artifactsPath: issueArtifactsPath,
        },
        1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: "build error",
      };
    }

    const closeGate = await verifyBuildCloseGate(
      repoRoot,
      issueId,
      config.linear.status_in_review,
      config.loop.max_close_retries,
      config.loop.poll_interval_seconds,
      dryRun,
      log,
    );

    writeJsonArtifact(
      path.join(getIssueArtifactsDirectory(runDirectory, issueId), `cycle-${cycle}-build-close-check.json`),
      {
        issueId,
        stage: "build",
        cycle,
        checkedAt: new Date().toISOString(),
        branchName: closeGate.branchName,
        openPullRequest: closeGate.openPullRequest,
        issueStatus: closeGate.issueStatus,
      },
    );

    if (!closeGate.branchName || closeGate.branchName === "main" || !closeGate.openPullRequest) {
      await emitHandoff(
        {
          issueId,
          stage: "BUILD",
          reason: `BUILD terminó pero no dejó un PR abierto verificable para la rama actual (${closeGate.branchName ?? "sin rama"}).`,
          completed: "Se ejecutó wf-build y el script verificó branch + PR sin relanzar BUILD.",
          needed: "Abrir o reparar el PR del issue y reanudar manualmente.",
          artifactsPath: issueArtifactsPath,
        },
        1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: "missing open pr",
      };
    }

    if (closeGate.issueStatus !== config.linear.status_in_review) {
      await emitHandoff(
        {
          issueId,
          stage: "BUILD",
          reason:
            `BUILD dejó PR abierto (${closeGate.openPullRequest.url}) pero ${issueId} quedó en ` +
            `${closeGate.issueStatus} en lugar de ${config.linear.status_in_review}.`,
          completed: "Se ejecutó wf-build y el script verificó el gate de salida sin relanzar BUILD.",
          needed: "Corregir el estado/trazabilidad en Linear y reanudar manualmente.",
          artifactsPath: issueArtifactsPath,
        },
        1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: "invalid linear status",
      };
    }

    currentStage = "REVIEW";
    const reviewArtifacts = createStageArtifactPaths(runDirectory, issueId, `cycle-${cycle}-review`);
    log(`→ REVIEW iniciando: ${issueId}`);
    const reviewStartedAt = new Date();

    const reviewResult = await runAgent({
      stage: "review",
      issueId,
      config,
      dryRun,
      verbose,
      artifactPaths: reviewArtifacts,
      metadata: {
        issueId,
        stage: "review",
        cycle,
        branchName: closeGate.branchName,
        pullRequestUrl: closeGate.openPullRequest.url,
      },
      log,
    });

    const pollResult = await pollForComment(
      issueId,
      [config.linear.approved_marker, config.linear.rejected_marker],
      config.loop.poll_interval_seconds,
      config.loop.poll_timeout_seconds,
      reviewStartedAt,
    );
    writeJsonArtifact(
      path.join(getIssueArtifactsDirectory(runDirectory, issueId), `cycle-${cycle}-review-linear-comments.json`),
      {
        issueId,
        stage: "review",
        cycle,
        since: reviewStartedAt.toISOString(),
        markerFound: pollResult.marker,
        reviewExitCode: reviewResult.exitCode,
        observations: pollResult.observations,
      },
    );

    if (!pollResult.found || !pollResult.marker) {
      const reason =
        reviewResult.exitCode !== 0
          ? `REVIEW terminó con exit ${reviewResult.exitCode} y no dejó marker interpretable en Linear.`
          : "Timeout esperando marcador de REVIEW en los últimos 5 comentarios de Linear.";

      await emitHandoff(
        {
          issueId,
          stage: "REVIEW",
          reason,
          completed: "Se ejecutó wf-review una vez y se hizo polling hasta agotar el timeout configurado.",
          needed: "Revisar manualmente el issue en Linear y reanudar cuando exista comentario con marker explícito.",
          artifactsPath: issueArtifactsPath,
        },
        1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: reviewResult.exitCode !== 0 ? "review exit error" : "timeout",
      };
    }

    if (pollResult.marker === config.linear.approved_marker) {
      if (reviewResult.exitCode !== 0) {
        log(`⚠ REVIEW dejó marker aprobado con exit ${reviewResult.exitCode}; se prioriza el marker.`);
      }
      log(`✓ REVIEW APROBADO: ${issueId}`);
      return {
        issueId,
        outcome: "approved",
      };
    }

    if (reviewResult.exitCode !== 0) {
      log(`⚠ REVIEW dejó marker rechazado con exit ${reviewResult.exitCode}; se prioriza el marker.`);
    }

    await emitHandoff(
      {
        issueId,
        stage: "REVIEW",
        reason: pollResult.comment || `REVIEW RECHAZADO para ${issueId}.`,
        completed: "Se ejecutó wf-review una vez sin relanzar BUILD automaticamente.",
        needed: "Atender los hallazgos del review y reanudar manualmente con un nuevo BUILD cuando corresponda.",
        artifactsPath: issueArtifactsPath,
      },
      1,
      config.loop.max_retries,
      logPath,
      dryRun,
      log,
      writeBlock,
    );

    return {
      issueId,
      outcome: "handoff",
      reason: "review rejected",
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`✗ Error inesperado durante ${issueId}: ${message}`);

    await emitHandoff(
      {
        issueId,
        stage: currentStage,
        reason: `Error inesperado: ${message}`,
        completed: `Se procesó ${issueId} hasta que falló una llamada externa (Linear/agente).`,
        needed: "Revisar log para diagnóstico, corregir el error subyacente y reanudar el run.",
        artifactsPath: issueArtifactsPath,
      },
      1,
      config.loop.max_retries,
      logPath,
      dryRun,
      log,
      writeBlock,
    );

    return {
      issueId,
      outcome: "handoff",
      reason: "unexpected error",
    };
  }
}

async function main(): Promise<void> {
  const cli = parseCliArgs(process.argv.slice(2));
  const repoRoot = resolveRepoRoot();
  const config = loadConfig(repoRoot);
  const { runDirectory, logPath, log, writeBlock } = createLogger(repoRoot);
  const relativeLogPath = toRepoRelativePath(repoRoot, logPath);
  const relativeRunDirectory = toRepoRelativePath(repoRoot, runDirectory);

  try {
    runPreflight(repoRoot, config, cli.dryRun, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    process.exit(1);
  }

  log(`Pre-flight OK — repo limpio, sincronizado${cli.dryRun ? " (dry-run)" : ""}`);
  log(`Issues a procesar: ${cli.issueIds.join(", ")}`);
  log(`Artefactos del run: ${relativeRunDirectory}`);

  const results: IssueResult[] = [];

  for (const [index, issueId] of cli.issueIds.entries()) {
    const result = await runIssueLoop(
      repoRoot,
      runDirectory,
      issueId,
      config,
      cli.dryRun,
      cli.verbose,
      relativeLogPath,
      log,
      writeBlock,
    );
    results.push(result);

    const isLastIssue = index === cli.issueIds.length - 1;
    if (isLastIssue) {
      continue;
    }

    log(`─── ${issueId} completado → sincronizando repo ───`);

    try {
      runGitCommand(repoRoot, ["switch", "main"], cli.dryRun, log);
      runGitCommand(repoRoot, ["pull", "--ff-only", "origin", "main"], cli.dryRun, log);
      log(`✓ Repo sincronizado — iniciando ${cli.issueIds[index + 1]}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`✗ Sync falló — deteniendo run completo: ${message}`);
      await emitHandoff(
        {
          issueId,
          stage: "TRANSICIÓN",
          reason: `git sync falló: ${message}`,
          completed: `Se terminó el procesamiento de ${issueId} y se intentó sincronizar main antes del siguiente issue.`,
          needed: "Corregir el problema de sincronización del repo antes de reanudar el run.",
          artifactsPath: toRepoRelativePath(repoRoot, getIssueArtifactsDirectory(runDirectory, issueId)),
        },
        null,
        config.loop.max_retries,
        relativeLogPath,
        cli.dryRun,
        log,
        writeBlock,
      );
      break;
    }
  }

  const approvedIssues = results.filter((result) => result.outcome === "approved").map((result) => result.issueId);
  const dryRunIssues = results.filter((result) => result.outcome === "dry-run").map((result) => result.issueId);
  const attentionIssues = results
    .filter((result) => result.outcome === "handoff")
    .map((result) => ({
      issueId: result.issueId,
      reason: result.reason ?? "handoff",
    }));

  writeBlock(
    formatSummaryBlock(
      approvedIssues,
      attentionIssues,
      dryRunIssues,
      relativeLogPath,
      relativeRunDirectory,
      cli.issueIds.length,
    ),
  );

  if (cli.issueIds.length > 0) {
    await safePostComment(
      cli.issueIds[0],
      formatSummaryComment(
        approvedIssues,
        attentionIssues,
        dryRunIssues,
        relativeLogPath,
        relativeRunDirectory,
        cli.issueIds.length,
      ),
      cli.dryRun,
      log,
    );
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
