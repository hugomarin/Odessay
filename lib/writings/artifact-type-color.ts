import type { ArtifactType } from "@/lib/writings/artifact-type"

const ARTIFACT_TYPE_COLOR_VAR: Record<ArtifactType, string> = {
  general: "hsl(var(--ink-4))",
  agent: "var(--od-annotation-ai)",
  skill: "var(--od-annotation-highlight)",
  prompt: "hsl(var(--cursor))",
  template: "hsl(var(--success))",
  status: "var(--od-annotation-ai)",
}

export function getArtifactTypeColor(artifactType: ArtifactType): string {
  return ARTIFACT_TYPE_COLOR_VAR[artifactType] ?? ARTIFACT_TYPE_COLOR_VAR.general
}
