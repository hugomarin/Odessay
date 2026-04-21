import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";

export interface WfRunAgentConfig {
  cmd: string;
  prompt_flag: string;
  flags: string;
  cwd: string;
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
}

export interface RunAgentParams {
  stage: "build" | "review";
  issueId: string;
  config: WfRunConfig;
  extraContext?: string;
  dryRun?: boolean;
  verbose?: boolean;
  artifactPaths?: AgentArtifactPaths;
  metadata?: Record<string, unknown>;
  log: (msg: string) => void;
}

const STAGE_PROMPTS: Record<RunAgentParams["stage"], string> = {
  build: "/wf-build",
  review: "/wf-review",
};

function splitFlags(flags: string): string[] {
  return flags
    .split(/\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

function buildPrompt(stage: RunAgentParams["stage"], issueId: string, extraContext?: string): string {
  const basePrompt = `${STAGE_PROMPTS[stage]} ${issueId}`;
  const context = extraContext?.trim();
  return context ? `${basePrompt}\n\n${context}` : basePrompt;
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

export async function runAgent(params: RunAgentParams): Promise<RunAgentResult> {
  const agentName =
    params.stage === "build" ? params.config.build.agent : params.config.review.agent;
  const agentConfig = params.config.agents[agentName];

  if (!agentConfig) {
    throw new Error(`Missing agent config for "${agentName}"`);
  }

  const prompt = buildPrompt(params.stage, params.issueId, params.extraContext);
  const args = splitFlags(agentConfig.flags);

  if (agentConfig.prompt_flag.trim()) {
    args.push(agentConfig.prompt_flag.trim(), prompt);
  } else {
    args.push(prompt);
  }

  const printableCommand = formatCommand(agentConfig.cmd, args);
  params.log(`  agente: ${agentName} | cmd: ${printableCommand}`);

  if (params.artifactPaths) {
    fs.mkdirSync(path.dirname(params.artifactPaths.stdoutPath), { recursive: true });
    fs.mkdirSync(path.dirname(params.artifactPaths.stderrPath), { recursive: true });
    fs.mkdirSync(path.dirname(params.artifactPaths.metaPath), { recursive: true });
  }

  if (params.dryRun) {
    const startedAt = new Date();
    const finishedAt = new Date();
    const result: RunAgentResult = {
      exitCode: 0,
      command: printableCommand,
      cwd: agentConfig.cwd,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
      stdoutPath: params.artifactPaths?.stdoutPath,
      stderrPath: params.artifactPaths?.stderrPath,
      metaPath: params.artifactPaths?.metaPath,
    };

    if (params.artifactPaths) {
      fs.writeFileSync(params.artifactPaths.stdoutPath, "");
      fs.writeFileSync(params.artifactPaths.stderrPath, "");
      fs.writeFileSync(
        params.artifactPaths.metaPath,
        `${JSON.stringify(
          {
            ...params.metadata,
            ...getRepoSnapshot(agentConfig.cwd),
            command: printableCommand,
            cwd: agentConfig.cwd,
            startedAt: result.startedAt,
            finishedAt: result.finishedAt,
            durationMs: result.durationMs,
            exitCode: result.exitCode,
            dryRun: true,
          },
          null,
          2,
        )}\n`,
      );
    }

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

      const result: RunAgentResult = {
        exitCode,
        command: printableCommand,
        cwd: agentConfig.cwd,
        startedAt: startedAt.toISOString(),
        finishedAt: finishedAt.toISOString(),
        durationMs: finishedAt.getTime() - startedAt.getTime(),
        stdoutPath: params.artifactPaths?.stdoutPath,
        stderrPath: params.artifactPaths?.stderrPath,
        metaPath: params.artifactPaths?.metaPath,
      };

      if (params.artifactPaths) {
        fs.writeFileSync(
          params.artifactPaths.metaPath,
          `${JSON.stringify(
            {
              ...params.metadata,
              ...getRepoSnapshot(agentConfig.cwd),
              command: printableCommand,
              cwd: agentConfig.cwd,
              startedAt: result.startedAt,
              finishedAt: result.finishedAt,
              durationMs: result.durationMs,
              exitCode: result.exitCode,
              stdoutPath: result.stdoutPath,
              stderrPath: result.stderrPath,
            },
            null,
            2,
          )}\n`,
        );
      }

      resolve(result);
    });
  });
}
