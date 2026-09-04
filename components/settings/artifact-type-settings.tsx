"use client"

import { VocabularyList } from "@/components/settings/vocabulary-list"
import { useVocabulary } from "@/hooks/useVocabulary"
import { getArtifactTypeVocabulary } from "@/lib/settings/vocabulary"

/**
 * Settings › Artifact types.
 *
 * Types have no switch — nothing hides a type from the editor selector — so the
 * list renders without `onToggle` and the card falls back to its four-column
 * shape.
 */
export default function ArtifactTypeSettings() {
  // Subscribes this page to the shared catalog so it repaints the instant
  // Save/Delete resolves — requirement 1/9, without a reload.
  // getArtifactTypeVocabulary() below reads the same catalog synchronously.
  useVocabulary()

  return (
    <div id="settings-artifact-types" data-section="settings-artifact-types" data-testid="settings-artifact-types">
      <VocabularyList
        kind="type"
        items={getArtifactTypeVocabulary()}
        addLabel="New type"
        footnote="The type is metadata about the artifact — it lives in the catalog and the cloud, not in the markdown frontmatter, so it never changes the file's bytes."
      />
    </div>
  )
}
