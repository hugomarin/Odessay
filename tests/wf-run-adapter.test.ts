import { describe, expect, it } from "vitest";
import { buildAgentPrompt, buildCodexExecArgs, type WfRunAgentConfig } from "@/scripts/wf-run-adapter";

describe("wf-run adapter prompts", () => {
  it("builds a wf-build prompt with optional orchestration context", () => {
    const prompt = buildAgentPrompt("build", "ODE-105", "REVIEW rechazado en el ciclo anterior.");

    expect(prompt).toContain("Ejecuta el protocolo /wf-build para ODE-105");
    expect(prompt).toContain("Lee workflow/agents.md.");
    expect(prompt).toContain("Contexto adicional del orquestador:");
    expect(prompt).toContain("REVIEW rechazado en el ciclo anterior.");
  });

  it("builds a wf-review prompt with required review markers", () => {
    const prompt = buildAgentPrompt("review", "ODE-88");

    expect(prompt).toContain("Ejecuta el protocolo /wf-review para ODE-88");
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
