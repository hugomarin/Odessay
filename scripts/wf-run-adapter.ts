import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

export interface WfRunAgentConfig {
  cmd: string;
  cwd: string;
  mode?: "one_shot" | "interactive_terminal" | "codex_exec";
  prompt_flag?: string;
  flags?: string;
  prompt_pattern?: string;
  startup_timeout_seconds?: number;
  command_timeout_seconds?: number;
  output_last_message_artifact?: boolean;
  required_env?: string[];
}

export interface WfRunConfig {
  agents: Record<string, WfRunAgentConfig>;
  build: {
    agent: string;
  };
  review: {
    agent: string;
  };
  loop: {
    max_retries: number;
    max_close_retries: number;
    poll_interval_seconds: number;
    poll_timeout_seconds: number;
  };
  linear: {
    status_in_progress: string;
    status_in_review: string;
    status_done: string;
    approved_marker: string;
    rejected_marker: string;
  };
}

export interface AgentArtifactPaths {
  stdoutPath: string;
  stderrPath: string;
  metaPath: string;
  promptPath?: string;
  lastMessagePath?: string;
}

export interface RunAgentResult {
  exitCode: number;
  command: string;
  cwd: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  stdoutPath?: string;
  stderrPath?: string;
  metaPath?: string;
  promptPath?: string;
  lastMessagePath?: string;
}

export interface RunAgentParams {
  stage: "build" | "review";
  issueId: string;
  config: WfRunConfig;
  dryRun?: boolean;
  verbose?: boolean;
  artifactPaths?: AgentArtifactPaths;
  metadata?: Record<string, unknown>;
  log: (msg: string) => void;
}

function splitFlags(flags?: string): string[] {
  return flags
    ?.split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean) ?? [];
}

function buildInteractiveCommand(stage: RunAgentParams["stage"], issueId: string): string {
  return `${stage === "build" ? "wf-build" : "wf-review"} ${issueId}`;
}

export function buildAgentPrompt(
  stage: RunAgentParams["stage"],
  issueId: string,
): string {
  const slashCommand = `/${stage === "build" ? "wf-build" : "wf-review"} ${issueId}`;

  if (stage === "build") {
    return [
      `Actua exactamente como si el humano hubiera ejecutado \`${slashCommand}\` en una sesion nueva de Codex para este repositorio.`,
      "",
      "Reglas:",
      "1. Tu unica responsabilidad es completar ese comando end-to-end.",
      "2. No asumas el rol de `wf-run` ni hagas orquestacion adicional fuera de `/wf-build`.",
      "3. Carga solo el contexto que `/wf-build` requiera por si mismo.",
      "4. Si BUILD no puede cerrar su gate, deja trazabilidad clara con el motivo exacto dentro del flujo normal de `/wf-build`.",
    ].join("\n");
  }

  return [
    `Actua exactamente como si el humano hubiera ejecutado \`${slashCommand}\` en una sesion nueva de Codex para este repositorio.`,
    "",
    "Reglas:",
    "1. Tu unica responsabilidad es completar ese comando end-to-end.",
    "2. No asumas el rol de `wf-run` ni hagas orquestacion adicional fuera de `/wf-review`.",
    "3. Carga solo el contexto que `/wf-review` requiera por si mismo.",
    "4. Si apruebas, el comentario final en Linear debe incluir exactamente el marker `REVIEW APROBADO`.",
    "5. Si rechazas, el comentario final en Linear debe incluir exactamente el marker `REVIEW RECHAZADO`.",
  ].join("\n");
}

export function buildCodexExecArgs(
  agentConfig: WfRunAgentConfig,
  prompt: string,
  artifactPaths?: AgentArtifactPaths,
): string[] {
  const args = ["exec", ...splitFlags(agentConfig.flags)];

  if (agentConfig.output_last_message_artifact && artifactPaths?.lastMessagePath) {
    args.push("--output-last-message", artifactPaths.lastMessagePath);
  }

  args.push(prompt);

  return args;
}

function formatCommand(command: string, args: string[]): string {
  const parts = [command, ...args].map((part) =>
    /\s/.test(part) ? JSON.stringify(part) : part,
  );
  return parts.join(" ");
}

function safeGitValue(cwd: string, args: string[]): string | null {
  try {
    const value = execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    return value || null;
  } catch {
    return null;
  }
}

function getRepoSnapshot(cwd: string): Record<string, string | null> {
  return {
    repoRoot: safeGitValue(cwd, ["rev-parse", "--show-toplevel"]),
    branch: safeGitValue(cwd, ["branch", "--show-current"]),
    headSha: safeGitValue(cwd, ["rev-parse", "HEAD"]),
  };
}

function prepareArtifactDirectories(artifactPaths?: AgentArtifactPaths): void {
  if (!artifactPaths) {
    return;
  }

  fs.mkdirSync(path.dirname(artifactPaths.stdoutPath), { recursive: true });
  fs.mkdirSync(path.dirname(artifactPaths.stderrPath), { recursive: true });
  fs.mkdirSync(path.dirname(artifactPaths.metaPath), { recursive: true });

  if (artifactPaths.promptPath) {
    fs.mkdirSync(path.dirname(artifactPaths.promptPath), { recursive: true });
  }

  if (artifactPaths.lastMessagePath) {
    fs.mkdirSync(path.dirname(artifactPaths.lastMessagePath), { recursive: true });
  }
}

function writeMetaArtifact(
  artifactPaths: AgentArtifactPaths | undefined,
  payload: Record<string, unknown>,
): void {
  if (!artifactPaths) {
    return;
  }

  fs.writeFileSync(artifactPaths.metaPath, `${JSON.stringify(payload, null, 2)}\n`);
}

function createBaseResult(
  agentConfig: WfRunAgentConfig,
  command: string,
  startedAt: Date,
  finishedAt: Date,
  exitCode: number,
  artifactPaths?: AgentArtifactPaths,
): RunAgentResult {
  return {
    exitCode,
    command,
    cwd: agentConfig.cwd,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    stdoutPath: artifactPaths?.stdoutPath,
    stderrPath: artifactPaths?.stderrPath,
    metaPath: artifactPaths?.metaPath,
    promptPath: artifactPaths?.promptPath,
    lastMessagePath: artifactPaths?.lastMessagePath,
  };
}

function createExpectScript(
  scriptPath: string,
  promptPattern: string,
  startupTimeoutSeconds: number,
  commandTimeoutSeconds: number,
): void {
  const content = `#!/usr/bin/expect -f
log_user 1
match_max 100000
set timeout ${startupTimeoutSeconds}
set prompt_pattern {${promptPattern}}
set input_text [lindex $argv 0]
set cmd [lindex $argv 1]
set cwd [lindex $argv 2]
set command_timeout ${commandTimeoutSeconds}
set args [lrange $argv 3 end]
cd $cwd
spawn -noecho $cmd {*}$args
expect {
  -re $prompt_pattern {}
  timeout {
    puts stderr "__WF_RUN_EXPECT_TIMEOUT__:startup"
    exit 124
  }
  eof {
    puts stderr "__WF_RUN_EXPECT_EOF__:startup"
    exit 1
  }
}
set timeout $command_timeout
send -- "$input_text\\r"
expect {
  -re $prompt_pattern {}
  timeout {
    puts stderr "__WF_RUN_EXPECT_TIMEOUT__:command"
    exit 124
  }
  eof {}
}
send "\\004"
expect eof
`;

  fs.writeFileSync(scriptPath, content);
  fs.chmodSync(scriptPath, 0o755);
}

async function runInteractiveTerminalAgent(
  params: RunAgentParams,
  agentName: string,
  agentConfig: WfRunAgentConfig,
): Promise<RunAgentResult> {
  const inputCommand = buildInteractiveCommand(params.stage, params.issueId);
  const args = splitFlags(agentConfig.flags);
  const launchCommand = formatCommand(agentConfig.cmd, args);
  const displayCommand = `${launchCommand}  # interactive => ${JSON.stringify(inputCommand)}`;
  const promptPattern = agentConfig.prompt_pattern?.trim();

  if (!promptPattern) {
    throw new Error(`Missing prompt_pattern for interactive agent "${agentName}"`);
  }

  prepareArtifactDirectories(params.artifactPaths);
  params.log(`  agente: ${agentName} | cmd: ${displayCommand}`);

  if (params.dryRun) {
    const startedAt = new Date();
    const finishedAt = new Date();
    const result = createBaseResult(
      agentConfig,
      displayCommand,
      startedAt,
      finishedAt,
      0,
      params.artifactPaths,
    );

    if (params.artifactPaths) {
      fs.writeFileSync(params.artifactPaths.stdoutPath, "");
      fs.writeFileSync(params.artifactPaths.stderrPath, "");
    }

    writeMetaArtifact(params.artifactPaths, {
      ...params.metadata,
      ...getRepoSnapshot(agentConfig.cwd),
      mode: "interactive_terminal",
      inputCommand,
      promptPattern,
      command: displayCommand,
      cwd: agentConfig.cwd,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      dryRun: true,
    });

    params.log(`[DRY-RUN] ${displayCommand}`);
    return result;
  }

  const startupTimeoutSeconds = agentConfig.startup_timeout_seconds ?? 30;
  const commandTimeoutSeconds = agentConfig.command_timeout_seconds ?? 1800;
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "wf-run-expect-"));
  const scriptPath = path.join(tempDirectory, "run-agent.expect");
  createExpectScript(scriptPath, promptPattern, startupTimeoutSeconds, commandTimeoutSeconds);

  const startedAt = new Date();
  const proc = spawn(
    "expect",
    [scriptPath, inputCommand, agentConfig.cmd, agentConfig.cwd, ...args],
    {
      cwd: agentConfig.cwd,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const stdoutStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stdoutPath) : null;
  const stderrStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stderrPath) : null;

  proc.stdout?.on("data", (chunk) => {
    const value = chunk.toString();
    stdoutStream?.write(value);

    if (params.verbose) {
      process.stdout.write(value);
    } else {
      stdoutBuffer += value;
    }
  });

  proc.stderr?.on("data", (chunk) => {
    const value = chunk.toString();
    stderrStream?.write(value);

    if (params.verbose) {
      process.stderr.write(value);
    } else {
      stderrBuffer += value;
    }
  });

  return await new Promise<RunAgentResult>((resolve, reject) => {
    proc.on("error", (error) => {
      stdoutStream?.end();
      stderrStream?.end();
      fs.rmSync(tempDirectory, { recursive: true, force: true });
      reject(error);
    });

    proc.on("close", (code) => {
      const finishedAt = new Date();
      const exitCode = code ?? 1;
      stdoutStream?.end();
      stderrStream?.end();
      fs.rmSync(tempDirectory, { recursive: true, force: true });

      if (!params.verbose && exitCode !== 0) {
        if (stdoutBuffer.trim()) {
          for (const line of stdoutBuffer.trimEnd().split("\n")) {
            params.log(`  stdout | ${line}`);
          }
        }

        if (stderrBuffer.trim()) {
          for (const line of stderrBuffer.trimEnd().split("\n")) {
            params.log(`  stderr | ${line}`);
          }
        }
      }

      const result = createBaseResult(
        agentConfig,
        displayCommand,
        startedAt,
        finishedAt,
        exitCode,
        params.artifactPaths,
      );

      writeMetaArtifact(params.artifactPaths, {
        ...params.metadata,
        ...getRepoSnapshot(agentConfig.cwd),
        mode: "interactive_terminal",
        inputCommand,
        promptPattern,
        startupTimeoutSeconds,
        commandTimeoutSeconds,
        command: displayCommand,
        cwd: agentConfig.cwd,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
      });

      resolve(result);
    });
  });
}

async function runOneShotAgent(
  params: RunAgentParams,
  agentName: string,
  agentConfig: WfRunAgentConfig,
): Promise<RunAgentResult> {
  const prompt = buildAgentPrompt(params.stage, params.issueId);
  const args = splitFlags(agentConfig.flags);

  if (agentConfig.prompt_flag?.trim()) {
    args.push(agentConfig.prompt_flag.trim(), prompt);
  } else {
    args.push(prompt);
  }

  const printableCommand = formatCommand(agentConfig.cmd, args);
  prepareArtifactDirectories(params.artifactPaths);
  params.log(`  agente: ${agentName} | cmd: ${printableCommand}`);

  if (params.dryRun) {
    const startedAt = new Date();
    const finishedAt = new Date();
    const result = createBaseResult(
      agentConfig,
      printableCommand,
      startedAt,
      finishedAt,
      0,
      params.artifactPaths,
    );

    if (params.artifactPaths) {
      fs.writeFileSync(params.artifactPaths.stdoutPath, "");
      fs.writeFileSync(params.artifactPaths.stderrPath, "");
    }

    writeMetaArtifact(params.artifactPaths, {
      ...params.metadata,
      ...getRepoSnapshot(agentConfig.cwd),
      mode: "one_shot",
      command: printableCommand,
      cwd: agentConfig.cwd,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      dryRun: true,
    });

    params.log(`[DRY-RUN] ${printableCommand}`);
    return result;
  }

  const startedAt = new Date();
  const proc = spawn(agentConfig.cmd, args, {
    cwd: agentConfig.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const stdoutStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stdoutPath) : null;
  const stderrStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stderrPath) : null;

  proc.stdout?.on("data", (chunk) => {
    const value = chunk.toString();
    stdoutStream?.write(value);

    if (params.verbose) {
      process.stdout.write(value);
    } else {
      stdoutBuffer += value;
    }
  });

  proc.stderr?.on("data", (chunk) => {
    const value = chunk.toString();
    stderrStream?.write(value);

    if (params.verbose) {
      process.stderr.write(value);
    } else {
      stderrBuffer += value;
    }
  });

  return await new Promise<RunAgentResult>((resolve, reject) => {
    proc.on("error", (error) => {
      stdoutStream?.end();
      stderrStream?.end();
      reject(error);
    });

    proc.on("close", (code) => {
      const exitCode = code ?? 1;
      const finishedAt = new Date();
      stdoutStream?.end();
      stderrStream?.end();

      if (!params.verbose && exitCode !== 0) {
        if (stdoutBuffer.trim()) {
          for (const line of stdoutBuffer.trimEnd().split("\n")) {
            params.log(`  stdout | ${line}`);
          }
        }

        if (stderrBuffer.trim()) {
          for (const line of stderrBuffer.trimEnd().split("\n")) {
            params.log(`  stderr | ${line}`);
          }
        }
      }

      const result = createBaseResult(
        agentConfig,
        printableCommand,
        startedAt,
        finishedAt,
        exitCode,
        params.artifactPaths,
      );

      writeMetaArtifact(params.artifactPaths, {
        ...params.metadata,
        ...getRepoSnapshot(agentConfig.cwd),
        mode: "one_shot",
        command: printableCommand,
        cwd: agentConfig.cwd,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
      });

      resolve(result);
    });
  });
}

async function runCodexExecAgent(
  params: RunAgentParams,
  agentName: string,
  agentConfig: WfRunAgentConfig,
): Promise<RunAgentResult> {
  const prompt = buildAgentPrompt(params.stage, params.issueId);
  const args = buildCodexExecArgs(agentConfig, prompt, params.artifactPaths);
  const printableArgs = args.map((arg) => (arg === prompt ? "<prompt>" : arg));
  const printableCommand = formatCommand(agentConfig.cmd, printableArgs);
  prepareArtifactDirectories(params.artifactPaths);

  if (params.artifactPaths?.promptPath) {
    fs.writeFileSync(params.artifactPaths.promptPath, `${prompt}\n`);
  }

  params.log(`  agente: ${agentName} | cmd: ${printableCommand}`);

  if (params.dryRun) {
    const startedAt = new Date();
    const finishedAt = new Date();
    const result = createBaseResult(
      agentConfig,
      printableCommand,
      startedAt,
      finishedAt,
      0,
      params.artifactPaths,
    );

    if (params.artifactPaths) {
      fs.writeFileSync(params.artifactPaths.stdoutPath, "");
      fs.writeFileSync(params.artifactPaths.stderrPath, "");

      if (params.artifactPaths.lastMessagePath) {
        fs.writeFileSync(params.artifactPaths.lastMessagePath, "");
      }
    }

    writeMetaArtifact(params.artifactPaths, {
      ...params.metadata,
      ...getRepoSnapshot(agentConfig.cwd),
      mode: "codex_exec",
      command: printableCommand,
      cwd: agentConfig.cwd,
      startedAt: result.startedAt,
      finishedAt: result.finishedAt,
      durationMs: result.durationMs,
      exitCode: result.exitCode,
      stdoutPath: result.stdoutPath,
      stderrPath: result.stderrPath,
      promptPath: result.promptPath,
      lastMessagePath: result.lastMessagePath,
      requiredEnv: agentConfig.required_env ?? [],
      dryRun: true,
    });

    params.log(`[DRY-RUN] ${printableCommand}`);
    return result;
  }

  const startedAt = new Date();
  const proc = spawn(agentConfig.cmd, args, {
    cwd: agentConfig.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";
  const stdoutStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stdoutPath) : null;
  const stderrStream = params.artifactPaths ? fs.createWriteStream(params.artifactPaths.stderrPath) : null;

  proc.stdout?.on("data", (chunk) => {
    const value = chunk.toString();
    stdoutStream?.write(value);

    if (params.verbose) {
      process.stdout.write(value);
    } else {
      stdoutBuffer += value;
    }
  });

  proc.stderr?.on("data", (chunk) => {
    const value = chunk.toString();
    stderrStream?.write(value);

    if (params.verbose) {
      process.stderr.write(value);
    } else {
      stderrBuffer += value;
    }
  });

  return await new Promise<RunAgentResult>((resolve, reject) => {
    proc.on("error", (error) => {
      stdoutStream?.end();
      stderrStream?.end();
      reject(error);
    });

    proc.on("close", (code) => {
      const exitCode = code ?? 1;
      const finishedAt = new Date();
      stdoutStream?.end();
      stderrStream?.end();

      if (!params.verbose && exitCode !== 0) {
        if (stdoutBuffer.trim()) {
          for (const line of stdoutBuffer.trimEnd().split("\n")) {
            params.log(`  stdout | ${line}`);
          }
        }

        if (stderrBuffer.trim()) {
          for (const line of stderrBuffer.trimEnd().split("\n")) {
            params.log(`  stderr | ${line}`);
          }
        }
      }

      const result = createBaseResult(
        agentConfig,
        printableCommand,
        startedAt,
        finishedAt,
        exitCode,
        params.artifactPaths,
      );

      writeMetaArtifact(params.artifactPaths, {
        ...params.metadata,
        ...getRepoSnapshot(agentConfig.cwd),
        mode: "codex_exec",
        command: printableCommand,
        cwd: agentConfig.cwd,
        startedAt: result.startedAt,
        finishedAt: result.finishedAt,
        durationMs: result.durationMs,
        exitCode: result.exitCode,
        stdoutPath: result.stdoutPath,
        stderrPath: result.stderrPath,
        promptPath: result.promptPath,
        lastMessagePath: result.lastMessagePath,
        requiredEnv: agentConfig.required_env ?? [],
      });

      resolve(result);
    });
  });
}

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const agentName =
    params.stage === "build" ? params.config.build.agent : params.config.review.agent;
  const agentConfig = params.config.agents[agentName];

  if (!agentConfig) {
    throw new Error(`Missing agent config for "${agentName}"`);
  }

  const mode = agentConfig.mode ?? "one_shot";

  if (mode === "codex_exec") {
    return await runCodexExecAgent(params, agentName, agentConfig);
  }

  if (mode === "interactive_terminal") {
    return await runInteractiveTerminalAgent(params, agentName, agentConfig);
  }

  return await runOneShotAgent(params, agentName, agentConfig);
}
