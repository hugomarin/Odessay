"use client"

/**
 * WATCH-07 — la reacción de la UI del editor a los cambios externos del
 * documento activo: la suscripción al catálogo (borrado, movimiento y cambio
 * de contenido), la recarga limpia, el banner de conflicto y sus dos acciones.
 *
 * ODE-599 — corte 3b de `components/editor/editor-shell.tsx`, entrega 2.
 * MUDANZA MECÁNICA: el efecto de suscripción (con la proyección del estado
 * durable de sync de ODE-542) y los dos manejadores del banner de conflicto
 * son los que vivían en la shell, con sus cuerpos idénticos. El estado
 * (`externalFileNotice`, `externalContentConflict`), los refs y
 * `persistEditorSnapshot` siguen siendo de la shell y llegan por `input`; la
 * shell llama a este hook donde empezaba el efecto, así que el orden de
 * efectos no cambia. La decisión pura vive en su owner,
 * `lib/editor/external-change-policy.ts` (`resolveExternalContentChange`,
 * `computeHasPendingLocalEdit`).
 *
 * `publishTabState` NO entra aquí: publica metadatos de la pestaña activa
 * (título, estado de guardado) y su dueño se decide en el corte 7 (espejos,
 * ODE-609). El ADR del documento activo fija su contrato: solo metadatos,
 * nunca crea, activa ni reemplaza pestañas.
 */
import { useCallback, useEffect } from "react"
import type { Editor } from "@tiptap/react"
import {
  formatSaveStateDiagnostic,
  reconcileSaveStateFromDurable,
  saveStateToHasPendingSync,
  type EditorSaveState,
} from "@/components/editor/save-state"
import { EMPTY_EDITOR_JSON } from "@/lib/editor/extensions"
import { computeHasPendingLocalEdit, resolveExternalContentChange } from "@/lib/editor/external-change-policy"
import type { PersistenceCoordinator, PersistenceSnapshotOverrides } from "@/lib/editor/persistence-coordinator"
import type { CatalogChange } from "@/lib/services/contracts/document-catalog"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { getDocumentService } from "@/lib/services/document-service-factory"
import { updateTabSaveState } from "@/lib/stores/editor-session-store"

export type ExternalFileNotice =
  | { kind: "moved"; path: string | null }
  | { kind: "deleted"; path: string | null }
  | { kind: "relocate-failed"; path: string | null }
  | { kind: "content-changed"; path: string | null }

/**
 * WATCH-07 — set only while there is BOTH a pending local edit AND a known
 * external content change to the same document. Blocks persistEditorSnapshot
 * from auto-saving (which would otherwise silently overwrite the external
 * edit the moment the debounce fires) until the user explicitly resolves it
 * via "Reload external" or "Keep my version".
 */
export type ExternalContentConflict = {
  externalContentHash: string
  path: string | null
}

export type ExternalDocumentChangesInput = {
  applySyncStatus: (next: EditorSaveState) => void
  currentCanonicalPathRef: React.RefObject<string | null>
  currentWritingId: string | null
  currentWritingIdRef: React.RefObject<string | null>
  editor: Editor | null
  editorInstanceRef: React.RefObject<Editor | null>
  externalContentConflict: ExternalContentConflict | null
  externalContentConflictRef: React.RefObject<ExternalContentConflict | null>
  hasSeededBaselineRef: React.RefObject<boolean>
  hasUnconfirmedLocalEditRef: React.RefObject<boolean>
  isApplyingContentRef: React.RefObject<boolean>
  persistenceCoordinator: PersistenceCoordinator
  persistEditorSnapshot: (
    editorInstance: Editor,
    overrides?: PersistenceSnapshotOverrides,
    options?: { awaitDurability?: boolean; forceMaterialize?: boolean },
  ) => Promise<unknown>
  refreshRichFootnotes: () => void
  setCanonicalPath: (path: string | null) => void
  setExternalContentConflict: (conflict: ExternalContentConflict | null) => void
  setExternalFileNotice: (notice: ExternalFileNotice | null) => void
  syncStatusRef: React.RefObject<EditorSaveState>
  updateDerivedEditorState: (editorInstance: Editor) => void
}

export function useExternalDocumentChanges(input: ExternalDocumentChangesInput) {
  const {
    applySyncStatus,
    currentCanonicalPathRef,
    currentWritingId,
    currentWritingIdRef,
    editor,
    editorInstanceRef,
    externalContentConflict,
    externalContentConflictRef,
    hasSeededBaselineRef,
    hasUnconfirmedLocalEditRef,
    isApplyingContentRef,
    persistenceCoordinator,
    persistEditorSnapshot,
    refreshRichFootnotes,
    setCanonicalPath,
    setExternalContentConflict,
    setExternalFileNotice,
    syncStatusRef,
    updateDerivedEditorState,
  } = input

  useEffect(() => {
    if (!isDesktopRuntime() || !currentWritingId) {
      currentCanonicalPathRef.current = null
      setCanonicalPath(null)
      setExternalFileNotice(null)
      return
    }

    let cancelled = false

    let unsubscribeCatalog: (() => void) | null = null

    // Desktop presence and bindings live in SQLite's DocumentCatalog. The
    // legacy IndexedDB change bus does not receive watcher detach events, so
    // listening only to it leaves an externally removed file looking "Saved".
    void import("@/lib/queries/document-catalog")
      .then(({ getCatalogRecord, subscribeToCatalog }) => {
        if (cancelled) return

        const syncCurrentWritingState = async (reason?: CatalogChange["reason"]) => {
          const catalogRecord = await getCatalogRecord(currentWritingId)
          if (cancelled || !catalogRecord) return

          // ODE-542: proyectar el estado durable de sync solo en lecturas de
          // reconciliación. La lectura inicial es segura (al activar un
          // documento no hay guardado en vuelo) y `cloud-snapshot` solo se
          // emite tras un flush que confirmó el write que describe. Las demás
          // razones (`content`, `upsert`, `excerpt`, `bulk`…) pueden llegar con
          // la fila del guardado ANTERIOR mientras uno nuevo sigue en vuelo:
          // proyectarlas mostraría un "Saved" falso.
          if (
            (reason === undefined || reason === "cloud-snapshot") &&
            currentWritingIdRef.current === currentWritingId
          ) {
            const current = syncStatusRef.current
            const reconciled = reconcileSaveStateFromDurable({
              current,
              durable: { syncStatus: catalogRecord.syncStatus, cloudPresent: catalogRecord.cloudPresent },
              isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
            })
            if (reconciled) {
              console.info(
                formatSaveStateDiagnostic({
                  writingId: currentWritingId,
                  durableSyncStatus: catalogRecord.syncStatus,
                  current,
                  next: reconciled,
                  reason: `catalog-${reason ?? "initial"}`,
                }),
              )
              applySyncStatus(reconciled)
              updateTabSaveState({
                tabId: currentWritingId,
                saveState: reconciled,
                hasPendingSync: saveStateToHasPendingSync(reconciled),
              })
            }
          }

          const nextCanonicalPath = catalogRecord.binding?.canonicalPath ?? null
          const previousCanonicalPath = currentCanonicalPathRef.current

          if (!catalogRecord.localPresent && previousCanonicalPath) {
            currentCanonicalPathRef.current = null
            setCanonicalPath(null)
            setExternalFileNotice({ kind: "deleted", path: previousCanonicalPath })
            return
          }

          if (
            previousCanonicalPath &&
            nextCanonicalPath &&
            previousCanonicalPath !== nextCanonicalPath
          ) {
            currentCanonicalPathRef.current = nextCanonicalPath
            setCanonicalPath(nextCanonicalPath)
            setExternalFileNotice({ kind: "moved", path: nextCanonicalPath })
            return
          }

          currentCanonicalPathRef.current = nextCanonicalPath
          setCanonicalPath(nextCanonicalPath)

          // WATCH-07 — the file's content itself (not just its path/presence)
          // may have changed externally. The very first run for a freshly
          // opened document has no baseline yet: only seed the coordinator's
          // own tracked baseline here, never reload — the separate hydration
          // effect already owns setting the editor's initial content for
          // that case, and racing it here would double-apply the same
          // content. The coordinator (not a local ref) owns this baseline
          // from here on — see its own getDurableContentHash doc comment
          // for why a caller-local copy would race a queued second save.
          const nextContentHash = catalogRecord.binding?.contentHash ?? null
          if (!hasSeededBaselineRef.current) {
            hasSeededBaselineRef.current = true
            persistenceCoordinator.setDurableContentHash(currentWritingId, nextContentHash)
            persistenceCoordinator.discardUnconfirmed(currentWritingId)
            setExternalFileNotice(null)
            return
          }

          const decision = resolveExternalContentChange({
            baselineContentHash: persistenceCoordinator.getDurableContentHash(currentWritingId),
            currentContentHash: nextContentHash,
            hasPendingLocalEdit: computeHasPendingLocalEdit({
              hasUnconfirmedLocalEdit: hasUnconfirmedLocalEditRef.current,
              hasUnconfirmedPersistedContent: persistenceCoordinator.hasUnconfirmedContent({
                writingId: currentWritingId,
              }),
            }),
            reason,
          })

          if (decision.action === "none") {
            setExternalFileNotice(null)
            return
          }

          if (decision.action === "conflict") {
            // Never auto-reload over an unsaved edit, and never let it
            // silently save over the external one either — persistEditorSnapshot
            // checks externalContentConflictRef before scheduling any write.
            const conflict: ExternalContentConflict = { externalContentHash: nextContentHash!, path: nextCanonicalPath }
            externalContentConflictRef.current = conflict
            setExternalContentConflict(conflict)
            return
          }

          // CLEAN auto-reload: nothing local is at risk, so silently keeping
          // stale content would be strictly worse than adopting the external
          // version. Re-read from the real service rather than trusting the
          // catalog's own cached body (it has none — only the hash).
          try {
            const opened = await (await getDocumentService()).openWriting(currentWritingId)
            const liveEditor = editorInstanceRef.current
            if (cancelled || !opened.data || !liveEditor) return
            isApplyingContentRef.current = true
            liveEditor.commands.setContent(opened.data.content.richText ?? EMPTY_EDITOR_JSON)
            isApplyingContentRef.current = false
            refreshRichFootnotes()
            updateDerivedEditorState(liveEditor)
            hasUnconfirmedLocalEditRef.current = false
            persistenceCoordinator.discardUnconfirmed(currentWritingId)
            persistenceCoordinator.setDurableContentHash(currentWritingId, nextContentHash)
            setExternalFileNotice({ kind: "content-changed", path: nextCanonicalPath })
          } catch {
            // Leave the stale content open and the previous notice in place;
            // the next catalog event or focus retries the reload.
          }
        }

        // ODE-574: una lectura del catálogo que falla (p. ej. SQLite ocupado)
        // no puede quedar como rechazo sin manejar. El contenido sigue abierto
        // y el siguiente cambio del catálogo o la siguiente activación
        // reintentan.
        const logCatalogReadFailure = (error: unknown) => {
          console.error("[editor] catalog state read failed", {
            writingId: currentWritingId,
            error: error instanceof Error ? error.message : String(error),
          })
        }
        void syncCurrentWritingState().catch(logCatalogReadFailure)
        unsubscribeCatalog = subscribeToCatalog((change) => {
          if (change.documentIds.includes(currentWritingId)) {
            void syncCurrentWritingState(change.reason).catch(logCatalogReadFailure)
          }
        })
      })
      .catch(() => {
        // A catalog read failure leaves the editor content open; the next
        // catalog event or document activation retries the state projection.
      })

    return () => {
      cancelled = true
      unsubscribeCatalog?.()
      // Reset the canonical-path tracker when the watched writing changes.
      // Otherwise the next writing's first sync sees the previous writing's path
      // as the "previous" value and flashes a false "file moved" notice.
      currentCanonicalPathRef.current = null
      setCanonicalPath(null)
      hasSeededBaselineRef.current = false
      hasUnconfirmedLocalEditRef.current = false
      externalContentConflictRef.current = null
      setExternalContentConflict(null)
    }
  }, [
    applySyncStatus,
    currentCanonicalPathRef,
    currentWritingId,
    currentWritingIdRef,
    editorInstanceRef,
    externalContentConflictRef,
    hasSeededBaselineRef,
    hasUnconfirmedLocalEditRef,
    isApplyingContentRef,
    persistenceCoordinator,
    refreshRichFootnotes,
    setCanonicalPath,
    setExternalContentConflict,
    setExternalFileNotice,
    syncStatusRef,
    updateDerivedEditorState,
  ])

  const reloadExternalVersion = useCallback(() => {
    void (async () => {
      const writingId = currentWritingIdRef.current
      if (!writingId || !editor || !externalContentConflict) return
      const opened = await (await getDocumentService()).openWriting(writingId)
      if (!opened.data) return
      isApplyingContentRef.current = true
      editor.commands.setContent(opened.data.content.richText ?? EMPTY_EDITOR_JSON)
      isApplyingContentRef.current = false
      refreshRichFootnotes()
      updateDerivedEditorState(editor)
      hasUnconfirmedLocalEditRef.current = false
      persistenceCoordinator.discardUnconfirmed(writingId)
      persistenceCoordinator.setDurableContentHash(writingId, externalContentConflict.externalContentHash)
      externalContentConflictRef.current = null
      setExternalContentConflict(null)
      setExternalFileNotice({ kind: "content-changed", path: externalContentConflict.path })
    })()
  }, [
    currentWritingIdRef,
    editor,
    externalContentConflict,
    externalContentConflictRef,
    hasUnconfirmedLocalEditRef,
    isApplyingContentRef,
    persistenceCoordinator,
    refreshRichFootnotes,
    setExternalContentConflict,
    setExternalFileNotice,
    updateDerivedEditorState,
  ])

  const keepMyVersion = useCallback(() => {
    const writingId = currentWritingIdRef.current
    if (!editor || !writingId || !externalContentConflict) return
    // Pre-seed the coordinator's tracked baseline to exactly
    // the external hash this conflict was raised against —
    // disk really is at that version right now, so the write
    // this triggers targets it precisely (one deliberate
    // overwrite, never a bypass of the guard itself). Clear
    // the conflict *before* persisting so persistEditorSnapshot's
    // own guard doesn't refuse this call too.
    persistenceCoordinator.setDurableContentHash(writingId, externalContentConflict.externalContentHash)
    externalContentConflictRef.current = null
    setExternalContentConflict(null)
    void persistEditorSnapshot(editor, undefined, { awaitDurability: true })
  }, [
    currentWritingIdRef,
    editor,
    externalContentConflict,
    externalContentConflictRef,
    persistenceCoordinator,
    persistEditorSnapshot,
    setExternalContentConflict,
  ])

  return { keepMyVersion, reloadExternalVersion }
}
