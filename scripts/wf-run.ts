import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { execFileSync, spawnSync } from "node:child_process";
import yaml from "js-yaml";
import { type WfRunConfig, runAgent } from "./wf-run-adapter";

interface CliOptions {
  issueIds: string[];
  dryRun: boolean;
  verbose: boolean;
}

interface PollResult {
  found: boolean;
  marker: string | null;
  comment: string;
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
}

interface RecentComment {
  body: string;
  createdAt: string;
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

interface CommentCreateMutation {
  commentCreate: {
    success: boolean;
  };
}

const CONFIG_PATH = "scripts/wf-run-config.yaml";
const LOG_DIRECTORY = "logs";
const FIXED_AGENT_FLAGS = {
  claude: "--dangerously-skip-permissions",
  codex: "--full-auto",
} as const;

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

function loadConfig(repoRoot: string): WfRunConfig {
  const raw = fs.readFileSync(path.join(repoRoot, CONFIG_PATH), "utf8");
  const parsed = yaml.load(raw);

  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid wf-run config");
  }

  const config = parsed as WfRunConfig;

  for (const [agentName, fixedFlags] of Object.entries(FIXED_AGENT_FLAGS)) {
    const agent = config.agents?.[agentName];

    if (!agent) {
      throw new Error(`Missing config for agent "${agentName}"`);
    }

    if (agent.flags !== fixedFlags) {
      throw new Error(
        `Invalid flags for agent "${agentName}". Expected "${fixedFlags}" as defined by the spec.`,
      );
    }

    if (agent.cwd === "repo_root") {
      agent.cwd = repoRoot;
    }
  }

  return config;
}

function createLogger(repoRoot: string): {
  logPath: string;
  log: (message: string) => void;
  writeBlock: (block: string) => void;
} {
  const logsDir = path.join(repoRoot, LOG_DIRECTORY);
  fs.mkdirSync(logsDir, { recursive: true });

  const logPath = path.join(logsDir, `wf-run-${localDateStamp()}.log`);
  fs.appendFileSync(logPath, `=== Run iniciado ${isoTimestamp()} ===\n`);

  const log = (message: string): void => {
    const line = `[${timeStamp()}] ${message}`;
    console.log(line);
    fs.appendFileSync(logPath, `${line}\n`);
  };

  const writeBlock = (block: string): void => {
    console.log(block);
    fs.appendFileSync(logPath, `${block}\n`);
  };

  return { logPath, log, writeBlock };
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

async function getRecentComments(issueId: string, count = 5): Promise<RecentComment[]> {
  const data = await linearGraphQL<RecentCommentQuery>(
    `query($id: String!, $count: Int!) {
      issue(id: $id) {
        comments(last: $count, orderBy: { field: createdAt, direction: DESC }) {
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

  while (Date.now() <= deadline) {
    const comments = await getRecentComments(issueId, 5);
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
      return { found: true, marker: rejectedMarker, comment: rejectedComment };
    }

    if (approvedComment) {
      return { found: true, marker: approvedMarker, comment: approvedComment };
    }

    await sleep(intervalSec * 1000);
  }

  return {
    found: false,
    marker: null,
    comment: "",
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
  return [
    "⏸ HANDOFF REQUERIDO",
    "",
    `Issue:       ${details.issueId}`,
    `Etapa:       ${details.stage}`,
    `Razón:       ${details.reason}`,
    `Completé:    ${details.completed}`,
    `Necesito:    ${details.needed}`,
    `Reanudación: npx tsx scripts/wf-run.ts ${details.issueId}`,
  ].join("\n");
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
    `Log: ${path.relative(process.cwd(), logPath)}`,
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
    `Log: ${path.relative(process.cwd(), logPath)}`,
  );

  return lines.join("\n");
}

function formatSummaryBlock(
  approvedIssues: string[],
  attentionIssues: Array<{ issueId: string; reason: string }>,
  dryRunIssues: string[],
  logPath: string,
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
    `  Log: ${path.relative(process.cwd(), logPath)}`,
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

function runPreflight(repoRoot: string, config: WfRunConfig, dryRun: boolean, log: (msg: string) => void): void {
  const requiredCommands = [
    config.agents[config.build.agent]?.cmd,
    config.agents[config.review.agent]?.cmd,
    "gh",
  ];

  for (const command of requiredCommands) {
    if (!command || !ensureCommandExists(command)) {
      throw new Error(`Pre-flight failed: missing command in PATH -> ${command || "unknown"}`);
    }
  }

  if (!process.env.LINEAR_API_KEY?.trim()) {
    throw new Error("Pre-flight failed: missing LINEAR_API_KEY");
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
  issueId: string,
  config: WfRunConfig,
  dryRun: boolean,
  verbose: boolean,
  logPath: string,
  log: (msg: string) => void,
  writeBlock: (block: string) => void,
): Promise<IssueResult> {
  if (dryRun) {
    log(`→ BUILD iniciando: ${issueId} (intento 1/${config.loop.max_retries})`);
    await runAgent({
      stage: "build",
      issueId,
      config,
      dryRun: true,
      verbose,
      log,
    });

    log(`→ REVIEW iniciando: ${issueId} (ciclo 1)`);
    await runAgent({
      stage: "review",
      issueId,
      config,
      dryRun: true,
      verbose,
      log,
    });

    log(`✓ DRY-RUN completado: ${issueId}`);
    return {
      issueId,
      outcome: "dry-run",
      reason: "dry-run",
    };
  }

  let attempt = 0;
  let rejectionComment = "";

  try {
  while (attempt < config.loop.max_retries) {
    log(`→ BUILD iniciando: ${issueId} (intento ${attempt + 1}/${config.loop.max_retries})`);

    const buildExitCode = await runAgent({
      stage: "build",
      issueId,
      config,
      extraContext: rejectionComment || undefined,
      dryRun,
      verbose,
      log,
    });

    if (buildExitCode !== 0) {
      log(`✗ BUILD proceso terminó con error (exit ${buildExitCode})`);
      const comments = await getRecentComments(issueId, 5);
      const gateFailure = comments.find((comment) => isInterpretableGateFailureComment(comment.body));

      if (gateFailure) {
        rejectionComment = gateFailure.body;
        attempt += 1;
        continue;
      }

      await emitHandoff(
        {
          issueId,
          stage: "BUILD",
          reason: `BUILD terminó con exit ${buildExitCode} y no hubo comentario interpretable en Linear.`,
          completed: "Se ejecutó wf-build y se inspeccionaron los últimos 5 comentarios de Linear.",
          needed: "Revisar el fallo real del agente o dejar un comentario de gate fallido trazable antes de reanudar.",
        },
        attempt + 1,
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

    let issueStatus = await getIssueStatus(issueId);

    if (issueStatus !== config.linear.status_in_review) {
      for (let closeRetry = 0; closeRetry < config.loop.max_close_retries; closeRetry += 1) {
        await runAgent({
          stage: "build",
          issueId,
          config,
          extraContext:
            `El build de ${issueId} terminó pero el issue no está en In Review en Linear. ` +
            "Tu gate de salida requiere mover el issue y dejar comentario de trazabilidad. " +
            "Completa esos pasos ahora.",
          dryRun,
          verbose,
          log,
        });

        issueStatus = await getIssueStatus(issueId);
        if (issueStatus === config.linear.status_in_review) {
          break;
        }
      }
    }

    if (issueStatus !== config.linear.status_in_review) {
      await emitHandoff(
        {
          issueId,
          stage: "BUILD",
          reason: `BUILD terminó pero ${issueId} no quedó en ${config.linear.status_in_review}.`,
          completed: "Se ejecutó wf-build y se reintentó el cierre del gate de salida.",
          needed: "Mover manualmente el issue a In Review con comentario de trazabilidad válido o corregir wf-build.",
        },
        attempt + 1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: "close retry failed",
      };
    }

    log(`→ REVIEW iniciando: ${issueId} (ciclo ${attempt + 1})`);
    const reviewStartedAt = new Date();

    await runAgent({
      stage: "review",
      issueId,
      config,
      dryRun,
      verbose,
      log,
    });

    const pollResult = await pollForComment(
      issueId,
      [config.linear.approved_marker, config.linear.rejected_marker],
      config.loop.poll_interval_seconds,
      config.loop.poll_timeout_seconds,
      reviewStartedAt,
    );

    if (!pollResult.found || !pollResult.marker) {
      await emitHandoff(
        {
          issueId,
          stage: "REVIEW",
          reason: "Timeout esperando marcador de REVIEW en los últimos 5 comentarios de Linear.",
          completed: "Se ejecutó wf-review y se hizo polling hasta agotar el timeout configurado.",
          needed: "Revisar manualmente el issue en Linear y reanudar cuando exista comentario con marker explícito.",
        },
        attempt + 1,
        config.loop.max_retries,
        logPath,
        dryRun,
        log,
        writeBlock,
      );

      return {
        issueId,
        outcome: "handoff",
        reason: "timeout",
      };
    }

    if (pollResult.marker === config.linear.approved_marker) {
      log(`✓ REVIEW APROBADO: ${issueId}`);
      return {
        issueId,
        outcome: "approved",
      };
    }

    log(`✗ REVIEW RECHAZADO: ${issueId} (ciclo ${attempt + 1}) — re-build con contexto`);
    rejectionComment = pollResult.comment;
    attempt += 1;
  }

  log(`⚠ MAX_RETRIES alcanzado: ${issueId}`);

  await emitHandoff(
    {
      issueId,
      stage: "REVIEW",
      reason: `Se alcanzó max_retries (${config.loop.max_retries}).`,
      completed: "Se agotaron los ciclos automáticos build → review para este issue.",
      needed: "Inspeccionar el issue manualmente, corregir el bloqueo y reanudar el run para este issue.",
    },
    config.loop.max_retries,
    config.loop.max_retries,
    logPath,
    dryRun,
    log,
    writeBlock,
  );

  return {
    issueId,
    outcome: "handoff",
    reason: "max retries",
  };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`✗ Error inesperado durante ${issueId}: ${message}`);

    await emitHandoff(
      {
        issueId,
        stage: "BUILD",
        reason: `Error inesperado: ${message}`,
        completed: `Se procesó ${issueId} hasta que falló una llamada externa (Linear/agente).`,
        needed: "Revisar log para diagnóstico, corregir el error subyacente y reanudar el run.",
      },
      attempt + 1,
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
  const { logPath, log, writeBlock } = createLogger(repoRoot);

  try {
    runPreflight(repoRoot, config, cli.dryRun, log);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(message);
    process.exit(1);
  }

  log(`Pre-flight OK — repo limpio, sincronizado${cli.dryRun ? " (dry-run)" : ""}`);
  log(`Issues a procesar: ${cli.issueIds.join(", ")}`);

  const results: IssueResult[] = [];

  for (const [index, issueId] of cli.issueIds.entries()) {
    const result = await runIssueLoop(issueId, config, cli.dryRun, cli.verbose, logPath, log, writeBlock);
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
        },
        null,
        config.loop.max_retries,
        logPath,
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

  writeBlock(formatSummaryBlock(approvedIssues, attentionIssues, dryRunIssues, logPath, cli.issueIds.length));

  if (cli.issueIds.length > 0) {
    await safePostComment(
      cli.issueIds[0],
      formatSummaryComment(approvedIssues, attentionIssues, dryRunIssues, logPath, cli.issueIds.length),
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
