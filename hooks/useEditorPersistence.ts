"use client"

/**
 * Cadena de guardado/persistencia del documento activo del editor: el
 * debounce rich y markdown, el snapshot, el `PersistenceCoordinator` y sus
 * efectos de activación y desmontaje.
 *
 * ODE-605 — corte 5, paso 1 de `components/editor/editor-shell.tsx`. Es una
 * MUDANZA MECÁNICA: los cuerpos son los que vivían en la shell, con las
 * mismas dependencias, y la propiedad del estado NO cambia: el estado y los
 * refs (`currentWritingId`, `currentWritingIdRef`, `titleRef`, las colas de
 * rich/markdown, ...) siguen siendo de la shell y llegan aquí por `input`.
 *
 * Reglas del corte:
 * - Los refs llegan como `RefObject`, nunca como snapshot de `.current`: los
 *   callbacks diferidos (rAF, timeouts, promesas) leen el valor vivo por ellos.
 * - El orden de efectos no cambia: este hook se llama donde estaba el
 *   `useMemo` del coordinador, así que sus efectos (activar el coordinador →
 *   volcar + `dispose` al desmontar → asignar el volcado) quedan declarados
 *   antes de la suscripción a sync y del cleanup de unmount de la shell
 *   (ODE-573).
 * - Sin cambio de dueño: los dueños puros siguen en `lib/editor/`; aquí solo
 *   vive el cableado de React.
 */
import { useCallback, useEffect, useMemo, type RefObject } from "react"
import type { useRouter } from "next/navigation"
import type { Editor } from "@tiptap/react"

import { mapLocalSyncStatusToSaveState, type EditorSaveState } from "@/components/editor/save-state"
import type { ActivationReason, DocumentMetadataPatch } from "@/hooks/useDocumentHydration"
import type { ExternalContentConflict } from "@/hooks/useExternalDocumentChanges"
import { UNTITLED_DOCUMENT_NAME } from "@/lib/desktop/document-naming"
import { createBlankDraftIdentity, createNewWritingSessionState } from "@/lib/editor/hydration-session"
import {
  createPersistenceCoordinator,
  type PersistenceCommitEvent,
  type PersistenceSnapshotOverrides,
  type PersistenceStateEvent,
} from "@/lib/editor/persistence-coordinator"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import type { ArtifactType, WritingLifecycle, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import {
  createDesktopDraft as createProductionDesktopDraft,
  getDocumentService,
} from "@/lib/services/document-service-factory"
import { reconcileMaterializedDraftTab, updateTabSaveState } from "@/lib/stores/editor-session-store"

const MARKDOWN_SAVE_DEBOUNCE_MS = 800
// Building the persistence snapshot calls getText/getJSON over the full TipTap
// document and updates shell-level metrics. On desktop, do that work only after
// a short quiet window so the keystroke stays inside ProseMirror. The actual
// local commit starts immediately once the snapshot exists; cloud sync retains
// its separate 1500 ms trailing debounce.
const DESKTOP_EDITOR_OUTPUT_DEBOUNCE_MS = 150
// The durable commit itself (write_file, catalog_dual_write, cloud sync
// enqueue, and the catalog-change event every mounted view reacts to) does not
// need to track keystrokes in near-real-time — content lives in TipTap's
// in-memory state regardless. Coalescing it to once per 4s of typing pause
// keeps that pipeline from running once per pause during sustained typing.
export const DESKTOP_PERSISTENCE_DEBOUNCE_MS = 4_000

const DESKTOP_UNTITLED_WRITING_TITLE = UNTITLED_DOCUMENT_NAME

export type KeptVersionConflictNotice = {
  writingId: string
  keptPath: string | null
  preservationFailed: boolean
}

export type EditorPersistenceInput = {
  currentWritingId: string | null
  currentWritingIdRef: RefObject<string | null>
  activeEditorTabIdRef: RefObject<string | null>
  ephemeralDraftWritingIdRef: RefObject<string | null>
  draftContentSnapshotRef: RefObject<{ draftId: string; bodyJson: Record<string, unknown> } | null>
  materializedDraftIdsRef: RefObject<Map<string, string>>
  navigatedToDraftRef: RefObject<boolean>
  routeWritingIdRef: RefObject<string | null>
  routerRef: RefObject<ReturnType<typeof useRouter>>
  externalContentConflictRef: RefObject<ExternalContentConflict | null>
  hasUnconfirmedLocalEditRef: RefObject<boolean>
  isApplyingContentRef: RefObject<boolean>
  modeRef: RefObject<"rich" | "markdown">
  createdAtRef: RefObject<string | null>
  titleRef: RefObject<string>
  hasExplicitTitleRef: RefObject<boolean>
  versionRef: RefObject<number>
  statusRef: RefObject<WritingStatus>
  artifactTypeRef: RefObject<ArtifactType>
  visibilityRef: RefObject<WritingVisibility>
  lifecycleRef: RefObject<WritingLifecycle>
  richUpdateRafRef: RefObject<number | null>
  richUpdateDebounceRef: RefObject<number | null>
  richUpdateEditorRef: RefObject<Editor | null>
  markdownSaveTimeoutRef: RefObject<number | null>
  pendingMarkdownSaveRef: RefObject<(() => void) | null>
  flushPendingEditOnUnmountRef: RefObject<(() => void) | null>
  onKeptVersionConflict: (notice: KeptVersionConflictNotice) => void
  applySyncStatus: (next: EditorSaveState) => void
  activateDocument: (target: { writingId: string | null; href?: string }, reason: ActivationReason) => void
  applyDocumentMetadata: (patch: DocumentMetadataPatch) => void
  updateDerivedEditorState: (editorInstance: Editor) => void
  createDesktopDraftFn: typeof createProductionDesktopDraft
  createWritingId: () => string
  deriveAutoTitle: (bodyText: string, createdAt: string | null) => string
  navigateToWriting: (
    router: Pick<ReturnType<typeof useRouter>, "push" | "replace">,
    href: string,
    options: { mode: "push" | "replace"; skipOnDesktop: boolean },
  ) => void
  untitledWritingTitle: string
}

export function useEditorPersistence(input: EditorPersistenceInput) {
  const {
    currentWritingId,
    currentWritingIdRef,
    activeEditorTabIdRef,
    ephemeralDraftWritingIdRef,
    draftContentSnapshotRef,
    materializedDraftIdsRef,
    navigatedToDraftRef,
    routeWritingIdRef,
    routerRef,
    externalContentConflictRef,
    hasUnconfirmedLocalEditRef,
    isApplyingContentRef,
    modeRef,
    createdAtRef,
    titleRef,
    hasExplicitTitleRef,
    versionRef,
    statusRef,
    artifactTypeRef,
    visibilityRef,
    lifecycleRef,
    richUpdateRafRef,
    richUpdateDebounceRef,
    richUpdateEditorRef,
    markdownSaveTimeoutRef,
    pendingMarkdownSaveRef,
    flushPendingEditOnUnmountRef,
    onKeptVersionConflict,
    applySyncStatus,
    activateDocument,
    applyDocumentMetadata,
    updateDerivedEditorState,
    createDesktopDraftFn,
    createWritingId,
    deriveAutoTitle,
    navigateToWriting,
    untitledWritingTitle,
  } = input

  const scheduleMarkdownSave = useCallback(
    (run: () => void) => {
      pendingMarkdownSaveRef.current = run
      return window.setTimeout(() => {
        pendingMarkdownSaveRef.current = null
        run()
      }, MARKDOWN_SAVE_DEBOUNCE_MS)
    },
    [pendingMarkdownSaveRef],
  )

  /** Ejecuta ya el guardado de markdown pendiente, si su timer sigue vivo. */
  const flushPendingMarkdownSave = useCallback(() => {
    const run = pendingMarkdownSaveRef.current
    pendingMarkdownSaveRef.current = null
    if (markdownSaveTimeoutRef.current === null || !run) {
      return
    }
    window.clearTimeout(markdownSaveTimeoutRef.current)
    markdownSaveTimeoutRef.current = null
    run()
  }, [markdownSaveTimeoutRef, pendingMarkdownSaveRef])

  const persistenceCoordinator = useMemo(
    () => {
      const applyCommittedTabState = ({ record, snapshot }: PersistenceCommitEvent) => {
        const sourceTabId = snapshot.sourceTabId ?? record.id
        // Same OR-fallback as onStateChange below: right after a draft
        // materializes, currentWritingIdRef updates synchronously but
        // activeEditorTabIdRef only catches up on a later render, so a
        // commit landing in that window must still recognize the genuinely
        // active document (ODE-478 follow-up).
        const isSourceTabActive =
          activeEditorTabIdRef.current === sourceTabId || currentWritingIdRef.current === record.id
        const lifecycle = record.lifecycle ?? snapshot.lifecycle
        const saveState = mapLocalSyncStatusToSaveState(
          "pending",
          lifecycle,
          typeof navigator === "undefined" ? true : navigator.onLine,
        )

        if (!isSourceTabActive) {
          updateTabSaveState({
            tabId: sourceTabId,
            saveState,
            hasPendingSync: lifecycle !== "local-only",
          })
        }

        // A stale completion can still belong to the tab the author has
        // returned to. Only update the active editor when its identity
        // matches; never let another document overwrite these refs.
        if (isSourceTabActive && currentWritingIdRef.current === record.id) {
          applyDocumentMetadata({ version: record.version, createdAt: record.createdAt })
        }
      }

      return createPersistenceCoordinator(
        {
          runtime: isDesktopRuntime() ? "desktop" : "web",
          // Desktop's durable commit (write_file + catalog_dual_write + cloud
          // sync enqueue + the catalog-change fan-out every mounted view
          // reacts to) is expensive enough that near-real-time persistence
          // makes typing itself the bottleneck. Coalescing it to fire once per
          // quiet window — rather than ~150ms after every pause — cuts how
          // often that whole pipeline runs during sustained typing, without
          // changing what the editor shows: TipTap stays the source of truth
          // in memory, and settle() below still flushes immediately on tab
          // close/switch so a deliberate action never waits out this window.
          persistenceDebounceMs: isDesktopRuntime() ? DESKTOP_PERSISTENCE_DEBOUNCE_MS : 0,
          documentService: {
            saveWriting: async (input) => (await getDocumentService()).saveWriting(input),
          },
          createDesktopDraft: (options) => createDesktopDraftFn(options),
          createWritingId,
          now: () => new Date().toISOString(),
        },
        {
        onStateChange: (event: PersistenceStateEvent) => {
          const sourceTabId = event.snapshot.sourceTabId ?? (event.writingId ?? null)
          const isSourceTabActive = sourceTabId
            ? activeEditorTabIdRef.current === sourceTabId ||
              Boolean(event.writingId && currentWritingIdRef.current === event.writingId)
            : event.writingId === currentWritingIdRef.current

          if (sourceTabId && !isSourceTabActive) {
            if (event.state === "persisting_local" || event.state === "dirty") {
              updateTabSaveState({ tabId: sourceTabId, saveState: "saving", hasPendingSync: true })
            } else if (event.state === "failed") {
              updateTabSaveState({ tabId: sourceTabId, saveState: "error", hasPendingSync: true })
            }
          }

          if (!isSourceTabActive) {
            return
          }

          if (event.state === "persisting_local" || event.state === "dirty") {
            applySyncStatus("saving")
            return
          }

          if (event.state === "failed") {
            applySyncStatus("error")
            return
          }

          if (event.state === "queued_remote") {
            applySyncStatus(
              event.created
                ? "saved-local"
                : mapLocalSyncStatusToSaveState(
                    "pending",
                    event.snapshot.lifecycle,
                    typeof navigator === "undefined" ? true : navigator.onLine,
                  ),
            )
          }
        },
        onMaterialized: ({ record, snapshot }) => {
          const materializedTitle = record.title?.trim() || DESKTOP_UNTITLED_WRITING_TITLE
          const sourceTabId = snapshot.sourceTabId ?? EDITOR_DRAFT_TAB_ID
          const isSourceDraftActive =
            currentWritingIdRef.current === null &&
            activeEditorTabIdRef.current === sourceTabId &&
            ephemeralDraftWritingIdRef.current === snapshot.draftWritingId

          if (snapshot.draftWritingId) {
            materializedDraftIdsRef.current.set(snapshot.draftWritingId, record.id)
          }

          // Reconcile the exact source tab even when this completion is stale;
          // a generation only describes UI ownership, never document identity.
          // draftWritingId lets the store tell this draft's own tab apart from
          // a different draft session that has since reused the same tab id
          // (ODE-478 follow-up).
          reconcileMaterializedDraftTab({
            writingId: record.id,
            draftTabId: sourceTabId,
            draftWritingId: snapshot.draftWritingId,
            title: materializedTitle,
            saveState: "saved-local",
            hasPendingSync: false,
          })

          if (ephemeralDraftWritingIdRef.current === snapshot.draftWritingId) {
            ephemeralDraftWritingIdRef.current = null
            draftContentSnapshotRef.current = null
          }

          if (!isSourceDraftActive) {
            // The author is looking at another document (or this completion
            // belongs to an older draft instance). Reconciliation above keeps
            // the file owned without stealing focus or editor state.
            return
          }

          activateDocument({ writingId: record.id }, "materialize")
          ephemeralDraftWritingIdRef.current = null
          applyDocumentMetadata({
            createdAt: record.createdAt,
            title: materializedTitle,
            hasExplicitTitle: false,
            version: record.version,
            slug: null,
            status: "draft",
            artifactType: "general",
            visibility: "private",
            lifecycle: "local-only",
          })
          navigatedToDraftRef.current = true
          // ODE-542: no hace falta reconciliar aquí. Materializar hidrata el
          // documento (ODE-570) y la hidratación relee el estado durable.
        },
        onIdentityCreated: (writingId) => {
          const nextWritingSession = createNewWritingSessionState(writingId)
          // La ruta de esta transición es una navegación real de Next, no una
          // proyección: va por `navigateToWriting`, aquí abajo.
          activateDocument(
            {
              writingId: nextWritingSession.activeWritingId,
            },
            "identity",
          )

          if (!routeWritingIdRef.current) {
            navigatedToDraftRef.current = true
            navigateToWriting(routerRef.current, `/write/${writingId}`, { mode: "replace", skipOnDesktop: false })
          }
        },
        onCommitted: applyCommittedTabState,
        onBackgroundCommitted: applyCommittedTabState,
        onError: (event) => {
          if (event.operation !== "schedule") {
            const sourceTabId = event.snapshot.sourceTabId ?? (event.writingId ?? null)
            if (sourceTabId) {
              updateTabSaveState({ tabId: sourceTabId, saveState: "error", hasPendingSync: true })
            }

            const isSourceTabActive = sourceTabId
              ? activeEditorTabIdRef.current === sourceTabId
              : event.writingId === currentWritingIdRef.current
            if (isSourceTabActive) {
              applySyncStatus("error")

              const details = event.error?.details
              const keptPath = typeof details?.keptPath === "string" ? details.keptPath : null
              const preservationFailed = details?.preservationFailed === true
              if (
                event.operation === "save" &&
                event.error?.code === "CONFLICT" &&
                event.writingId &&
                (keptPath || preservationFailed)
              ) {
                onKeptVersionConflict({
                  writingId: event.writingId,
                  keptPath,
                  preservationFailed,
                })
              }
            }
          }

          console.error(
            event.operation === "draft-materialization"
              ? "[editor:save] desktop draft materialization failed"
              : event.operation === "schedule"
                ? "[editor:sync] schedule failed after local commit"
                : "[editor:save] local save failed",
            {
              writingId: event.writingId,
              error: event.error?.message ?? "Unknown persistence error",
            },
          )
        },
        },
      )
    },
    [
      applySyncStatus,
      activateDocument,
      applyDocumentMetadata,
      createDesktopDraftFn,
      createWritingId,
      onKeptVersionConflict,
    ],
  )

  useEffect(() => {
    persistenceCoordinator.activateDocument(currentWritingId)
  }, [currentWritingId, persistenceCoordinator])

  useEffect(
    () => () => {
      // ODE-573: volcar ANTES de cerrar el coordinador. Este efecto está
      // declarado antes que la limpieza que cancela las colas de la shell, y
      // React ejecuta las limpiezas en ese orden: si el volcado fuera después,
      // el coordinador ya cerrado rechazaría el guardado y se perdería lo
      // escrito en los últimos 150 ms (rich) u 800 ms (markdown).
      flushPendingEditOnUnmountRef.current?.()
      persistenceCoordinator.dispose()
    },
    [persistenceCoordinator, flushPendingEditOnUnmountRef],
  )

  const persistEditorSnapshot = useCallback(
    async (
      editorInstance: Editor,
      overrides?: PersistenceSnapshotOverrides,
      options?: { awaitDurability?: boolean; forceMaterialize?: boolean },
    ) => {
      const activeId = currentWritingIdRef.current

      // WATCH-07 DIRTY — a known external content conflict for this document
      // blocks every autosave (never silently overwrite the external edit
      // the debounce would otherwise write over) until the user explicitly
      // resolves it via the conflict banner's actions, both of which clear
      // this ref themselves before calling back in here.
      if (externalContentConflictRef.current) {
        return false
      }

      const baseCreatedAt = createdAtRef.current
      const nextBodyText = editorInstance.getText()
      const nextDerivedTitle = deriveAutoTitle(nextBodyText, baseCreatedAt)
      const overrideTitle = overrides?.title?.trim()
      const nextTitle =
        overrideTitle && overrideTitle.length > 0
          ? overrideTitle
          : isDesktopRuntime()
            ? titleRef.current.trim() || DESKTOP_UNTITLED_WRITING_TITLE
            : hasExplicitTitleRef.current
            ? titleRef.current.trim() || untitledWritingTitle
            : nextDerivedTitle

      if (!activeId && isDesktopRuntime() && !ephemeralDraftWritingIdRef.current) {
        ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      }

      const draftWritingId = ephemeralDraftWritingIdRef.current
      const sourceTabId = activeEditorTabIdRef.current ?? (activeId ?? EDITOR_DRAFT_TAB_ID)
      const nextBodyJson = editorInstance.getJSON() as Record<string, unknown>

      // WATCH-07 write-side guard: PersistenceCoordinator itself now owns
      // resolving and advancing the durable baseline (see its own doc
      // comment on getDurableContentHash for why — a caller-frozen baseline
      // races a second save queued behind a first one). Nothing to pass
      // through here any more.
      //
      // End the shell's pre-handoff lifecycle and begin the coordinator's
      // post-handoff lifecycle in the same tick. `persist()` records its
      // unconfirmed-content marker synchronously before returning.
      hasUnconfirmedLocalEditRef.current = false
      const result = await persistenceCoordinator.persist(
        {
          writingId: activeId,
          createdAt: baseCreatedAt,
          version: versionRef.current,
          title: nextTitle,
          bodyJson: nextBodyJson,
          bodyText: nextBodyText,
          status: statusRef.current,
          artifactType: artifactTypeRef.current,
          visibility: visibilityRef.current,
          lifecycle: activeId ? lifecycleRef.current : "local-only",
          draftWritingId,
          sourceTabId,
          // getText() misses atomic non-text content (an image, etc.) — use
          // TipTap's own structural emptiness check instead. forceMaterialize
          // lets a caller that's about to add non-text content (e.g. an
          // image upload that needs a real writingId to attach to) claim
          // non-blank a beat early, rather than waiting for content that
          // can't land until materialization already happened (ODE-478
          // follow-up).
          bodyIsEmpty: options?.forceMaterialize ? false : editorInstance.isEmpty,
        },
        overrides,
      )

      if (!options?.awaitDurability || !result) {
        return result
      }

      // persist() can resolve `true` optimistically when merged into an
      // already-in-flight write, without waiting for that write to actually
      // land — fine for fire-and-forget autosave, but a caller reporting
      // success back to the user (e.g. a rename confirmation) needs the real
      // outcome (ODE-478 follow-up).
      return persistenceCoordinator.settle({ writingId: activeId, draftWritingId, sourceTabId })
    },
    [
      persistenceCoordinator,
      activeEditorTabIdRef,
      artifactTypeRef,
      createdAtRef,
      currentWritingIdRef,
      deriveAutoTitle,
      ephemeralDraftWritingIdRef,
      externalContentConflictRef,
      hasExplicitTitleRef,
      hasUnconfirmedLocalEditRef,
      lifecycleRef,
      statusRef,
      titleRef,
      untitledWritingTitle,
      versionRef,
      visibilityRef,
    ],
  )

  const runRichModeUpdateSideEffects = useCallback(
    (editorInstance: Editor) => {
      updateDerivedEditorState(editorInstance)
      void persistEditorSnapshot(editorInstance)
    },
    [persistEditorSnapshot, updateDerivedEditorState],
  )

  const flushQueuedRichModeUpdate = useCallback(() => {
    if (richUpdateRafRef.current !== null) {
      window.cancelAnimationFrame(richUpdateRafRef.current)
      richUpdateRafRef.current = null
    }
    if (richUpdateDebounceRef.current !== null) {
      window.clearTimeout(richUpdateDebounceRef.current)
      richUpdateDebounceRef.current = null
    }
    const queuedEditor = richUpdateEditorRef.current
    richUpdateEditorRef.current = null

    if (!queuedEditor) {
      return
    }

    runRichModeUpdateSideEffects(queuedEditor)
  }, [runRichModeUpdateSideEffects, richUpdateRafRef, richUpdateDebounceRef, richUpdateEditorRef])

  useEffect(() => {
    flushPendingEditOnUnmountRef.current = () => {
      flushQueuedRichModeUpdate()
      flushPendingMarkdownSave()
    }
  }, [flushPendingMarkdownSave, flushQueuedRichModeUpdate, flushPendingEditOnUnmountRef])

  const scheduleQueuedRichModeUpdate = useCallback(() => {
    richUpdateRafRef.current = null
    if (!isDesktopRuntime()) {
      flushQueuedRichModeUpdate()
      return
    }
    if (richUpdateDebounceRef.current !== null) {
      window.clearTimeout(richUpdateDebounceRef.current)
    }
    richUpdateDebounceRef.current = window.setTimeout(() => {
      richUpdateDebounceRef.current = null
      flushQueuedRichModeUpdate()
    }, DESKTOP_EDITOR_OUTPUT_DEBOUNCE_MS)
  }, [flushQueuedRichModeUpdate, richUpdateRafRef, richUpdateDebounceRef])

  const handleEditorUpdate = useCallback(
    ({ editor: nextEditor }: { editor: Editor }) => {
      if (isApplyingContentRef.current || modeRef.current === "markdown") {
        return
      }

      // WATCH-07 — real edit, marked dirty immediately, well before the
      // debounce below even schedules a persist() call.
      hasUnconfirmedLocalEditRef.current = true
      richUpdateEditorRef.current = nextEditor

      if (richUpdateRafRef.current !== null) {
        return
      }

      richUpdateRafRef.current = window.requestAnimationFrame(() => {
        scheduleQueuedRichModeUpdate()
      })
    },
    [
      hasUnconfirmedLocalEditRef,
      isApplyingContentRef,
      modeRef,
      richUpdateEditorRef,
      richUpdateRafRef,
      scheduleQueuedRichModeUpdate,
    ],
  )

  return {
    persistenceCoordinator,
    persistEditorSnapshot,
    flushQueuedRichModeUpdate,
    scheduleMarkdownSave,
    handleEditorUpdate,
  }
}
