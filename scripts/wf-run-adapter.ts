import { spawn } from "node:child_process";

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

export interface RunAgentParams {
  stage: "build" | "review";
  issueId: string;
  config: WfRunConfig;
  extraContext?: string;
  dryRun?: boolean;
  verbose?: boolean;
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

export async function runAgent(params: RunAgentParams): Promise<number> {
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

  params.log(`  agente: ${agentName} | cmd: ${formatCommand(agentConfig.cmd, args)}`);

  if (params.dryRun) {
    params.log(`[DRY-RUN] ${formatCommand(agentConfig.cmd, args)}`);
    return 0;
  }

  const proc = spawn(agentConfig.cmd, args, {
    cwd: agentConfig.cwd,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdoutBuffer = "";
  let stderrBuffer = "";

  if (params.verbose) {
    proc.stdout?.pipe(process.stdout);
    proc.stderr?.pipe(process.stderr);
  } else {
    proc.stdout?.on("data", (chunk) => {
      stdoutBuffer += chunk.toString();
    });
    proc.stderr?.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
    });
  }

  return await new Promise<number>((resolve, reject) => {
    proc.on("error", reject);
    proc.on("close", (code) => {
      const exitCode = code ?? 1;

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

      resolve(exitCode);
    });
  });
}
