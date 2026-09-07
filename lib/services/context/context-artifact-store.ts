import type { ContextArtifact, ContextArtifactKey } from "@/lib/services/context/types"

function artifactCacheKey(key: ContextArtifactKey): string {
  return `${key.documentId}@${key.documentVersion}::${key.representation}::${key.extractionPolicy}`
}

/**
 * Session-scoped semantic cache (odessay-agent-context-cache.md "Session
 * cache" / "Semantic cache" layers). Derived and descartable: the caller
 * owns the artifact's lifetime by choosing when to create/reset a store, and
 * a document's entries are only ever invalidated explicitly — never by this
 * module reaching into a filesystem, catalog or watcher.
 */
export type ContextArtifactStore = {
  get(key: ContextArtifactKey): ContextArtifact | null
  set(artifact: ContextArtifact): void
  /** Drops every cached representation of a document, regardless of version — used when a mutation is confirmed. */
  invalidateDocument(documentId: string): void
  clear(): void
  size(): number
}

export function createContextArtifactStore(): ContextArtifactStore {
  const artifacts = new Map<string, ContextArtifact>()

  return {
    get(key) {
      return artifacts.get(artifactCacheKey(key)) ?? null
    },
    set(artifact) {
      artifacts.set(
        artifactCacheKey({
          documentId: artifact.documentId,
          documentVersion: artifact.documentVersion,
          representation: artifact.representation,
          extractionPolicy: artifact.extractionPolicy,
        }),
        artifact,
      )
    },
    invalidateDocument(documentId) {
      for (const [cacheKey, artifact] of artifacts) {
        if (artifact.documentId === documentId) artifacts.delete(cacheKey)
      }
    },
    clear() {
      artifacts.clear()
    },
    size() {
      return artifacts.size
    },
  }
}
