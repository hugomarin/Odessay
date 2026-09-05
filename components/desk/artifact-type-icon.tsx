import { VocabularyIcon } from "@/components/settings/vocabulary-icon"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getVocabularyColor, getVocabularyIconName } from "@/lib/vocabulary/resolve"
import type { ArtifactType } from "@/lib/writings/artifact-type"

/**
 * The glyph for an artifact type.
 *
 * It lives in its own module because the Desk's row, its filter menu and the
 * selection bar all need it, and importing it from `desk-activity-table.tsx`
 * dragged that module's whole dependency tree — dialogs, the shared table, the
 * collection menus — into every one of them, and put the row and the table in an
 * import cycle.
 *
 * Icon and colour resolve from the shared vocabulary catalog (ODE-474) — no
 * per-component type→icon table. An unrecognized type falls back to the
 * neutral "circle" glyph, which is in the closed icon set.
 */
export function ArtifactTypeIcon({ artifactType, className }: { artifactType: ArtifactType; className?: string }) {
  const catalog = useVocabulary()

  return (
    <VocabularyIcon
      name={getVocabularyIconName(catalog, "type", artifactType) ?? "circle"}
      size={13}
      className={className ?? "shrink-0"}
      style={{ color: getVocabularyColor(catalog, "type", artifactType) }}
    />
  )
}

/**
 * The neutral-color variant: some surfaces (the type selector dropdown, the
 * preview modal's type menu) deliberately keep every glyph the same ink
 * shade — coloring six-plus menu options individually read as noisy there.
 * Color is left to the wrapping element's `text-*` class via `currentColor`.
 */
export function ArtifactTypeGlyph({ artifactType, className }: { artifactType: ArtifactType; className?: string }) {
  const catalog = useVocabulary()
  return (
    <VocabularyIcon
      name={getVocabularyIconName(catalog, "type", artifactType) ?? "circle"}
      size={13}
      className={className}
    />
  )
}
