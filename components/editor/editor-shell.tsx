"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getMarkRange } from "@tiptap/core"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
import { TextSelection } from "@tiptap/pm/state"
import { useRouter } from "next/navigation"
import {
  mapLocalSyncStatusToSaveState,
  mapSyncLifecycleToSaveState,
  type EditorSaveState,
} from "@/components/editor/save-state"
import { WritingEditorContent } from "@/components/editor/editor-content"
import { EditorEmptyState } from "@/components/editor/editor-empty-state"
import { EditorFindReplace } from "@/components/editor/editor-find-replace"
import { EditorStatusBar } from "@/components/editor/status-bar"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { MobileWriteNotice } from "@/components/editor/mobile-write-notice"
import { AnnotationBubble } from "@/components/reading/margins/annotation-bubble"
import { SelectionPopup } from "@/components/reading/margins/selection-popup"
import { InsertFootnoteModal } from "@/components/editor/modals/insert-footnote-modal"
import { InsertImageModal } from "@/components/editor/modals/insert-image-modal"
import { InsertLinkModal } from "@/components/editor/modals/insert-link-modal"
import { InsertTableModal } from "@/components/editor/modals/insert-table-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import {
  appendMarkdownFootnote,
  extractWritingAnnotationNodes,
  getMarkdownFootnotes,
  removeMarkdownFootnote,
  updateMarkdownFootnote,
} from "@/lib/editor/footnote-extension"
import {
  convertHtmlTablesToMarkdown,
  materializeMarkdownForRichParser,
  normalizeMarkdownForRoundTrip,
  toggleMarkdownInlineMarker,
} from "@/lib/editor/markdown-format"
import { FOOTNOTE_REF_EVENT, getEditorFootnotes, getMarkdownWithFootnoteDefinitions, type AnnotationType } from "@/lib/editor/footnote-node"
import { resolveEscapeIntent } from "@/lib/editor/panel-behavior"
import { applyPanelMarkdownChange, applyPanelMetaChange } from "@/lib/editor/panel-sync"
import {
  clearFindReplaceQueryState,
  clampFindReplaceIndex,
  findDocumentMatches,
  findTextMatches,
  renderFindReplaceOverlayHtml,
  replaceAllMatchesInText,
  replaceMatchInText,
  resolveNextFindReplaceIndex,
  setFindReplaceQueryState,
} from "@/lib/editor/find-replace"
import {
  clearPublicationSuggestions,
  setPublicationSuggestions as setEditorPublicationSuggestions,
} from "@/lib/editor/publication-suggestion-extension"
import { createCorrectionSuggestionBatcher } from "@/lib/editor/correction-suggestion-batcher"
import {
  collectCorrectionBlocks,
  acknowledgeCorrectionDirtyBlocks,
  getCurrentCorrectionBlock,
  type CorrectionTriggerBlock,
} from "@/lib/editor/correction-trigger-plugin"
import {
  applyAllPublicationSuggestions,
  applySuggestionToMarkdown,
  deriveSuggestionContexts,
  hashPublicationSource,
  invalidateBlockSuggestions,
  isSuggestionAcceptDisabled,
  replaceBlockSuggestions,
  updateSuggestionStatuses,
} from "@/lib/editor/suggestion-engine"
import { readCorrectionMemory, rememberCorrectionDecision } from "@/lib/editor/correction-memory-client"
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter"
import {
  createBlankDraftIdentity,
  createNewWritingSessionState,
  createRouteHydrationSessionState,
  resolveExternalWritingLoad,
} from "@/lib/editor/hydration-session"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { getExportFileBaseName } from "@/lib/export/writing-export"
import {
  buildEditorSpellcheckConfig,
  DEFAULT_EDITOR_SPELLCHECK_LANGUAGE,
  persistEditorSpellcheckPreference,
  readEditorSpellcheckPreference,
  type EditorSpellcheckPreference,
} from "@/lib/editor/spellcheck"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { type EditorShortcutAction, getEditorShortcutAction } from "@/lib/editor/shortcuts"
import type { RichSelectionRange } from "@/lib/editor/topbar-compact"
import { calculateTextMetrics } from "@/lib/editor/text-metrics"
import { downloadBlob as downloadBlobUtil } from "@/lib/utils/download"
import { useEditorSelection, type MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { logCorrectionEvent } from "@/lib/observability/corrections-log"
import {
  CORRECTION_BLOCK_CACHE_LIMIT,
  createCorrectionBlockRecordId,
  hydrateCorrectionBlocksFromRemote,
  parseCorrectionBlockPosition,
  persistCorrectionBlockRemotely,
} from "@/lib/corrections/persistence"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type {
  LocalCorrectionBlock,
  LocalWriting,
  PublicationSuggestion,
  WritingLifecycle,
  WritingStatus,
  WritingVisibility,
} from "@/lib/local-db/schema"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
import { webAIService } from "@/lib/services/web-ai-service"
import { webDocumentService } from "@/lib/services/web-document-service"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import type { WritingRecord } from "@/lib/services/contracts/document-service"
import {
  closeTab,
  focusTab,
  initializeEditorSessionStore,
  openDraftTab,
  openWritingTab,
  publishTabState,
  saveTabViewState,
  useEditorSessionStore,
} from "@/lib/stores/editor-session-store"
import { setSidebarMode } from "@/lib/stores/ui-shell-store"

type EditorShellProps = {
  writingId?: string
  forceNewWriting?: boolean
}

type SelectionSnapshot = {
  from: number
  to: number
  text: string
}

type PendingAnnotationSnapshot = {
  from: number
  to: number
  text: string
  position: { x: number; y: number }
  annotationType?: "personal" | "ai" | "footnote"
}

type PendingRichSelectionSnapshot = {
  from: number
  to: number
  text: string
  popupPosition: { x: number; y: number }
  bubblePosition: { x: number; y: number }
}

type EditorCursorSnapshot =
  | {
      mode: "rich"
      from: number
      to: number
    }
  | {
      mode: "markdown"
      start: number
      end: number
      scrollTop?: number
      scrollLeft?: number
      editorScrollTop?: number
      editorScrollLeft?: number
      shellScrollTop?: number
      shellScrollLeft?: number
      windowScrollX?: number
      windowScrollY?: number
    }

type EditorPanel = "notes" | "properties" | "publication" | null

type PersistSnapshotOverrides = {
  title?: string
  status?: WritingStatus
  visibility?: WritingVisibility
}

type RenameWritingSnapshot = {
  title: string
  bodyText: string
}

type CorrectionToastState = {
  phase: "running" | "complete"
  completed: number
  total: number
}

const NotesPanel = lazy(() =>
  import("@/components/editor/panels/notes-panel").then((module) => ({ default: module.NotesPanel })),
)

const PropertiesPanel = lazy(() =>
  import("@/components/editor/panels/properties-panel").then((module) => ({
    default: module.PropertiesPanel,
  })),
)

const CorrectionsPanel = lazy(() =>
  import("@/components/editor/panels/corrections-panel").then((module) => ({
    default: module.CorrectionsPanel,
  })),
)

const MARKDOWN_SAVE_DEBOUNCE_MS = 800

const AUTO_TITLE_MAX_CHARS = 48
const UNTITLED_WRITING_TITLE = "Untitled writing"

function deriveAutoTitle(bodyText: string, createdAt: string | null): string {
  const text = bodyText.trim()

  if (!text) {
    const dateSource = createdAt ? new Date(createdAt) : new Date()
    const yyyy = dateSource.getFullYear()
    const mm = String(dateSource.getMonth() + 1).padStart(2, "0")
    const dd = String(dateSource.getDate()).padStart(2, "0")
    return `Untitled — ${yyyy}-${mm}-${dd}`
  }

  if (text.length <= AUTO_TITLE_MAX_CHARS) {
    return text
  }

  const truncated = text.slice(0, AUTO_TITLE_MAX_CHARS)
  const lastSpace = truncated.lastIndexOf(" ")
  return lastSpace > 0 ? truncated.slice(0, lastSpace) : truncated
}

function isExplicitWritingTitle(title: string | null | undefined, bodyText: string, createdAt: string | null): boolean {
  const normalizedTitle = title?.trim() ?? ""

  if (!normalizedTitle || normalizedTitle === UNTITLED_WRITING_TITLE) {
    return false
  }

  return normalizedTitle !== deriveAutoTitle(bodyText, createdAt)
}

const createWritingId = () => {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }

  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const values = new Uint8Array(16)
    crypto.getRandomValues(values)

    values[6] = (values[6] & 0x0f) | 0x40
    values[8] = (values[8] & 0x3f) | 0x80

    const hex = Array.from(values, (value) => value.toString(16).padStart(2, "0")).join("")
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
  }

  throw new Error("Unable to generate a UUID for the writing.")
}

const isPerfHarness = () =>
  typeof window !== "undefined" && window.location.pathname.startsWith("/perf/")

export function EditorShell({ writingId, forceNewWriting = false }: EditorShellProps) {
  const router = useRouter()
  const { loaded: sessionLoaded, session: editorSession } = useEditorSessionStore()
  const routeWritingId = writingId ?? null
  const initialHydrationSession = createRouteHydrationSessionState(routeWritingId)

  const [currentWritingId, setCurrentWritingId] = useState<string | null>(initialHydrationSession.activeWritingId)
  const [hydrationWritingId, setHydrationWritingId] = useState<string | null>(initialHydrationSession.hydrationWritingId)
  const [title, setTitle] = useState(UNTITLED_WRITING_TITLE)
  const [hasExplicitTitle, setHasExplicitTitle] = useState(false)
  const [mode, setMode] = useState<"rich" | "markdown">("rich")
  const [markdownValue, setMarkdownValue] = useState("")

  const [bodyText, setBodyText] = useState("")
  const [markdownSelectionState, setMarkdownSelectionState] = useState<MarkdownSelectionSnapshot | null>(null)
  const [syncStatus, setSyncStatus] = useState<EditorSaveState>("saved")
  const [version, setVersion] = useState(1)
  const [richFootnoteRevision, setRichFootnoteRevision] = useState(0)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [writingSlug, setWritingSlug] = useState<string | null>(null)
  const [writingStatus, setWritingStatus] = useState<WritingStatus>("draft")
  const [writingVisibility, setWritingVisibility] = useState<WritingVisibility>("private")
  const [lifecycle, setLifecycle] = useState<WritingLifecycle>("local-only")
  const lifecycleRef = useRef<WritingLifecycle>("local-only")
  const [isBodyHydrating, setIsBodyHydrating] = useState(false)
  const [activePanel, setActivePanel] = useState<EditorPanel>(null)
  const [spellcheckScope, setSpellcheckScope] = useState(() => getLocalDBScope())
  const [spellcheckPreference, setSpellcheckPreference] = useState<EditorSpellcheckPreference>("system")
  const [automaticCorrectionSuggestions, setAutomaticCorrectionSuggestions] = useState<PublicationSuggestion[]>([])
  const [correctionToast, setCorrectionToast] = useState<CorrectionToastState | null>(null)
  const [correctionsEnabled, setCorrectionsEnabled] = useState(true)
  const [showCorrections, setShowCorrections] = useState(true)

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameModalSnapshot, setRenameModalSnapshot] = useState<RenameWritingSnapshot | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [replaceValue, setReplaceValue] = useState("")
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findActiveIndex, setFindActiveIndex] = useState(0)
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotationSnapshot | null>(null)
  const [pendingRichSelection, setPendingRichSelection] = useState<PendingRichSelectionSnapshot | null>(null)

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const hasExplicitTitleRef = useRef(hasExplicitTitle)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const writingSlugRef = useRef<string | null>(null)
  const statusRef = useRef<WritingStatus>(writingStatus)
  const visibilityRef = useRef<WritingVisibility>(writingVisibility)
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  const isApplyingContentRef = useRef(false)
  const currentWritingIdRef = useRef<string | null>(initialHydrationSession.activeWritingId)
  const navigatedToDraftRef = useRef(false)
  const identityEnsuredRef = useRef(false)
  const forceNewWritingRequestedRef = useRef(false)
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const markdownSelectionRef = useRef<MarkdownSelectionSnapshot | null>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const editorCursorSnapshotRef = useRef<EditorCursorSnapshot | null>(null)
  const richUpdateRafRef = useRef<number | null>(null)
  const richUpdateEditorRef = useRef<Editor | null>(null)
  const markdownSelectionRafRef = useRef<number | null>(null)
  const pendingMarkdownSelectionRef = useRef<{
    start: number
    end: number
    scrollTop?: number
    scrollLeft?: number
    editorScrollTop?: number
    editorScrollLeft?: number
    shellScrollTop?: number
    shellScrollLeft?: number
    windowScrollX?: number
    windowScrollY?: number
  } | null>(null)
  const suppressNextSelectionPopupRef = useRef(false)
  const currentDocumentMarkdownRef = useRef("")
  const correctionsEnabledRef = useRef(true)
  const automaticCorrectionSuggestionsRef = useRef<PublicationSuggestion[]>([])
  const persistedCorrectionBlocksRef = useRef(new Map<string, LocalCorrectionBlock>())
  const enqueueCorrectionBlockRef = useRef<((block: CorrectionTriggerBlock, reason?: "edit" | "hydrate-miss") => void) | null>(null)
  const correctionQueueRef = useRef<CorrectionTriggerBlock[]>([])
  const correctionProcessingRef = useRef(false)
  const correctionQueueTotalRef = useRef(0)
  const correctionQueueCompletedRef = useRef(0)
  const correctionTimersRef = useRef(new Map<string, { timer: number; pos: number }>())
  const correctionToastDismissRef = useRef<number | null>(null)
  const suppressCorrectionAnalysisUntilRef = useRef(0)
  const editorExtensions = useMemo(() => createEditorExtensions(), [])
  const spellcheckConfig = useMemo(
    () => buildEditorSpellcheckConfig(spellcheckPreference),
    [spellcheckPreference],
  )
  const correctionSuggestionBatcher = useMemo(
    () => createCorrectionSuggestionBatcher(setAutomaticCorrectionSuggestions),
    [],
  )

  const updateDerivedEditorState = useCallback((editorInstance: Editor) => {
    setBodyText(editorInstance.getText())
  }, [])

  const applyCorrectionSuggestionUpdate = useCallback(
    (
      updater: (current: PublicationSuggestion[]) => PublicationSuggestion[],
      options?: { immediate?: boolean },
    ) => {
      if (options?.immediate) {
        correctionSuggestionBatcher.flush()
        setAutomaticCorrectionSuggestions(updater)
        return
      }

      correctionSuggestionBatcher.enqueue(updater)
    },
    [correctionSuggestionBatcher],
  )

  const setPersistedCorrectionBlocks = useCallback((blocks: LocalCorrectionBlock[]) => {
    persistedCorrectionBlocksRef.current = new Map(
      blocks.map((block) => [block.blockHash, block] satisfies [string, LocalCorrectionBlock]),
    )
  }, [])

  const flattenPersistedSuggestions = useCallback((blocks: LocalCorrectionBlock[]) => {
    const suggestionsById = new Map<string, PublicationSuggestion>()

    for (const block of blocks) {
      for (const suggestion of block.suggestions) {
        suggestionsById.set(suggestion.id, suggestion)
      }
    }

    return [...suggestionsById.values()]
  }, [])

  const syncPersistedCorrectionBlock = useCallback(async (block: LocalCorrectionBlock) => {
    persistedCorrectionBlocksRef.current.set(block.blockHash, block)
    await localDB.correctionBlocks.save(block)
    await localDB.correctionBlocks.evictOldestWriting(CORRECTION_BLOCK_CACHE_LIMIT)
  }, [])

  const persistCorrectionBlockWriteThrough = useCallback(
    async (block: LocalCorrectionBlock, deletedBlockIds: string[] = []) => {
      await syncPersistedCorrectionBlock(block)

      void persistCorrectionBlockRemotely({
        writingId: block.writingId,
        block,
        deletedBlockIds,
      })
        .then(() => {
          persistedCorrectionBlocksRef.current.set(block.blockHash, {
            ...block,
            syncedAt: new Date().toISOString(),
          })
        })
        .catch((error) => {
          console.info(
            `[corrections] persist skipped message=${error instanceof Error ? error.message : String(error)}`,
          )
        })
    },
    [syncPersistedCorrectionBlock],
  )

  const updatePersistedBlocksFromSuggestions = useCallback(
    async (nextSuggestions: PublicationSuggestion[], blockHashes: string[]) => {
      const updatedBlocks = blockHashes
        .map((blockHash) => {
          const currentBlock = persistedCorrectionBlocksRef.current.get(blockHash)

          if (!currentBlock) {
            return null
          }

          return {
            ...currentBlock,
            suggestions: nextSuggestions.filter((suggestion) => suggestion.source_hash === blockHash),
          } satisfies LocalCorrectionBlock
        })
        .filter((block): block is LocalCorrectionBlock => block !== null)

      if (updatedBlocks.length === 0) {
        return
      }

      for (const block of updatedBlocks) {
        await persistCorrectionBlockWriteThrough(block)
      }
    },
    [persistCorrectionBlockWriteThrough],
  )

  const deletePersistedBlocksForPosition = useCallback(
    async (writingId: string, block: CorrectionTriggerBlock) => {
      const staleBlocks = [...persistedCorrectionBlocksRef.current.values()].filter((candidate) => {
        const candidatePosition = parseCorrectionBlockPosition(candidate.blockId)
        return candidatePosition === block.pos && candidate.blockHash !== block.hash
      })

      if (staleBlocks.length === 0) {
        return
      }

      staleBlocks.forEach((candidate) => {
        persistedCorrectionBlocksRef.current.delete(candidate.blockHash)
      })
      await localDB.correctionBlocks.deleteMany(staleBlocks.map((candidate) => candidate.id))

      void persistCorrectionBlockRemotely({
        writingId,
        deletedBlockIds: staleBlocks.map((candidate) => candidate.id),
      }).catch((error) => {
        console.info(
          `[corrections] stale delete skipped message=${error instanceof Error ? error.message : String(error)}`,
        )
      })
    },
    [],
  )

  const flushPendingCorrectionBlocks = useCallback(async (writingId: string) => {
    const pendingBlocks = (await localDB.correctionBlocks.getByWriting(writingId)).filter(
      (block) => block.syncedAt === null,
    )

    for (const block of pendingBlocks) {
      void persistCorrectionBlockRemotely({
        writingId,
        block,
      })
        .then(() => {
          persistedCorrectionBlocksRef.current.set(block.blockHash, {
            ...block,
            syncedAt: new Date().toISOString(),
          })
        })
        .catch((error) => {
          console.info(
            `[corrections] retry skipped message=${error instanceof Error ? error.message : String(error)}`,
          )
        })
    }
  }, [])

  const persistEditorSnapshot = useCallback(
    async (editorInstance: Editor, overrides?: PersistSnapshotOverrides) => {
      const nowIso = new Date().toISOString()
      const activeId = currentWritingIdRef.current
      const nextId = activeId ?? createWritingId()
      const baseCreatedAt = createdAtRef.current ?? nowIso
      const nextVersion = versionRef.current + 1
      const nextBodyText = editorInstance.getText()
      const nextDerivedTitle = deriveAutoTitle(nextBodyText, baseCreatedAt)
      const overrideTitle = overrides?.title?.trim()
      const nextTitle =
        overrideTitle && overrideTitle.length > 0
          ? overrideTitle
          : hasExplicitTitleRef.current
            ? titleRef.current.trim() || UNTITLED_WRITING_TITLE
            : nextDerivedTitle

      if (!activeId) {
        const nextWritingSession = createNewWritingSessionState(nextId)
        currentWritingIdRef.current = nextWritingSession.activeWritingId
        setCurrentWritingId(nextWritingSession.activeWritingId)
        setHydrationWritingId(nextWritingSession.hydrationWritingId)

        if (!routeWritingId && !navigatedToDraftRef.current) {
          navigatedToDraftRef.current = true
          if (isPerfHarness()) {
            window.history.replaceState(null, "", `/write/${nextId}`)
          } else {
            router.replace(`/write/${nextId}`)
          }
        }
      }

      setSyncStatus("saving")

      const nextLifecycle = !activeId ? "local-only" : lifecycleRef.current

      const nextRecord: WritingRecord = {
        id: nextId,
        authorId: null,
        title: nextTitle,
        content: {
          richText: editorInstance.getJSON() as Record<string, unknown>,
          markdown: null,
          plainText: nextBodyText,
          canonicalSource: "rich-text",
        },
        slug: null,
        status: overrides?.status ?? statusRef.current,
        visibility: overrides?.visibility ?? visibilityRef.current,
        parentId: null,
        correspondenceId: null,
        version: nextVersion,
        deletedAt: null,
        createdAt: baseCreatedAt,
        updatedAt: nowIso,
      }

      try {
        const result = await webDocumentService.saveWriting({ writing: nextRecord })
        if (result.error) {
          throw new Error(result.error.message)
        }
        versionRef.current = nextVersion
        setVersion(nextVersion)
        createdAtRef.current = baseCreatedAt
        setCreatedAt(baseCreatedAt)
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            "pending",
            nextLifecycle,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
      } catch {
        setSyncStatus(typeof navigator !== "undefined" && !navigator.onLine ? "saved-local" : "saving")
      }
    },
    [routeWritingId, router],
  )

  const runRichModeUpdateSideEffects = useCallback(
    (editorInstance: Editor) => {
      updateDerivedEditorState(editorInstance)
      void persistEditorSnapshot(editorInstance)
    },
    [persistEditorSnapshot, updateDerivedEditorState],
  )

  const flushQueuedRichModeUpdate = useCallback(() => {
    richUpdateRafRef.current = null
    const queuedEditor = richUpdateEditorRef.current
    richUpdateEditorRef.current = null

    if (!queuedEditor) {
      return
    }

    runRichModeUpdateSideEffects(queuedEditor)
  }, [runRichModeUpdateSideEffects])

  const queueMarkdownSelectionRestore = useCallback(
    (
      start: number,
      end: number,
      options?: {
        scrollTop?: number
        scrollLeft?: number
        editorScrollTop?: number
        editorScrollLeft?: number
        shellScrollTop?: number
        shellScrollLeft?: number
        windowScrollX?: number
        windowScrollY?: number
      },
    ) => {
      pendingMarkdownSelectionRef.current = { start, end, ...options }

      if (markdownSelectionRafRef.current !== null) {
        return
      }

      markdownSelectionRafRef.current = window.requestAnimationFrame(() => {
        markdownSelectionRafRef.current = null

        const pendingSelection = pendingMarkdownSelectionRef.current
        pendingMarkdownSelectionRef.current = null

        if (!pendingSelection) {
          return
        }

        const nextTextarea = markdownTextareaRef.current

        if (!nextTextarea) {
          return
        }

        if (document.activeElement !== nextTextarea) {
          nextTextarea.focus()
        }

        if (nextTextarea.selectionStart !== pendingSelection.start || nextTextarea.selectionEnd !== pendingSelection.end) {
          nextTextarea.setSelectionRange(pendingSelection.start, pendingSelection.end)
        }

        if (typeof pendingSelection.scrollTop === "number") {
          nextTextarea.scrollTop = pendingSelection.scrollTop
        }

        if (typeof pendingSelection.scrollLeft === "number") {
          nextTextarea.scrollLeft = pendingSelection.scrollLeft
        }

        const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')

        if (
          editorViewport &&
          (typeof pendingSelection.editorScrollTop === "number" || typeof pendingSelection.editorScrollLeft === "number")
        ) {
          const applyViewportScroll = () => {
            if (typeof pendingSelection.editorScrollTop === "number") {
              editorViewport.scrollTop = pendingSelection.editorScrollTop
            }

            if (typeof pendingSelection.editorScrollLeft === "number") {
              editorViewport.scrollLeft = pendingSelection.editorScrollLeft
            }
          }

          applyViewportScroll()
          window.requestAnimationFrame(applyViewportScroll)
        }

        const shellViewport = document.querySelector<HTMLElement>("main")
        if (
          shellViewport &&
          (typeof pendingSelection.shellScrollTop === "number" || typeof pendingSelection.shellScrollLeft === "number")
        ) {
          const applyShellScroll = () => {
            if (typeof pendingSelection.shellScrollTop === "number") {
              shellViewport.scrollTop = pendingSelection.shellScrollTop
            }

            if (typeof pendingSelection.shellScrollLeft === "number") {
              shellViewport.scrollLeft = pendingSelection.shellScrollLeft
            }
          }

          applyShellScroll()
          window.requestAnimationFrame(applyShellScroll)
        }

        if (typeof pendingSelection.windowScrollX === "number" || typeof pendingSelection.windowScrollY === "number") {
          const applyWindowScroll = () => {
            window.scrollTo(
              typeof pendingSelection.windowScrollX === "number" ? pendingSelection.windowScrollX : window.scrollX,
              typeof pendingSelection.windowScrollY === "number" ? pendingSelection.windowScrollY : window.scrollY,
            )
          }

          applyWindowScroll()
          window.requestAnimationFrame(applyWindowScroll)
        }

        markdownSelectionRef.current = {
          start: pendingSelection.start,
          end: pendingSelection.end,
          text: nextTextarea.value.slice(pendingSelection.start, pendingSelection.end),
        }
      })
    },
    [],
  )

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: EMPTY_EDITOR_JSON,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "odessay-editor-content odessay-rich-content",
          spellcheck: "true",
          autocorrect: "on",
          autocapitalize: "on",
          lang: DEFAULT_EDITOR_SPELLCHECK_LANGUAGE,
        },
      },
      onUpdate: ({ editor: nextEditor }) => {
        if (isApplyingContentRef.current || modeRef.current === "markdown") {
          return
        }

        richUpdateEditorRef.current = nextEditor

        if (richUpdateRafRef.current !== null) {
          return
        }

        richUpdateRafRef.current = window.requestAnimationFrame(() => {
          flushQueuedRichModeUpdate()
        })
      },
    },
    [editorExtensions, flushQueuedRichModeUpdate],
  )

  const persistCurrentWorkspaceViewState = useCallback(() => {
    const tabId = currentWritingIdRef.current ?? EDITOR_DRAFT_TAB_ID
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    const shellViewport = document.querySelector<HTMLElement>("main")

    saveTabViewState({
      tabId,
      viewState: {
        mode: modeRef.current,
        scrollTop: editorViewport?.scrollTop ?? 0,
        scrollLeft: editorViewport?.scrollLeft ?? 0,
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
        shellScrollTop: shellViewport?.scrollTop ?? 0,
        shellScrollLeft: shellViewport?.scrollLeft ?? 0,
        selectionFrom: modeRef.current === "rich" && editor ? editor.state.selection.from : null,
        selectionTo: modeRef.current === "rich" && editor ? editor.state.selection.to : null,
        markdownSelectionStart:
          modeRef.current === "markdown"
            ? markdownSelectionRef.current?.start ?? markdownTextareaRef.current?.selectionStart ?? null
            : null,
        markdownSelectionEnd:
          modeRef.current === "markdown"
            ? markdownSelectionRef.current?.end ?? markdownTextareaRef.current?.selectionEnd ?? null
            : null,
      },
    })
  }, [editor])

  useEffect(() => {
    void initializeEditorSessionStore()
  }, [])

  useEffect(() => {
    setSpellcheckScope(getLocalDBScope())

    return subscribeToLocalDBScopeChanges((nextScope) => {
      setSpellcheckScope(nextScope)
    })
  }, [])

  useEffect(() => {
    setSpellcheckPreference(readEditorSpellcheckPreference(spellcheckScope))
  }, [spellcheckScope])

  useEffect(() => {
    if (!editor) {
      return
    }

    editor.setOptions({
      editorProps: {
        attributes: {
          class: "odessay-editor-content odessay-rich-content",
          spellcheck: spellcheckConfig.enabled ? "true" : "false",
          autocorrect: spellcheckConfig.autoCorrect,
          autocapitalize: spellcheckConfig.autoCapitalize,
          lang: spellcheckConfig.language,
        },
      },
    })
  }, [editor, spellcheckConfig])

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => () => correctionSuggestionBatcher.clear(), [correctionSuggestionBatcher])

  useEffect(() => {
    if (!editor) {
      return
    }

    if (mode !== "rich" || !showCorrections) {
      clearPublicationSuggestions(editor)
      return
    }

    const suggestionsById = new Map<string, PublicationSuggestion>()

    for (const suggestion of automaticCorrectionSuggestions) {
      suggestionsById.set(suggestion.id, suggestion)
    }

    setEditorPublicationSuggestions(editor, [...suggestionsById.values()])
  }, [editor, mode, automaticCorrectionSuggestions, showCorrections])

  useEffect(() => {
    correctionsEnabledRef.current = correctionsEnabled
  }, [correctionsEnabled])

  useEffect(() => {
    if (correctionsEnabled) {
      return
    }

    for (const { timer } of correctionTimersRef.current.values()) {
      window.clearTimeout(timer)
    }

    correctionTimersRef.current.clear()
    correctionQueueRef.current = []
    correctionQueueTotalRef.current = 0
    correctionQueueCompletedRef.current = 0
    correctionProcessingRef.current = false
    setCorrectionToast(null)
  }, [correctionsEnabled])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    hasExplicitTitleRef.current = hasExplicitTitle
  }, [hasExplicitTitle])

  useEffect(() => {
    versionRef.current = version
  }, [version])

  useEffect(() => {
    createdAtRef.current = createdAt
  }, [createdAt])

  useEffect(() => {
    writingSlugRef.current = writingSlug
  }, [writingSlug])

  useEffect(() => {
    statusRef.current = writingStatus
  }, [writingStatus])

  useEffect(() => {
    visibilityRef.current = writingVisibility
  }, [writingVisibility])

  useEffect(() => {
    lifecycleRef.current = lifecycle
  }, [lifecycle])

  useEffect(() => {
    const nextExternalLoad = resolveExternalWritingLoad(currentWritingIdRef.current, routeWritingId)

    if (!nextExternalLoad) {
      return
    }

    currentWritingIdRef.current = nextExternalLoad.activeWritingId
    setCurrentWritingId(nextExternalLoad.activeWritingId)
    setHydrationWritingId(nextExternalLoad.hydrationWritingId)
    navigatedToDraftRef.current = false
  }, [routeWritingId])

  useEffect(() => {
    currentWritingIdRef.current = currentWritingId
  }, [currentWritingId])

  useEffect(() => {
    if (!sessionLoaded || !routeWritingId) {
      return
    }

    openWritingTab({ writingId: routeWritingId, replaceDraft: false })
  }, [routeWritingId, sessionLoaded])

  useEffect(() => {
    if (forceNewWriting || !sessionLoaded || routeWritingId || currentWritingIdRef.current) {
      return
    }

    if (editorSession.active_tab_id && editorSession.active_tab_id !== EDITOR_DRAFT_TAB_ID) {
      const activeTab = editorSession.tabs.find((tab) => tab.id === editorSession.active_tab_id)
      if (activeTab?.writing_id) {
        if (isPerfHarness()) {
          window.history.replaceState(null, "", `/write/${activeTab.slug ?? activeTab.writing_id}`)
        } else {
          router.replace(`/write/${activeTab.slug ?? activeTab.writing_id}`)
        }
        return
      }
    }

    openDraftTab()
  }, [editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded])

  // Eagerly create a stable local identity for blank /write so the first
  // paste/input never races against identity creation. This is the explicit
  // owner of the blank-draft -> identified-local-writing transition.
  useEffect(() => {
    if (forceNewWriting || !sessionLoaded || routeWritingId || identityEnsuredRef.current || currentWritingIdRef.current) {
      return
    }

    // If the session store already has an active non-draft tab, let the
    // openDraftTab effect above handle redirection.
    if (editorSession.active_tab_id && editorSession.active_tab_id !== EDITOR_DRAFT_TAB_ID) {
      return
    }

    identityEnsuredRef.current = true

    const ensureIdentity = async () => {
      const { writingId: nextId } = createBlankDraftIdentity()
      const nowIso = new Date().toISOString()
      const nextTitle = deriveAutoTitle("", nowIso)

      try {
        await webDocumentService.saveWriting({
          writing: {
            id: nextId,
            authorId: null,
            title: nextTitle,
            content: {
              richText: EMPTY_EDITOR_JSON as Record<string, unknown>,
              markdown: null,
              plainText: "",
              canonicalSource: "rich-text",
            },
            slug: null,
            status: "draft",
            visibility: "private",
            parentId: null,
            correspondenceId: null,
            version: 1,
            deletedAt: null,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
        })
      } catch {
        // If the save fails (e.g., scope change in progress), fall back to
        // the identity-on-first-input path in persistEditorSnapshot.
        identityEnsuredRef.current = false
        return
      }

      openWritingTab({
        writingId: nextId,
        title: nextTitle,
        saveState: "saved-local",
        hasPendingSync: false,
        replaceDraft: true,
      })

      currentWritingIdRef.current = nextId
      setCurrentWritingId(nextId)
      setHydrationWritingId(null)
      setTitle(nextTitle)
      setHasExplicitTitle(false)
      setBodyText("")
      setVersion(1)
      createdAtRef.current = nowIso
      setCreatedAt(nowIso)
      setWritingSlug(null)
      setWritingStatus("draft")
      setWritingVisibility("private")
      setLifecycle("local-only")
      setSyncStatus("saved-local")
      titleRef.current = nextTitle
      hasExplicitTitleRef.current = false
      versionRef.current = 1
      writingSlugRef.current = null
      statusRef.current = "draft"
      visibilityRef.current = "private"
      lifecycleRef.current = "local-only"
      navigatedToDraftRef.current = true
      if (isPerfHarness()) {
        window.history.replaceState(null, "", `/write/${nextId}`)
      } else {
        router.replace(`/write/${nextId}`)
      }
    }

    void ensureIdentity()
  }, [editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded])

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  useEffect(() => {
    document.body.classList.toggle("od-editor-focus-mode", isFocusMode)

    if (isFocusMode) {
      setActivePanel(null)
      setIsFindReplaceOpen(false)
    }

    return () => {
      document.body.classList.remove("od-editor-focus-mode")
    }
  }, [activePanel, isFocusMode])

  useEffect(() => {
    if (!editor) {
      return
    }

    if (!currentWritingId) {
      // No tab is open — clear stale content so the editor never shows a previous
      // writing after the last tab is closed.
      isApplyingContentRef.current = true
      editor.commands.setContent(EMPTY_EDITOR_JSON)
      isApplyingContentRef.current = false
      updateDerivedEditorState(editor)
      setWritingStatus("draft")
      setWritingVisibility("private")
      setTitle(UNTITLED_WRITING_TITLE)
      setHasExplicitTitle(false)
      setBodyText("")
      setVersion(1)
      setCreatedAt(null)
      setWritingSlug(null)
      setLifecycle("local-only")
      setSyncStatus("saved")
      setPersistedCorrectionBlocks([])
      applyCorrectionSuggestionUpdate(() => [], { immediate: true })
      titleRef.current = UNTITLED_WRITING_TITLE
      hasExplicitTitleRef.current = false
      versionRef.current = 1
      createdAtRef.current = null
      writingSlugRef.current = null
      lifecycleRef.current = "local-only"
      window.requestAnimationFrame(() => {
        editor.commands.focus("start")
      })
      return
    }

    updateDerivedEditorState(editor)

    if (!hydrationWritingId) {
      return
    }

    let cancelled = false
    const targetWritingId = hydrationWritingId

    const hydrateEditor = async () => {
      let localWriting: LocalWriting | null = null
      let localCorrectionBlocks = await localDB.correctionBlocks.getByWriting(targetWritingId)

      // openWriting handles local read + optional remote hydration in one call.
      // Skeleton surfaces only when the call takes longer than 200 ms.
      const skeletonTimer = setTimeout(() => {
        if (!cancelled) {
          setIsBodyHydrating(true)
        }
      }, 200)

      try {
        const openResult = await webDocumentService.openWriting(targetWritingId)
        if (openResult.error) {
          console.error(`[editor] openWriting failed for ${targetWritingId}`, openResult.error)
          return
        }
        localWriting = await localDB.writings.get(targetWritingId)
      } catch (error) {
        console.error(`[editor] openWriting failed for ${targetWritingId}`, error)
        return
      } finally {
        clearTimeout(skeletonTimer)
        if (!cancelled) {
          setIsBodyHydrating(false)
        }
      }

      if (cancelled) {
        return
      }

      if (localCorrectionBlocks.length === 0) {
        try {
          localCorrectionBlocks = await hydrateCorrectionBlocksFromRemote(targetWritingId)
        } catch (error) {
          console.error(`[editor] correction hydration failed for ${targetWritingId}`, error)
          localCorrectionBlocks = []
        }
      } else {
        void flushPendingCorrectionBlocks(targetWritingId)
      }

      if (cancelled) {
        return
      }

      if (localWriting) {
        isApplyingContentRef.current = true
        // Load JSON first to get the markdown serialization, then re-parse as markdown
        // so that footnote references are converted to footnoteReference nodes.
        editor.commands.setContent(localWriting.body_json)
        const loadedMarkdown = normalizeMarkdownForRoundTrip(
          getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor))
        )
        if (loadedMarkdown) {
          editor.commands.setContent(materializeMarkdownForRichParser(loadedMarkdown))
        }
        isApplyingContentRef.current = false
        setPersistedCorrectionBlocks(localCorrectionBlocks)
        applyCorrectionSuggestionUpdate(() => flattenPersistedSuggestions(localCorrectionBlocks), {
          immediate: true,
        })

        if (localCorrectionBlocks.length > 0) {
          suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        }

        const cachedBlockHashes = new Set(localCorrectionBlocks.map((block) => block.blockHash))
        const uncachedBlocks = collectCorrectionBlocks(editor.state.doc).filter(
          (block) => block.wordCount >= 8 && !cachedBlockHashes.has(block.hash),
        )

        for (const block of uncachedBlocks) {
          const existingTimer = correctionTimersRef.current.get(block.id)

          if (existingTimer) {
            window.clearTimeout(existingTimer.timer)
            correctionTimersRef.current.delete(block.id)
          }

          const timer = window.setTimeout(() => {
            correctionTimersRef.current.delete(block.id)

            if (!correctionsEnabledRef.current) {
              return
            }

            const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

            if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) {
              return
            }

            enqueueCorrectionBlockRef.current?.(currentBlock, "hydrate-miss")
          }, 2000)

          correctionTimersRef.current.set(block.id, { timer, pos: block.pos })
        }

        const loadedTitle = localWriting.title?.trim() || UNTITLED_WRITING_TITLE
        const loadedHasExplicitTitle = isExplicitWritingTitle(loadedTitle, localWriting.body_text, localWriting.created_at)
        setTitle(loadedTitle)
        setHasExplicitTitle(loadedHasExplicitTitle)
        setVersion(localWriting.version)
        setCreatedAt(localWriting.created_at)
        setWritingSlug(localWriting.slug ?? null)
        setWritingStatus(localWriting.status ?? "draft")
        setWritingVisibility(localWriting.visibility ?? "private")
        setLifecycle(localWriting.lifecycle ?? "local-only")
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            localWriting.sync_status,
            localWriting.lifecycle ?? "local-only",
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
        updateDerivedEditorState(editor)

        const activeTab =
          editorSession.tabs.find((tab) => tab.writing_id === localWriting.id) ??
          editorSession.tabs.find((tab) => tab.id === routeWritingId) ??
          editorSession.tabs.find((tab) => tab.id === EDITOR_DRAFT_TAB_ID)
        const viewState = activeTab?.view_state

        if (viewState?.mode === "markdown") {
          let nextMarkdown: string
          if (isDesktopRuntime()) {
            const result = desktopDocumentEngine.richToSource(editor)
            if (!result.success) {
              console.error("[ODE-209] DesktopDocumentEngine.richToSource failed:", result.error)
              nextMarkdown = normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)))
            } else {
              nextMarkdown = result.markdown
            }
          } else {
            nextMarkdown = normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)))
          }
          modeRef.current = "markdown"
          setMode("markdown")
          setMarkdownValue(nextMarkdown)

          window.requestAnimationFrame(() => {
            queueMarkdownSelectionRestore(
              viewState.markdownSelectionStart ?? 0,
              viewState.markdownSelectionEnd ?? viewState.markdownSelectionStart ?? 0,
              {
                scrollTop: viewState.scrollTop,
                scrollLeft: viewState.scrollLeft,
                editorScrollTop: viewState.scrollTop,
                editorScrollLeft: viewState.scrollLeft,
                shellScrollTop: viewState.shellScrollTop,
                shellScrollLeft: viewState.shellScrollLeft,
                windowScrollX: viewState.windowScrollX,
                windowScrollY: viewState.windowScrollY,
              },
            )
          })
        } else if (viewState) {
          modeRef.current = "rich"
          setMode("rich")
          window.requestAnimationFrame(() => {
            const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
            const shellViewport = document.querySelector<HTMLElement>("main")

            const applyEditorScroll = () => {
              if (editorViewport) {
                editorViewport.scrollTop = viewState.scrollTop
                editorViewport.scrollLeft = viewState.scrollLeft
              }
            }

            const applyShellScroll = () => {
              if (shellViewport) {
                shellViewport.scrollTop = viewState.shellScrollTop ?? 0
                shellViewport.scrollLeft = viewState.shellScrollLeft ?? 0
              }
            }

            const applyWindowScroll = () => {
              window.scrollTo(
                typeof viewState.windowScrollX === "number" ? viewState.windowScrollX : window.scrollX,
                typeof viewState.windowScrollY === "number" ? viewState.windowScrollY : window.scrollY,
              )
            }

            if (
              typeof viewState.selectionFrom === "number" &&
              typeof viewState.selectionTo === "number" &&
              viewState.selectionFrom >= 1 &&
              viewState.selectionTo >= viewState.selectionFrom
            ) {
              editor
                .chain()
                .focus(undefined, { scrollIntoView: false })
                .setTextSelection({ from: viewState.selectionFrom, to: viewState.selectionTo })
                .run()
            } else {
              editor.commands.focus("start")
            }

            applyWindowScroll()
            applyShellScroll()
            applyEditorScroll()

            window.requestAnimationFrame(() => {
              applyWindowScroll()
              applyShellScroll()
              applyEditorScroll()
            })
          })
        }
      } else {
        setTitle(UNTITLED_WRITING_TITLE)
        setHasExplicitTitle(false)
        setVersion(0)
        setCreatedAt(null)
        setWritingSlug(null)
        setWritingStatus("draft")
        setWritingVisibility("private")
        setSyncStatus("saved")
        setBodyText("")
      }

      setHydrationWritingId(null)
    }

    void hydrateEditor()

    return () => {
      cancelled = true
    }
  }, [
    applyCorrectionSuggestionUpdate,
    currentWritingId,
    editor,
    editorSession.tabs,
    flattenPersistedSuggestions,
    flushPendingCorrectionBlocks,
    hydrationWritingId,
    queueMarkdownSelectionRestore,
    routeWritingId,
    setPersistedCorrectionBlocks,
    updateDerivedEditorState,
  ])

  useEffect(() => {
    if (!currentWritingId) {
      return
    }

    return subscribeToSyncStatusChanges((event) => {
      if (event.writingId !== currentWritingId) {
        return
      }

      setSyncStatus(mapSyncLifecycleToSaveState(event.status))

      if (event.status !== "synced") {
        return
      }

      void (async () => {
        const localWriting = await localDB.writings.get(currentWritingId)

        if (!localWriting?.slug || routeWritingId === localWriting.slug) {
          return
        }

        setWritingSlug(localWriting.slug)
        router.replace(`/write/${localWriting.slug}`)
      })()
    })
  }, [currentWritingId, routeWritingId, router])

  useEffect(() => {
    const correctionTimers = correctionTimersRef.current

    return () => {
      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      if (richUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(richUpdateRafRef.current)
      }

      if (markdownSelectionRafRef.current !== null) {
        window.cancelAnimationFrame(markdownSelectionRafRef.current)
      }

      for (const { timer } of correctionTimers.values()) {
        window.clearTimeout(timer)
      }

      if (correctionToastDismissRef.current !== null) {
        window.clearTimeout(correctionToastDismissRef.current)
      }

      richUpdateRafRef.current = null
      richUpdateEditorRef.current = null
      markdownSelectionRafRef.current = null
      pendingMarkdownSelectionRef.current = null
      correctionTimers.clear()
      correctionQueueRef.current = []
      persistCurrentWorkspaceViewState()
    }
  }, [persistCurrentWorkspaceViewState])

  const applyMarkdownFromPanel = useCallback(
    (nextMarkdown: string) => {
      const normalizedMarkdown = normalizeMarkdownForRoundTrip(nextMarkdown)

      if (editor) {
        isApplyingContentRef.current = true
      }

      void applyPanelMarkdownChange(editor, materializeMarkdownForRichParser(normalizedMarkdown), {
        clearPendingSave: () => {
          if (markdownSaveTimeoutRef.current) {
            window.clearTimeout(markdownSaveTimeoutRef.current)
            markdownSaveTimeoutRef.current = null
          }
        },
        updateDerivedState: () => {
          if (!editor) {
            return
          }
          updateDerivedEditorState(editor)
        },
        persistSnapshot: () => {
          if (!editor) {
            return
          }

          void persistEditorSnapshot(editor)
        },
      })

      isApplyingContentRef.current = false
    },
    [editor, persistEditorSnapshot, updateDerivedEditorState],
  )

  const closeActivePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

  const handleAcceptCorrection = useCallback(
    (suggestion: PublicationSuggestion) => {
      const result = applySuggestionToMarkdown(currentDocumentMarkdownRef.current, suggestion)

      if (result.applied) {
        suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        applyMarkdownFromPanel(result.markdown)
        rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted")
        const nextSuggestions = updateSuggestionStatuses(
          automaticCorrectionSuggestionsRef.current,
          [suggestion.id],
          "accepted",
        )
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
        return
      }

      const nextSuggestions = updateSuggestionStatuses(
        automaticCorrectionSuggestionsRef.current,
        [suggestion.id],
        "conflict",
      )
      applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
      void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
    },
    [applyCorrectionSuggestionUpdate, applyMarkdownFromPanel, updatePersistedBlocksFromSuggestions],
  )

  const handleRejectCorrection = useCallback((suggestionId: string) => {
    const suggestion = automaticCorrectionSuggestionsRef.current.find((item) => item.id === suggestionId)

    if (!suggestion) {
      return
    }

    rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected")
    const nextSuggestions = updateSuggestionStatuses(
      automaticCorrectionSuggestionsRef.current,
      [suggestionId],
      "rejected",
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
  }, [applyCorrectionSuggestionUpdate, updatePersistedBlocksFromSuggestions])

  const handleAcceptAllCorrections = useCallback(() => {
    const result = applyAllPublicationSuggestions(
      currentDocumentMarkdownRef.current,
      automaticCorrectionSuggestionsRef.current,
    )

    if (result.appliedIds.length === 0) {
      return
    }

    applyMarkdownFromPanel(result.markdown)
    automaticCorrectionSuggestionsRef.current
      .filter((suggestion) => result.appliedIds.includes(suggestion.id))
      .forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted"))
    const nextSuggestions = updateSuggestionStatuses(
      automaticCorrectionSuggestionsRef.current,
      result.appliedIds,
      "accepted",
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(
      nextSuggestions,
      [
        ...new Set(
          automaticCorrectionSuggestionsRef.current
            .filter((suggestion) => result.appliedIds.includes(suggestion.id))
            .map((suggestion) => suggestion.source_hash ?? "")
            .filter(Boolean),
        ),
      ],
    )
  }, [applyCorrectionSuggestionUpdate, applyMarkdownFromPanel, updatePersistedBlocksFromSuggestions])

  const handleRejectAllCorrections = useCallback(() => {
    const pending = automaticCorrectionSuggestionsRef.current.filter((s) => s.status === "pending")

    pending.forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected"))
    const nextSuggestions = updateSuggestionStatuses(
      automaticCorrectionSuggestionsRef.current,
      pending.map((s) => s.id),
      "rejected",
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(
      nextSuggestions,
      [...new Set(pending.map((suggestion) => suggestion.source_hash ?? "").filter(Boolean))],
    )
  }, [applyCorrectionSuggestionUpdate, updatePersistedBlocksFromSuggestions])

  const captureRichSelectionSnapshot = useCallback((): PendingRichSelectionSnapshot | null => {
    if (!editor || modeRef.current !== "rich") {
      return null
    }

    const { from, to } = editor.state.selection
    if (from === to) {
      return null
    }

    const selectedText = editor.state.doc.textBetween(from, to, " ").trim()
    if (!selectedText) {
      return null
    }

    const fromCoords = editor.view.coordsAtPos(from)
    const toCoords = editor.view.coordsAtPos(to)

    return {
      from,
      to,
      text: selectedText,
      popupPosition: {
        x: (fromCoords.left + toCoords.right) / 2,
        y: Math.min(fromCoords.top, toCoords.top) - 8,
      },
      bubblePosition: {
        x: (fromCoords.left + toCoords.right) / 2,
        y: Math.max(fromCoords.bottom, toCoords.bottom) + 10,
      },
    }
  }, [editor])

  const isRichSelectionInsideTable = useCallback(() => {
    if (!editor || modeRef.current !== "rich") {
      return false
    }

    return editor.isActive("table")
  }, [editor])

  const handleRunAction = useCallback(
    (action: EditorShortcutAction, options?: { richSelection?: RichSelectionRange }) => {
      const runGlobalAction = () => {
        switch (action) {
          case "find":
            openFindReplacePanel()
            return true
          case "replace":
            openFindReplacePanel({ focusReplace: true })
            return true
          case "focusMode":
            setIsFocusMode((currentState) => !currentState)
            return true
          case "newWriting":
            router.push("/write?new=1")
            return true
          case "settings":
            router.push("/settings")
            return true
          default:
            return false
        }
      }

      if (runGlobalAction()) {
        return
      }

      const captureSelection = () => {
        if (!editor) {
          return
        }

        const { from, to } = editor.state.selection
        selectionRef.current = {
          from,
          to,
          text: editor.state.doc.textBetween(from, to, " "),
        }
      }

      const captureMarkdownSelection = () => {
        const textarea = markdownTextareaRef.current

        if (!textarea) {
          markdownSelectionRef.current = null
          return
        }

        const start = textarea.selectionStart
        const end = textarea.selectionEnd
        markdownSelectionRef.current = {
          start,
          end,
          text: textarea.value.slice(start, end),
        }
      }

      const persistMarkdownDraft = (nextMarkdown: string) => {
        setMarkdownValue(nextMarkdown)

        if (markdownSaveTimeoutRef.current) {
          window.clearTimeout(markdownSaveTimeoutRef.current)
        }

        setSyncStatus("saving")

        if (!editor) {
          return
        }

        markdownSaveTimeoutRef.current = window.setTimeout(() => {
          if (modeRef.current !== "markdown") {
            markdownSaveTimeoutRef.current = null
            return
          }

          isApplyingContentRef.current = true
          editor.commands.setContent(materializeMarkdownForRichParser(nextMarkdown))
          isApplyingContentRef.current = false
          setBodyText(editor.getText())
          void persistEditorSnapshot(editor)
          markdownSaveTimeoutRef.current = null
        }, MARKDOWN_SAVE_DEBOUNCE_MS)
      }

      const toggleMarkdownWrap = (marker: string) => {
        const textarea = markdownTextareaRef.current
        const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
        const shellViewport = document.querySelector<HTMLElement>("main")
        const fallbackCursor = markdownValue.length
        const start = markdownSelectionRef.current?.start ?? textarea?.selectionStart ?? fallbackCursor
        const end = markdownSelectionRef.current?.end ?? textarea?.selectionEnd ?? fallbackCursor
        const scrollTop = textarea?.scrollTop
        const scrollLeft = textarea?.scrollLeft
        const editorScrollTop = editorViewport?.scrollTop
        const editorScrollLeft = editorViewport?.scrollLeft
        const shellScrollTop = shellViewport?.scrollTop
        const shellScrollLeft = shellViewport?.scrollLeft
        const windowScrollX = window.scrollX
        const windowScrollY = window.scrollY
        const result = toggleMarkdownInlineMarker(markdownValue, start, end, marker)

        persistMarkdownDraft(result.markdown)
        queueMarkdownSelectionRestore(result.selectionStart, result.selectionEnd, {
          scrollTop,
          scrollLeft,
          editorScrollTop,
          editorScrollLeft,
          shellScrollTop,
          shellScrollLeft,
          windowScrollX,
          windowScrollY,
        })
      }

      const toggleMarkdownLinePrefix = (
        prefix: string,
        options?: {
          ordered?: boolean
          clearBlockFormatting?: boolean
        },
      ) => {
        const textarea = markdownTextareaRef.current
        const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
        const shellViewport = document.querySelector<HTMLElement>("main")
        const fallbackCursor = markdownValue.length
        const selectionStart = markdownSelectionRef.current?.start ?? textarea?.selectionStart ?? fallbackCursor
        const selectionEnd = markdownSelectionRef.current?.end ?? textarea?.selectionEnd ?? fallbackCursor
        const scrollTop = textarea?.scrollTop
        const scrollLeft = textarea?.scrollLeft
        const editorScrollTop = editorViewport?.scrollTop
        const editorScrollLeft = editorViewport?.scrollLeft
        const shellScrollTop = shellViewport?.scrollTop
        const shellScrollLeft = shellViewport?.scrollLeft
        const windowScrollX = window.scrollX
        const windowScrollY = window.scrollY
        const blockStart = markdownValue.lastIndexOf("\n", Math.max(0, selectionStart - 1)) + 1
        const nextBreak = markdownValue.indexOf("\n", selectionEnd)
        const blockEnd = nextBreak === -1 ? markdownValue.length : nextBreak
        const block = markdownValue.slice(blockStart, blockEnd)
        const lines = block.split("\n")
        const normalize = (line: string) => {
          if (!options?.clearBlockFormatting) {
            return line
          }

          return line
            .replace(/^\s*>\s?/, "")
            .replace(/^\s*[-*]\s+/, "")
            .replace(/^\s*\d+\.\s+/, "")
            .replace(/^\s{0,3}#{1,6}\s+/, "")
        }

        const removePrefix = options?.ordered
          ? lines.every((line) => /^\s*\d+\.\s+/.test(line))
          : prefix.length > 0 && lines.every((line) => line.startsWith(prefix))

        const nextLines = lines.map((line, index) => {
          if (options?.ordered) {
            if (removePrefix) {
              return line.replace(/^\s*\d+\.\s+/, "")
            }

            return `${index + 1}. ${normalize(line)}`
          }

          if (!prefix.length) {
            return normalize(line)
          }

          if (removePrefix) {
            return line.slice(prefix.length)
          }

          return `${prefix}${normalize(line)}`
        })

        const nextBlock = nextLines.join("\n")
        const nextMarkdown = `${markdownValue.slice(0, blockStart)}${nextBlock}${markdownValue.slice(blockEnd)}`
        const nextSelectionEnd = blockStart + nextBlock.length

        persistMarkdownDraft(nextMarkdown)

        queueMarkdownSelectionRestore(blockStart, nextSelectionEnd, {
          scrollTop,
          scrollLeft,
          editorScrollTop,
          editorScrollLeft,
          shellScrollTop,
          shellScrollLeft,
          windowScrollX,
          windowScrollY,
        })
      }

      const preserveViewport = (fn: () => void) => {
        const container = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
        const previousScrollTop = container?.scrollTop
        const previousScrollLeft = container?.scrollLeft

        fn()

        if (!container) {
          return
        }

        window.requestAnimationFrame(() => {
          if (typeof previousScrollTop === "number") {
            container.scrollTop = previousScrollTop
          }

          if (typeof previousScrollLeft === "number") {
            container.scrollLeft = previousScrollLeft
          }
        })
      }

      if (modeRef.current === "markdown") {
        switch (action) {
          case "bold":
            toggleMarkdownWrap("**")
            return
          case "italic":
            toggleMarkdownWrap("*")
            return
          case "strike":
            toggleMarkdownWrap("~~")
            return
          case "highlight":
            toggleMarkdownWrap("==")
            return
          case "inlineCode":
            toggleMarkdownWrap("`")
            return
          case "paragraph":
            toggleMarkdownLinePrefix("", { clearBlockFormatting: true })
            return
          case "heading1":
            toggleMarkdownLinePrefix("# ", { clearBlockFormatting: true })
            return
          case "heading2":
            toggleMarkdownLinePrefix("## ", { clearBlockFormatting: true })
            return
          case "heading3":
            toggleMarkdownLinePrefix("### ", { clearBlockFormatting: true })
            return
          case "blockquote":
            toggleMarkdownLinePrefix("> ", { clearBlockFormatting: true })
            return
          case "bulletList":
            toggleMarkdownLinePrefix("- ", { clearBlockFormatting: true })
            return
          case "orderedList":
            toggleMarkdownLinePrefix("", { ordered: true, clearBlockFormatting: true })
            return
          case "link":
            captureMarkdownSelection()
            setLinkModalOpen(true)
            return
          case "footnote":
            captureMarkdownSelection()
            setFootnoteModalOpen(true)
            return
          case "table":
            setTableModalOpen(true)
            return
          case "image":
            setImageModalOpen(true)
            return
          default:
            return
        }
      }

      if (!editor) {
        return
      }

      const getValidatedRichSelection = (): RichSelectionRange | null => {
        const docSelectionMax = editor.state.doc.content.size + 1
        const minPos = 1
        const candidate = options?.richSelection

        if (
          candidate &&
          Number.isInteger(candidate.from) &&
          Number.isInteger(candidate.to) &&
          candidate.from >= minPos &&
          candidate.to <= docSelectionMax &&
          candidate.from <= candidate.to
        ) {
          return candidate
        }

        const { from, to } = editor.state.selection

        if (from < minPos || to > docSelectionMax || from > to) {
          return null
        }

        return { from, to }
      }

      const runWithRichSelection = (command: (chain: ReturnType<Editor["chain"]>) => ReturnType<Editor["chain"]>) => {
        const selectedRange = getValidatedRichSelection()
        let chain = editor.chain().focus()

        if (selectedRange) {
          chain = chain.setTextSelection(selectedRange)
        }

        command(chain).run()
      }

      switch (action) {
        case "bold":
          runWithRichSelection((chain) => chain.toggleBold())
          return
        case "italic":
          runWithRichSelection((chain) => chain.toggleItalic())
          return
        case "strike":
          runWithRichSelection((chain) => chain.toggleStrike())
          return
        case "highlight":
          {
            const snapshot = captureRichSelectionSnapshot()
            if (!snapshot) {
              return
            }
            setPendingRichSelection(snapshot)
            setPendingAnnotation(null)
          }
          return
        case "inlineCode":
          runWithRichSelection((chain) => chain.toggleCode())
          return
        case "codeBlock":
          runWithRichSelection((chain) => chain.toggleCodeBlock())
          return
        case "paragraph":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.setParagraph())
          })
          return
        case "heading1":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleHeading({ level: 1 }))
          })
          return
        case "heading2":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleHeading({ level: 2 }))
          })
          return
        case "heading3":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleHeading({ level: 3 }))
          })
          return
        case "blockquote":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleBlockquote())
          })
          return
        case "bulletList":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleBulletList())
          })
          return
        case "orderedList":
          preserveViewport(() => {
            runWithRichSelection((chain) => chain.toggleOrderedList())
          })
          return
        case "link":
          captureSelection()
          setLinkModalOpen(true)
          return
        case "footnote":
          captureSelection()
          setFootnoteModalOpen(true)
          return
        case "table":
          setTableModalOpen(true)
          return
        case "image":
          setImageModalOpen(true)
          return
        default:
          return
      }
    },
    [
      captureRichSelectionSnapshot,
      editor,
      markdownValue,
      openFindReplacePanel,
      persistEditorSnapshot,
      queueMarkdownSelectionRestore,
      router,
    ],
  )

  const dismissSelectionPopup = useCallback(() => {
    suppressNextSelectionPopupRef.current = true
    setPendingRichSelection(null)
  }, [])

  const handleMarkSelection = useCallback(() => {
    if (!editor || !pendingRichSelection) {
      return
    }

    suppressNextSelectionPopupRef.current = true
    editor
      .chain()
      .focus()
      .setTextSelection({ from: pendingRichSelection.from, to: pendingRichSelection.to })
      .setHighlight()
      .addAnnotation("highlight", "")
      .setTextSelection(pendingRichSelection.to)
      .run()

    setPendingRichSelection(null)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)
  }, [editor, pendingRichSelection, persistEditorSnapshot, updateDerivedEditorState])

  const convertStandaloneHighlight = useCallback(
    (anchorText: string, type: AnnotationType, text: string, anchorStart?: number, anchorEnd?: number) => {
      if (!editor || !anchorText) return
      const highlightMark = editor.schema.marks.highlight
      if (!highlightMark) return

      editor.state.doc.descendants((node, pos) => {
        if (node.type.name !== "text") return
        if (!node.marks.some((m) => m.type.name === "highlight")) return
        const $pos = editor.state.doc.resolve(pos)
        const range = getMarkRange($pos, highlightMark)
        if (!range) return
        const highlightedText = editor.state.doc.textBetween(range.from, range.to)
        if (highlightedText === anchorText) {
          if (anchorStart !== undefined && anchorEnd !== undefined) {
            if (range.from !== anchorStart || range.to !== anchorEnd) return
          }
          editor
            .chain()
            .focus()
            .setTextSelection({ from: range.from, to: range.to })
            .unsetHighlight()
            .setHighlight()
            .addAnnotation(type, text)
            .setTextSelection(range.to)
            .run()
          return false
        }
      })
    },
    [editor],
  )

  const handleAnnotateSelection = useCallback(
    (annotationType: "personal" | "ai" | "footnote" = "footnote") => {
      if (!pendingRichSelection) return
      setPendingAnnotation({
        from: pendingRichSelection.from,
        to: pendingRichSelection.to,
        text: pendingRichSelection.text,
        position: pendingRichSelection.bubblePosition,
        annotationType,
      })
      setPendingRichSelection(null)
    },
    [pendingRichSelection],
  )

  const handleFootnoteSelection = useCallback(() => {
    if (!pendingRichSelection) {
      return
    }

    if (modeRef.current === "markdown") {
      setPendingRichSelection(null)
      setFootnoteModalOpen(true)
      return
    }

    selectionRef.current = {
      from: pendingRichSelection.from,
      to: pendingRichSelection.to,
      text: pendingRichSelection.text,
    }
    setPendingRichSelection(null)
    setFootnoteModalOpen(true)
  }, [pendingRichSelection])

  const handleEditorSelectType = useCallback(
    (type: "personal" | "ai" | "footnote") => {
      if (type === "personal") {
        handleMarkSelection()
        return
      }
      if (type === "footnote") {
        handleFootnoteSelection()
        return
      }
      handleAnnotateSelection(type)
    },
    [handleAnnotateSelection, handleFootnoteSelection, handleMarkSelection],
  )

  const handleConfirmAnnotation = useCallback(
    (note: string) => {
      if (!editor || !pendingAnnotation) return
      const trimmedNote = note.trim()
      if (!trimmedNote) return

      const annotationType = pendingAnnotation.annotationType ?? "footnote"
      suppressNextSelectionPopupRef.current = true

      if (annotationType === "footnote" || annotationType === "personal") {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: pendingAnnotation.from, to: pendingAnnotation.to })
          .setHighlight()
          .addFootnote(trimmedNote)
          .setTextSelection(pendingAnnotation.to)
          .run()
        setActivePanel("notes")
      } else {
        editor
          .chain()
          .focus()
          .setTextSelection({ from: pendingAnnotation.from, to: pendingAnnotation.to })
          .setHighlight()
          .addAnnotation(annotationType, trimmedNote)
          .setTextSelection(pendingAnnotation.to)
          .run()
      }

      setPendingAnnotation(null)
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
    },
    [editor, pendingAnnotation, persistEditorSnapshot, updateDerivedEditorState],
  )

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleSelectionUpdate = () => {
      if (suppressNextSelectionPopupRef.current) {
        suppressNextSelectionPopupRef.current = false
        setPendingRichSelection(null)
        return
      }

      if (modeRef.current !== "rich" || pendingAnnotation) {
        return
      }

      if (isRichSelectionInsideTable()) {
        setPendingRichSelection(null)
        return
      }

      const snapshot = captureRichSelectionSnapshot()
      if (!snapshot) {
        setPendingRichSelection(null)
        return
      }

      setPendingRichSelection((current) => {
        if (current && current.from === snapshot.from && current.to === snapshot.to) {
          return current
        }
        return snapshot
      })
    }

    editor.on("selectionUpdate", handleSelectionUpdate)

    return () => {
      editor.off("selectionUpdate", handleSelectionUpdate)
    }
  }, [captureRichSelectionSnapshot, editor, isRichSelectionInsideTable, pendingAnnotation])

  const handleToggleMode = useCallback(
    (nextMode: "rich" | "markdown") => {
      if (!editor || nextMode === modeRef.current) {
        return
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
        markdownSaveTimeoutRef.current = null
      }

      if (nextMode === "markdown") {
        modeRef.current = "markdown"
        setMode("markdown")
        let bodyMarkdown: string
        if (isDesktopRuntime()) {
          const result = desktopDocumentEngine.richToSource(editor)
          if (!result.success) {
            console.error("[ODE-209] DesktopDocumentEngine.richToSource failed:", result.error)
            bodyMarkdown = getEditorMarkdown(editor)
          } else {
            bodyMarkdown = result.markdown
          }
        } else {
          bodyMarkdown = getEditorMarkdown(editor)
        }
        const footnoteNodes = getEditorFootnotes(editor)
        setMarkdownValue(normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(bodyMarkdown, footnoteNodes)))
        return
      }

      const normalizedMarkdown = normalizeMarkdownForRoundTrip(markdownValue)
      modeRef.current = "rich"
      isApplyingContentRef.current = true
      if (isDesktopRuntime()) {
        const result = desktopDocumentEngine.sourceToRich(normalizedMarkdown)
        if (result.success) {
          editor.commands.setContent(result.snapshot.bodyJson)
        } else {
          console.error("[ODE-209] DesktopDocumentEngine.sourceToRich failed:", result.error)
          editor.commands.setContent(materializeMarkdownForRichParser(normalizedMarkdown))
        }
      } else {
        editor.commands.setContent(materializeMarkdownForRichParser(normalizedMarkdown))
      }
      isApplyingContentRef.current = false
      setMarkdownValue(normalizedMarkdown)
      setMode("rich")
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
    },
    [editor, markdownValue, persistEditorSnapshot, updateDerivedEditorState],
  )

  const handleMarkdownChange = useCallback(
    (nextMarkdown: string) => {
      const normalizedMarkdown = convertHtmlTablesToMarkdown(nextMarkdown)
      setMarkdownValue(normalizedMarkdown)

      if (!editor) {
        return
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      setSyncStatus("saving")

      markdownSaveTimeoutRef.current = window.setTimeout(() => {
        if (modeRef.current !== "markdown") {
          markdownSaveTimeoutRef.current = null
          return
        }

        isApplyingContentRef.current = true
        editor.commands.setContent(materializeMarkdownForRichParser(normalizedMarkdown))
        isApplyingContentRef.current = false
        // Update metrics from TipTap but do NOT derive markdownValue from it —
        // TipTap serializes table nodes as HTML, which would overwrite GFM textarea content.
        // In Markdown mode the textarea is the source of truth; markdownValue is already correct.
        setBodyText(editor.getText())
        void persistEditorSnapshot(editor)
        markdownSaveTimeoutRef.current = null
      }, MARKDOWN_SAVE_DEBOUNCE_MS)
    },
    [editor, persistEditorSnapshot],
  )

  const handleInsertLink = useCallback(
    (payload: { text: string; url: string }) => {
      if (modeRef.current === "markdown") {
        const source = markdownValue
        const textarea = markdownTextareaRef.current
        const fallbackCursor = source.length
        const start = markdownSelectionRef.current?.start ?? textarea?.selectionStart ?? fallbackCursor
        const end = markdownSelectionRef.current?.end ?? textarea?.selectionEnd ?? fallbackCursor
        const selectedText = markdownSelectionRef.current?.text?.trim() ?? source.slice(start, end).trim()
        const linkText = payload.text || selectedText || payload.url
        const replacement = `[${linkText}](${payload.url})`
        const nextMarkdown = `${source.slice(0, start)}${replacement}${source.slice(end)}`
        const nextSelectionStart = start + 1
        const nextSelectionEnd = start + 1 + linkText.length

        setMarkdownValue(nextMarkdown)

        if (markdownSaveTimeoutRef.current) {
          window.clearTimeout(markdownSaveTimeoutRef.current)
        }

        setSyncStatus("saving")

        if (editor) {
          markdownSaveTimeoutRef.current = window.setTimeout(() => {
            if (modeRef.current !== "markdown") {
              markdownSaveTimeoutRef.current = null
              return
            }

            isApplyingContentRef.current = true
            editor.commands.setContent(materializeMarkdownForRichParser(nextMarkdown))
            isApplyingContentRef.current = false
            setBodyText(editor.getText())
            void persistEditorSnapshot(editor)
            markdownSaveTimeoutRef.current = null
          }, MARKDOWN_SAVE_DEBOUNCE_MS)
        }

        queueMarkdownSelectionRestore(nextSelectionStart, nextSelectionEnd)

        return
      }

      if (!editor) {
        return
      }

      const snapshot = selectionRef.current

      if (snapshot) {
        editor.chain().focus().setTextSelection({ from: snapshot.from, to: snapshot.to }).run()
      } else {
        editor.commands.focus()
      }

      const selectedText = snapshot?.text?.trim() ?? ""

      if (snapshot && snapshot.from !== snapshot.to && selectedText) {
        editor.chain().focus().setLink({ href: payload.url }).run()
      } else {
        const linkText = payload.text || selectedText || payload.url
        editor
          .chain()
          .focus()
          .insertContent({
            type: "text",
            text: linkText,
            marks: [{ type: "link", attrs: { href: payload.url } }],
          })
          .run()
      }
    },
    [editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore],
  )

  useEffect(() => {
    const onFootnoteClick = () => {
      setActivePanel("notes")
    }

    window.addEventListener(FOOTNOTE_REF_EVENT, onFootnoteClick)

    return () => {
      window.removeEventListener(FOOTNOTE_REF_EVENT, onFootnoteClick)
    }
  }, [])

  const handleInsertTable = useCallback(
    (rows: number, cols: number) => {
      if (mode === "rich") {
        if (!editor) {
          return
        }

        editor.chain().focus().insertTable({ rows, cols, withHeaderRow: true }).run()
        void persistEditorSnapshot(editor)
        return
      }

      // Markdown mode: generate and insert a markdown table at the current cursor
      const header = `| ${Array.from({ length: cols }, () => "Header").join(" | ")} |`
      const separator = `| ${Array.from({ length: cols }, () => "---").join(" | ")} |`
      const row = `| ${Array.from({ length: cols }, () => "Cell").join(" | ")} |`
      const dataRows = Array.from({ length: rows - 1 }, () => row)
      const tableMarkdown = [header, separator, ...dataRows].join("\n")

      const nextMarkdown = markdownValue ? `${markdownValue}\n\n${tableMarkdown}\n` : `${tableMarkdown}\n`
      setMarkdownValue(nextMarkdown)
      setSyncStatus("saving")

      if (!editor) {
        return
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      // Debounce parse + persist exactly like handleMarkdownChange, but do NOT call
      // updateDerivedEditorState — that would overwrite markdownValue with TipTap's
      // serialization of the table nodes, which can include HTML instead of GFM syntax.
      markdownSaveTimeoutRef.current = window.setTimeout(() => {
        if (modeRef.current !== "markdown") {
          markdownSaveTimeoutRef.current = null
          return
        }

        isApplyingContentRef.current = true
        editor.commands.setContent(materializeMarkdownForRichParser(nextMarkdown))
        isApplyingContentRef.current = false
        void persistEditorSnapshot(editor)
        markdownSaveTimeoutRef.current = null
      }, MARKDOWN_SAVE_DEBOUNCE_MS)
    },
    [mode, editor, markdownValue, persistEditorSnapshot],
  )

  const handleInsertImage = useCallback(
    (payload: { src: string; alt: string }) => {
      if (modeRef.current === "markdown") {
        const source = markdownValue
        const textarea = markdownTextareaRef.current
        const fallbackCursor = source.length
        const start = markdownSelectionRef.current?.start ?? textarea?.selectionStart ?? fallbackCursor
        const end = markdownSelectionRef.current?.end ?? textarea?.selectionEnd ?? fallbackCursor
        const imageMarkdown = `![${payload.alt}](${payload.src})`
        const nextMarkdown = `${source.slice(0, start)}${imageMarkdown}${source.slice(end)}`
        const nextSelectionStart = start + imageMarkdown.length

        setMarkdownValue(nextMarkdown)
        setSyncStatus("saving")

        if (editor) {
          if (markdownSaveTimeoutRef.current) {
            window.clearTimeout(markdownSaveTimeoutRef.current)
          }
          markdownSaveTimeoutRef.current = window.setTimeout(() => {
            if (modeRef.current !== "markdown") {
              markdownSaveTimeoutRef.current = null
              return
            }
            isApplyingContentRef.current = true
            editor.commands.setContent(materializeMarkdownForRichParser(nextMarkdown))
            isApplyingContentRef.current = false
            setBodyText(editor.getText())
            void persistEditorSnapshot(editor)
            markdownSaveTimeoutRef.current = null
          }, MARKDOWN_SAVE_DEBOUNCE_MS)
        }

        queueMarkdownSelectionRestore(nextSelectionStart, nextSelectionStart)
        return
      }

      if (!editor) {
        return
      }

      editor
        .chain()
        .focus()
        .setImage({ src: payload.src, alt: payload.alt })
        .run()
      void persistEditorSnapshot(editor)
    },
    [editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore],
  )

  const handleInsertFootnote = useCallback(
    (note: string) => {
      if (modeRef.current === "markdown") {
        const nextMarkdown = appendMarkdownFootnote(markdownValue, note)
        applyMarkdownFromPanel(nextMarkdown)
        setActivePanel("notes")
        return
      }

      if (!editor) {
        return
      }

      editor.commands.addFootnote(note)
      setRichFootnoteRevision((r) => r + 1)
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
      setActivePanel("notes")
    },
    [applyMarkdownFromPanel, editor, markdownValue, persistEditorSnapshot, updateDerivedEditorState],
  )

  // In Rich mode, derive footnotes from editor nodes only when content version changes.
  // In Markdown mode, parse from the raw markdown value.
  const footnotes = useMemo(() => {
    if (mode === "rich") {
      const contentRevision = version || richFootnoteRevision
      void contentRevision
      if (!editor) return []
      const json = editor.getJSON()
      const annotations = extractWritingAnnotationNodes(json)

      // Extract standalone highlights with real document positions
      const highlights: Array<{
        type: "highlight"
        index: number
        text: string
        id: string
        anchor_text: string
        anchor_start: number
        anchor_end: number
      }> = []
      const highlightMark = editor.schema.marks.highlight
      if (highlightMark) {
        const annotationRanges: Array<{ from: number; to: number }> = []
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name === "annotationReference" || node.type.name === "footnoteReference") {
            annotationRanges.push({ from: pos, to: pos + node.nodeSize })
          }
        })

        const visitedRanges = new Set<string>()
        editor.state.doc.descendants((node, pos) => {
          if (node.type.name !== "text") return
          if (!node.marks.some((m) => m.type.name === "highlight")) return

          const $pos = editor.state.doc.resolve(pos)
          const range = getMarkRange($pos, highlightMark)
          if (!range) return

          const key = `${range.from}-${range.to}`
          if (visitedRanges.has(key)) return
          visitedRanges.add(key)

          const hasAnnotation = annotationRanges.some(
            (ar) =>
              (ar.from >= range.from && ar.to <= range.to) || // annotation inside highlight
              ar.from === range.to, // annotation immediately after highlight (==text==[@1: ...])
          )

          if (!hasAnnotation) {
            highlights.push({
              type: "highlight",
              index: highlights.length + 1,
              text: "",
              id: `highlight:${highlights.length}`,
              anchor_text: editor.state.doc.textBetween(range.from, range.to),
              anchor_start: range.from,
              anchor_end: range.to,
            })
          }
        })
      }

      return [...annotations, ...highlights]
    }

    return getMarkdownFootnotes(markdownValue).filter((f) => f.type === "footnote")
  }, [editor, markdownValue, mode, richFootnoteRevision, version])
  const textMetrics = useMemo(() => calculateTextMetrics(bodyText), [bodyText])
  const selectionMetrics = useEditorSelection(editor, mode, markdownSelectionState)
  const displayTitle = useMemo(
    () => (hasExplicitTitle ? title : deriveAutoTitle(bodyText, createdAt)),
    [hasExplicitTitle, title, bodyText, createdAt],
  )
  const currentDocumentMarkdown = useMemo(() => {
    if (mode === "markdown") {
      return normalizeMarkdownForRoundTrip(markdownValue)
    }

    if (!editor) {
      return ""
    }

    const contentRevision = version
    void contentRevision

    return normalizeMarkdownForRoundTrip(
      getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
    )
  }, [editor, markdownValue, mode, version])

  useEffect(() => {
    currentDocumentMarkdownRef.current = currentDocumentMarkdown
  }, [currentDocumentMarkdown])

  useEffect(() => {
    automaticCorrectionSuggestionsRef.current = automaticCorrectionSuggestions
  }, [automaticCorrectionSuggestions])

  const normalizeAutomaticSuggestion = useCallback(
    (block: CorrectionTriggerBlock, suggestion: PublicationSuggestion): PublicationSuggestion => {
      const sourceMarkdown = currentDocumentMarkdownRef.current
      const occurrence = suggestion.occurrence ?? 0
      const fingerprint =
        suggestion.correction_fingerprint ??
        [block.id, suggestion.kind, suggestion.original_text, suggestion.replacement_text].join("|")
      const id = [
        "auto-correction",
        block.hash,
        hashPublicationSource(`${fingerprint}:${occurrence}`),
      ].join(":")

      return {
        ...suggestion,
        ...deriveSuggestionContexts(sourceMarkdown, suggestion.original_text),
        id,
        block_id: block.id,
        source_hash: block.hash,
        correction_fingerprint: fingerprint,
        occurrence,
        status: "pending",
      }
    },
    [],
  )

  const getBlockSuggestions = useCallback(
    (blockId: string, sourceHash?: string) =>
      automaticCorrectionSuggestionsRef.current.filter(
        (suggestion) =>
          suggestion.block_id === blockId && (sourceHash ? suggestion.source_hash === sourceHash : true),
      ),
    [],
  )

  const finishCorrectionQueueIfIdle = useCallback(() => {
    if (correctionQueueRef.current.length > 0 || correctionProcessingRef.current) {
      return
    }

    setCorrectionToast({
      phase: "complete",
      completed: correctionQueueCompletedRef.current,
      total: correctionQueueTotalRef.current,
    })

    if (correctionToastDismissRef.current !== null) {
      window.clearTimeout(correctionToastDismissRef.current)
    }

    correctionToastDismissRef.current = window.setTimeout(() => {
      setCorrectionToast(null)
      correctionToastDismissRef.current = null
      correctionQueueTotalRef.current = 0
      correctionQueueCompletedRef.current = 0
    }, 2000)
  }, [])

  const processCorrectionQueue = useCallback(async () => {
    if (correctionProcessingRef.current || !editor) {
      return
    }

    if (!correctionsEnabledRef.current) {
      correctionQueueRef.current = []
      correctionQueueTotalRef.current = 0
      correctionQueueCompletedRef.current = 0
      setCorrectionToast(null)
      return
    }

    if (isPerfHarness()) {
      correctionQueueRef.current = []
      correctionQueueTotalRef.current = 0
      correctionQueueCompletedRef.current = 0
      setCorrectionToast(null)
      return
    }

    correctionProcessingRef.current = true
    logCorrectionEvent({
      type: "queue:flush",
      batchSize: correctionQueueRef.current.length,
      blockIds: correctionQueueRef.current.map((queuedBlock) => queuedBlock.id),
    })

    while (correctionQueueRef.current.length > 0) {
      const block = correctionQueueRef.current.shift()

      if (!block) {
        continue
      }

      const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

      if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) {
        correctionQueueCompletedRef.current += 1
        continue
      }

      setCorrectionToast({
        phase: "running",
        completed: correctionQueueCompletedRef.current,
        total: correctionQueueTotalRef.current,
      })

      try {
        const batchId = `${block.id}:${block.hash}`
        const requestStartedAt = Date.now()
        logCorrectionEvent({
          type: "request:start",
          batchId,
          blockIds: [block.id],
        })

        const result = await webAIService.reviewPublication({
          writingId: currentWritingIdRef.current ?? undefined,
          title: titleRef.current,
          markdown: block.text,
          bodyText: block.text,
          sourceHash: block.hash,
          stream: false,
          correctionBlock: {
            id: block.id,
            text: block.text,
            hash: block.hash,
          },
          correctionMemory: {
            entries: readCorrectionMemory(),
          },
        })

        if (result.error || !result.data) {
          console.info(`[corrections] block analysis skipped code=${result.error?.code ?? "unknown"}`)
          correctionQueueCompletedRef.current += 1
          continue
        }

        if (!correctionsEnabledRef.current) {
          continue
        }

        const adapted = adaptCorrectionsContract({
          summary: result.data.summary,
          language:
            result.data.language === "es" ||
            result.data.language === "en" ||
            result.data.language === "mixed" ||
            result.data.language === "unknown"
              ? result.data.language
              : "unknown",
          corrections: result.data.corrections,
          uncertain: result.data.uncertain,
        })
        const suggestions = adapted.legacy.suggestions
        const stillCurrentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

        if (!stillCurrentBlock || stillCurrentBlock.hash !== block.hash || stillCurrentBlock.text !== block.text) {
          for (const suggestion of getBlockSuggestions(block.id, block.hash)) {
            logCorrectionEvent({
              type: "stale:drop",
              blockId: block.id,
              suggestionId: suggestion.id,
            })
          }
          logCorrectionEvent({
            type: "request:end",
            batchId,
            latencyMs: Date.now() - requestStartedAt,
            suggestions: 0,
            missing: [block.id],
          })
          correctionQueueCompletedRef.current += 1
          continue
        }

        const normalizedSuggestions = suggestions.map((suggestion) => normalizeAutomaticSuggestion(block, suggestion))
        const nextCorrectionBlock: LocalCorrectionBlock | null = currentWritingIdRef.current
          ? {
              id: createCorrectionBlockRecordId(currentWritingIdRef.current, block.hash),
              writingId: currentWritingIdRef.current,
              blockId: block.id,
              blockHash: block.hash,
              suggestions: normalizedSuggestions,
              model: result.data.usage?.model ?? "web-route",
              createdAt: new Date().toISOString(),
              latencyMs: Date.now() - requestStartedAt,
              promptTokens: result.data.usage?.promptTokens ?? null,
              completionTokens: result.data.usage?.completionTokens ?? null,
              syncedAt: null,
            }
          : null

        const replacement = replaceBlockSuggestions(
          automaticCorrectionSuggestionsRef.current,
          block.id,
          normalizedSuggestions,
        )

        for (const suggestionId of replacement.replacedIds) {
          logCorrectionEvent({
            type: "stale:drop",
            blockId: block.id,
            suggestionId,
          })
        }

        for (const suggestion of normalizedSuggestions) {
          logCorrectionEvent({
            type: "stale:keep",
            blockId: block.id,
            suggestionId: suggestion.id,
          })
        }

        applyCorrectionSuggestionUpdate((current) =>
          replaceBlockSuggestions(current, block.id, normalizedSuggestions).suggestions,
        )

        if (nextCorrectionBlock) {
          await persistCorrectionBlockWriteThrough(nextCorrectionBlock)
        }
        logCorrectionEvent({
          type: "request:end",
          batchId,
          latencyMs: Date.now() - requestStartedAt,
          suggestions: normalizedSuggestions.length,
          missing: [],
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "block correction failed"
        console.info(`[corrections] block analysis skipped message=${message}`)
      } finally {
        correctionQueueCompletedRef.current += 1

        if (correctionsEnabledRef.current) {
          setCorrectionToast({
            phase: "running",
            completed: correctionQueueCompletedRef.current,
            total: correctionQueueTotalRef.current,
          })
        }
      }
    }

    correctionProcessingRef.current = false
    if (correctionsEnabledRef.current) {
      finishCorrectionQueueIfIdle()
    }
  }, [
    applyCorrectionSuggestionUpdate,
    editor,
    finishCorrectionQueueIfIdle,
    getBlockSuggestions,
    normalizeAutomaticSuggestion,
    persistCorrectionBlockWriteThrough,
  ])

  const enqueueCorrectionBlock = useCallback(
    (block: CorrectionTriggerBlock, reason: "edit" | "hydrate-miss" = "edit") => {
      if (!correctionsEnabledRef.current) {
        return
      }

      const cachedBlock = persistedCorrectionBlocksRef.current.get(block.hash)
      const hasMemorySuggestion = getBlockSuggestions(block.id, block.hash).length > 0

      if (cachedBlock) {
        logCorrectionEvent({
          type: "cache:hit",
          blockId: block.id,
          source: cachedBlock.syncedAt ? "supabase" : "idb",
        })
        return
      }

      logCorrectionEvent(
        hasMemorySuggestion
          ? {
              type: "cache:hit",
              blockId: block.id,
              source: "memory",
            }
          : {
              type: "cache:miss",
              blockId: block.id,
            },
      )

      const currentIds = new Set(correctionQueueRef.current.map((item) => item.id))

      if (!currentIds.has(block.id)) {
        correctionQueueRef.current.push(block)
        correctionQueueTotalRef.current += 1
        logCorrectionEvent({
          type: "queue:enqueue",
          blockId: block.id,
          reason,
        })
      }

      setCorrectionToast({
        phase: "running",
        completed: correctionQueueCompletedRef.current,
        total: correctionQueueTotalRef.current,
      })

      void processCorrectionQueue()
    },
    [getBlockSuggestions, processCorrectionQueue],
  )

  useEffect(() => {
    enqueueCorrectionBlockRef.current = enqueueCorrectionBlock
  }, [enqueueCorrectionBlock])

  useEffect(() => {
    if (!editor) {
      return
    }

    const handleDirtyBlocks = (event: Event) => {
      const blocks = ((event as CustomEvent<{ blocks?: CorrectionTriggerBlock[] }>).detail?.blocks ?? [])

      acknowledgeCorrectionDirtyBlocks(editor, blocks.map((block) => block.id))

      if (
        Date.now() < suppressCorrectionAnalysisUntilRef.current ||
        modeRef.current !== "rich" ||
        !correctionsEnabledRef.current
      ) {
        return
      }

      for (const block of blocks) {
        if (currentWritingIdRef.current) {
          void deletePersistedBlocksForPosition(currentWritingIdRef.current, block)
        }

        const applyStaleInvalidation = () => {
          applyCorrectionSuggestionUpdate((current) => {
            const invalidation = invalidateBlockSuggestions(current, block)

            for (const suggestionId of invalidation.droppedIds) {
              logCorrectionEvent({
                type: "stale:drop",
                blockId: block.id,
                suggestionId,
              })
            }

            for (const suggestionId of invalidation.keptIds) {
              logCorrectionEvent({
                type: "stale:keep",
                blockId: block.id,
                suggestionId,
              })
            }

            return invalidation.suggestions
          })
        }

        if (block.wordCount < 8) {
          applyStaleInvalidation()
          continue
        }

        const existingTimer = correctionTimersRef.current.get(block.id)

        if (existingTimer) {
          window.clearTimeout(existingTimer.timer)
          correctionTimersRef.current.delete(block.id)
        }

        applyStaleInvalidation()

        const timer = window.setTimeout(() => {
          correctionTimersRef.current.delete(block.id)
          const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

          if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) {
            return
          }

          enqueueCorrectionBlock(currentBlock)
        }, 2000)

        correctionTimersRef.current.set(block.id, { timer, pos: block.pos })
      }
    }

    editor.view.dom.addEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)

    return () => {
      editor.view.dom.removeEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)
    }
  }, [applyCorrectionSuggestionUpdate, deletePersistedBlocksForPosition, editor, enqueueCorrectionBlock, getBlockSuggestions])

  useEffect(() => {
    const handleOnline = () => {
      const writingId = currentWritingIdRef.current

      if (!writingId) {
        return
      }

      void flushPendingCorrectionBlocks(writingId)
    }

    window.addEventListener("online", handleOnline)

    return () => {
      window.removeEventListener("online", handleOnline)
    }
  }, [flushPendingCorrectionBlocks])

  useEffect(() => {
    const handleAutomaticInlineAction = (event: Event) => {
      const detail = (event as CustomEvent<{ action?: string; suggestionId?: string }>).detail
      const suggestionId = detail?.suggestionId

      if (!suggestionId) {
        return
      }

      const suggestion = automaticCorrectionSuggestionsRef.current.find((item) => item.id === suggestionId)

      if (!suggestion) {
        return
      }

      if (isSuggestionAcceptDisabled(suggestion) && detail.action === "accept") {
        return
      }

      if (detail.action === "accept") {
        const result = applySuggestionToMarkdown(currentDocumentMarkdownRef.current, suggestion)

        if (result.applied) {
          suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
          applyMarkdownFromPanel(result.markdown)
          rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted")
          const nextSuggestions = updateSuggestionStatuses(
            automaticCorrectionSuggestionsRef.current,
            [suggestion.id],
            "accepted",
          )
          applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
          void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
          return
        }

        const nextSuggestions = updateSuggestionStatuses(
          automaticCorrectionSuggestionsRef.current,
          [suggestion.id],
          "conflict",
        )
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
        return
      }

      if (detail.action === "reject") {
        rememberCorrectionDecision(suggestion.correction_fingerprint, "rejected")
        const nextSuggestions = updateSuggestionStatuses(
          automaticCorrectionSuggestionsRef.current,
          [suggestion.id],
          "rejected",
        )
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
      }
    }

    window.addEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)

    return () => {
      window.removeEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)
    }
  }, [applyCorrectionSuggestionUpdate, applyMarkdownFromPanel, updatePersistedBlocksFromSuggestions])
  const markdownFindMatches = useMemo(
    () => (isFindReplaceOpen ? findTextMatches(markdownValue, findQuery, findCaseSensitive) : []),
    [findCaseSensitive, findQuery, isFindReplaceOpen, markdownValue],
  )
  const richFindMatches = useMemo(
    () => (editor && isFindReplaceOpen ? findDocumentMatches(editor.state.doc, findQuery, findCaseSensitive) : []),
    [editor, findCaseSensitive, findQuery, isFindReplaceOpen],
  )
  const matchCount =
    mode === "markdown" ? markdownFindMatches.length : richFindMatches.length
  const activeMatchIndex = clampFindReplaceIndex(matchCount, findActiveIndex)
  const markdownOverlayHtml = useMemo(
    () =>
      mode === "markdown" && isFindReplaceOpen && findQuery.trim()
        ? renderFindReplaceOverlayHtml(markdownValue, findQuery, findCaseSensitive, activeMatchIndex)
        : undefined,
    [activeMatchIndex, findCaseSensitive, findQuery, isFindReplaceOpen, markdownValue, mode],
  )

  useEffect(() => {
    if (!sessionLoaded) {
      return
    }

    // Guard: don't publish tab state with a stale title while hydration is in progress.
    // During tab switching, displayTitle may still derive from the previous writing's
    // bodyText until hydration settles. Skipping publishTabState here prevents both
    // the transient title flash in the tab bar and session-store corruption from
    // desynchronized routeWritingId/currentWritingId pairs.
    if (hydrationWritingId !== null) {
      return
    }

    // Guard: nothing to publish for a blank draft tab. The draft tab is already
    // initialized correctly by openDraftTab(). Publishing here would write the
    // previous writing's stale displayTitle onto the draft tab because the title
    // state is only reset once the next hydration cycle completes.
    if (currentWritingId === null) {
      return
    }

    // Only pass routeWritingId when it matches the currently loaded writing.
    // After a soft tab switch (window.history.replaceState), routeWritingId stays
    // at the old route's writing ID while currentWritingId has already moved on.
    // Passing the stale routeWritingId would cause publishTabState to overwrite the
    // old tab's data with the new document's id/title, corrupting all other tabs.
    publishTabState({
      routeWritingId: routeWritingId === currentWritingId ? routeWritingId : null,
      writingId: currentWritingId,
      slug: writingSlug,
      title: displayTitle,
      saveState: syncStatus === "saved-local" ? "saved-local" : syncStatus,
      hasPendingSync: syncStatus !== "saved",
    })
  }, [currentWritingId, displayTitle, hydrationWritingId, routeWritingId, sessionLoaded, syncStatus, writingSlug])

  useEffect(() => {
    if (!editor) {
      return
    }

    if (!isFindReplaceOpen || !findQuery.trim()) {
      clearFindReplaceQueryState(editor)
      return
    }

    setFindReplaceQueryState(editor, {
      query: findQuery,
      caseSensitive: findCaseSensitive,
      activeIndex: activeMatchIndex,
    })
  }, [activeMatchIndex, editor, findCaseSensitive, findQuery, isFindReplaceOpen])

  useEffect(() => {
    if (findActiveIndex !== activeMatchIndex) {
      setFindActiveIndex(activeMatchIndex)
    }
  }, [activeMatchIndex, findActiveIndex])

  useEffect(() => {
    if (!isFindReplaceOpen || !findQuery.trim()) {
      setFindActiveIndex(0)
      return
    }

    setFindActiveIndex(0)
  }, [findCaseSensitive, findQuery, isFindReplaceOpen])

  function captureEditorCursorSnapshot(): EditorCursorSnapshot | null {
    if (modeRef.current === "markdown") {
      const textarea = markdownTextareaRef.current
      const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      const shellViewport = document.querySelector<HTMLElement>("main")

      if (!textarea) {
        return null
      }

      return {
        mode: "markdown",
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
        scrollTop: textarea.scrollTop,
        scrollLeft: textarea.scrollLeft,
        editorScrollTop: editorViewport?.scrollTop,
        editorScrollLeft: editorViewport?.scrollLeft,
        shellScrollTop: shellViewport?.scrollTop,
        shellScrollLeft: shellViewport?.scrollLeft,
        windowScrollX: window.scrollX,
        windowScrollY: window.scrollY,
      }
    }

    if (!editor) {
      return null
    }

    return {
      mode: "rich",
      from: editor.state.selection.from,
      to: editor.state.selection.to,
    }
  }

  function restoreEditorCursorSnapshot(snapshot: EditorCursorSnapshot | null) {
    if (!snapshot) {
      return
    }

    if (snapshot.mode === "markdown") {
      queueMarkdownSelectionRestore(snapshot.start, snapshot.end, snapshot)
      return
    }

    if (!editor) {
      return
    }

    editor.chain().focus().setTextSelection({ from: snapshot.from, to: snapshot.to }).run()
  }

  function closeFindReplacePanel(options?: { restoreSelection?: boolean }) {
    const snapshot = editorCursorSnapshotRef.current

    setIsFindReplaceOpen(false)
    setFindQuery("")
    setReplaceValue("")
    setFindActiveIndex(0)

    if (editor) {
      clearFindReplaceQueryState(editor)
    }

    if (options?.restoreSelection !== false) {
      window.requestAnimationFrame(() => {
        restoreEditorCursorSnapshot(snapshot)
      })
    }
  }

  function openFindReplacePanel(options?: { focusReplace?: boolean }) {
    editorCursorSnapshotRef.current = captureEditorCursorSnapshot()

    if (!isFindReplaceOpen) {
      setFindActiveIndex(0)
    }

    setIsFindReplaceOpen(true)

    window.requestAnimationFrame(() => {
      if (options?.focusReplace) {
        replaceInputRef.current?.focus()
        return
      }

      findInputRef.current?.focus()
      findInputRef.current?.select()
    })
  }

  function syncActiveRichMatchSelection(nextActiveIndex: number) {
    if (!editor || !isFindReplaceOpen || !findQuery.trim()) {
      return
    }

    const targetMatch = richFindMatches[clampFindReplaceIndex(richFindMatches.length, nextActiveIndex)]

    if (!targetMatch) {
      return
    }

    const transaction = editor.state.tr
    transaction.setSelection(TextSelection.create(transaction.doc, targetMatch.from, targetMatch.to))
    transaction.scrollIntoView()
    transaction.setMeta("addToHistory", false)
    editor.view.dispatch(transaction)

    window.requestAnimationFrame(() => {
      const activeMatchElement = editor.view.dom.querySelector<HTMLElement>(".od-find-match-active")

      if (activeMatchElement) {
        activeMatchElement.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "auto",
        })
        return
      }

      const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
      const startCoords = editor.view.coordsAtPos(targetMatch.from)
      const endCoords = editor.view.coordsAtPos(targetMatch.to)

      if (!editorViewport) {
        return
      }

      const viewportRect = editorViewport.getBoundingClientRect()
      const matchTop = startCoords.top
      const matchBottom = Math.max(startCoords.bottom, endCoords.bottom)
      const topInset = 96
      const bottomInset = 56

      if (matchTop < viewportRect.top + topInset) {
        editorViewport.scrollBy({
          top: matchTop - viewportRect.top - topInset,
          behavior: "auto",
        })
        return
      }

      if (matchBottom > viewportRect.bottom - bottomInset) {
        editorViewport.scrollBy({
          top: matchBottom - viewportRect.bottom + bottomInset,
          behavior: "auto",
        })
      }
    })
  }

  function syncActiveMarkdownMatchSelection(nextActiveIndex: number) {
    const textarea = markdownTextareaRef.current
    const targetMatch = markdownFindMatches[clampFindReplaceIndex(markdownFindMatches.length, nextActiveIndex)]

    if (!textarea || !targetMatch) {
      return
    }

    textarea.focus()
    textarea.setSelectionRange(targetMatch.start, targetMatch.end)
    markdownSelectionRef.current = {
      start: targetMatch.start,
      end: targetMatch.end,
      text: textarea.value.slice(targetMatch.start, targetMatch.end),
    }
  }

  const navigateFindMatches = useCallback(
    (direction: 1 | -1) => {
      if (matchCount === 0) {
        return
      }

      const nextActiveIndex = resolveNextFindReplaceIndex(matchCount, activeMatchIndex, direction)
      setFindActiveIndex(nextActiveIndex)

      if (modeRef.current === "markdown") {
        window.requestAnimationFrame(() => {
          syncActiveMarkdownMatchSelection(nextActiveIndex)
        })
        return
      }

      syncActiveRichMatchSelection(nextActiveIndex)
    },
    [activeMatchIndex, matchCount, syncActiveMarkdownMatchSelection, syncActiveRichMatchSelection],
  )

  const handleReplaceCurrentMatch = useCallback(() => {
    if (!findQuery.trim()) {
      return
    }

    if (modeRef.current === "markdown") {
      const currentMatch = markdownFindMatches[activeMatchIndex]

      if (!currentMatch) {
        return
      }

      const nextMarkdown = replaceMatchInText(markdownValue, currentMatch, replaceValue)
      const nextMatches = findTextMatches(nextMarkdown, findQuery, findCaseSensitive)
      const nextActive = clampFindReplaceIndex(nextMatches.length, activeMatchIndex)

      handleMarkdownChange(nextMarkdown)
      setFindActiveIndex(nextActive)

      window.requestAnimationFrame(() => {
        syncActiveMarkdownMatchSelection(nextActive)
      })
      return
    }

    if (!editor) {
      return
    }

    const currentMatch = richFindMatches[activeMatchIndex]

    if (!currentMatch) {
      return
    }

    const transaction = editor.state.tr.insertText(replaceValue, currentMatch.from, currentMatch.to)
    editor.view.dispatch(transaction)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)

    const nextActive = clampFindReplaceIndex(findDocumentMatches(editor.state.doc, findQuery, findCaseSensitive).length, activeMatchIndex)
    setFindActiveIndex(nextActive)
    syncActiveRichMatchSelection(nextActive)
  }, [
    activeMatchIndex,
    editor,
    findCaseSensitive,
    findQuery,
    handleMarkdownChange,
    markdownFindMatches,
    markdownValue,
    persistEditorSnapshot,
    replaceValue,
    richFindMatches,
    syncActiveMarkdownMatchSelection,
    syncActiveRichMatchSelection,
    updateDerivedEditorState,
  ])

  const handleReplaceAllMatches = useCallback(() => {
    if (!findQuery.trim() || matchCount === 0) {
      return
    }

    const confirmation = window.confirm(`Replace ${matchCount} matches with "${replaceValue}"?`)

    if (!confirmation) {
      return
    }

    if (modeRef.current === "markdown") {
      const result = replaceAllMatchesInText(markdownValue, findQuery, replaceValue, findCaseSensitive)
      handleMarkdownChange(result.value)
      setFindActiveIndex(0)
      return
    }

    if (!editor) {
      return
    }

    if (richFindMatches.length === 0) {
      return
    }

    const transaction = editor.state.tr

    for (let index = richFindMatches.length - 1; index >= 0; index -= 1) {
      const match = richFindMatches[index]
      transaction.insertText(replaceValue, match.from, match.to)
    }

    editor.view.dispatch(transaction)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)
    setFindActiveIndex(0)
  }, [
    editor,
    findCaseSensitive,
    findQuery,
    handleMarkdownChange,
    markdownValue,
    matchCount,
    persistEditorSnapshot,
    replaceValue,
    richFindMatches,
    updateDerivedEditorState,
  ])

  const handleSelectWorkspaceTab = useCallback(
    (tabId: string) => {
      const nextTab = editorSession.tabs.find((tab) => tab.id === tabId)
      if (!nextTab) {
        return
      }

      persistCurrentWorkspaceViewState()
      focusTab(tabId)
      navigatedToDraftRef.current = false

      if (nextTab.writing_id) {
        currentWritingIdRef.current = nextTab.writing_id
        setCurrentWritingId(nextTab.writing_id)
        setHydrationWritingId(nextTab.writing_id)
        window.history.replaceState(null, "", `/write/${nextTab.slug ?? nextTab.writing_id}`)
        return
      }

      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      window.history.replaceState(null, "", "/write")
    },
    [editorSession.tabs, persistCurrentWorkspaceViewState],
  )

  const handleCloseWorkspaceTab = useCallback(
    (tabId: string) => {
      const targetTab = editorSession.tabs.find((tab) => tab.id === tabId)
      if (!targetTab) {
        return
      }

      if (targetTab.has_pending_sync) {
        const confirmed = window.confirm("This writing still has unsynced changes. Close it anyway?")
        if (!confirmed) {
          return
        }
      }

      if (tabId === (currentWritingId ?? EDITOR_DRAFT_TAB_ID)) {
        persistCurrentWorkspaceViewState()
      }

      const nextActiveTabId = closeTab(tabId)

      if (tabId !== (currentWritingId ?? EDITOR_DRAFT_TAB_ID)) {
        return
      }

      const nextTab = editorSession.tabs.find((tab) => tab.id === nextActiveTabId)
      navigatedToDraftRef.current = false
      if (nextTab?.writing_id) {
        currentWritingIdRef.current = nextTab.writing_id
        setCurrentWritingId(nextTab.writing_id)
        setHydrationWritingId(nextTab.writing_id)
        window.history.replaceState(null, "", `/write/${nextTab.slug ?? nextTab.writing_id}`)
        return
      }

      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      window.history.replaceState(null, "", "/write")
    },
    [currentWritingId, editorSession.tabs, persistCurrentWorkspaceViewState],
  )

  const handleRenameWorkspaceTab = useCallback(
    (tabId: string) => {
      if (tabId !== editorSession.active_tab_id) {
        return
      }

      setRenameModalSnapshot({
        title: titleRef.current.trim() || UNTITLED_WRITING_TITLE,
        bodyText: editor ? getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)) : "",
      })
      setRenameModalOpen(true)
    },
    [editor, editorSession.active_tab_id],
  )

  const handleRenameModalOpenChange = useCallback((open: boolean) => {
    setRenameModalOpen(open)
    if (!open) {
      setRenameModalSnapshot(null)
    }
  }, [])

  const handleRenameWritingConfirm = useCallback(
    (nextTitle: string) => {
      setTitle(nextTitle)
      setHasExplicitTitle(nextTitle !== UNTITLED_WRITING_TITLE)

      if (editor) {
        void persistEditorSnapshot(editor, { title: nextTitle })
      }
    },
    [editor, persistEditorSnapshot],
  )

  const handleCreateWorkspaceTab = useCallback(async (options?: { skipConfirm?: boolean }) => {
    if (!options?.skipConfirm && editorSession.tabs.length >= 10) {
      const confirmed = window.confirm("You already have many tabs open. Open another writing anyway?")
      if (!confirmed) {
        return
      }
    }

    persistCurrentWorkspaceViewState()
    const activeDraftTabId = currentWritingId ?? EDITOR_DRAFT_TAB_ID
    const isActiveDraft =
      !currentWritingId ||
      editorSession.tabs.some((tab) => tab.id === activeDraftTabId && tab.writing_id === null)

    const nowIso = new Date().toISOString()
    const nextWritingId = createWritingId()
    const nextTitle = deriveAutoTitle("", nowIso)

    // Claim ownership of the blank-draft -> identified-local-writing transition
    // synchronously so persistEditorSnapshot never races against it.
    currentWritingIdRef.current = nextWritingId
    setCurrentWritingId(nextWritingId)
    setHydrationWritingId(nextWritingId)
    window.history.replaceState(null, "", `/write/${nextWritingId}`)

    const blankDraftRecord: WritingRecord = {
      id: nextWritingId,
      authorId: null,
      title: nextTitle,
      content: {
        richText: EMPTY_EDITOR_JSON as Record<string, unknown>,
        markdown: null,
        plainText: "",
        canonicalSource: "rich-text",
      },
      slug: null,
      status: "draft",
      visibility: "private",
      parentId: null,
      correspondenceId: null,
      version: 1,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
    }

    if (isActiveDraft) {
      try {
        await webDocumentService.saveWriting({ writing: blankDraftRecord })
      } catch {
        // If save fails, revert the optimistic claim so persistEditorSnapshot
        // can fall back to identity-on-first-input.
        currentWritingIdRef.current = null
        setCurrentWritingId(null)
        setHydrationWritingId(null)
        return
      }

      openWritingTab({
        writingId: nextWritingId,
        title: nextTitle,
        saveState: "saved",
        hasPendingSync: false,
      })
      // Double rAF: first waits for React to commit the new tab to the DOM,
      // second ensures the editor contenteditable is focusable.
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
          editorEl?.focus()
        })
      })
      return
    }

    try {
      await webDocumentService.saveWriting({ writing: blankDraftRecord })
    } catch {
      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      return
    }

    openWritingTab({
      writingId: nextWritingId,
      title: nextTitle,
      saveState: "saved",
      hasPendingSync: false,
    })
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
        editorEl?.focus()
      })
    })
  }, [currentWritingId, editorSession.tabs, persistCurrentWorkspaceViewState])

  useEffect(() => {
    if (!forceNewWriting || !sessionLoaded || forceNewWritingRequestedRef.current) {
      return
    }

    forceNewWritingRequestedRef.current = true
    void handleCreateWorkspaceTab({ skipConfirm: true })
  }, [forceNewWriting, handleCreateWorkspaceTab, sessionLoaded])

  const exportFileBaseName = useMemo(
    () =>
      getExportFileBaseName({
        title: displayTitle,
        bodyText,
        writingId: currentWritingId ?? "draft",
      }),
    [bodyText, currentWritingId, displayTitle],
  )

  const downloadBlob = useCallback((blob: Blob, filename: string) => {
    downloadBlobUtil(blob, filename)
  }, [])

  const exportMarkdown = useCallback(async () => {
    if (!editor) {
      return
    }

    const bodyMarkdown =
      modeRef.current === "markdown"
        ? markdownValue
        : normalizeMarkdownForRoundTrip(
            getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
          )

    const blob = new Blob([`${bodyMarkdown.trimEnd()}\n`], { type: "text/markdown;charset=utf-8" })
    downloadBlob(blob, `${exportFileBaseName}.md`)
  }, [downloadBlob, editor, exportFileBaseName, markdownValue])

  const exportBinary = useCallback(
    async (format: "pdf" | "docx") => {
      if (!currentWritingId) {
        return
      }

      const result = await webDocumentService.exportWriting({ writingId: currentWritingId, format })
      if (result.error) {
        throw new Error(result.error.message)
      }

      const blob = new Blob([result.data.bytes.buffer as ArrayBuffer], { type: result.data.mimeType })
      downloadBlob(blob, `${exportFileBaseName}.${format}`)
    },
    [currentWritingId, downloadBlob, exportFileBaseName],
  )

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (renameModalOpen || linkModalOpen || footnoteModalOpen || tableModalOpen) {
          return
        }

        if (pendingAnnotation) {
          event.preventDefault()
          setPendingAnnotation(null)
          return
        }

        if (pendingRichSelection) {
          event.preventDefault()
          setPendingRichSelection(null)
          return
        }

        if (isFindReplaceOpen) {
          event.preventDefault()
          closeFindReplacePanel()
          return
        }

        const intent = resolveEscapeIntent({
          hasOpenPanel: activePanel !== null,
          isFocusMode,
        })

        if (intent === "close-panel") {
          event.preventDefault()
          closeActivePanel()
        } else if (intent === "exit-focus") {
          event.preventDefault()
          setIsFocusMode(false)
        }

        return
      }

      if (renameModalOpen || linkModalOpen || footnoteModalOpen || tableModalOpen) {
        return
      }

      const action = getEditorShortcutAction(event)

      if (!action) {
        return
      }

      event.preventDefault()
      handleRunAction(action)
    }

    window.addEventListener("keydown", onWindowKeyDown)

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown)
    }
  }, [
    activePanel,
    footnoteModalOpen,
    handleRunAction,
    isFocusMode,
    isFindReplaceOpen,
    linkModalOpen,
    closeFindReplacePanel,
    closeActivePanel,
    pendingAnnotation,
    pendingRichSelection,
    renameModalOpen,
    tableModalOpen,
  ])

  return (
    <section id="editor" data-page="editor" className="min-h-screen bg-bg">
      <div className="EditorLayout hidden min-h-screen flex-col md:flex">
        {!isFocusMode ? (
          <EditorTopbar
            editor={editor}
            mode={mode}
            isFocusMode={isFocusMode}
            activePanel={activePanel}
            isPublicationModeEnabled={activePanel === "publication"}
            tabs={editorSession.tabs}
            activeTabId={editorSession.active_tab_id}
            onSelectTab={handleSelectWorkspaceTab}
            onCloseTab={handleCloseWorkspaceTab}
            onRenameTab={handleRenameWorkspaceTab}
            onNewTab={handleCreateWorkspaceTab}
            onToggleFocusMode={() => setIsFocusMode((currentState) => !currentState)}
            onTogglePanel={(panel) => {
              setActivePanel((current) => (current === panel ? null : panel))
            }}
            onRunAction={handleRunAction}
          />
        ) : null}

        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
            {sessionLoaded && editorSession.tabs.length === 0 ? (
              <EditorEmptyState onNewWriting={handleCreateWorkspaceTab} />
            ) : (
              <>
                {isBodyHydrating ? (
                  <div
                    aria-hidden="true"
                    data-testid="editor-body-skeleton"
                    className="pointer-events-none absolute inset-x-0 top-0 z-10 mx-auto mt-12 max-w-prose animate-pulse space-y-3 px-6"
                  >
                    <div className="h-3 w-3/4 rounded bg-foreground/5" />
                    <div className="h-3 w-11/12 rounded bg-foreground/5" />
                    <div className="h-3 w-2/3 rounded bg-foreground/5" />
                  </div>
                ) : null}
                <WritingEditorContent
                  editor={editor}
                  mode={mode}
                  markdownValue={markdownValue}
                  onMarkdownChange={handleMarkdownChange}
                  onMarkdownSelectionChange={(selection) => {
                    markdownSelectionRef.current = selection
                    setMarkdownSelectionState(selection)
                  }}
                  markdownTextareaRef={markdownTextareaRef}
                  markdownOverlayHtml={markdownOverlayHtml}
                  topSlot={
                    !isFocusMode && isFindReplaceOpen ? (
                      <EditorFindReplace
                        searchValue={findQuery}
                        replaceValue={replaceValue}
                        caseSensitive={findCaseSensitive}
                        matchCount={matchCount}
                        activeMatchNumber={matchCount > 0 ? activeMatchIndex + 1 : 0}
                        onSearchChange={setFindQuery}
                        onReplaceChange={setReplaceValue}
                        onToggleCaseSensitive={() => setFindCaseSensitive((currentState) => !currentState)}
                        onNavigatePrevious={() => navigateFindMatches(-1)}
                        onNavigateNext={() => navigateFindMatches(1)}
                        onReplaceOne={handleReplaceCurrentMatch}
                        onReplaceAll={handleReplaceAllMatches}
                        onClose={() => closeFindReplacePanel()}
                        searchInputRef={findInputRef}
                        replaceInputRef={replaceInputRef}
                      />
                    ) : null
                  }
                />

                {!isFocusMode ? (
                  <EditorStatusBar
                    mode={mode}
                    metrics={textMetrics}
                    selectionMetrics={selectionMetrics}
                    saveState={syncStatus}
                    isNotesPanelOpen={activePanel === "notes"}
                    onToggleMode={handleToggleMode}
                    onToggleNotesPanel={() => {
                      setActivePanel((current) => (current === "notes" ? null : "notes"))
                    }}
                  />
                ) : null}
              </>
            )}
          </div>
        </div>

        {!isFocusMode && activePanel && editorSession.tabs.length > 0 ? (
          <Suspense fallback={null}>
            {activePanel === "notes" ? (
              <NotesPanel
                annotations={footnotes}
                currentMarkdown={currentDocumentMarkdown}
                onClose={closeActivePanel}
                onNavigate={(type, index, pos) => {
                  if (!editor) return
                  if (pos != null) {
                    editor.chain().focus().setTextSelection(pos).scrollIntoView().run()
                    return
                  }
                  editor.state.doc.descendants((node, nodePos) => {
                    if (
                      (node.type.name === "annotationReference" ||
                        node.type.name === "footnoteReference") &&
                      (node.attrs.type as string) === type &&
                      (node.attrs.index as number) === index
                    ) {
                      editor.chain().focus().setTextSelection(nodePos).scrollIntoView().run()
                      return false
                    }
                  })
                }}
                onUpdateAnnotation={(type, index, text) => {
                  if (mode === "rich" && editor) {
                    editor.commands.updateAnnotation(type, index, text)
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  } else if (type === "footnote") {
                    const nextMarkdown = updateMarkdownFootnote(markdownValue, index, text)
                    applyMarkdownFromPanel(nextMarkdown)
                  }
                }}
                onUpdateAnnotationType={(type, index, newType) => {
                  if (mode === "rich" && editor) {
                    editor.commands.updateAnnotationType(type, index, newType)
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  }
                }}
                onDeleteAnnotation={(type, index) => {
                  if (mode === "rich" && editor) {
                    editor.commands.deleteAnnotation(type, index)
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  } else if (type === "footnote") {
                    const nextMarkdown = removeMarkdownFootnote(markdownValue, index)
                    applyMarkdownFromPanel(nextMarkdown)
                  }
                }}
                onUpdateHighlight={(anchorText: string, text: string, anchorStart?: number, anchorEnd?: number) => {
                  if (!editor || !anchorText) return
                  convertStandaloneHighlight(anchorText, "highlight", text, anchorStart, anchorEnd)
                  setRichFootnoteRevision((r) => r + 1)
                  updateDerivedEditorState(editor)
                  void persistEditorSnapshot(editor)
                }}
                onConvertHighlightToAi={(anchorText: string, text: string, anchorStart?: number, anchorEnd?: number) => {
                  if (!editor || !anchorText) return
                  const aiText = text.trim() || anchorText
                  convertStandaloneHighlight(anchorText, "ai", aiText, anchorStart, anchorEnd)
                  setRichFootnoteRevision((r) => r + 1)
                  updateDerivedEditorState(editor)
                  void persistEditorSnapshot(editor)
                }}
                onDeleteHighlight={(anchorText: string, anchorStart?: number, anchorEnd?: number) => {
                  if (!editor || !anchorText) return
                  const highlightMark = editor.schema.marks.highlight
                  if (!highlightMark) return
                  editor.state.doc.descendants((node, pos) => {
                    if (node.type.name !== "text") return
                    if (!node.marks.some((m) => m.type.name === "highlight")) return
                    const $pos = editor.state.doc.resolve(pos)
                    const range = getMarkRange($pos, highlightMark)
                    if (!range) return
                    const text = editor.state.doc.textBetween(range.from, range.to)
                    if (text === anchorText) {
                      if (anchorStart !== undefined && anchorEnd !== undefined) {
                        if (range.from !== anchorStart || range.to !== anchorEnd) return
                      }
                      editor.chain().setTextSelection(range).unsetHighlight().run()
                    }
                  })
                }}
              />
            ) : activePanel === "properties" ? (
              <PropertiesPanel
                writingId={currentWritingId}
                lifecycle={lifecycle}
                status={writingStatus}
                visibility={writingVisibility}
                metrics={textMetrics}
                spellcheckPreference={spellcheckPreference}
                spellcheckLanguage={spellcheckConfig.language}
                onExportMarkdown={exportMarkdown}
                onExportPdf={() => exportBinary("pdf")}
                onExportDocx={() => exportBinary("docx")}
                onClose={closeActivePanel}
                onStatusChange={(nextStatus) => {
                  if (nextStatus === writingStatus) {
                    return
                  }

                  setWritingStatus(nextStatus)
                  void applyPanelMetaChange(editor, { status: nextStatus }, {
                    persistSnapshot: (overrides) => {
                      if (!editor) {
                        return
                      }

                      void persistEditorSnapshot(editor, overrides)
                    },
                  })
                }}
                onVisibilityChange={(nextVisibility) => {
                  if (nextVisibility === writingVisibility) {
                    return
                  }

                  setWritingVisibility(nextVisibility)
                  void applyPanelMetaChange(editor, { visibility: nextVisibility }, {
                    persistSnapshot: (overrides) => {
                      if (!editor) {
                        return
                      }

                      void persistEditorSnapshot(editor, overrides)
                    },
                  })
                }}
                onSpellcheckPreferenceChange={(nextPreference) => {
                  if (nextPreference === spellcheckPreference) {
                    return
                  }

                  setSpellcheckPreference(nextPreference)
                  persistEditorSpellcheckPreference(spellcheckScope, nextPreference)
                }}
              />
            ) : (
              <CorrectionsPanel
                suggestions={automaticCorrectionSuggestions}
                markdown={currentDocumentMarkdown}
                correctionsEnabled={correctionsEnabled}
                showCorrections={showCorrections}
                onAcceptSuggestion={handleAcceptCorrection}
                onRejectSuggestion={handleRejectCorrection}
                onAcceptAll={handleAcceptAllCorrections}
                onRejectAll={handleRejectAllCorrections}
                onCorrectionsEnabledChange={setCorrectionsEnabled}
                onShowCorrectionsChange={setShowCorrections}
                onClose={closeActivePanel}
              />
            )}
          </Suspense>
        ) : null}
      </div>

      {correctionToast ? (
        <div
          className="fixed bottom-12 right-6 z-50 rounded-[8px] border-[0.5px] border-border bg-sb px-3 py-2 text-[11px] text-ink-3 shadow-float-md"
          role="status"
          aria-live="polite"
        >
          {correctionToast.phase === "complete"
            ? "✓ Revisión completada"
            : correctionToast.completed === 0
              ? "Revisando documento..."
              : `${correctionToast.completed} de ${correctionToast.total} bloques revisados`}
        </div>
      ) : null}

      <div className="md:hidden">
        <MobileWriteNotice />
      </div>

      {renameModalOpen || renameModalSnapshot ? (
        <RenameWritingModal
          open={renameModalOpen}
          title={renameModalSnapshot?.title ?? UNTITLED_WRITING_TITLE}
          bodyText={renameModalSnapshot?.bodyText ?? ""}
          writingId={currentWritingIdRef.current ?? undefined}
          onOpenChange={handleRenameModalOpenChange}
          onConfirm={handleRenameWritingConfirm}
        />
      ) : null}

      <InsertLinkModal
        open={linkModalOpen}
        initialText={selectionRef.current?.text ?? ""}
        onOpenChange={setLinkModalOpen}
        onConfirm={handleInsertLink}
      />

      <InsertFootnoteModal open={footnoteModalOpen} onOpenChange={setFootnoteModalOpen} onConfirm={handleInsertFootnote} />

      <InsertTableModal open={tableModalOpen} onOpenChange={setTableModalOpen} onConfirm={handleInsertTable} />

      <InsertImageModal
        open={imageModalOpen}
        writingId={currentWritingId ?? ""}
        onOpenChange={setImageModalOpen}
        onConfirm={handleInsertImage}
      />

      <SelectionPopup
        position={pendingRichSelection?.popupPosition ?? null}
        onSelectType={handleEditorSelectType}
        onDismiss={dismissSelectionPopup}
      />

      <AnnotationBubble
        position={pendingAnnotation?.position ?? null}
        type={pendingAnnotation?.annotationType ?? "personal"}
        onConfirm={handleConfirmAnnotation}
        onCancel={() => setPendingAnnotation(null)}
      />
    </section>
  )
}
