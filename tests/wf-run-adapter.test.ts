import { describe, expect, it } from "vitest";
import { buildAgentPrompt, buildCodexExecArgs, type WfRunAgentConfig } from "@/scripts/wf-run-adapter";

describe("wf-run adapter prompts", () => {
  it("builds a thin supervisor prompt for wf-build", () => {
    const prompt = buildAgentPrompt("build", "ODE-105");

    expect(prompt).toContain("Actua exactamente como si el humano hubiera ejecutado `/wf-build ODE-105`");
    expect(prompt).toContain("No asumas el rol de `wf-run`");
    expect(prompt).not.toContain("Lee workflow/agents.md.");
  });

  it("builds a wf-review prompt with required review markers", () => {
    const prompt = buildAgentPrompt("review", "ODE-88");

    expect(prompt).toContain("Actua exactamente como si el humano hubiera ejecutado `/wf-review ODE-88`");
    expect(prompt).toContain("REVIEW APROBADO");
    expect(prompt).toContain("REVIEW RECHAZADO");
  });
});

describe("wf-run codex exec args", () => {
  it("appends the last-message artifact before the prompt", () => {
    const agentConfig: WfRunAgentConfig = {
      cmd: "codex",
      cwd: "/repo",
      mode: "codex_exec",
      flags: "--full-auto --color never",
      output_last_message_artifact: true,
    };
    const prompt = "Ejecuta /wf-build ODE-105";

    const args = buildCodexExecArgs(agentConfig, prompt, {
      stdoutPath: "/tmp/build.stdout.log",
      stderrPath: "/tmp/build.stderr.log",
      metaPath: "/tmp/build.meta.json",
      lastMessagePath: "/tmp/build.last-message.md",
    });

    expect(args).toEqual([
      "exec",
      "--full-auto",
      "--color",
      "never",
      "--output-last-message",
      "/tmp/build.last-message.md",
      "Ejecuta /wf-build ODE-105",
    ]);
  });
});
