export const ARTIFACT_TYPE_VALUES = [
  "general",
  "agent",
  "skill",
  "prompt",
  "template",
  "status",
] as const

export type ArtifactType = (typeof ARTIFACT_TYPE_VALUES)[number]

export const DEFAULT_ARTIFACT_TYPE: ArtifactType = "general"

export const normalizeArtifactType = (value: string | null | undefined): ArtifactType =>
  ARTIFACT_TYPE_VALUES.includes(value as ArtifactType)
    ? (value as ArtifactType)
    : DEFAULT_ARTIFACT_TYPE

export const getArtifactTypeLabel = (artifactType: ArtifactType): string => {
  switch (artifactType) {
    case "agent":
      return "Agent"
    case "skill":
      return "Skill"
    case "prompt":
      return "Prompt"
    case "template":
      return "Template"
    case "status":
      return "Status"
    case "general":
    default:
      return "General"
  }
}
