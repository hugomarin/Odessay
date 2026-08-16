"use client"

import { VocabularyList } from "@/components/settings/vocabulary-list"
import { getArtifactTypeVocabulary } from "@/lib/settings/vocabulary"

/**
 * Settings › Artifact types.
 *
 * Types have no switch — nothing hides a type from the editor selector — so the
 * list renders without `onToggle` and the card falls back to its four-column
 * shape. The footnote is the prototype's: the type travels in the markdown, not
 * in a database.
 */
export default function ArtifactTypeSettings() {
  return (
    <div id="settings-artifact-types" data-section="settings-artifact-types" data-testid="settings-artifact-types">
      <VocabularyList
        kind="type"
        items={getArtifactTypeVocabulary()}
        addLabel="New type"
        footnote="The type is written into the markdown frontmatter, so it travels with the file even when you open it outside the app."
      />
    </div>
  )
}
