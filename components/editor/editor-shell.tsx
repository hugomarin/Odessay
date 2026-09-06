"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getMarkRange, type JSONContent } from "@tiptap/core"
import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { generateHTML } from "@tiptap/html"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
import { TextSelection } from "@tiptap/pm/state"
import { useRouter } from "next/navigation"
import { Bot } from "lucide-react"
import { useManualCorrections } from "@/hooks/useManualCorrections"
import {
  mapLocalSyncStatusToSaveState,
  mapSyncLifecycleToSaveState,
  type EditorSaveState,
} from "@/components/editor/save-state"
import { WritingEditorContent } from "@/components/editor/editor-content"
import { ImagePresentationViewer } from "@/components/editor/image-presentation-viewer"
import { EditorEmptyState } from "@/components/editor/editor-empty-state"
import { EditorFindReplace } from "@/components/editor/editor-find-replace"
import { EditorSheetHeader } from "@/components/editor/editor-sheet-header"
import { EditorShortcutsDialog } from "@/components/editor/editor-shortcuts-dialog"
import { EditorStatusBar } from "@/components/editor/status-bar"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { EditorRightPanelTabs } from "@/components/editor/panels/editor-right-panel-tabs"
import { MobileWriteNotice } from "@/components/editor/mobile-write-notice"
import {
  AnnotationBubble,
  nextAnnotationSessionId,
  type AnnotationBubblePosition,
} from "@/components/reading/margins/annotation-bubble"
import { SelectionPopup, type SelectionPopupPosition } from "@/components/reading/margins/selection-popup"
import { InsertFootnoteModal } from "@/components/editor/modals/insert-footnote-modal"
import { BackupImageModal } from "@/components/editor/modals/backup-image-modal"
import { InsertImageModal } from "@/components/editor/modals/insert-image-modal"
import { InsertLinkModal } from "@/components/editor/modals/insert-link-modal"
import { InsertTableModal } from "@/components/editor/modals/insert-table-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import {
  annotateMarkdownStandaloneHighlight,
  appendMarkdownFootnote,
  changeMarkdownAnnotationType,
  extractRichEditorAnnotations,
  getMarkdownFootnotes,
  removeMarkdownAnnotation,
  removeMarkdownStandaloneHighlight,
  updateMarkdownAnnotation,
} from "@/lib/editor/footnote-extension"
import type { AnnotationPanelEntry } from "@/components/editor/panels/notes-panel"
import {
  convertHtmlTablesToMarkdown,
  materializeMarkdownForRichParser,
  normalizeMarkdownForRoundTrip,
  toggleMarkdownInlineMarker,
} from "@/lib/editor/markdown-format"
import { FOOTNOTE_REF_EVENT, getEditorFootnotes, getMarkdownWithFootnoteDefinitions, type AnnotationType } from "@/lib/editor/footnote-node"
import {
  deleteStandaloneHighlight,
  resolveStandaloneHighlightRange,
} from "@/lib/editor/annotation-highlight"
import { areFloatingOverlayAnchorsEqual } from "@/lib/reading/floating-overlay-position"
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
import { getResolvedCorrectionText, resolveCorrectionDecorationRanges } from "@/lib/editor/ai-correction-decorations"
import { getHydrateMissCorrectionBlocks, isCorrectionBlockEligible } from "@/lib/editor/correction-analysis"
import { createCorrectionSuggestionBatcher } from "@/lib/editor/correction-suggestion-batcher"
import {
  collectCorrectionBlocks,
  acknowledgeCorrectionDirtyBlocks,
  getCurrentCorrectionBlock,
  type CorrectionTriggerBlock,
} from "@/lib/editor/correction-trigger-plugin"
import {
  applyPublicationSuggestionGroup,
  deriveSuggestionContexts,
  getVisibleCorrectionSuggestions,
  hashPublicationSource,
  invalidateBlockSuggestions,
  isSuggestionAcceptDisabled,
  replaceBlockSuggestions,
  updateSuggestionStatuses,
} from "@/lib/editor/suggestion-engine"
import { forgetCorrectionDecision, readCorrectionMemory, rememberCorrectionDecision } from "@/lib/editor/correction-memory-client"
import { admitSuggestions, type AdmissionContext } from "@/lib/corrections/engine/admission"
import {
  CORRECTION_STALE_TIMEOUT_MS,
  consumeDeferredCorrectionBlocks,
  deferCorrectionBlocks,
  dropExpiredStaleSuggestions,
  dropStaleSuggestionsForBlock,
  restorePendingSuggestions,
  type DeferredCorrectionBlocksState,
} from "@/lib/corrections/engine/lifecycle"
import {
  createStableFingerprint,
  stableFingerprintFromStoredFingerprint,
} from "@/lib/corrections/engine/identity"
import { adaptCorrectionsContract } from "@/lib/ai/corrections-contract-adapter"
import { CORRECTION_BLOCK_BATCH_SIZE, CORRECTION_ENGINE_REVISION } from "@/lib/ai/corrections-config"
import {
  getMissingCorrectionBlockIds,
  takeCorrectionBatch,
} from "@/lib/corrections/engine/batching"
import {
  CORRECTION_REVIEW_FAILURE_COOLDOWN_MS,
  buildCorrectionReviewRetryKey,
  CORRECTION_REVIEW_MAX_RETRIES,
  decideCorrectionReviewRetry,
} from "@/lib/corrections/engine/retry"
import {
  createBlankDraftIdentity,
  createNewWritingSessionState,
  createRouteHydrationSessionState,
  resolvePersistedSessionRestoreTransition,
  resolveUnavailableWritingRecovery,
  resolveExternalWritingLoad,
} from "@/lib/editor/hydration-session"
import { EDITOR_DRAFT_TAB_ID } from "@/lib/local-db/editor-sessions"
import { getExportFileBaseName } from "@/lib/export/writing-export"
import {
  buildEditorSpellcheckConfig,
  DEFAULT_EDITOR_SPELLCHECK_LANGUAGE,
  readEditorSpellcheckPreference,
  type EditorSpellcheckPreference,
} from "@/lib/editor/spellcheck"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { isLocalImageSource, type ImagePresentationRequest, type LocalImageBackupRequest } from "@/lib/editor/local-image-extension"
import { backUpLocalImage } from "@/lib/editor/local-image-backup"
import { type EditorShortcutAction, getEditorShortcutAction } from "@/lib/editor/shortcuts"
import type { RichSelectionRange } from "@/lib/editor/topbar-compact"
import { calculateTextMetrics } from "@/lib/editor/text-metrics"
import { saveBinaryArtifact } from "@/lib/utils/download"
import { cn } from "@/lib/utils"
import { useEditorSelection, type MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { logCorrectionEvent } from "@/lib/observability/corrections-log"
import {
  CORRECTION_BLOCK_CACHE_LIMIT,
  createCorrectionBlockRecordId,
  DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
  findStaleCorrectionBlockRecords,
  hydrateCorrectionBlocksFromRemote,
  parseCorrectionBlockLogicalId,
  persistCorrectionBlockRemotely,
  reconcileHydratedCorrectionBlocks,
} from "@/lib/corrections/persistence"
import { createLearnedWordSet, normalizeLearnedWord } from "@/lib/corrections/learned-words"
import {
  loadCachedLearnedWordsPages,
  mergeLearnedWordEntries,
  primeLearnedWordsCache,
  removeCachedLearnedWord,
  upsertCachedLearnedWord,
} from "@/lib/corrections/learned-words-loader"
import { buildLearnWordRollbackState } from "@/lib/corrections/learned-words-rollback"
import { getLocalDBScope, localDB, subscribeToLocalDBChanges, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type {
  ArtifactType,
  LocalCorrectionBlock,
  PublicationSuggestion,
  WritingLifecycle,
  WritingStatus,
  WritingVisibility,
} from "@/lib/local-db/schema"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
import { getAIService } from "@/lib/services/ai-service-factory"
import { getAssetService } from "@/lib/services/asset-service-factory"
import type { LearnedWordEntry } from "@/lib/services/contracts/ai-service"
import {
  createDesktopDraft as createProductionDesktopDraft,
  getDocumentService,
  importDesktopWritingFile,
} from "@/lib/services/document-service-factory"
import {
  filenameToTitle,
  titleToFilename,
  UNTITLED_DOCUMENT_NAME,
} from "@/lib/desktop/document-naming"
import { desktopDocumentEngine } from "@/lib/editor/desktop-document-engine"
import { consumePendingOpenFile } from "@/lib/editor/pending-open-file"
import {
  describeOpenOutcome,
  isUnifiedOpenEnabled,
  openDocumentById,
  openDocumentByIdWithRetry,
  openDocumentByPath,
} from "@/lib/services/open-document-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { useTauriMenuEvents } from "@/hooks/useTauriMenuEvents"
import { useTauriCloseGuard } from "@/hooks/useTauriCloseGuard"
import { useTauriEditorMenuEvents } from "@/hooks/useTauriEditorMenuEvents"
import type { WritingRecord } from "@/lib/services/contracts/document-service"
import type { EditorHydrationRecord } from "@/lib/editor/document-hydration"
import { resolveHydrationOutcome } from "@/lib/editor/hydration-coordinator"
import { createHydrationGenerationOwner, type HydrationGeneration } from "@/lib/editor/hydration-generation"
import {
  createPersistenceCoordinator,
  type PersistenceCommitEvent,
  type PersistenceSnapshotOverrides,
  type PersistenceStateEvent,
} from "@/lib/editor/persistence-coordinator"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"
import {
  closeTab,
  focusTab,
  getEditorSessionState,
  initializeEditorSessionStore,
  openDraftTab,
  openWritingTab,
  publishTabState,
  reconcileMaterializedDraftTab,
  reconcileUnavailableWritingTab,
  reorderTab,
  saveTabViewState,
  updateTabSaveState,
  useEditorSessionStore,
} from "@/lib/stores/editor-session-store"
import { setSidebarMode, toggleSidebarMode } from "@/lib/stores/ui-shell-store"
import { useHydrationProgress } from "@/lib/sync/hydration-progress"
import { CATALOG_TITLE_CHANGE_EVENT, getLatestCatalogTitle } from "@/lib/events/catalog-title-events"
import type { EditorNavigationMode } from "@/components/editor/panels/editor-navigation-sidebar"

/** Debounce for the table of contents rebuild — see failure mode 3 of ODE-433. */
const TABLE_OF_CONTENTS_DEBOUNCE_MS = 180

type EditorShellProps = {
  writingId?: string
  forceNewWriting?: boolean
  createDesktopDraftOverride?: typeof createProductionDesktopDraft
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
  position: AnnotationBubblePosition
  /** Draft identity — stable across repositioning (ODE-409). */
  sessionId: string
  annotationType?: "personal" | "ai" | "footnote"
}

type PendingRichSelectionSnapshot = {
  from: number
  to: number
  text: string
  popupPosition: SelectionPopupPosition
  bubblePosition: AnnotationBubblePosition
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

type EditorPanel = "notes" | "properties" | "grammar" | "share" | null

type RenameWritingSnapshot = {
  title: string
  bodyText: string
}

type CorrectionToastState = {
  phase: "running" | "complete" | "error"
  completed: number
  total: number
  message?: string
}

type ExternalFileNotice =
  | { kind: "moved"; path: string | null }
  | { kind: "deleted"; path: string | null }
  | { kind: "relocate-failed"; path: string | null }

function replaceEditorHistory(nextHref: string) {
  if (typeof window === "undefined") {
    return
  }

  const currentHref = `${window.location.pathname}${window.location.search}${window.location.hash}`
  if (currentHref === nextHref) {
    return
  }

  // ODE-389: Next 15's App Router patches `window.history.replaceState` to sync
  // its own state, which turns this URL rewrite into a real RSC navigation to
  // /write/<id>. On the perf harness that route has no session, so the server
  // redirects to /login and the editor is replaced mid-test. Going through the
  // unpatched prototype method updates the address bar only, which is all this
  // helper ever wanted.
  History.prototype.replaceState.call(window.history, null, "", nextHref)
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

const TableOfContentsPanel = lazy(() =>
  import("@/components/editor/panels/table-of-contents-panel").then((module) => ({
    default: module.TableOfContentsPanel,
  })),
)

const WorkspaceAgentPanel = lazy(() =>
  import("@/components/agent/workspace-agent-panel").then((module) => ({
    default: module.WorkspaceAgentPanel,
  })),
)

const MARKDOWN_SAVE_DEBOUNCE_MS = 800
// Desktop persistence performs several ordered local commits (the `.md`, its
// binding manifest, and SQLite). Keep that pipeline off the keystroke cadence:
// TipTap remains immediate, while a short quiet window coalesces rapid typing
// into one durable local snapshot. Cloud sync already has its own longer
// trailing debounce after this local commit.
const DESKTOP_PERSISTENCE_DEBOUNCE_MS = 150

const AUTO_TITLE_MAX_CHARS = 48
const UNTITLED_WRITING_TITLE = "Untitled artifact"
const DESKTOP_UNTITLED_WRITING_TITLE = UNTITLED_DOCUMENT_NAME

const navigateToEditorPosition = (editor: Editor, position: number) => {
  const didSelect = editor
    .chain()
    .focus()
    .setTextSelection(position)
    .run()

  if (!didSelect) {
    return false
  }

  requestAnimationFrame(() => {
    const scrollContainer = editor.view.dom.closest<HTMLElement>("[data-testid='editor-writing-area']")
    if (!scrollContainer) {
      return
    }

    const target = editor.view.coordsAtPos(position)
    const container = scrollContainer.getBoundingClientRect()
    const targetOffset = 72
    scrollContainer.scrollTo({
      top: scrollContainer.scrollTop + target.top - container.top - targetOffset,
      behavior: "smooth",
    })
  })

  return true
}

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

  throw new Error("Unable to generate a UUID for the artifact.")
}

// ODE-389: the harness guard latches. `replaceEditorHistory` rewrites the URL
// to /write/<id>, so re-reading `window.location` after the first guarded
// navigation reports a non-harness path and the next navigation escapes to the
// real router — which, on a cold harness with no session, lands on /login and
// tears the editor down mid-test. Once the harness is observed it stays
// observed for the lifetime of the page.
let perfHarnessDetected = false

const isPerfHarness = () => {
  if (typeof window === "undefined") {
    return false
  }

  if (perfHarnessDetected) {
    return true
  }

  perfHarnessDetected =
    window.location.pathname.startsWith("/perf/") &&
    !new URLSearchParams(window.location.search).has("run-corrections")

  return perfHarnessDetected
}

export function EditorShell({
  writingId,
  forceNewWriting = false,
  createDesktopDraftOverride,
}: EditorShellProps) {
  const router = useRouter()
  const createDesktopDraftFn = createDesktopDraftOverride ?? createProductionDesktopDraft
  const { loaded: sessionLoaded, session: editorSession } = useEditorSessionStore()
  const routeWritingId = writingId ?? null
  const routerRef = useRef(router)
  routerRef.current = router
  const routeWritingIdRef = useRef(routeWritingId)
  routeWritingIdRef.current = routeWritingId
  const initialHydrationSession = createRouteHydrationSessionState(routeWritingId)
  const hydrationProgress = useHydrationProgress()

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
  const [artifactType, setArtifactType] = useState<ArtifactType>("general")
  const [writingVisibility, setWritingVisibility] = useState<WritingVisibility>("private")
  const [lifecycle, setLifecycle] = useState<WritingLifecycle>("local-only")
  const lifecycleRef = useRef<WritingLifecycle>("local-only")
  const [isBodyHydrating, setIsBodyHydrating] = useState(false)
  const [activePanel, setActivePanel] = useState<EditorPanel>(null)
  const [isAgentPanelOpen, setIsAgentPanelOpen] = useState(false)
  const [hasOpenedAgentPanel, setHasOpenedAgentPanel] = useState(false)
  const [agentWorkspaceRootPath, setAgentWorkspaceRootPath] = useState<string | null>(null)
  // Studio opens with both side panels closed: the ghost rail at the sheet's
  // left edge is the way in (docs/design/views/studio.md).
  const [navigationMode, setNavigationMode] = useState<EditorNavigationMode>(null)
  const [tableOfContentsItems, setTableOfContentsItems] = useState<TableOfContentDataItem[]>([])
  const [selectedTableOfContentsItemId, setSelectedTableOfContentsItemId] = useState<string | null>(null)
  const [spellcheckScope, setSpellcheckScope] = useState(() => getLocalDBScope())
  const [spellcheckPreference, setSpellcheckPreference] = useState<EditorSpellcheckPreference>("system")
  const [automaticCorrectionSuggestions, setAutomaticCorrectionSuggestions] = useState<PublicationSuggestion[]>([])
  const [correctionToast, setCorrectionToast] = useState<CorrectionToastState | null>(null)
  const [externalFileNotice, setExternalFileNotice] = useState<ExternalFileNotice | null>(null)
  const [showCorrections, setShowCorrections] = useState(true)
  const [learnedWords, setLearnedWords] = useState<LearnedWordEntry[]>([])
  const [learnedWordsLoading, setLearnedWordsLoading] = useState(false)

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [renameModalSnapshot, setRenameModalSnapshot] = useState<RenameWritingSnapshot | null>(null)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [imageModalOpen, setImageModalOpen] = useState(false)
  const [localImageBackup, setLocalImageBackup] = useState<LocalImageBackupRequest | null>(null)
  const [localImageBackupUploading, setLocalImageBackupUploading] = useState(false)
  const [localImageBackupError, setLocalImageBackupError] = useState<string | null>(null)
  const [imageViewerSource, setImageViewerSource] = useState<string | null>(null)
  const imageViewerScrollRef = useRef<{ top: number; left: number } | null>(null)
  const [isFocusMode, setIsFocusMode] = useState(false)
  const [canonicalPath, setCanonicalPath] = useState<string | null>(null)
  const [isTopbarVisible, setIsTopbarVisible] = useState(true)
  const [isTabBarVisible, setIsTabBarVisible] = useState(true)
  const [isFindReplaceOpen, setIsFindReplaceOpen] = useState(false)
  const [isShortcutHelpOpen, setIsShortcutHelpOpen] = useState(false)
  const [findQuery, setFindQuery] = useState("")
  const [replaceValue, setReplaceValue] = useState("")
  const [findCaseSensitive, setFindCaseSensitive] = useState(false)
  const [findActiveIndex, setFindActiveIndex] = useState(0)
  const [pendingAnnotation, setPendingAnnotation] = useState<PendingAnnotationSnapshot | null>(null)
  const [pendingRichSelection, setPendingRichSelection] = useState<PendingRichSelectionSnapshot | null>(null)

  useEffect(() => {
    if (!isAgentPanelOpen || !canonicalPath || !isDesktopRuntime()) {
      setAgentWorkspaceRootPath(null)
      return
    }

    let cancelled = false
    const currentCanonicalPath = canonicalPath
    void import("@/lib/services/desktop/workspace-service")
      .then(({ getDesktopWorkspaceService }) => getDesktopWorkspaceService())
      .then((service) => service.getWorkspaceContainingPath(currentCanonicalPath))
      .then((workspace) => {
        if (!cancelled) setAgentWorkspaceRootPath(workspace?.rootPath ?? null)
      })
      .catch(() => {
        if (!cancelled) setAgentWorkspaceRootPath(null)
      })

    return () => {
      cancelled = true
    }
  }, [canonicalPath, isAgentPanelOpen])

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const hasExplicitTitleRef = useRef(hasExplicitTitle)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const writingSlugRef = useRef<string | null>(null)
  const statusRef = useRef<WritingStatus>(writingStatus)
  const artifactTypeRef = useRef<ArtifactType>(artifactType)
  const visibilityRef = useRef<WritingVisibility>(writingVisibility)
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  const isApplyingContentRef = useRef(false)
  const currentWritingIdRef = useRef<string | null>(initialHydrationSession.activeWritingId)
  const activeEditorTabIdRef = useRef<string | null>(editorSession.active_tab_id)
  const hydrationGenerationOwnerRef = useRef<ReturnType<typeof createHydrationGenerationOwner> | null>(null)
  if (hydrationGenerationOwnerRef.current === null) {
    hydrationGenerationOwnerRef.current = createHydrationGenerationOwner()
  }
  const currentCanonicalPathRef = useRef<string | null>(null)
  const focusModeRestorationRef = useRef<{
    activePanel: EditorPanel
    isFindReplaceOpen: boolean
    isAgentPanelOpen: boolean
  } | null>(null)

  const enterFocusMode = useCallback(() => {
    if (isFocusMode) {
      return
    }

    focusModeRestorationRef.current = { activePanel, isFindReplaceOpen, isAgentPanelOpen }

    setActivePanel(null)
    setIsAgentPanelOpen(false)
    setIsFindReplaceOpen(false)
    setIsFocusMode(true)
  }, [activePanel, isAgentPanelOpen, isFindReplaceOpen, isFocusMode])

  const exitFocusMode = useCallback(() => {
    if (!isFocusMode) {
      return
    }

    const stateToRestore = focusModeRestorationRef.current
    focusModeRestorationRef.current = null
    if (stateToRestore) {
      setActivePanel(stateToRestore.activePanel)
      setIsAgentPanelOpen(stateToRestore.isAgentPanelOpen)
      setIsFindReplaceOpen(stateToRestore.isFindReplaceOpen)
    }
    setIsFocusMode(false)
  }, [isFocusMode])

  const toggleFocusMode = useCallback(() => {
    if (isFocusMode) {
      exitFocusMode()
    } else {
      enterFocusMode()
    }
  }, [enterFocusMode, exitFocusMode, isFocusMode])
  const navigatedToDraftRef = useRef(false)
  const identityEnsuredRef = useRef(false)
  const desktopWebHandoffAppliedRef = useRef(false)
  const desktopSessionRestoreTimingRef = useRef<{ writingId: string; startedAt: number } | null>(null)
  const forceNewWritingRequestedRef = useRef(false)
  const createWorkspaceTabRef = useRef<((options?: { skipConfirm?: boolean }) => Promise<void>) | null>(null)
  const isCreatingWorkspaceTabRef = useRef(false)
  const ephemeralDraftWritingIdRef = useRef<string | null>(null)
  // Last body captured when leaving the still-blank draft (ODE-478 case 4).
  // Keyed by ephemeralDraftWritingIdRef so a later, different draft never
  // accidentally restores an older one's leftover content.
  const draftContentSnapshotRef = useRef<{ draftId: string; bodyJson: Record<string, unknown> } | null>(null)
  // Remembers what an ephemeral draft id materialized into, so a caller that
  // captured that draft id before an await (e.g. handleCloseWorkspaceTab
  // resolving which tab to close after settling) can still find the tab even
  // after reconcileMaterializedDraftTab has renamed it out from under the
  // original id (ODE-478 follow-up).
  const materializedDraftIdsRef = useRef<Map<string, string>>(new Map())
  const selectAdjacentTabRef = useRef<((direction: number) => void) | null>(null)
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const markdownSelectionRef = useRef<MarkdownSelectionSnapshot | null>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const findInputRef = useRef<HTMLInputElement | null>(null)
  const replaceInputRef = useRef<HTMLInputElement | null>(null)
  const editorCursorSnapshotRef = useRef<EditorCursorSnapshot | null>(null)
  const richUpdateRafRef = useRef<number | null>(null)
  const richUpdateEditorRef = useRef<Editor | null>(null)
  const tableOfContentsItemsRef = useRef<TableOfContentDataItem[]>([])
  const activeTableOfContentsItemIdRef = useRef<string | null>(null)
  const tableOfContentsScrollRafRef = useRef<number | null>(null)
  const tableOfContentsDebounceRef = useRef<number | null>(null)
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
  const correctionsEnabledRef = useRef(false)
  const automaticCorrectionSuggestionsRef = useRef<PublicationSuggestion[]>([])
  const learnedWordsRef = useRef<LearnedWordEntry[]>([])
  const learnedWordsLoadedRef = useRef(false)
  const persistedCorrectionBlocksRef = useRef(new Map<string, LocalCorrectionBlock>())
  const enqueueCorrectionBlockRef = useRef<((block: CorrectionTriggerBlock, reason?: "edit" | "hydrate-miss") => void) | null>(null)
  const correctionQueueRef = useRef<CorrectionTriggerBlock[]>([])
  const correctionProcessingRef = useRef(false)
  const processCorrectionQueueRef = useRef<(() => void) | null>(null)
  const correctionQueueTotalRef = useRef(0)
  const correctionQueueCompletedRef = useRef(0)
  const correctionBatchRetryRef = useRef(new Set<string>())
  const correctionQueueFailureVisibleRef = useRef(false)
  const correctionReviewCircuitOpenUntilRef = useRef(0)
  const correctionFailureRetryRef = useRef(new Map<string, number>())
  const correctionFailureRetryTimersRef = useRef(new Map<string, number>())
  const correctionTimersRef = useRef(new Map<string, { timer: number; pos: number }>())
  const correctionStaleTimersRef = useRef(new Map<string, number>())
  const correctionToastDismissRef = useRef<number | null>(null)
  const suppressCorrectionAnalysisUntilRef = useRef(0)
  const deferredSuppressedCorrectionBlocksRef = useRef<DeferredCorrectionBlocksState<CorrectionTriggerBlock>>({
    blocksById: new Map(),
    flushAt: null,
  })
  const suppressedCorrectionFlushTimerRef = useRef<number | null>(null)
  const editorInstanceRef = useRef<Editor | null>(null)

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
          versionRef.current = record.version
          setVersion(record.version)
          createdAtRef.current = record.createdAt
          setCreatedAt(record.createdAt)
        }
      }

      return createPersistenceCoordinator(
        {
          runtime: isDesktopRuntime() ? "desktop" : "web",
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
            setSyncStatus("saving")
            return
          }

          if (event.state === "failed") {
            setSyncStatus("error")
            return
          }

          if (event.state === "queued_remote") {
            setSyncStatus(
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

          currentWritingIdRef.current = record.id
          ephemeralDraftWritingIdRef.current = null
          setCurrentWritingId(record.id)
          setHydrationWritingId(record.id)
          createdAtRef.current = record.createdAt
          setCreatedAt(record.createdAt)
          setTitle(materializedTitle)
          titleRef.current = materializedTitle
          setHasExplicitTitle(false)
          hasExplicitTitleRef.current = false
          versionRef.current = record.version
          setVersion(record.version)
          setWritingSlug(null)
          writingSlugRef.current = null
          setWritingStatus("draft")
          statusRef.current = "draft"
          setArtifactType("general")
          artifactTypeRef.current = "general"
          setWritingVisibility("private")
          visibilityRef.current = "private"
          setLifecycle("local-only")
          lifecycleRef.current = "local-only"
          navigatedToDraftRef.current = true
        },
        onIdentityCreated: (writingId) => {
          const nextWritingSession = createNewWritingSessionState(writingId)
          currentWritingIdRef.current = nextWritingSession.activeWritingId
          setCurrentWritingId(nextWritingSession.activeWritingId)
          setHydrationWritingId(nextWritingSession.hydrationWritingId)

          if (!routeWritingIdRef.current && !navigatedToDraftRef.current) {
            navigatedToDraftRef.current = true
            if (isPerfHarness()) {
              replaceEditorHistory(`/write/${writingId}`)
            } else {
              routerRef.current.replace(`/write/${writingId}`)
            }
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
              setSyncStatus("error")
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
    [createDesktopDraftFn],
  )

  useEffect(() => {
    persistenceCoordinator.activateDocument(currentWritingId)
  }, [currentWritingId, persistenceCoordinator])

  useEffect(() => () => persistenceCoordinator.dispose(), [persistenceCoordinator])

  const resetCorrectionQueueState = useCallback(() => {
    for (const { timer } of correctionTimersRef.current.values()) {
      window.clearTimeout(timer)
    }

    for (const timer of correctionStaleTimersRef.current.values()) {
      window.clearTimeout(timer)
    }

    for (const timer of correctionFailureRetryTimersRef.current.values()) {
      window.clearTimeout(timer)
    }

    if (suppressedCorrectionFlushTimerRef.current !== null) {
      window.clearTimeout(suppressedCorrectionFlushTimerRef.current)
      suppressedCorrectionFlushTimerRef.current = null
    }

    correctionTimersRef.current.clear()
    correctionStaleTimersRef.current.clear()
    correctionBatchRetryRef.current.clear()
    correctionQueueFailureVisibleRef.current = false
    correctionReviewCircuitOpenUntilRef.current = 0
    correctionFailureRetryRef.current.clear()
    correctionFailureRetryTimersRef.current.clear()
    deferredSuppressedCorrectionBlocksRef.current = {
      blocksById: new Map(),
      flushAt: null,
    }
    correctionQueueRef.current = []
    correctionQueueTotalRef.current = 0
    correctionQueueCompletedRef.current = 0
    correctionProcessingRef.current = false
    setCorrectionToast(null)
  }, [])

  const getTableOfContentsScrollParent = useCallback(() => {
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    return editorViewport ?? window
  }, [])
  const resolveImage = useCallback(async (source: string) => {
    const service = getAssetService()
    if (!isLocalImageSource(source)) {
      const resolved = await service.resolveImageAssetUrl?.(source)
      if (!resolved) return { renderUrl: source }
      // Falling back to `source` on failure paints a broken image with no
      // explanation: an authenticated /api/writing-assets URL carries no
      // credentials as a plain <img> src. Surface the failure instead.
      if (resolved.error) throw new Error(resolved.error.message)
      return { renderUrl: resolved.data }
    }
    const documentPath = currentCanonicalPathRef.current
    if (!documentPath) throw new Error("Save this artifact before loading local images")
    const result = await service.readLocalImageAsset({ documentPath, source })
    if (result.error) throw new Error(result.error.message)
    const objectUrl = URL.createObjectURL(
      new Blob([result.data.bytes.buffer as ArrayBuffer], { type: result.data.mimeType }),
    )
    return { renderUrl: objectUrl, revoke: () => URL.revokeObjectURL(objectUrl) }
  }, [])
  const requestLocalImageBackup = useCallback((request: LocalImageBackupRequest) => {
    setLocalImageBackup(request)
    setLocalImageBackupError(null)
  }, [])
  const openImagePresentation = useCallback((request: ImagePresentationRequest) => {
    if (modeRef.current !== "rich") return
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    imageViewerScrollRef.current = editorViewport
      ? { top: editorViewport.scrollTop, left: editorViewport.scrollLeft }
      : null
    setImageViewerSource(request.source)
  }, [])
  // The TOC subscribes to every document update. Debouncing it keeps a long
  // document from rebuilding the tree on each keystroke; the timer is cleared
  // on unmount and on document switch, so it always has a way out.
  const scheduleTableOfContentsUpdate = useCallback((items: TableOfContentDataItem[]) => {
    if (tableOfContentsDebounceRef.current !== null) {
      window.clearTimeout(tableOfContentsDebounceRef.current)
    }

    const snapshot = [...items]
    tableOfContentsDebounceRef.current = window.setTimeout(() => {
      tableOfContentsDebounceRef.current = null
      setTableOfContentsItems(snapshot)
    }, TABLE_OF_CONTENTS_DEBOUNCE_MS)
  }, [])

  const editorExtensions = useMemo(
    () =>
      createEditorExtensions({
        onTableOfContentsUpdate: scheduleTableOfContentsUpdate,
        tableOfContentsScrollParent: getTableOfContentsScrollParent,
        resolveImage: isDesktopRuntime() ? resolveImage : undefined,
        onRequestLocalImageBackup: isDesktopRuntime() ? requestLocalImageBackup : undefined,
        onOpenImagePresentation: openImagePresentation,
      }),
    [getTableOfContentsScrollParent, openImagePresentation, requestLocalImageBackup, resolveImage, scheduleTableOfContentsUpdate],
  )
  const spellcheckConfig = useMemo(
    () => buildEditorSpellcheckConfig(spellcheckPreference),
    [spellcheckPreference],
  )
  const correctionSuggestionBatcher = useMemo(
    () => createCorrectionSuggestionBatcher(setAutomaticCorrectionSuggestions),
    [],
  )

  useEffect(() => {
    if (desktopWebHandoffAppliedRef.current || typeof window === "undefined") {
      return
    }

    const params = new URLSearchParams(window.location.search)
    const isDesktopHandoff = params.get("desktop") === "1"
    const action = params.get("action")

    if (isDesktopHandoff && (action === "publish" || action === "share")) {
      desktopWebHandoffAppliedRef.current = true
      setActivePanel("properties")
    }
  }, [])

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

  const createCorrectionAdmissionContext = useCallback(
    (blocks?: CorrectionTriggerBlock[]): AdmissionContext => {
      const editorBlocks = blocks ?? (editorInstanceRef.current ? collectCorrectionBlocks(editorInstanceRef.current.state.doc) : [])
      const blocksById = new Map(editorBlocks.map((block) => [block.id, block]))
      const blocksByLogicalId = new Map(
        editorBlocks
          .map((block) => [parseCorrectionBlockLogicalId(block.id), block] as const)
          .filter((entry): entry is [string, CorrectionTriggerBlock] => entry[0] !== null),
      )
      const rejectedFingerprints = new Set(
        readCorrectionMemory()
          .filter((entry) => entry.decision === "rejected")
          .map((entry) => stableFingerprintFromStoredFingerprint(entry.fingerprint))
          .filter((fingerprint): fingerprint is string => Boolean(fingerprint)),
      )

      return {
        learnedWords: createLearnedWordSet(learnedWordsRef.current.map((item) => item.word)),
        rejectedFingerprints,
        blockText: (blockId) => {
          const block = blocksById.get(blockId)

          if (block) {
            return block.text
          }

          const logicalId = parseCorrectionBlockLogicalId(blockId)
          return logicalId ? blocksByLogicalId.get(logicalId)?.text ?? null : null
        },
      }
    },
    [],
  )

  const admitCorrectionSuggestions = useCallback(
    (candidates: PublicationSuggestion[], blocks?: CorrectionTriggerBlock[]) =>
      admitSuggestions(candidates, createCorrectionAdmissionContext(blocks)),
    [createCorrectionAdmissionContext],
  )

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
      const currentEditor = editorInstanceRef.current

      if (!currentEditor) {
        return
      }

      const currentBlocksByLogicalId = new Map(
        collectCorrectionBlocks(currentEditor.state.doc)
          .map((block) => [parseCorrectionBlockLogicalId(block.id), block] as const)
          .filter((entry): entry is [string, CorrectionTriggerBlock] => entry[0] !== null),
      )

      const updates = blockHashes
        .map((blockHash) => {
          const persistedBlock = persistedCorrectionBlocksRef.current.get(blockHash)

          if (!persistedBlock) {
            return null
          }

          const logicalId = parseCorrectionBlockLogicalId(persistedBlock.blockId)
          const currentBlock = logicalId ? currentBlocksByLogicalId.get(logicalId) ?? null : null
          const nextBlockHash = currentBlock?.hash ?? persistedBlock.blockHash
          const nextBlockId = currentBlock?.id ?? persistedBlock.blockId
          const didBlockHashChange = nextBlockHash !== persistedBlock.blockHash
          const suggestions = nextSuggestions
            .filter((suggestion) => suggestion.source_hash === blockHash)
            .map((suggestion) =>
              didBlockHashChange
                ? {
                    ...suggestion,
                    block_id: nextBlockId,
                    source_hash: nextBlockHash,
                  }
                : suggestion,
            )

          return {
            previousBlock: persistedBlock,
            nextBlock: {
              ...persistedBlock,
              id: didBlockHashChange
                ? createCorrectionBlockRecordId(persistedBlock.writingId, nextBlockHash)
                : persistedBlock.id,
              blockId: nextBlockId,
              blockHash: nextBlockHash,
              suggestions,
            } satisfies LocalCorrectionBlock,
            deletedBlockIds: didBlockHashChange ? [persistedBlock.id] : [],
          }
        })
        .filter(
          (
            update,
          ): update is {
            previousBlock: LocalCorrectionBlock
            nextBlock: LocalCorrectionBlock
            deletedBlockIds: string[]
          } => update !== null,
        )

      if (updates.length === 0) {
        return
      }

      for (const update of updates) {
        if (update.deletedBlockIds.length > 0) {
          persistedCorrectionBlocksRef.current.delete(update.previousBlock.blockHash)
          await localDB.correctionBlocks.delete(update.previousBlock.id)
        }

        await persistCorrectionBlockWriteThrough(update.nextBlock, update.deletedBlockIds)
      }
    },
    [persistCorrectionBlockWriteThrough],
  )

  const deletePersistedBlocksForPosition = useCallback(
    async (writingId: string, block: CorrectionTriggerBlock) => {
      const staleBlocks = findStaleCorrectionBlockRecords(
        [...persistedCorrectionBlocksRef.current.values()].map((candidate) => ({
          id: candidate.id,
          blockId: candidate.blockId,
          blockHash: candidate.blockHash,
        })),
        {
          id: block.id,
          hash: block.hash,
          pos: block.pos,
        },
        DEFAULT_CORRECTION_BLOCK_POSITION_WINDOW,
      ).map((candidate) => persistedCorrectionBlocksRef.current.get(candidate.blockHash)).filter(
        (candidate): candidate is LocalCorrectionBlock => candidate !== undefined,
      )

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

  const flushPendingCorrectionBlocks = useCallback(async (
    writingId: string,
    generation?: HydrationGeneration,
  ) => {
    const pendingResult = generation
      ? await generation.runAsync(() => localDB.correctionBlocks.getByWriting(writingId))
      : { status: "current" as const, value: await localDB.correctionBlocks.getByWriting(writingId) }
    if (pendingResult.status === "stale") return
    const pendingBlocks = pendingResult.value.filter((block) => block.syncedAt === null)

    for (const block of pendingBlocks) {
      if (generation && !generation.isCurrent()) return
      void persistCorrectionBlockRemotely({
        writingId,
        block,
      })
        .then(() => {
          const markPersisted = () =>
            persistedCorrectionBlocksRef.current.set(block.blockHash, {
              ...block,
              syncedAt: new Date().toISOString(),
            })
          if (generation) generation.run(markPersisted)
          else markPersisted()
        })
        .catch((error) => {
          const logFailure = () => console.info(
            `[corrections] retry skipped message=${error instanceof Error ? error.message : String(error)}`,
          )
          if (generation) generation.run(logFailure)
          else logFailure()
        })
    }
  }, [])

  const persistEditorSnapshot = useCallback(
    async (
      editorInstance: Editor,
      overrides?: PersistenceSnapshotOverrides,
      options?: { awaitDurability?: boolean; forceMaterialize?: boolean },
    ) => {
      const activeId = currentWritingIdRef.current
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
            ? titleRef.current.trim() || UNTITLED_WRITING_TITLE
            : nextDerivedTitle

      if (!activeId && isDesktopRuntime() && !ephemeralDraftWritingIdRef.current) {
        ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      }

      const draftWritingId = ephemeralDraftWritingIdRef.current
      const sourceTabId = activeEditorTabIdRef.current ?? (activeId ?? EDITOR_DRAFT_TAB_ID)

      const result = await persistenceCoordinator.persist(
        {
          writingId: activeId,
          createdAt: baseCreatedAt,
          version: versionRef.current,
          title: nextTitle,
          bodyJson: editorInstance.getJSON() as Record<string, unknown>,
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
    [persistenceCoordinator],
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

  // Keep an imperative handle to the latest TipTap instance so persistence remaps
  // can read the current block graph even when callbacks outlive a render.
  useEffect(() => {
    editorInstanceRef.current = editor ?? null
  }, [editor])

  // Captures the still-blank draft's live content right before leaving it, so
  // the "no active document" effect can restore it on return instead of
  // wiping it (ODE-478 case 4). No-op when the outgoing tab isn't the draft.
  const snapshotOutgoingDraftContent = useCallback(() => {
    if (currentWritingIdRef.current || !editor || !ephemeralDraftWritingIdRef.current) {
      return
    }
    draftContentSnapshotRef.current = {
      draftId: ephemeralDraftWritingIdRef.current,
      bodyJson: editor.getJSON() as Record<string, unknown>,
    }
  }, [editor])

  // Uploading an image needs a real writingId to attach the asset to
  // (server-side storage path + RLS), so a still-blank draft must
  // materialize first — the same principle as naming it (case 3) or Save As.
  // Without this, InsertImageModal's own writingId-required guard silently
  // no-ops the whole upload with no error shown (ODE-478 follow-up).
  const openInsertImageModal = useCallback(async () => {
    if (!currentWritingIdRef.current) {
      if (!editor) return
      await persistEditorSnapshot(editor, undefined, { awaitDurability: true, forceMaterialize: true })
      // Materialization failed (e.g. desktop draft creation errored) — opening
      // the modal now would just reproduce the original silent no-op once the
      // user tries to upload with still no writingId.
      if (!currentWritingIdRef.current) return
    }
    setImageModalOpen(true)
  }, [editor, persistEditorSnapshot])

  useEffect(() => {
    tableOfContentsItemsRef.current = tableOfContentsItems
  }, [tableOfContentsItems])

  useEffect(() => {
    activeTableOfContentsItemIdRef.current = selectedTableOfContentsItemId
  }, [selectedTableOfContentsItemId])

  useEffect(() => {
    if (
      selectedTableOfContentsItemId &&
      !tableOfContentsItems.some((item) => item.id === selectedTableOfContentsItemId)
    ) {
      setSelectedTableOfContentsItemId(null)
    }
  }, [selectedTableOfContentsItemId, tableOfContentsItems])

  const syncActiveTableOfContentsItemFromScroll = useCallback(() => {
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    const items = tableOfContentsItemsRef.current

    if (items.length === 0) {
      return
    }

    const editorViewportRect = editorViewport?.getBoundingClientRect()
    const usesEditorScroll = editorViewport
      ? editorViewport.scrollHeight > editorViewport.clientHeight + 1
      : false
    const viewportTop = usesEditorScroll && editorViewportRect ? editorViewportRect.top : 0
    const viewportBottom = usesEditorScroll && editorViewportRect ? editorViewportRect.bottom : window.innerHeight
    const activationLine = viewportTop + 96
    const visibleItems = items
      .map((item) => ({ item, rect: item.dom.getBoundingClientRect() }))
      .filter(({ rect }) => rect.bottom >= viewportTop && rect.top <= viewportBottom)

    const nextActiveItem = visibleItems.reduce<TableOfContentDataItem | null>((closest, current) => {
      if (!closest) {
        return current.item
      }

      const closestRect = closest.dom.getBoundingClientRect()
      const closestDistance = Math.abs(closestRect.top - activationLine)
      const currentDistance = Math.abs(current.rect.top - activationLine)
      return currentDistance < closestDistance ? current.item : closest
    }, null)

    if (nextActiveItem && nextActiveItem.id !== activeTableOfContentsItemIdRef.current) {
      activeTableOfContentsItemIdRef.current = nextActiveItem.id
      setSelectedTableOfContentsItemId(nextActiveItem.id)
    }
  }, [])

  useEffect(() => {
    if (!editor || typeof window === "undefined") {
      return
    }

    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    const scrollHandler = editor.storage.tableOfContents?.scrollHandler

    const handleScroll = () => {
      if (typeof scrollHandler === "function") {
        scrollHandler()
      }

      if (tableOfContentsScrollRafRef.current !== null) {
        return
      }

      tableOfContentsScrollRafRef.current = window.requestAnimationFrame(() => {
        tableOfContentsScrollRafRef.current = null
        syncActiveTableOfContentsItemFromScroll()
      })
    }

    editor.commands.updateTableOfContents()
    handleScroll()
    editorViewport?.addEventListener("scroll", handleScroll, { passive: true })
    window.addEventListener("scroll", handleScroll, { passive: true })

    return () => {
      editorViewport?.removeEventListener("scroll", handleScroll)
      window.removeEventListener("scroll", handleScroll)

      if (tableOfContentsScrollRafRef.current !== null) {
        window.cancelAnimationFrame(tableOfContentsScrollRafRef.current)
        tableOfContentsScrollRafRef.current = null
      }
    }
  }, [editor, syncActiveTableOfContentsItemFromScroll, tableOfContentsItems.length])

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
    resetCorrectionQueueState()
  }, [currentWritingId, resetCorrectionQueueState])

  useEffect(() => {
    titleRef.current = title
  }, [title])

  useEffect(() => {
    if (!isDesktopRuntime() || hydrationWritingId !== null || !currentWritingId) {
      return
    }

    const applyCatalogTitle = () => {
      const catalogTitle = getLatestCatalogTitle(currentWritingId)?.trim()
      if (!catalogTitle || catalogTitle === titleRef.current) {
        return
      }

      // On desktop the filename is the canonical human title. Mirror the
      // catalog projection into the active editor without feeding session
      // writes back into this effect (which would create an update loop).
      titleRef.current = catalogTitle
      setTitle(catalogTitle)
      setHasExplicitTitle(catalogTitle !== UNTITLED_WRITING_TITLE)
    }

    applyCatalogTitle()
    window.addEventListener(CATALOG_TITLE_CHANGE_EVENT, applyCatalogTitle)
    return () => window.removeEventListener(CATALOG_TITLE_CHANGE_EVENT, applyCatalogTitle)
  }, [currentWritingId, hydrationWritingId])

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
    artifactTypeRef.current = artifactType
  }, [artifactType])

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
    activeEditorTabIdRef.current = editorSession.active_tab_id
  }, [editorSession.active_tab_id])

  useEffect(() => {
    setImageViewerSource(null)
  }, [currentWritingId])

  useEffect(() => {
    if (!sessionLoaded || !routeWritingId) {
      return
    }

    openWritingTab({ writingId: routeWritingId, replaceDraft: false })
  }, [routeWritingId, sessionLoaded])

  useEffect(() => {
    if (
      forceNewWriting ||
      !sessionLoaded ||
      routeWritingId ||
      currentWritingIdRef.current ||
      navigatedToDraftRef.current
    ) {
      return
    }

    const restoreTransition = resolvePersistedSessionRestoreTransition({
      activeTabId: editorSession.active_tab_id,
      tabs: editorSession.tabs.map((tab) => ({
        id: tab.id,
        writingId: tab.writing_id,
        slug: tab.slug,
      })),
    }, {
      isDesktopRuntime: isDesktopRuntime(),
      useHistoryProjection: isPerfHarness(),
    })

    if (restoreTransition.status === "restore-writing") {
      const nextHref = buildWritingRouteHref("/write", {
        id: restoreTransition.writingId,
        slug: restoreTransition.slug,
      })

      if (restoreTransition.target === "desktop-hydration") {
        // Explicit desktop handoff: history is only a projection in the static
        // bundle, so identity must transition before hydration/fallback effects.
        currentWritingIdRef.current = restoreTransition.writingId
        desktopSessionRestoreTimingRef.current = {
          writingId: restoreTransition.writingId,
          startedAt: performance.now(),
        }
        setCurrentWritingId(restoreTransition.writingId)
        setHydrationWritingId(restoreTransition.writingId)
        console.info(`[editor:session-restore] restorable ${restoreTransition.writingId}`)
      } else if (restoreTransition.target === "history") {
        replaceEditorHistory(nextHref)
      } else {
        router.replace(nextHref)
      }
      return
    }

    if (isDesktopRuntime()) {
      console.info("[editor:session-restore] no-restorable-tab")
    }

    if (restoreTransition.status === "remain-empty") {
      return
    }

    navigatedToDraftRef.current = true
    openDraftTab(ephemeralDraftWritingIdRef.current)
  }, [createDesktopDraftFn, editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded])

  // Eagerly create a stable local identity for blank /write so the first
  // paste/input never races against identity creation. This is the explicit
  // owner of the blank-draft -> identified-local-writing transition.
  // Desktop drafts stay ephemeral until real content is entered, so this eager
  // materialization is skipped there; identity is created on the first input/paste.
  useEffect(() => {
    if (isDesktopRuntime()) {
      if (
        sessionLoaded &&
        !routeWritingId &&
        !currentWritingIdRef.current &&
        !ephemeralDraftWritingIdRef.current
      ) {
        ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      }
      return
    }

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
      const nextTitle = isDesktopRuntime()
        ? DESKTOP_UNTITLED_WRITING_TITLE
        : deriveAutoTitle("", nowIso)

      try {
        if (isDesktopRuntime()) {
          const result = await createDesktopDraftFn({ title: nextTitle })
          if (result.error || !result.data) {
            throw new Error(result.error?.message ?? "Failed to create desktop draft")
          }
          currentWritingIdRef.current = result.data.id
        } else {
          await (await getDocumentService()).saveWriting({
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
              artifactType: "general",
              visibility: "private",
              parentId: null,
              correspondenceId: null,
              version: 1,
              deletedAt: null,
              createdAt: nowIso,
              updatedAt: nowIso,
              contentUpdatedAt: nowIso,
              metadataUpdatedAt: nowIso,
            },
          })
          currentWritingIdRef.current = nextId
        }
      } catch {
        // If the save fails (e.g., scope change in progress), fall back to
        // the identity-on-first-input path in persistEditorSnapshot.
        identityEnsuredRef.current = false
        return
      }

      openWritingTab({
        writingId: currentWritingIdRef.current ?? nextId,
        title: nextTitle,
        saveState: "saved-local",
        hasPendingSync: false,
        replaceDraft: true,
      })

      setCurrentWritingId(currentWritingIdRef.current ?? nextId)
      setHydrationWritingId(null)
      setTitle(nextTitle)
      setHasExplicitTitle(false)
      setBodyText("")
      setVersion(1)
      createdAtRef.current = nowIso
      setCreatedAt(nowIso)
      setWritingSlug(null)
      setWritingStatus("draft")
      setArtifactType("general")
      setWritingVisibility("private")
      setLifecycle("local-only")
      setSyncStatus("saved-local")
      titleRef.current = nextTitle
      hasExplicitTitleRef.current = false
      versionRef.current = 1
      writingSlugRef.current = null
      statusRef.current = "draft"
      artifactTypeRef.current = "general"
      visibilityRef.current = "private"
      lifecycleRef.current = "local-only"
      navigatedToDraftRef.current = true
      if (isPerfHarness()) {
        replaceEditorHistory(`/write/${currentWritingIdRef.current ?? nextId}`)
      } else if (!isDesktopRuntime()) {
        router.replace(`/write/${currentWritingIdRef.current ?? nextId}`)
      }
    }

    void ensureIdentity()
  }, [createDesktopDraftFn, editorSession.active_tab_id, editorSession.tabs, forceNewWriting, routeWritingId, router, sessionLoaded])

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

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

        const syncCurrentWritingState = async () => {
          const catalogRecord = await getCatalogRecord(currentWritingId)
          if (cancelled || !catalogRecord) return

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
          setExternalFileNotice(null)
        }

        void syncCurrentWritingState()
        unsubscribeCatalog = subscribeToCatalog((change) => {
          if (change.documentIds.includes(currentWritingId)) {
            void syncCurrentWritingState()
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
    }
  }, [currentWritingId])

  useEffect(() => {
    document.body.classList.toggle("od-editor-focus-mode", isFocusMode)

    return () => {
      document.body.classList.remove("od-editor-focus-mode")
    }
  }, [isFocusMode])

  useEffect(() => {
    return () => {
      if (tableOfContentsDebounceRef.current !== null) {
        window.clearTimeout(tableOfContentsDebounceRef.current)
        tableOfContentsDebounceRef.current = null
      }
    }
  }, [])

  // Switching artifact drops the previous document's headings immediately: a
  // pending debounce must never land on the new document.
  useEffect(() => {
    if (tableOfContentsDebounceRef.current !== null) {
      window.clearTimeout(tableOfContentsDebounceRef.current)
      tableOfContentsDebounceRef.current = null
    }

    setTableOfContentsItems([])
  }, [currentWritingId])

  // Studio opens with the rail collapsed to 52px (docs/design/views/studio.md
   // anatomy). It is a default, not a lock: expanding it afterwards sticks.
  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  useEffect(() => {
    if (!editor) {
      return
    }

    if (!currentWritingId) {
      // No tab is open — clear stale content so the editor never shows a previous
      // writing after the last tab is closed. `currentWritingId` is also null
      // while sitting on the still-blank draft, so before wiping, restore
      // whatever that draft held the last time it was left (captured by
      // handleSelectWorkspaceTab/handleCloseWorkspaceTab) instead of
      // discarding it — otherwise switching away and back erases in-progress
      // text that was never given a chance to save (ODE-478 case 4).
      const restorable =
        ephemeralDraftWritingIdRef.current &&
        draftContentSnapshotRef.current?.draftId === ephemeralDraftWritingIdRef.current
          ? draftContentSnapshotRef.current
          : null

      isApplyingContentRef.current = true
      editor.commands.setContent(restorable?.bodyJson ?? EMPTY_EDITOR_JSON)
      isApplyingContentRef.current = false
      updateDerivedEditorState(editor)
      setWritingStatus("draft")
      setArtifactType("general")
      setWritingVisibility("private")
      setTitle(UNTITLED_WRITING_TITLE)
      setHasExplicitTitle(false)
      setVersion(1)
      setCreatedAt(null)
      setWritingSlug(null)
      setLifecycle("local-only")
      setSyncStatus("saved")
      setExternalFileNotice(null)
      setPersistedCorrectionBlocks([])
      applyCorrectionSuggestionUpdate(() => [], { immediate: true })
      titleRef.current = UNTITLED_WRITING_TITLE
      hasExplicitTitleRef.current = false
      versionRef.current = 1
      createdAtRef.current = null
      writingSlugRef.current = null
      lifecycleRef.current = "local-only"
      currentCanonicalPathRef.current = null
      setCanonicalPath(null)
      window.requestAnimationFrame(() => {
        editor.commands.focus("start")
      })
      return
    }

    updateDerivedEditorState(editor)

    if (!hydrationWritingId) {
      return
    }

    const targetWritingId = hydrationWritingId
    const generationOwner = hydrationGenerationOwnerRef.current!
    const generation = generationOwner.start(targetWritingId)

    const hydrateEditor = async () => {
      let hydratedWriting: EditorHydrationRecord | null = null
      const localCorrectionBlocksResult = await generation.runAsync(
        () => localDB.correctionBlocks.getByWriting(targetWritingId),
      )
      if (localCorrectionBlocksResult.status === "stale") return
      let localCorrectionBlocks = localCorrectionBlocksResult.value

      // openWriting handles local read + optional remote hydration in one call.
      // Skeleton surfaces only when the call takes longer than 200 ms.
      const skeletonTimer = setTimeout(() => {
        generation.run(() => {
          setIsBodyHydrating(true)
        })
      }, 200)

      // Recovers the tab for an unavailable/unopenable writing WITHOUT persisting
      // a new draft (invariant #10 / requirement 7): drop the invalid tab and
      // fall back to a sibling tab or an in-memory blank draft tab.
      const recoverUnavailableTab = () => {
        console.info(`[editor] unavailable writing ${targetWritingId}; reconciling session`)
        const reconciliation = reconcileUnavailableWritingTab(targetWritingId)
        const sessionTabs = getEditorSessionState().session.tabs
        const recovery = resolveUnavailableWritingRecovery(reconciliation, sessionTabs.map((tab) => ({
          id: tab.id,
          writingId: tab.writing_id,
          slug: tab.slug,
        })))
        setHydrationWritingId(null)

        if (recovery.status === "activate-writing") {
          currentWritingIdRef.current = recovery.writingId
          setCurrentWritingId(recovery.writingId)
          setHydrationWritingId(recovery.writingId)
          replaceEditorHistory(
            buildWritingRouteHref("/write", { id: recovery.writingId, slug: recovery.slug }),
          )
        } else if (recovery.status === "show-empty-editor") {
          currentWritingIdRef.current = null
          setCurrentWritingId(null)
          replaceEditorHistory("/write")
        }
      }

      // Unified opener (ODE-375 M3): every id entry point — Desk, Search,
      // Recent and the sidebar all navigate to /write?id= and funnel through
      // this hydration — resolves identity through the DocumentCatalog first
      // and consumes the opener's explicit outcomes. A `failed` outcome the
      // opener classified as retryable (ODE-454) rearms itself with a bounded
      // backoff + jitter — no click, navigation or web event involved — before
      // falling back. `orphaned`, an exhausted retry loop, or a terminal
      // `failed` recover the tab without a draft; `conflict` opens the local
      // copy (visible conflict UX is owned by ODE-373); `opened` continues to
      // content hydration below. The decision logic itself is the pure,
      // dependency-injected coordinator extracted in ODE-455 — this effect
      // only supplies the runtime adapters and reacts to its outcome.
      const outcomeResult = await generation.runAsync(() =>
        resolveHydrationOutcome(targetWritingId, {
          isDesktopRuntime,
          isUnifiedOpenEnabled,
          isCancelled: () => !generation.isCurrent(),
          openDocumentByIdWithRetry,
          openWriting: async (id) => (await getDocumentService()).openWriting(id),
          getLocalWriting: async (id) => {
            // Explicit translation, not structural reuse: the coordinator's
            // boundary is domain-shaped (HydrationLocalMetadata), not
            // storage-shaped — this adapter is where the IndexedDB/SQLite
            // column names (`canonical_path`, `sync_status`) stop.
            const localWriting = await localDB.writings.get(id)
            if (!localWriting) return null
            return {
              canonicalPath: localWriting.canonical_path,
              lifecycle: localWriting.lifecycle,
              syncStatus: localWriting.sync_status,
            }
          },
        }),
      )

      clearTimeout(skeletonTimer)
      generation.run(() => {
        setIsBodyHydrating(false)
      })

      // The generation owner checks the result again after every awaited
      // boundary. A document switch (A -> B) can land during unified open,
      // openWriting or local metadata; a late A result must never act on B's
      // session, editor, correction cache or route.
      if (outcomeResult.status === "stale") return
      const outcome = outcomeResult.value

      if (outcome.status === "unavailable") {
        if (outcome.source === "unified-open") {
          console.info(
            `[editor] unified-open unavailable documentId=${targetWritingId} status=${outcome.openStatus} reasonCode=${outcome.reasonCode} attempt=${outcome.attempt} next=unavailable`,
          )
        }
        recoverUnavailableTab()
        return
      }

      if (outcome.status === "open-error") {
        console.error(`[editor] openWriting failed for ${targetWritingId}`, outcome.error)
        return
      }

      hydratedWriting = outcome.record

      if (localCorrectionBlocks.length === 0) {
        try {
          const correctionBlocksResult = await generation.runAsync(
            () => hydrateCorrectionBlocksFromRemote(targetWritingId),
          )
          if (correctionBlocksResult.status === "stale") return
          localCorrectionBlocks = correctionBlocksResult.value
        } catch (error) {
          if (!generation.isCurrent()) return
          console.error(`[editor] correction hydration failed for ${targetWritingId}`, error)
          localCorrectionBlocks = []
        }
      } else {
        void flushPendingCorrectionBlocks(targetWritingId, generation)
      }

      if (!generation.isCurrent()) return

      if (hydratedWriting) {
        const { writing, canonicalPath, lifecycle: hydratedLifecycle, syncStatus: hydratedSyncStatus } =
          hydratedWriting
        // Local image node views resolve relative sources during setContent, so
        // the document path must be available before ProseMirror creates them.
        currentCanonicalPathRef.current = canonicalPath
        setCanonicalPath(canonicalPath)
        isApplyingContentRef.current = true
        // Load JSON first to get the markdown serialization, then re-parse as markdown
        // so that footnote references are converted to footnoteReference nodes.
        editor.commands.setContent(writing.content.richText ?? EMPTY_EDITOR_JSON)
        const serialized = isDesktopRuntime()
          ? desktopDocumentEngine.richToSource(editor)
          : null
        const loadedMarkdown = serialized?.success
          ? serialized.markdown
          : normalizeMarkdownForRoundTrip(
              getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
            )
        if (loadedMarkdown) {
          const parsed = isDesktopRuntime() ? desktopDocumentEngine.sourceToRich(loadedMarkdown) : null
          editor.commands.setContent(
            parsed?.success ? parsed.snapshot.bodyJson : materializeMarkdownForRichParser(loadedMarkdown),
          )
        }
        isApplyingContentRef.current = false
        const currentDocBlocks = collectCorrectionBlocks(editor.state.doc)
        const hydratedReconciliation = reconcileHydratedCorrectionBlocks(
          localCorrectionBlocks,
          currentDocBlocks.map((block) => block.hash),
        )

        if (hydratedReconciliation.stale.length > 0) {
          const staleIds = hydratedReconciliation.stale.map((block) => block.id)

          const deleteResult = await generation.runAsync(() => localDB.correctionBlocks.deleteMany(staleIds))
          if (deleteResult.status === "stale") return
          void persistCorrectionBlockRemotely({
            writingId: targetWritingId,
            deletedBlockIds: staleIds,
          }).catch((error) => {
            generation.run(() => {
              console.info(
                `[corrections] hydrate cleanup skipped message=${error instanceof Error ? error.message : String(error)}`,
              )
            })
          })
        }

        localCorrectionBlocks = hydratedReconciliation.fresh
        setPersistedCorrectionBlocks(localCorrectionBlocks)
        applyCorrectionSuggestionUpdate(() => admitCorrectionSuggestions(
          flattenPersistedSuggestions(localCorrectionBlocks),
          currentDocBlocks,
        ), {
          immediate: true,
        })

        if (localCorrectionBlocks.length > 0) {
          suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        }

        const cachedBlockHashes = new Set(localCorrectionBlocks.map((block) => block.blockHash))
        const uncachedBlocks = getHydrateMissCorrectionBlocks(
          currentDocBlocks,
          cachedBlockHashes,
        )

        for (const block of uncachedBlocks) {
          const existingTimer = correctionTimersRef.current.get(block.id)

          if (existingTimer) {
            window.clearTimeout(existingTimer.timer)
            correctionTimersRef.current.delete(block.id)
          }

          const timer = window.setTimeout(() => {
            generation.run(() => {
              correctionTimersRef.current.delete(block.id)

              if (!correctionsEnabledRef.current) return

              const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

              if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) return

              enqueueCorrectionBlockRef.current?.(currentBlock, "hydrate-miss")
            })
          }, 2000)

          correctionTimersRef.current.set(block.id, { timer, pos: block.pos })
        }

        const loadedTitle = writing.title?.trim() || UNTITLED_WRITING_TITLE
        const loadedHasExplicitTitle = isExplicitWritingTitle(
          loadedTitle,
          writing.content.plainText,
          writing.createdAt,
        )
        setTitle(loadedTitle)
        setHasExplicitTitle(loadedHasExplicitTitle)
        setVersion(writing.version)
        setCreatedAt(writing.createdAt)
        setWritingSlug(writing.slug ?? null)
        setWritingStatus(writing.status ?? "draft")
        setArtifactType(writing.artifactType ?? "general")
        setWritingVisibility(writing.visibility ?? "private")
        setLifecycle(hydratedLifecycle)
        setExternalFileNotice(null)
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            hydratedSyncStatus,
            hydratedLifecycle,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
        updateDerivedEditorState(editor)

        const activeTab =
          editorSession.tabs.find((tab) => tab.writing_id === writing.id) ??
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
            generation.run(() => {
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
          })
        } else if (viewState) {
          modeRef.current = "rich"
          setMode("rich")
          window.requestAnimationFrame(() =>
            generation.run(() => {
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
                generation.run(() => {
                  applyWindowScroll()
                  applyShellScroll()
                  applyEditorScroll()
                })
              })
            }),
          )
        }
      } else {
        setTitle(UNTITLED_WRITING_TITLE)
        setHasExplicitTitle(false)
        setVersion(0)
        setCreatedAt(null)
        setWritingSlug(null)
        setWritingStatus("draft")
        setArtifactType("general")
        setWritingVisibility("private")
        setSyncStatus("saved")
        setExternalFileNotice(null)
        setBodyText("")
        currentCanonicalPathRef.current = null
        setCanonicalPath(null)
      }

      generation.run(() => {
        const restoreTiming = desktopSessionRestoreTimingRef.current
        if (restoreTiming?.writingId === targetWritingId) {
          console.info(
            `[editor:session-restore] hydrated ${targetWritingId} duration_ms=${Math.round(performance.now() - restoreTiming.startedAt)}`,
          )
          desktopSessionRestoreTimingRef.current = null
        }
        setHydrationWritingId(null)
      })
    }

    void hydrateEditor()

    return () => {
      generationOwner.cancel(generation)
    }
  }, [
    applyCorrectionSuggestionUpdate,
    admitCorrectionSuggestions,
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
        if (isPerfHarness()) {
          // ODE-389: a cold harness has no session, so a real navigation lands
          // on /login and takes the editor down mid-test. Keep the URL in sync
          // without leaving the harness route.
          replaceEditorHistory(`/write/${localWriting.slug}`)
        } else if (!isDesktopRuntime()) {
          router.replace(`/write/${localWriting.slug}`)
        }
      })()
    })
  }, [currentWritingId, routeWritingId, router])

  useEffect(() => {
    const correctionTimers = correctionTimersRef.current
    const correctionFailureRetryTimers = correctionFailureRetryTimersRef.current

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

      for (const timer of correctionFailureRetryTimers.values()) {
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
      correctionFailureRetryTimers.clear()
      correctionQueueRef.current = []
      persistCurrentWorkspaceViewState()
    }
  }, [persistCurrentWorkspaceViewState])

  const applyMarkdownFromPanel = useCallback(
    (nextMarkdown: string) => {
      const normalizedMarkdown = normalizeMarkdownForRoundTrip(nextMarkdown)

      if (!editor) return false

      setMarkdownValue(normalizedMarkdown)
      isApplyingContentRef.current = true

      const applied = applyPanelMarkdownChange(editor, materializeMarkdownForRichParser(normalizedMarkdown), {
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
      return applied
    },
    [editor, persistEditorSnapshot, updateDerivedEditorState],
  )

  const applyCorrectionSuggestionsByRange = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      if (!editor || modeRef.current !== "rich") {
        return {
          appliedIds: [] as string[],
          conflictIds: targetSuggestions.map((suggestion) => suggestion.id),
        }
      }

      const pendingSuggestions = targetSuggestions.filter((suggestion) => suggestion.status === "pending")

      if (pendingSuggestions.length === 0) {
        return {
          appliedIds: [] as string[],
          conflictIds: [],
        }
      }

      const resolvedRanges = resolveCorrectionDecorationRanges(editor.state.doc, pendingSuggestions)
      const rangesById = new Map(resolvedRanges.map((range) => [range.suggestion.id, range]))
      const applicableRanges = pendingSuggestions
        .map((suggestion) => {
          const range = rangesById.get(suggestion.id) ?? null

          if (!range) {
            return null
          }

          return getResolvedCorrectionText(editor.state.doc, range) === suggestion.original_text
            ? range
            : null
        })
        .filter((range): range is NonNullable<typeof range> => range !== null)
        .sort((left, right) => right.from - left.from)

      if (applicableRanges.length === 0) {
        return {
          appliedIds: [] as string[],
          conflictIds: pendingSuggestions.map((suggestion) => suggestion.id),
        }
      }

      const selectionBookmark = editor.state.selection.getBookmark()
      const transaction = editor.state.tr

      for (const { suggestion, from, to } of applicableRanges) {
        transaction.insertText(suggestion.replacement_text, from, to)
      }

      try {
        transaction.setSelection(selectionBookmark.map(transaction.mapping).resolve(transaction.doc))
      } catch {
        transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.selection.from)))
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
        markdownSaveTimeoutRef.current = null
      }

      suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
      isApplyingContentRef.current = true
      editor.view.dispatch(transaction)
      isApplyingContentRef.current = false
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)

      const appliedIds = applicableRanges.map((range) => range.suggestion.id)

      return {
        appliedIds,
        conflictIds: pendingSuggestions
          .filter((suggestion) => !appliedIds.includes(suggestion.id))
          .map((suggestion) => suggestion.id),
      }
    },
    [editor, persistEditorSnapshot, updateDerivedEditorState],
  )

  const applyCorrectionSuggestionsFromMarkdown = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      const result = applyPublicationSuggestionGroup(currentDocumentMarkdownRef.current, targetSuggestions)

      if (result.appliedIds.length > 0) {
        suppressCorrectionAnalysisUntilRef.current = Date.now() + 1200
        applyMarkdownFromPanel(result.markdown)
      }

      return {
        appliedIds: result.appliedIds,
        conflictIds: result.conflictIds,
      }
    },
    [applyMarkdownFromPanel],
  )

  const applyCorrectionSuggestions = useCallback(
    (targetSuggestions: PublicationSuggestion[]) => {
      if (modeRef.current === "rich") {
        return applyCorrectionSuggestionsByRange(targetSuggestions)
      }

      return applyCorrectionSuggestionsFromMarkdown(targetSuggestions)
    },
    [applyCorrectionSuggestionsByRange, applyCorrectionSuggestionsFromMarkdown],
  )

  const closeActivePanel = useCallback(() => {
    if (activePanel !== null) {
      setActivePanel(null)
      return
    }
    setIsAgentPanelOpen(false)
  }, [activePanel])

  const navigateToTableOfContentsItem = useCallback(
    (item: TableOfContentDataItem) => {
      if (!editor) {
        return
      }

      const cursorPosition = Math.min(item.pos + 1, editor.state.doc.content.size)
      setSelectedTableOfContentsItemId(item.id)
      editor.chain().focus().setTextSelection({ from: cursorPosition, to: cursorPosition }).run()

      // Scroll the heading to the center of the visible area so the caret
      // isn't hidden by the fixed topbar or bottom status bar.
      requestAnimationFrame(() => {
        const domPosition = editor.view.domAtPos(cursorPosition)
        const element =
          domPosition.node instanceof Element
            ? domPosition.node
            : domPosition.node.parentElement
        element?.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" })
      })
    },
    [editor],
  )

  const handleAcceptCorrection = useCallback(
    (suggestion: PublicationSuggestion, suggestionIds: string[] = [suggestion.id]) => {
      if (isSuggestionAcceptDisabled(suggestion)) {
        return
      }

      const suggestionIdSet = new Set(suggestionIds)
      const targetSuggestions = automaticCorrectionSuggestionsRef.current.filter((item) => suggestionIdSet.has(item.id))
      const result = applyCorrectionSuggestions(targetSuggestions)

      automaticCorrectionSuggestionsRef.current
        .filter((item) => result.appliedIds.includes(item.id))
        .forEach((item) => rememberCorrectionDecision(item.correction_fingerprint, "accepted"))

      let nextSuggestions = automaticCorrectionSuggestionsRef.current

      if (result.appliedIds.length > 0) {
        nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
      }

      if (result.conflictIds.length > 0) {
        nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
      }

      if (result.appliedIds.length > 0 || result.conflictIds.length > 0) {
        applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
        void updatePersistedBlocksFromSuggestions(
          nextSuggestions,
          [
            ...new Set(
              targetSuggestions
                .map((item) => item.source_hash ?? "")
                .filter(Boolean),
            ),
          ],
        )
      }
    },
    [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, updatePersistedBlocksFromSuggestions],
  )

  const showCorrectionToast = useCallback((toast: CorrectionToastState, durationMs: number) => {
    setCorrectionToast(toast)

    if (correctionToastDismissRef.current !== null) {
      window.clearTimeout(correctionToastDismissRef.current)
    }

    correctionToastDismissRef.current = window.setTimeout(() => {
      setCorrectionToast(null)
      correctionToastDismissRef.current = null
    }, durationMs)
  }, [])

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

  const handleLearnWord = useCallback((suggestion: PublicationSuggestion, suggestionIds: string[] = [suggestion.id]) => {
    const normalizedWord = normalizeLearnedWord(suggestion.original_text)

    if (!normalizedWord) {
      handleRejectCorrection(suggestion.id)
      return
    }

    const targetIds = [
      ...new Set([
        ...suggestionIds,
        ...automaticCorrectionSuggestionsRef.current
          .filter((item) => normalizeLearnedWord(item.original_text) === normalizedWord)
          .map((item) => item.id),
      ]),
    ]
    const sourceHashes = [
      ...new Set(
        automaticCorrectionSuggestionsRef.current
          .map((item) => item.source_hash ?? "")
          .filter(Boolean),
      ),
    ]

    const optimisticEntry: LearnedWordEntry = {
      id: `pending:${normalizedWord}`,
      word: normalizedWord,
      language: "unknown",
      createdAt: new Date().toISOString(),
    }

    setLearnedWords((current) => {
      if (current.some((item) => item.word === normalizedWord)) {
        return current
      }

      return [optimisticEntry, ...current]
    })

    automaticCorrectionSuggestionsRef.current
      .filter((item) => targetIds.includes(item.id))
      .forEach((item) => rememberCorrectionDecision(item.correction_fingerprint, "rejected"))

    const nextSuggestions = admitSuggestions(
      updateSuggestionStatuses(
        automaticCorrectionSuggestionsRef.current,
        targetIds,
        "rejected",
      ),
      {
        ...createCorrectionAdmissionContext(),
        learnedWords: createLearnedWordSet([
          normalizedWord,
          ...learnedWordsRef.current.map((item) => item.word),
        ]),
      },
    )
    applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
    void updatePersistedBlocksFromSuggestions(nextSuggestions, sourceHashes)

    void getAIService().learnWord({
      word: suggestion.original_text,
      language: "unknown",
    }).then((result) => {
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "Could not save learned word.")
      }

      upsertCachedLearnedWord(result.data)
      setLearnedWords((current) => {
        const withoutOptimistic = current.filter((item) => item.id !== optimisticEntry.id)

        if (withoutOptimistic.some((item) => item.word === result.data.word)) {
          return withoutOptimistic
        }

        return [result.data, ...withoutOptimistic]
      })
    }).catch((error) => {
      console.error("[learned-words] persist failed", error)
      automaticCorrectionSuggestionsRef.current
        .filter((item) => targetIds.includes(item.id))
        .forEach((item) => forgetCorrectionDecision(item.correction_fingerprint))

      const rollbackState = buildLearnWordRollbackState({
        learnedWords: learnedWordsRef.current,
        optimisticEntryId: optimisticEntry.id,
        suggestions: automaticCorrectionSuggestionsRef.current,
        targetIds,
        admissionContext: createCorrectionAdmissionContext(),
      })
      setLearnedWords(rollbackState.learnedWords)
      applyCorrectionSuggestionUpdate(() => rollbackState.suggestions, { immediate: true })
      void updatePersistedBlocksFromSuggestions(rollbackState.suggestions, sourceHashes)
      showCorrectionToast({
        phase: "complete",
        completed: 0,
        total: 0,
        message: "We couldn't save that word. Try again.",
      }, 4000)
    })
  }, [
    applyCorrectionSuggestionUpdate,
    createCorrectionAdmissionContext,
    handleRejectCorrection,
    showCorrectionToast,
    updatePersistedBlocksFromSuggestions,
  ])

  const handleRemoveLearnedWord = useCallback((id: string) => {
    const previous = learnedWordsRef.current
    setLearnedWords(previous.filter((item) => item.id !== id))
    removeCachedLearnedWord(id)

    void getAIService().deleteLearnedWord(id).then((result) => {
      if (result.error) {
        throw new Error(result.error.message)
      }
    }).catch((error) => {
      console.error("[learned-words] delete failed", error)
      primeLearnedWordsCache(previous)
      setLearnedWords(previous)
    })
  }, [])

  const handleAcceptAllCorrections = useCallback(() => {
    const pendingSuggestions = automaticCorrectionSuggestionsRef.current.filter((suggestion) => suggestion.status === "pending")
    const result = applyCorrectionSuggestions(pendingSuggestions)

    if (result.appliedIds.length === 0 && result.conflictIds.length === 0) {
      return
    }

    automaticCorrectionSuggestionsRef.current
      .filter((suggestion) => result.appliedIds.includes(suggestion.id))
      .forEach((suggestion) => rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted"))

    let nextSuggestions = automaticCorrectionSuggestionsRef.current
    if (result.appliedIds.length > 0) {
      nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
    }
    if (result.conflictIds.length > 0) {
      nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
    }
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
  }, [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, updatePersistedBlocksFromSuggestions])

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

  const getRichSelectionOverlayPositions = useCallback((from: number, to: number) => {
    if (!editor) return null
    const fromCoords = editor.view.coordsAtPos(from)
    const toCoords = editor.view.coordsAtPos(to)
    const anchorTop = Math.min(fromCoords.top, toCoords.top)
    const anchorBottom = Math.max(fromCoords.bottom, toCoords.bottom)
    const anchorX = (fromCoords.left + toCoords.right) / 2

    return {
      popupPosition: {
        x: anchorX,
        y: anchorTop - 8,
        top: anchorTop,
        bottom: anchorBottom,
      },
      bubblePosition: {
        x: anchorX,
        y: anchorBottom + 10,
        top: anchorTop,
        bottom: anchorBottom,
      },
    }
  }, [editor])

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

    const positions = getRichSelectionOverlayPositions(from, to)
    if (!positions) return null

    return {
      from,
      to,
      text: selectedText,
      ...positions,
    }
  }, [editor, getRichSelectionOverlayPositions])

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
            toggleFocusMode()
            return true
          case "shortcutHelp":
            setIsShortcutHelpOpen(true)
            return true
          case "newWriting":
            if (isDesktopRuntime()) {
              void createWorkspaceTabRef.current?.({ skipConfirm: true })
            } else {
              router.push("/write?new=1")
            }
            return true
          case "settings":
            router.push("/settings")
            return true
          case "goDesk":
            router.push("/desk")
            return true
          case "goWorkspace":
            router.push("/workspace")
            return true
          case "goStudio":
            router.push("/write")
            return true
          case "search":
            window.dispatchEvent(new CustomEvent("odessay:open-search"))
            return true
          case "nextTab":
            selectAdjacentTabRef.current?.(1)
            return true
          case "prevTab":
            selectAdjacentTabRef.current?.(-1)
            return true
          case "documentProperties":
            setActivePanel((current) => (current === "properties" ? null : "properties"))
            return true
          case "corrections":
            setActivePanel((current) => (current === "grammar" ? null : "grammar"))
            return true
          case "addNote":
          case "voiceNote":
            setActivePanel("notes")
            return true
          case "toggleSidebar":
            toggleSidebarMode()
            return true
          case "toggleTopbar":
            setIsTopbarVisible((currentState) => !currentState)
            return true
          case "toggleTabBar":
            setIsTabBarVisible((currentState) => !currentState)
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
            void openInsertImageModal()
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
          void openInsertImageModal()
          return
        case "clearStyles":
          editor.chain().focus().clearNodes().unsetAllMarks().run()
          return
        case "horizontalRule":
          editor.chain().focus().setHorizontalRule().run()
          return
        case "date": {
          const now = new Date()
          const yyyy = now.getFullYear()
          const mm = String(now.getMonth() + 1).padStart(2, "0")
          const dd = String(now.getDate()).padStart(2, "0")
          editor.chain().focus().insertContent(`${yyyy}-${mm}-${dd}`).run()
          return
        }
        case "copyAsMarkdown": {
          const { from: mdFrom, to: mdTo } = editor.state.selection
          let markdown: string
          if (mdFrom === mdTo) {
            markdown = getEditorMarkdown(editor)
          } else {
            const slice = editor.state.doc.slice(mdFrom, mdTo)
            const serializer = (editor.storage as { markdown?: { serializer?: { serialize: (node: unknown) => string } } }).markdown?.serializer
            if (serializer) {
              try {
                const tempDoc = editor.schema.nodes.doc.create(null, slice.content)
                markdown = serializer.serialize(tempDoc)
              } catch {
                markdown = editor.state.doc.textBetween(mdFrom, mdTo, "\n")
              }
            } else {
              markdown = editor.state.doc.textBetween(mdFrom, mdTo, "\n")
            }
          }
          void navigator.clipboard.writeText(markdown)
          return
        }
        case "copyAsHtml": {
          const { from: htmlFrom, to: htmlTo } = editor.state.selection
          let html: string
          if (htmlFrom === htmlTo) {
            html = editor.getHTML()
          } else {
            const slice = editor.state.doc.slice(htmlFrom, htmlTo)
            try {
              const sliceData = slice.toJSON() as { content?: JSONContent[] }
              html = generateHTML({ type: "doc", content: sliceData.content ?? [] }, editor.extensionManager.extensions)
            } catch {
              html = editor.getHTML()
            }
          }
          void navigator.clipboard.writeText(html)
          return
        }
        default:
          return
      }
    },
    [
      captureRichSelectionSnapshot,
      editor,
      markdownValue,
      openFindReplacePanel,
      openInsertImageModal,
      persistEditorSnapshot,
      queueMarkdownSelectionRestore,
      router,
      toggleFocusMode,
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
    (anchorText: string, type: AnnotationType, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => {
      if (!editor || !anchorText) return false
      const highlightMark = editor.schema.marks.highlight
      if (!highlightMark) return false

      let converted = false

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
          converted = editor
            .chain()
            .focus()
            .setTextSelection({ from: range.from, to: range.to })
            .unsetHighlight()
            .setHighlight()
            .addAnnotation(type, text, id)
            .setTextSelection(range.to)
            .run()
          return false
        }
      })
      return converted
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
        sessionId: nextAnnotationSessionId(),
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
  }, [captureRichSelectionSnapshot, editor, pendingAnnotation])

  useEffect(() => {
    if (!editor || (!pendingRichSelection && !pendingAnnotation)) return

    const syncOpenOverlayPosition = (event?: Event) => {
      // ODE-409: `scroll` is listened to in the capture phase, so scrolling the
      // bubble's own textarea reaches this handler. The document geometry has
      // not moved in that case — recomputing it is pure churn.
      const eventTarget = event?.target
      if (
        eventTarget instanceof Element &&
        eventTarget.closest(".AnnotationBubble, .SelectionPopup")
      ) {
        return
      }

      if (pendingRichSelection) {
        const positions = getRichSelectionOverlayPositions(pendingRichSelection.from, pendingRichSelection.to)
        if (positions) {
          setPendingRichSelection((current) => {
            if (!current) return current
            if (
              areFloatingOverlayAnchorsEqual(current.popupPosition, positions.popupPosition) &&
              areFloatingOverlayAnchorsEqual(current.bubblePosition, positions.bubblePosition)
            ) {
              return current
            }
            return { ...current, ...positions }
          })
        }
      }

      if (pendingAnnotation) {
        const positions = getRichSelectionOverlayPositions(pendingAnnotation.from, pendingAnnotation.to)
        if (positions) {
          setPendingAnnotation((current) => {
            if (!current) return current
            if (areFloatingOverlayAnchorsEqual(current.position, positions.bubblePosition)) {
              return current
            }
            return { ...current, position: positions.bubblePosition }
          })
        }
      }
    }

    window.addEventListener("resize", syncOpenOverlayPosition)
    window.addEventListener("scroll", syncOpenOverlayPosition, { capture: true, passive: true })

    return () => {
      window.removeEventListener("resize", syncOpenOverlayPosition)
      window.removeEventListener("scroll", syncOpenOverlayPosition, { capture: true })
    }
  }, [editor, getRichSelectionOverlayPositions, pendingAnnotation, pendingRichSelection])

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
        setMarkdownValue(
          isDesktopRuntime()
            ? bodyMarkdown
            : normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(bodyMarkdown, footnoteNodes)),
        )
        return
      }

      const normalizedMarkdown = isDesktopRuntime()
        ? markdownValue
        : normalizeMarkdownForRoundTrip(markdownValue)
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
        const parsed = isDesktopRuntime() ? desktopDocumentEngine.sourceToRich(normalizedMarkdown) : null
        editor.commands.setContent(
          parsed?.success ? parsed.snapshot.bodyJson : materializeMarkdownForRichParser(normalizedMarkdown),
        )
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

  const handleBackupLocalImage = useCallback(async () => {
    const request = localImageBackup
    const documentPath = currentCanonicalPathRef.current
    const writingId = currentWritingIdRef.current
    if (!request || !documentPath || !writingId) return

    setLocalImageBackupUploading(true)
    setLocalImageBackupError(null)
    try {
      const result = await backUpLocalImage({
        service: getAssetService(),
        writingId,
        documentPath,
        source: request.source,
        alt: request.alt,
        replaceSource: request.replaceSource,
        persistDocument: async () => editor ? (await persistEditorSnapshot(editor)) === true : false,
      })
      if (result.error) {
        setLocalImageBackupError(result.error.message)
        return
      }
      setLocalImageBackup(null)
    } catch {
      setLocalImageBackupError("Unable to back up this image. Its local path was preserved.")
    } finally {
      setLocalImageBackupUploading(false)
    }
  }, [editor, localImageBackup, persistEditorSnapshot])

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
      return extractRichEditorAnnotations(editor)
    }

    return getMarkdownFootnotes(markdownValue)
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

  // The Grammar tab's badge counts exactly what its panel would list, so it
  // filters through the same helper rather than the raw suggestion array.
  const visibleCorrectionCount = useMemo(
    () =>
      getVisibleCorrectionSuggestions(automaticCorrectionSuggestions, currentDocumentMarkdown)
        .length,
    [automaticCorrectionSuggestions, currentDocumentMarkdown],
  )


  useEffect(() => {
    currentDocumentMarkdownRef.current = currentDocumentMarkdown
  }, [currentDocumentMarkdown])

  useEffect(() => {
    automaticCorrectionSuggestionsRef.current = automaticCorrectionSuggestions
  }, [automaticCorrectionSuggestions])

  useEffect(() => {
    learnedWordsRef.current = learnedWords
  }, [learnedWords])

  useEffect(() => {
    if (!currentWritingId || learnedWordsLoadedRef.current) {
      return
    }

    setLearnedWordsLoading(true)

    void loadCachedLearnedWordsPages(getAIService()).then((result) => {
      if (!result.ok) {
        console.info(`[learned-words] load skipped message=${result.message}`)
        return
      }

      learnedWordsLoadedRef.current = true
      const nextLearnedWords = mergeLearnedWordEntries(learnedWordsRef.current, result.items)
      primeLearnedWordsCache(nextLearnedWords)
      setLearnedWords(nextLearnedWords)
      const sourceHashes = [
        ...new Set(
          automaticCorrectionSuggestionsRef.current
            .map((suggestion) => suggestion.source_hash ?? "")
            .filter(Boolean),
        ),
      ]
      const nextSuggestions = admitSuggestions(
        automaticCorrectionSuggestionsRef.current,
        {
          ...createCorrectionAdmissionContext(),
          learnedWords: createLearnedWordSet(nextLearnedWords.map((item) => item.word)),
        },
      )
      applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
      void updatePersistedBlocksFromSuggestions(nextSuggestions, sourceHashes)
    }).finally(() => {
      setLearnedWordsLoading(false)
    })
  }, [
    applyCorrectionSuggestionUpdate,
    createCorrectionAdmissionContext,
    currentWritingId,
    updatePersistedBlocksFromSuggestions,
  ])

  const normalizeAutomaticSuggestion = useCallback(
    (block: CorrectionTriggerBlock, suggestion: PublicationSuggestion): PublicationSuggestion => {
      const sourceMarkdown = currentDocumentMarkdownRef.current
      const occurrence = suggestion.occurrence ?? 0
      const fingerprint =
        suggestion.correction_fingerprint ??
        createStableFingerprint({
          type: suggestion.mechanical_type ?? suggestion.kind,
          originalText: suggestion.original_text,
          replacementText: suggestion.replacement_text,
        })
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

  const {
    runState: correctionAnalysisRunState,
    progress: correctionAnalysisProgress,
    startAnalysis: startCorrectionAnalysis,
    retryFailedPackages: retryFailedCorrectionPackages,
    cancelAnalysis: cancelCorrectionAnalysis,
  } = useManualCorrections({
    currentWritingId,
    editorRef: editorInstanceRef,
    currentWritingIdRef,
    titleRef,
    learnedWordsRef,
    persistedCorrectionBlocksRef,
    readCorrectionMemory,
    admitCorrectionSuggestions,
    applyCorrectionSuggestionUpdate,
    normalizeAutomaticSuggestion,
    persistCorrectionBlockWriteThrough,
    updatePersistedBlocksFromSuggestions,
    logCorrectionEvent,
    showCorrectionToast,
  })

  const getBlockSuggestions = useCallback(
    (blockId: string, sourceHash?: string) =>
      automaticCorrectionSuggestionsRef.current.filter(
        (suggestion) =>
          suggestion.block_id === blockId && (sourceHash ? suggestion.source_hash === sourceHash : true),
      ),
    [],
  )

  const finishCorrectionQueueIfIdle = useCallback(() => {
    if (
      correctionQueueRef.current.length > 0 ||
      correctionProcessingRef.current ||
      correctionFailureRetryTimersRef.current.size > 0 ||
      correctionQueueFailureVisibleRef.current
    ) {
      return
    }

    showCorrectionToast({
      phase: "complete",
      completed: correctionQueueCompletedRef.current,
      total: correctionQueueTotalRef.current,
    }, 2000)
    window.setTimeout(() => {
      correctionQueueTotalRef.current = 0
      correctionQueueCompletedRef.current = 0
    }, 2000)
  }, [showCorrectionToast])

  const dropStaleSuggestionsForQueuedBlock = useCallback(
    (blockId: string) => {
      applyCorrectionSuggestionUpdate((current) => {
        const transition = dropStaleSuggestionsForBlock(current, blockId)

        for (const suggestionId of transition.droppedIds) {
          logCorrectionEvent({
            type: "stale:drop",
            blockId,
            suggestionId,
          })
        }

        return transition.suggestions
      }, { immediate: true })
    },
    [applyCorrectionSuggestionUpdate],
  )

  const showCorrectionFailureToast = useCallback((message: string) => {
    showCorrectionToast({
      phase: "error",
      completed: correctionQueueCompletedRef.current,
      total: correctionQueueTotalRef.current,
      message,
    }, 5000)
  }, [showCorrectionToast])

  const clearPendingCorrectionReviewWork = useCallback(() => {
    correctionQueueRef.current = []

    for (const timer of correctionFailureRetryTimersRef.current.values()) {
      window.clearTimeout(timer)
    }
    correctionFailureRetryTimersRef.current.clear()
  }, [])

  const openCorrectionFailureCircuit = useCallback((message: string) => {
    correctionReviewCircuitOpenUntilRef.current = Date.now() + CORRECTION_REVIEW_FAILURE_COOLDOWN_MS
    correctionQueueFailureVisibleRef.current = true
    clearPendingCorrectionReviewWork()
    showCorrectionFailureToast(message)
  }, [clearPendingCorrectionReviewWork, showCorrectionFailureToast])

  const scheduleCorrectionFailureRetry = useCallback(
    ({
      batchKey,
      blocks,
      delayMs,
    }: {
      batchKey: string
      blocks: CorrectionTriggerBlock[]
      delayMs: number
    }) => {
      const existingTimer = correctionFailureRetryTimersRef.current.get(batchKey)

      if (existingTimer) {
        window.clearTimeout(existingTimer)
      }

      const retryTimer = window.setTimeout(() => {
        correctionFailureRetryTimersRef.current.delete(batchKey)

        if (
          !correctionsEnabledRef.current ||
          currentWritingIdRef.current === null ||
          !editor ||
          Date.now() < correctionReviewCircuitOpenUntilRef.current
        ) {
          correctionFailureRetryRef.current.delete(batchKey)
          return
        }

        const queuedIds = new Set(correctionQueueRef.current.map((block) => block.id))
        const retryBlocks = blocks
          .map((block) => getCurrentCorrectionBlock(editor.state.doc, block.id) ?? block)
          .filter((block) => block.text.trim().length > 0 && !queuedIds.has(block.id))

        if (retryBlocks.length === 0) {
          return
        }

        correctionQueueRef.current.push(...retryBlocks)
        correctionQueueTotalRef.current += retryBlocks.length
        setCorrectionToast({
          phase: "running",
          completed: correctionQueueCompletedRef.current,
          total: correctionQueueTotalRef.current,
          message: "Retrying corrections...",
        })
        processCorrectionQueueRef.current?.()
      }, delayMs)

      correctionFailureRetryTimersRef.current.set(batchKey, retryTimer)
    },
    [editor],
  )

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

    if (Date.now() < correctionReviewCircuitOpenUntilRef.current) {
      clearPendingCorrectionReviewWork()
      showCorrectionFailureToast("Corrections are temporarily unavailable. Try again in a moment.")
      return
    }

    correctionQueueFailureVisibleRef.current = false
    correctionReviewCircuitOpenUntilRef.current = 0
    correctionProcessingRef.current = true
    logCorrectionEvent({
      type: "queue:flush",
      batchSize: correctionQueueRef.current.length,
      blockIds: correctionQueueRef.current.map((queuedBlock) => queuedBlock.id),
    })

    while (correctionQueueRef.current.length > 0) {
      const queuedBatch = takeCorrectionBatch(correctionQueueRef.current, CORRECTION_BLOCK_BATCH_SIZE)
      const currentBatch: CorrectionTriggerBlock[] = []

      for (const block of queuedBatch) {
        const currentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

        if (!currentBlock || currentBlock.hash !== block.hash || currentBlock.text !== block.text) {
          correctionQueueCompletedRef.current += 1
          continue
        }

        currentBatch.push(currentBlock)
      }

      if (currentBatch.length === 0) {
        continue
      }

      setCorrectionToast({
        phase: "running",
        completed: correctionQueueCompletedRef.current,
        total: correctionQueueTotalRef.current,
      })

      const batchId = buildCorrectionReviewRetryKey(currentBatch)
      const requestStartedAt = Date.now()
      const requestWritingId = currentWritingIdRef.current

      try {
        logCorrectionEvent({
          type: "request:start",
          batchId,
          blockIds: currentBatch.map((block) => block.id),
        })

        const result = await getAIService().reviewPublication({
          writingId: requestWritingId ?? undefined,
          title: titleRef.current,
          markdown: currentBatch.map((block) => block.text).join("\n\n"),
          bodyText: currentBatch.map((block) => block.text).join("\n\n"),
          sourceHash: hashPublicationSource(currentBatch.map((block) => block.hash).join("|")),
          stream: false,
          correctionBlocks: currentBatch.map((block) => ({
            id: block.id,
            text: block.text,
            hash: block.hash,
          })),
          correctionMemory: {
            entries: readCorrectionMemory(),
          },
          learnedWords: {
            entries: learnedWordsRef.current.map((item) => ({
              word: item.word,
              language: item.language,
            })),
          },
        })

        if (result.error || !result.data) {
          const attempts = correctionFailureRetryRef.current.get(batchId) ?? 0
          const retryDecision = decideCorrectionReviewRetry({
            error: result.error,
            previousAttempts: attempts,
            maxRetries: CORRECTION_REVIEW_MAX_RETRIES,
          })
          console.info(
            `[corrections] block analysis failed code=${result.error?.code ?? "unknown"} retryable=${result.error?.retryable ?? false} decision=${retryDecision.action} attempt=${retryDecision.attempt}`,
          )
          for (const block of currentBatch) {
            dropStaleSuggestionsForQueuedBlock(block.id)
          }

          if (retryDecision.action === "retry") {
            correctionFailureRetryRef.current.set(batchId, retryDecision.attempt)
            correctionQueueRef.current = []
            scheduleCorrectionFailureRetry({
              batchKey: batchId,
              blocks: currentBatch,
              delayMs: retryDecision.delayMs,
            })
          } else {
            correctionFailureRetryRef.current.delete(batchId)
            openCorrectionFailureCircuit("Corrections are temporarily unavailable. Try again in a moment.")
          }
          continue
        }

        if (!correctionsEnabledRef.current) {
          for (const block of currentBatch) {
            dropStaleSuggestionsForQueuedBlock(block.id)
          }
          continue
        }

        if (currentWritingIdRef.current !== requestWritingId) {
          for (const block of currentBatch) {
            dropStaleSuggestionsForQueuedBlock(block.id)
          }
          logCorrectionEvent({
            type: "request:end",
            batchId,
            latencyMs: Date.now() - requestStartedAt,
            suggestions: 0,
            missing: currentBatch.map((block) => block.id),
          })
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
        correctionFailureRetryRef.current.delete(batchId)
        correctionQueueFailureVisibleRef.current = false
        const retryTimer = correctionFailureRetryTimersRef.current.get(batchId)
        if (retryTimer) {
          window.clearTimeout(retryTimer)
          correctionFailureRetryTimersRef.current.delete(batchId)
        }
        const suggestionsByBlockId = new Map<string, PublicationSuggestion[]>()
        for (const suggestion of adapted.legacy.suggestions) {
          if (!suggestion.block_id) continue
          const blockSuggestions = suggestionsByBlockId.get(suggestion.block_id) ?? []
          blockSuggestions.push(suggestion)
          suggestionsByBlockId.set(suggestion.block_id, blockSuggestions)
        }
        const missingBlockIds = getMissingCorrectionBlockIds(currentBatch, result.data.corrections)
        const missingBlockIdSet = new Set(missingBlockIds)
        let persistedSuggestionsCount = 0

        for (const block of currentBatch) {
          const stillCurrentBlock = getCurrentCorrectionBlock(editor.state.doc, block.id)

          if (!stillCurrentBlock || stillCurrentBlock.hash !== block.hash || stillCurrentBlock.text !== block.text) {
            dropStaleSuggestionsForQueuedBlock(block.id)
            continue
          }

          if (missingBlockIdSet.has(block.id)) {
            const retryKey = `${block.id}:${block.hash}`

            if (!correctionBatchRetryRef.current.has(retryKey)) {
              correctionBatchRetryRef.current.add(retryKey)
              correctionQueueRef.current.push(block)
              correctionQueueTotalRef.current += 1
              logCorrectionEvent({
                type: "queue:enqueue",
                blockId: block.id,
                reason: "edit",
              })
              continue
            }
          }

          correctionBatchRetryRef.current.delete(`${block.id}:${block.hash}`)

          const normalizedSuggestions = admitCorrectionSuggestions(
            (suggestionsByBlockId.get(block.id) ?? []).map((suggestion) =>
              normalizeAutomaticSuggestion(block, suggestion),
            ),
            [stillCurrentBlock],
          )
          const nextCorrectionBlock: LocalCorrectionBlock | null = requestWritingId
            ? {
                id: createCorrectionBlockRecordId(requestWritingId, block.hash),
                writingId: requestWritingId,
                blockId: block.id,
                blockHash: block.hash,
                suggestions: normalizedSuggestions,
                model: result.data.usage?.model ?? "web-route",
                engineRevision: result.data.engineRevision ?? CORRECTION_ENGINE_REVISION,
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

          const existingStaleTimer = correctionStaleTimersRef.current.get(block.id)

          if (existingStaleTimer) {
            window.clearTimeout(existingStaleTimer)
            correctionStaleTimersRef.current.delete(block.id)
          }

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

          persistedSuggestionsCount += normalizedSuggestions.length
        }

        logCorrectionEvent({
          type: "request:end",
          batchId,
          latencyMs: Date.now() - requestStartedAt,
          suggestions: persistedSuggestionsCount,
          missing: missingBlockIds,
        })
      } catch (error) {
        const message = error instanceof Error ? error.message : "block correction failed"
        console.info(`[corrections] block analysis skipped message=${message}`)
        for (const block of currentBatch) {
          dropStaleSuggestionsForQueuedBlock(block.id)
        }
        correctionFailureRetryRef.current.delete(batchId)
        openCorrectionFailureCircuit("Corrections are temporarily unavailable. Try again in a moment.")
      } finally {
        correctionQueueCompletedRef.current += currentBatch.length

        if (correctionsEnabledRef.current && !correctionQueueFailureVisibleRef.current) {
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
    admitCorrectionSuggestions,
    editor,
    finishCorrectionQueueIfIdle,
    normalizeAutomaticSuggestion,
    persistCorrectionBlockWriteThrough,
    dropStaleSuggestionsForQueuedBlock,
    clearPendingCorrectionReviewWork,
    openCorrectionFailureCircuit,
    scheduleCorrectionFailureRetry,
    showCorrectionFailureToast,
  ])

  useEffect(() => {
    processCorrectionQueueRef.current = () => {
      void processCorrectionQueue()
    }

    return () => {
      if (processCorrectionQueueRef.current) {
        processCorrectionQueueRef.current = null
      }
    }
  }, [processCorrectionQueue])

  const enqueueCorrectionBlock = useCallback(
    (block: CorrectionTriggerBlock, reason: "edit" | "hydrate-miss" = "edit") => {
      if (!correctionsEnabledRef.current) {
        return
      }

      if (Date.now() < correctionReviewCircuitOpenUntilRef.current) {
        dropStaleSuggestionsForQueuedBlock(block.id)
        showCorrectionFailureToast("Corrections are temporarily unavailable. Try again in a moment.")
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

        const cachedSuggestions = admitCorrectionSuggestions(
          restorePendingSuggestions(cachedBlock.suggestions),
          [block],
        )

        applyCorrectionSuggestionUpdate((current) =>
          replaceBlockSuggestions(current, block.id, cachedSuggestions).suggestions,
        )

        const existingStaleTimer = correctionStaleTimersRef.current.get(block.id)

        if (existingStaleTimer) {
          window.clearTimeout(existingStaleTimer)
          correctionStaleTimersRef.current.delete(block.id)
        }

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
    [
      admitCorrectionSuggestions,
      applyCorrectionSuggestionUpdate,
      dropStaleSuggestionsForQueuedBlock,
      getBlockSuggestions,
      processCorrectionQueue,
      showCorrectionFailureToast,
    ],
  )

  useEffect(() => {
    enqueueCorrectionBlockRef.current = enqueueCorrectionBlock
  }, [enqueueCorrectionBlock])

  useEffect(() => {
    if (!editor) {
      return
    }

    const scheduleDeferredSuppressedFlush = () => {
      if (suppressedCorrectionFlushTimerRef.current !== null) {
        return
      }

      const flushAt = deferredSuppressedCorrectionBlocksRef.current.flushAt

      if (flushAt === null) {
        return
      }

      suppressedCorrectionFlushTimerRef.current = window.setTimeout(() => {
        suppressedCorrectionFlushTimerRef.current = null

        if (modeRef.current !== "rich") {
          deferredSuppressedCorrectionBlocksRef.current = {
            blocksById: new Map(),
            flushAt: null,
          }
          return
        }

        const consumed = consumeDeferredCorrectionBlocks(deferredSuppressedCorrectionBlocksRef.current)
        deferredSuppressedCorrectionBlocksRef.current = consumed.state
        processDirtyCorrectionBlocks(
          consumed.blocks
            .map((block) => getCurrentCorrectionBlock(editor.state.doc, block.id) ?? block)
            .filter((block) => block.text.trim().length > 0),
        )
      }, Math.max(0, flushAt - Date.now()))
    }

    const scheduleStaleTimeout = (block: CorrectionTriggerBlock) => {
      const existingStaleTimer = correctionStaleTimersRef.current.get(block.id)

      if (existingStaleTimer) {
        window.clearTimeout(existingStaleTimer)
      }

      const staleTimer = window.setTimeout(() => {
        correctionStaleTimersRef.current.delete(block.id)
        applyCorrectionSuggestionUpdate((current) => {
          const transition = dropExpiredStaleSuggestions(current, Date.now())

          for (const suggestionId of transition.droppedIds) {
            logCorrectionEvent({
              type: "stale:drop",
              blockId: block.id,
              suggestionId,
            })
          }

          return transition.suggestions
        }, { immediate: true })
      }, CORRECTION_STALE_TIMEOUT_MS)

      correctionStaleTimersRef.current.set(block.id, staleTimer)
    }

    const processDirtyCorrectionBlocks = (blocks: CorrectionTriggerBlock[]) => {
      for (const block of blocks) {
        if (currentWritingIdRef.current) {
          void deletePersistedBlocksForPosition(currentWritingIdRef.current, block)
        }

        const applyStaleInvalidation = (markResolvableStale = true) => {
          applyCorrectionSuggestionUpdate((current) => {
            const invalidation = invalidateBlockSuggestions(current, block, Date.now(), markResolvableStale)

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

        if (!isCorrectionBlockEligible(block)) {
          applyStaleInvalidation(correctionsEnabledRef.current)
          continue
        }

        if (!correctionsEnabledRef.current) {
          applyStaleInvalidation(false)
          continue
        }

        const existingTimer = correctionTimersRef.current.get(block.id)

        if (existingTimer) {
          window.clearTimeout(existingTimer.timer)
          correctionTimersRef.current.delete(block.id)
        }

        applyStaleInvalidation()
        scheduleStaleTimeout(block)

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

    const handleDirtyBlocks = (event: Event) => {
      const blocks = ((event as CustomEvent<{ blocks?: CorrectionTriggerBlock[] }>).detail?.blocks ?? [])

      acknowledgeCorrectionDirtyBlocks(editor, blocks.map((block) => block.id))

      if (modeRef.current !== "rich") {
        return
      }

      if (Date.now() < suppressCorrectionAnalysisUntilRef.current) {
        deferredSuppressedCorrectionBlocksRef.current = deferCorrectionBlocks(
          deferredSuppressedCorrectionBlocksRef.current,
          blocks,
          suppressCorrectionAnalysisUntilRef.current,
        )
        scheduleDeferredSuppressedFlush()
        return
      }

      processDirtyCorrectionBlocks(blocks)
    }

    editor.view.dom.addEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)

    return () => {
      editor.view.dom.removeEventListener("odessay:correction-dirty-blocks", handleDirtyBlocks)
      if (suppressedCorrectionFlushTimerRef.current !== null) {
        window.clearTimeout(suppressedCorrectionFlushTimerRef.current)
        suppressedCorrectionFlushTimerRef.current = null
      }
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
        const result = applyCorrectionSuggestions([suggestion])

        if (result.appliedIds.length > 0) {
          rememberCorrectionDecision(suggestion.correction_fingerprint, "accepted")
        }

        let nextSuggestions = automaticCorrectionSuggestionsRef.current

        if (result.appliedIds.length > 0) {
          nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.appliedIds, "accepted")
        }

        if (result.conflictIds.length > 0) {
          nextSuggestions = updateSuggestionStatuses(nextSuggestions, result.conflictIds, "conflict")
        }

        if (result.appliedIds.length > 0 || result.conflictIds.length > 0) {
          applyCorrectionSuggestionUpdate(() => nextSuggestions, { immediate: true })
          void updatePersistedBlocksFromSuggestions(nextSuggestions, [suggestion.source_hash ?? ""])
        }
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
        return
      }

      if (detail.action === "learn") {
        handleLearnWord(suggestion)
      }
    }

    window.addEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)

    return () => {
      window.removeEventListener("odessay:publication-suggestion-action", handleAutomaticInlineAction)
    }
  }, [applyCorrectionSuggestionUpdate, applyCorrectionSuggestions, handleLearnWord, updatePersistedBlocksFromSuggestions])
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

    // Guard: don't publish tab state with a stale title while hydration is in progress
    // or while a new workspace tab is being created. During tab switching, displayTitle
    // may still derive from the previous writing's bodyText until hydration settles.
    // During + creation in desktop, hydrationWritingId is not set to the placeholder id,
    // so this guard also blocks publishTabState from running with the stale displayTitle
    // and corrupting/replacing an existing tab.
    if (hydrationWritingId !== null || isCreatingWorkspaceTabRef.current) {
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

      // A queued rich-mode update still holds the OLD tab's editor instance.
      // Flushing it here — before currentWritingIdRef changes below — makes
      // sure that content lands on the document it was actually typed into,
      // not on whatever tab we're about to switch to (ODE-478 case 2).
      flushQueuedRichModeUpdate()
      snapshotOutgoingDraftContent()

      persistCurrentWorkspaceViewState()
      activeEditorTabIdRef.current = tabId
      focusTab(tabId)
      navigatedToDraftRef.current = false

      if (nextTab.writing_id) {
        currentWritingIdRef.current = nextTab.writing_id
        setCurrentWritingId(nextTab.writing_id)
        setHydrationWritingId(nextTab.writing_id)
        replaceEditorHistory(buildWritingRouteHref("/write", { id: nextTab.writing_id, slug: nextTab.slug }))
        return
      }

      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      replaceEditorHistory("/write")
    },
    [editorSession.tabs, flushQueuedRichModeUpdate, persistCurrentWorkspaceViewState, snapshotOutgoingDraftContent],
  )

  const handleCloseWorkspaceTab = useCallback(
    async (tabId: string) => {
      const targetTab = editorSession.tabs.find((tab) => tab.id === tabId)
      if (!targetTab) {
        return
      }

      // Same reasoning as handleSelectWorkspaceTab: flush before this tab's
      // identity can change under a still-queued update (ODE-478 case 2).
      flushQueuedRichModeUpdate()
      snapshotOutgoingDraftContent()

      const isClosingActiveTab = activeEditorTabIdRef.current === tabId
      const persistenceTarget = {
        writingId: targetTab.writing_id,
        draftWritingId: targetTab.writing_id === null ? ephemeralDraftWritingIdRef.current : null,
        sourceTabId: tabId,
      }

      if (isClosingActiveTab) {
        persistCurrentWorkspaceViewState()
      }

      // A close waits for this tab's local write, including a still-debounced
      // request. It must not wait for unrelated background tabs, and the
      // existing tab save-state affordance makes the wait visible (ODE-478
      // case 5). There is intentionally no confirm/cancel race here: once the
      // user asks to close, the tab closes after its write is durable.
      if (persistenceCoordinator.hasPending(persistenceTarget)) {
        updateTabSaveState({ tabId, saveState: "saving", hasPendingSync: true })
        const settled = await persistenceCoordinator.settle(persistenceTarget)
        if (!settled) {
          return
        }
      }

      // The await above can let this very tab's own materialization complete
      // and rename it (draft id -> real writing id) via
      // reconcileMaterializedDraftTab, so the `tabId` captured before the
      // await can now point at nothing. Re-resolve it against live state
      // before closing: materializedDraftIdsRef records what the draft id
      // became, since the tab's own draft_writing_id is cleared once it's no
      // longer a draft (ODE-478 follow-up).
      const tabsAfterSettle = getEditorSessionState().session.tabs
      const resolvedTabId = tabsAfterSettle.some((tab) => tab.id === tabId)
        ? tabId
        : (persistenceTarget.draftWritingId
            ? materializedDraftIdsRef.current.get(persistenceTarget.draftWritingId)
            : undefined) ?? tabId

      const nextActiveTabId = closeTab(resolvedTabId)

      if (!isClosingActiveTab) {
        return
      }

      activeEditorTabIdRef.current = nextActiveTabId
      // Read fresh rather than the closed-over `editorSession.tabs`, which can
      // be stale after the same await (ODE-478 follow-up).
      const nextTab = getEditorSessionState().session.tabs.find((tab) => tab.id === nextActiveTabId)
      navigatedToDraftRef.current = false
      if (nextTab?.writing_id) {
        currentWritingIdRef.current = nextTab.writing_id
        setCurrentWritingId(nextTab.writing_id)
        setHydrationWritingId(nextTab.writing_id)
        replaceEditorHistory(buildWritingRouteHref("/write", { id: nextTab.writing_id, slug: nextTab.slug }))
        return
      }

      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      replaceEditorHistory("/write")
    },
    [
      editorSession.tabs,
      flushQueuedRichModeUpdate,
      persistCurrentWorkspaceViewState,
      persistenceCoordinator,
      snapshotOutgoingDraftContent,
    ],
  )

  // Renaming reads the loaded editor, so a pencil pressed on a background tab
  // selects it first and opens the modal once that tab is the active one.
  const pendingRenameTabIdRef = useRef<string | null>(null)

  const handleRenameWorkspaceTab = useCallback(
    (tabId: string) => {
      if (tabId !== editorSession.active_tab_id) {
        pendingRenameTabIdRef.current = tabId
        handleSelectWorkspaceTab(tabId)
        return
      }

      setRenameModalSnapshot({
        title: titleRef.current.trim() || UNTITLED_WRITING_TITLE,
        bodyText: editor ? getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)) : "",
      })
      setRenameModalOpen(true)
    },
    [editor, editorSession.active_tab_id, handleSelectWorkspaceTab],
  )

  useEffect(() => {
    const pendingTabId = pendingRenameTabIdRef.current
    if (!pendingTabId || pendingTabId !== editorSession.active_tab_id) return
    // The tab switch landed and the editor holds its content: open the modal.
    pendingRenameTabIdRef.current = null
    handleRenameWorkspaceTab(pendingTabId)
  }, [editorSession.active_tab_id, handleRenameWorkspaceTab])

  // The breadcrumb reads the document's canonical path: on desktop the parent
  // folder and its parent are the workspace lead the header shows. On web there
  // is no path and the breadcrumb collapses to the artifact name alone.
  const documentBreadcrumb = useMemo(() => {
    if (!canonicalPath) {
      return { workspace: null, folder: null }
    }

    const segments = canonicalPath.split("/").filter(Boolean).slice(0, -1)

    return {
      workspace: segments.at(-2) ?? segments.at(-1) ?? null,
      folder: segments.length > 1 ? (segments.at(-1) ?? null) : null,
    }
  }, [canonicalPath])

  const handleRenameActiveWriting = useCallback(() => {
    const activeTabId = editorSession.active_tab_id
    if (!activeTabId) {
      return
    }

    handleRenameWorkspaceTab(activeTabId)
  }, [editorSession.active_tab_id, handleRenameWorkspaceTab])

  const handleReorderWorkspaceTab = useCallback((tabId: string, targetTabId: string) => {
    reorderTab(tabId, targetTabId)
  }, [])

  /**
   * Editorial state per tab, so each tab draws the same glyph the properties
   * panel shows (`WritingStatusIcon`). The active tab reads live local state so
   * a change in Properties is reflected without a round trip; the rest come
   * from the catalog, refreshed when the open set changes.
   */
  const [catalogTabStatuses, setCatalogTabStatuses] = useState<Record<string, WritingStatus | null>>({})

  const openWritingIds = useMemo(
    () => editorSession.tabs.map((tab) => tab.writing_id).filter((id): id is string => Boolean(id)),
    [editorSession.tabs],
  )
  const openWritingIdsKey = openWritingIds.join(",")

  useEffect(() => {
    if (openWritingIds.length === 0) {
      setCatalogTabStatuses({})
      return
    }

    let cancelled = false
    let unsubscribe: (() => void) | null = null

    // Imported lazily: pulling the catalog into the shell's module graph drags
    // the Tauri filesystem watcher with it, which breaks any suite that mounts
    // the editor without the desktop mocks.
    void import("@/lib/queries/document-catalog")
      .then(({ loadCatalogRecords, subscribeToCatalog }) => {
        if (cancelled) return

        const refresh = () => {
          void loadCatalogRecords()
            .then((records) => {
              if (cancelled) return
              const wanted = new Set(openWritingIds)
              const next: Record<string, WritingStatus | null> = {}
              for (const record of records) {
                if (wanted.has(record.id)) next[record.id] = record.status ?? null
              }
              setCatalogTabStatuses(next)
            })
            .catch(() => {
              // A catalog miss just leaves the glyph on its fallback.
            })
        }

        refresh()
        unsubscribe = subscribeToCatalog(refresh)
      })
      .catch(() => {
        // No catalog in this runtime: the glyphs stay on their fallback.
      })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openWritingIdsKey])

  const tabStatuses = useMemo(() => {
    const next: Record<string, WritingStatus | null> = {}
    for (const tab of editorSession.tabs) {
      next[tab.id] =
        tab.id === editorSession.active_tab_id
          ? writingStatus
          : tab.writing_id
            ? catalogTabStatuses[tab.writing_id] ?? null
            : null
    }
    return next
  }, [catalogTabStatuses, editorSession.active_tab_id, editorSession.tabs, writingStatus])

  const handleRenameModalOpenChange = useCallback((open: boolean) => {
    setRenameModalOpen(open)
    if (!open) {
      setRenameModalSnapshot(null)
    }
  }, [])

  const handleRenameWritingConfirm = useCallback(
    async (nextTitle: string): Promise<boolean> => {
      if (isDesktopRuntime()) {
        const writingId = currentWritingIdRef.current
        if (!writingId) {
          // The draft has no file yet. Naming it is just as deliberate a
          // signal of real intent as the first keystroke, so it must
          // materialize through the same path typing already uses — not
          // silently no-op (ODE-478 case 3).
          if (!editor) return false
          setTitle(nextTitle)
          setHasExplicitTitle(nextTitle !== DESKTOP_UNTITLED_WRITING_TITLE)
          return persistEditorSnapshot(editor, { title: nextTitle }, { awaitDurability: true })
        }

        const result = await (await getDocumentService()).renameWriting({
          writingId,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        })
        if (result.error || !result.data) return false

        setTitle(result.data.title ?? nextTitle)
        setHasExplicitTitle((result.data.title ?? nextTitle) !== UNTITLED_WRITING_TITLE)
        return true
      }

      setTitle(nextTitle)
      setHasExplicitTitle(nextTitle !== UNTITLED_WRITING_TITLE)

      if (editor) {
        return persistEditorSnapshot(editor, { title: nextTitle }, { awaitDurability: true })
      }
      return true
    },
    [editor, persistEditorSnapshot],
  )

  const handleCreateWorkspaceTab = useCallback(async (options?: { skipConfirm?: boolean }) => {
    if (!options?.skipConfirm && editorSession.tabs.length >= 10) {
      const confirmed = window.confirm("You already have many tabs open. Open another artifact anyway?")
      if (!confirmed) {
        return
      }
    }

    // Desktop: drafts remain ephemeral until the user enters real content.
    // Just open/focus a draft tab; never persist a contentless writing here.
    if (isDesktopRuntime()) {
      // Flush/snapshot before detaching (same reasoning as
      // handleSelectWorkspaceTab/handleCloseWorkspaceTab): a still-queued rAF
      // rich-mode update or unmaterialized draft content must not be
      // discarded just because the user hit New Tab before the next
      // frame/save landed (ODE-478 follow-up — this handler never got the
      // original case 2/4 fix).
      flushQueuedRichModeUpdate()
      snapshotOutgoingDraftContent()

      persistCurrentWorkspaceViewState()

      // Detach the previous document before the draft tab can receive focus.
      // Merely changing the active session tab leaves TipTap and the save path
      // bound to the previous UUID until React effects run, so the first input
      // can otherwise append to (and persist over) the previous document.
      persistenceCoordinator.cancel()
      persistenceCoordinator.activateDocument(null)
      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      ephemeralDraftWritingIdRef.current = createBlankDraftIdentity().writingId
      navigatedToDraftRef.current = false

      if (editor) {
        isApplyingContentRef.current = true
        editor.commands.setContent(EMPTY_EDITOR_JSON)
        isApplyingContentRef.current = false
        updateDerivedEditorState(editor)
      }

      openDraftTab(ephemeralDraftWritingIdRef.current)
      activeEditorTabIdRef.current = getEditorSessionState().session.active_tab_id ?? EDITOR_DRAFT_TAB_ID
      replaceEditorHistory("/write")
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => {
          const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
          editorEl?.focus()
        })
      })
      return
    }

    // Block publishTabState while we are mid-creation. Web claims the final id
    // synchronously so persistEditorSnapshot never races against it.
    isCreatingWorkspaceTabRef.current = true

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
    replaceEditorHistory(`/write/${nextWritingId}`)

    const finishCreation = () => {
      isCreatingWorkspaceTabRef.current = false
    }

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
      artifactType: "general",
      visibility: "private",
      parentId: null,
      correspondenceId: null,
      version: 1,
      deletedAt: null,
      createdAt: nowIso,
      updatedAt: nowIso,
      contentUpdatedAt: nowIso,
      metadataUpdatedAt: nowIso,
    }

    if (isActiveDraft) {
      try {
        await (await getDocumentService()).saveWriting({ writing: blankDraftRecord })
      } catch {
        // If save fails, revert the optimistic claim so persistEditorSnapshot
        // can fall back to identity-on-first-input.
        currentWritingIdRef.current = null
        setCurrentWritingId(null)
        setHydrationWritingId(null)
        return
      } finally {
        finishCreation()
      }

      openWritingTab({
        writingId: currentWritingIdRef.current ?? nextWritingId,
        title: nextTitle,
        saveState: "saved",
        hasPendingSync: false,
      })
      activeEditorTabIdRef.current = currentWritingIdRef.current ?? nextWritingId
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
      await (await getDocumentService()).saveWriting({ writing: blankDraftRecord })
    } catch {
      currentWritingIdRef.current = null
      setCurrentWritingId(null)
      setHydrationWritingId(null)
      return
    } finally {
      finishCreation()
    }

    openWritingTab({
      writingId: currentWritingIdRef.current ?? nextWritingId,
      title: nextTitle,
      saveState: "saved",
      hasPendingSync: false,
    })
    activeEditorTabIdRef.current = currentWritingIdRef.current ?? nextWritingId
    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        const editorEl = document.querySelector<HTMLElement>(".odessay-editor-content")
        editorEl?.focus()
      })
    })
  }, [
    currentWritingId,
    editor,
    editorSession.tabs,
    flushQueuedRichModeUpdate,
    persistenceCoordinator,
    persistCurrentWorkspaceViewState,
    snapshotOutgoingDraftContent,
    updateDerivedEditorState,
  ])
  createWorkspaceTabRef.current = handleCreateWorkspaceTab

  const handleOpenWorkspaceDocument = useCallback(async (documentId: string) => {
    // Same reasoning as handleSelectWorkspaceTab/handleCloseWorkspaceTab/
    // handleCreateWorkspaceTab: this also detaches from whatever document is
    // currently active, so a still-queued edit or unmaterialized draft must
    // not be discarded just because the user opened a different document via
    // search/recents instead of the tab bar (ODE-478 follow-up).
    flushQueuedRichModeUpdate()
    snapshotOutgoingDraftContent()

    const outcome = await openDocumentById(documentId)
    if (outcome.status !== "opened" && outcome.status !== "conflict") {
      throw new Error(describeOpenOutcome(outcome))
    }
    const openedTitle = outcome.record.title ?? UNTITLED_WRITING_TITLE
    currentWritingIdRef.current = documentId
    setCurrentWritingId(documentId)
    setHydrationWritingId(documentId)
    openWritingTab({ writingId: documentId, slug: outcome.record.slug, title: openedTitle, saveState: "saved-local", hasPendingSync: false })
  }, [flushQueuedRichModeUpdate, snapshotOutgoingDraftContent])

  selectAdjacentTabRef.current = (direction) => {
    const tabs = editorSession.tabs
    if (tabs.length <= 1) {
      return
    }

    const activeId = editorSession.active_tab_id ?? currentWritingIdRef.current ?? EDITOR_DRAFT_TAB_ID
    const currentIndex = tabs.findIndex((tab) => tab.id === activeId)
    const baseIndex = currentIndex < 0 ? 0 : currentIndex
    const nextTab = tabs[(baseIndex + direction + tabs.length) % tabs.length]

    if (nextTab && nextTab.id !== activeId) {
      handleSelectWorkspaceTab(nextTab.id)
    }
  }

  useEffect(() => {
    if (!forceNewWriting || !sessionLoaded || forceNewWritingRequestedRef.current) {
      return
    }

    forceNewWritingRequestedRef.current = true
    void handleCreateWorkspaceTab({ skipConfirm: true })
  }, [forceNewWriting, handleCreateWorkspaceTab, sessionLoaded])

  const handleMenuOpenFile = useCallback(
    async (_path: string, content: string) => {
      // Same reasoning as the other document-switching handlers: the OS
      // "Open File" menu also detaches from whatever is currently active
      // (ODE-478 follow-up).
      flushQueuedRichModeUpdate()
      snapshotOutgoingDraftContent()

      persistCurrentWorkspaceViewState()

      // Unified opener (ODE-375 M3): desktop Open Document converges path → UUID
      // through the catalog before hydration and never mints a fresh id per open,
      // so reopening the same file is idempotent. A file outside every BindingRoot
      // asks for explicit consent before its parent folder is registered; cancel
      // leaves no UUID, manifest row or draft.
      if (isDesktopRuntime() && isUnifiedOpenEnabled()) {
        let result = await openDocumentByPath(_path)
        if (result.status === "needs-binding-root-confirmation") {
          const accept = window.confirm(
            `Register “${result.parentDir}” so Artifact Studio can keep this file’s identity across moves and renames?`,
          )
          if (!accept) return
          result = await openDocumentByPath(_path, { confirmRegisterRoot: true })
        }
        if (result.status !== "opened") {
          // Explicit, keyboard-dismissible outcome; never a silent draft. Full
          // ambiguous/conflict UX is owned by ODE-373.
          if (typeof window !== "undefined") {
            window.alert(describeOpenOutcome(result))
          }
          return
        }

        const openedId = result.documentId
        currentWritingIdRef.current = openedId
        setCurrentWritingId(openedId)
        setHydrationWritingId(openedId)
        const openedTitle = result.record.title ?? filenameToTitle(_path)
        setTitle(openedTitle)
        openWritingTab({
          writingId: openedId,
          title: titleRef.current || openedTitle,
          saveState: "saved-local",
          hasPendingSync: false,
        })
        return
      }

      const nowIso = new Date().toISOString()
      const nextWritingId = createWritingId()
      const parseResult = desktopDocumentEngine.sourceToRich(content)
      const bodyJson = parseResult.success ? parseResult.snapshot.bodyJson : EMPTY_EDITOR_JSON
      const bodyText = parseResult.success ? parseResult.snapshot.bodyText : ""
      const nextTitle = isDesktopRuntime()
        ? filenameToTitle(_path) || DESKTOP_UNTITLED_WRITING_TITLE
        : deriveAutoTitle(bodyText, nowIso)

      const record: WritingRecord = {
        id: nextWritingId,
        authorId: null,
        title: nextTitle,
        content: {
          richText: bodyJson as Record<string, unknown>,
          markdown: null,
          plainText: bodyText,
          canonicalSource: "rich-text",
        },
        slug: null,
        status: "draft",
        artifactType: "general",
        visibility: "private",
        parentId: null,
        correspondenceId: null,
        version: 1,
        deletedAt: null,
        createdAt: nowIso,
        updatedAt: nowIso,
        contentUpdatedAt: nowIso,
        metadataUpdatedAt: nowIso,
      }

      try {
        if (isDesktopRuntime()) {
          const result = await importDesktopWritingFile(_path, content)
          if (result.error || !result.data) {
            throw new Error(result.error?.message ?? "Failed to import desktop file")
          }
          currentWritingIdRef.current = result.data.id
          setCurrentWritingId(result.data.id)
          setHydrationWritingId(result.data.id)
          setTitle(result.data.title ?? nextTitle)
        } else {
          await (await getDocumentService()).saveWriting({ writing: record })
        }
      } catch {
        return
      }

      currentWritingIdRef.current = currentWritingIdRef.current ?? nextWritingId
      setCurrentWritingId(currentWritingIdRef.current)
      setHydrationWritingId(currentWritingIdRef.current)
      openWritingTab({
        writingId: currentWritingIdRef.current,
        title: isDesktopRuntime() ? titleRef.current || nextTitle : nextTitle,
        saveState: "saved-local",
        hasPendingSync: false,
      })
      if (isPerfHarness()) {
        // ODE-389: same cold-harness guard as the other editor navigations.
        replaceEditorHistory(`/write/${nextWritingId}`)
      } else if (!isDesktopRuntime()) {
        router.push(`/write/${nextWritingId}`)
      }
    },
    [flushQueuedRichModeUpdate, persistCurrentWorkspaceViewState, router, snapshotOutgoingDraftContent],
  )

  const handleMenuNewFile = useCallback(() => {
    void handleCreateWorkspaceTab({ skipConfirm: true })
  }, [handleCreateWorkspaceTab])

  const handleSaveToDisk = useCallback(async (path: string, content: string): Promise<string | false> => {
    if (!isDesktopRuntime()) return false
    let writingId = currentWritingIdRef.current

    if (!writingId) {
      // Save As is itself a deliberate naming action — the filename the user
      // just chose in the native picker is exactly as explicit a signal as
      // renaming a draft (case 3), so it materializes a still-blank,
      // untitled draft too instead of silently doing nothing after the user
      // has already picked a destination (ODE-478 follow-up).
      if (!editor) return false
      await persistEditorSnapshot(editor, { title: filenameToTitle(path) }, { awaitDurability: true })
      writingId = currentWritingIdRef.current
      if (!writingId) return false
    }

    const { relocateDesktopWriting } = await import("@/lib/services/document-service-factory")
    // Conscious physical MOVE (ODE-402): content commits to the current
    // canonical file and the rename transports it — no copy is ever written at
    // the destination. The adopted path may carry a collision suffix.
    const result = await relocateDesktopWriting(writingId, path, content)
    if (result.status !== "relocated") {
      // Never reflect a move that did not materialize. Title, canonical path
      // and any active external-file notice stay untouched; surface a clear
      // notice instead.
      setExternalFileNotice({ kind: "relocate-failed", path: currentCanonicalPathRef.current })
      return false
    }
    const filenameTitle = filenameToTitle(result.path)
    setTitle(filenameTitle)
    setHasExplicitTitle(filenameTitle !== DESKTOP_UNTITLED_WRITING_TITLE)
    currentCanonicalPathRef.current = result.path
    setCanonicalPath(result.path)
    setExternalFileNotice(null)
    return result.path
  }, [editor, persistEditorSnapshot])

  useTauriEditorMenuEvents(handleRunAction)

  const exportFileBaseName = useMemo(
    () =>
      getExportFileBaseName({
        title: displayTitle,
        bodyText,
        writingId: currentWritingId ?? "draft",
      }),
    [bodyText, currentWritingId, displayTitle],
  )

  // Save As creates a canonical desktop document, not an export. It must retain
  // the human filename, whereas exports intentionally use a portable slug.
  const desktopSaveFileBaseName = useMemo(
    () => titleToFilename(displayTitle, ""),
    [displayTitle],
  )

  const getBodyMarkdown = useCallback(() => {
    if (!editor) return null
    if (modeRef.current === "markdown") return markdownValue

    if (isDesktopRuntime()) {
      const result = desktopDocumentEngine.richToSource(editor)
      if (result.success) return result.markdown
    }

    return normalizeMarkdownForRoundTrip(
      getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)),
    )
  }, [editor, markdownValue])

  const handleGetSaveContent = useCallback(() => {
    // Always let the native picker open, even for a still-blank, untitled
    // draft — Save As's whole point is choosing a name, and that filename is
    // exactly the deliberate naming signal handleSaveToDisk needs to
    // materialize it (ODE-478 follow-up).
    const content = getBodyMarkdown()
    if (content === null) return null
    return {
      content: `${content.trimEnd()}\n`,
      defaultName: isDesktopRuntime() ? desktopSaveFileBaseName : exportFileBaseName,
    }
  }, [desktopSaveFileBaseName, exportFileBaseName, getBodyMarkdown])

  useTauriMenuEvents({
    onOpenFile: handleMenuOpenFile,
    onNewFile: handleMenuNewFile,
    onEditorAction: (action) => handleRunAction(action),
    onGetSaveContent: handleGetSaveContent,
    onSaveToDisk: handleSaveToDisk,
    documentKey: currentWritingId,
  })

  // ODE-478 case 5 covered the explicit tab-close button; the window itself
  // had no equivalent guard, so quitting the app or closing the window mid
  // save abandoned it the same way (ODE-478 follow-up).
  const settleBeforeClose = useCallback(async () => {
    flushQueuedRichModeUpdate()
    await persistenceCoordinator.settle()
  }, [flushQueuedRichModeUpdate, persistenceCoordinator])
  useTauriCloseGuard(settleBeforeClose)

  // Picks up a file opened via Cmd+O from outside Write (see useGlobalOpenFileMenu).
  useEffect(() => {
    if (!sessionLoaded || !isDesktopRuntime()) return
    const pending = consumePendingOpenFile()
    if (!pending) return
    void handleMenuOpenFile(pending.path, pending.content)
  }, [sessionLoaded, handleMenuOpenFile])

  const exportMarkdown = useCallback(async () => {
    const bodyMarkdown = getBodyMarkdown()
    if (bodyMarkdown === null) {
      return false
    }

    const bytes = new TextEncoder().encode(`${bodyMarkdown.trimEnd()}\n`)
    return saveBinaryArtifact({
      bytes,
      fileName: `${exportFileBaseName}.md`,
      mimeType: "text/markdown;charset=utf-8",
    })
  }, [exportFileBaseName, getBodyMarkdown])

  const exportBinary = useCallback(
    async (format: "pdf" | "docx") => {
      if (!currentWritingId) {
        return
      }

      const result = await (await getDocumentService()).exportWriting({ writingId: currentWritingId, format })
      if (result.error) {
        throw new Error(result.error.message)
      }

      return saveBinaryArtifact({
        bytes: result.data.bytes,
        fileName: result.data.fileName || `${exportFileBaseName}.${format}`,
        mimeType: result.data.mimeType,
      })
    },
    [currentWritingId, exportFileBaseName],
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
          hasOpenPanel: activePanel !== null || isAgentPanelOpen,
          isFocusMode,
        })

        if (intent === "close-panel") {
          event.preventDefault()
          closeActivePanel()
        } else if (intent === "exit-focus") {
          event.preventDefault()
          exitFocusMode()
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
    isAgentPanelOpen,
    isFindReplaceOpen,
    linkModalOpen,
    closeFindReplacePanel,
    closeActivePanel,
    pendingAnnotation,
    pendingRichSelection,
    renameModalOpen,
    tableModalOpen,
    exitFocusMode,
  ])

  // The editor is a fixed-height frame, not a scrolling page: the topbar is
  // sticky, the status bar and the notes panel are `fixed`, and every content
  // area owns its own scroller. With `min-h-screen` the layout could grow past
  // the shell's <main> and let it scroll, dragging the absolutely positioned
  // navigation sidebar out of view above the frame.
  return (
    <section
      id="editor"
      data-page="editor"
      data-focus-mode={isFocusMode ? "true" : "false"}
      className="h-screen overflow-hidden bg-bg"
    >
      <div className="EditorLayout hidden h-full min-h-0 flex-col md:flex">
        {!isFocusMode && isTopbarVisible ? (
          <EditorTopbar
            isFocusMode={isFocusMode}
            activePanel={activePanel}
            isAgentPanelOpen={isAgentPanelOpen}
            tabs={editorSession.tabs}
            tabStatuses={tabStatuses}
            activeTabId={editorSession.active_tab_id}
            onSelectTab={handleSelectWorkspaceTab}
            onCloseTab={handleCloseWorkspaceTab}
            onRenameTab={handleRenameWorkspaceTab}
            onReorderTab={handleReorderWorkspaceTab}
            onNewTab={handleCreateWorkspaceTab}
            onToggleFocusMode={toggleFocusMode}
            onTogglePanel={(panel) => setActivePanel((current) => (current === panel ? null : panel))}
            onToggleAgent={() => {
              if (!isAgentPanelOpen) setHasOpenedAgentPanel(true)
              setIsAgentPanelOpen((current) => !current)
            }}
            isTabBarVisible={isTabBarVisible}
          />
        ) : null}

        {!isFocusMode && externalFileNotice ? (
          <div className="border-b-[0.5px] border-border bg-muted/50 px-6 py-3 text-sm text-ink-3">
            {externalFileNotice.kind === "moved" ? (
              <span>
                This file moved outside Artifact Studio. The editor is now following the new path:
                <span className="ml-1 font-medium text-ink">{externalFileNotice.path}</span>
              </span>
            ) : externalFileNotice.kind === "relocate-failed" ? (
              <span>
                This artifact couldn&apos;t be moved to the chosen folder. Nothing was written there;
                Artifact Studio keeps working on the original
                {externalFileNotice.path ? (
                  <span className="ml-1 font-medium text-ink">{externalFileNotice.path}</span>
                ) : (
                  " file"
                )}
                .
              </span>
            ) : (
              <span>
                This file was removed outside Artifact Studio. Your current content stays open here, but the
                source file is no longer on disk.
              </span>
            )}
          </div>
        ) : null}

        <div
          data-testid="editor-band"
          className={cn(
            "EditorBand flex min-h-0 flex-1",
            isFocusMode ? "gap-0 px-0 pb-0 pt-[46px]" : "gap-2.5 pb-2.5 pr-2.5 pt-1.5",
          )}
        >
          <div className="relative flex min-w-0 flex-1 flex-col gap-1.5">
            {isDesktopRuntime() && hydrationProgress.active ? (
              <div className="absolute inset-0 z-20 flex items-center justify-center bg-bg/88 backdrop-blur-sm">
                <div className="w-full max-w-[360px] rounded-[20px] border border-border/70 bg-paper px-6 py-5 text-center shadow-[0_20px_60px_rgba(39,27,22,0.12)]">
                  <p className="font-sans text-[11px] font-medium tracking-[0.18em] text-ink-4 uppercase">
                    Desktop Sync
                  </p>
                  <h2 className="mt-3 font-lora text-[26px] leading-[1.25] text-ink">
                    Syncing your artifacts…
                  </h2>
                  <p className="mt-2 text-[13px] leading-[1.6] text-ink-4">
                    {hydrationProgress.total > 0
                      ? `${hydrationProgress.completed} of ${hydrationProgress.total} artifacts ready on this device`
                      : "Preparing your library on this device"}
                  </p>
                  <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-[var(--accent)] transition-[width] duration-300 ease-out"
                      style={{
                        width:
                          hydrationProgress.total > 0
                            ? `${Math.min(
                                100,
                                Math.round(
                                  (hydrationProgress.completed / hydrationProgress.total) * 100,
                                ),
                              )}%`
                            : "18%",
                      }}
                    />
                  </div>
                </div>
              </div>
            ) : null}
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
                <div className="relative flex min-h-0 flex-1 gap-0.5">
                  {!isFocusMode ? (
                    <Suspense fallback={null}>
                      <TableOfContentsPanel
                        items={tableOfContentsItems}
                        activeItemId={selectedTableOfContentsItemId}
                        onNavigate={navigateToTableOfContentsItem}
                        activeWritingId={currentWritingId}
                        onOpenDocument={handleOpenWorkspaceDocument}
                        mode={navigationMode}
                        onModeChange={setNavigationMode}
                      />
                    </Suspense>
                  ) : null}

                  <div
                    data-testid="editor-sheet"
                    className={cn(
                      "EditorSheet relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sb",
                      isFocusMode ? "rounded-none shadow-none" : "rounded-[10px] shadow-float",
                    )}
                  >
                    <EditorSheetHeader
                      editor={editor}
                      mode={mode}
                      onRunAction={handleRunAction}
                      title={title.trim() || UNTITLED_WRITING_TITLE}
                      workspaceName={documentBreadcrumb.workspace}
                      folderName={documentBreadcrumb.folder}
                      onRename={handleRenameActiveWriting}
                      leftPanel={navigationMode}
                      onToggleLeftPanel={(panel) =>
                        setNavigationMode(navigationMode === panel ? null : panel)
                      }
                      showPanelToggles={!navigationMode}
                    />

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
                  </div>
                </div>

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
                    onOpenShortcutHelp={() => setIsShortcutHelpOpen(true)}
                  />
                ) : null}
              </>
            )}
          </div>

        {!isFocusMode && activePanel && editorSession.tabs.length > 0 ? (
          <aside
            data-testid="editor-right-panel"
            // The panel is always a column of the band. It used to float over
            // the sheet below 1440 — the desktop window opens at 1280, so that
            // was its normal state and it covered the text (owner decision,
            // ODE-433 follow-up).
            className="EditorRightPanel flex h-full min-h-0 w-[var(--size-panel-right)] shrink-0 flex-col overflow-hidden border-l-[0.5px] border-border font-sans"
          >
          {/* One header for the four surfaces. Each of them used to carry a
              header and a close button of its own, and Share was a section
              buried inside Properties (owner review). */}
          <EditorRightPanelTabs
            active={activePanel}
            onSelect={setActivePanel}
            onClose={closeActivePanel}
            badges={{ grammar: visibleCorrectionCount }}
          />
          <div className="min-h-0 flex-1 overflow-hidden">
          <Suspense fallback={null}>
            {activePanel === "notes" ? (
              <NotesPanel
                annotations={footnotes}
                currentMarkdown={currentDocumentMarkdown}
                onNavigate={(annotation: AnnotationPanelEntry) => {
                  if (modeRef.current === "markdown") {
                    const textarea = markdownTextareaRef.current
                    if (
                      !textarea ||
                      annotation.source_start == null ||
                      annotation.source_end == null
                    ) {
                      return false
                    }

                    textarea.focus()
                    textarea.setSelectionRange(annotation.source_start, annotation.source_end)
                    markdownSelectionRef.current = {
                      start: annotation.source_start,
                      end: annotation.source_end,
                      text: markdownValue.slice(annotation.source_start, annotation.source_end),
                    }
                    queueMarkdownSelectionRestore(annotation.source_start, annotation.source_end)
                    return true
                  }

                  if (!editor) return false
                  if (annotation.anchor_start != null && annotation.anchor_text) {
                    const resolution = resolveStandaloneHighlightRange(editor, {
                      anchorText: annotation.anchor_text,
                      anchorStart: annotation.anchor_start,
                      anchorEnd: annotation.anchor_end,
                    })
                    return resolution.status === "found"
                      ? navigateToEditorPosition(editor, resolution.range.from)
                      : false
                  }

                  let targetPosition: number | null = null
                  editor.state.doc.descendants((node, nodePos) => {
                    if (targetPosition !== null) return false
                    if (
                      (node.type.name === "annotationReference" ||
                        node.type.name === "footnoteReference") &&
                      (annotation.id
                        ? String(node.attrs.id ?? "") === annotation.id
                        : (node.attrs.type as string) === annotation.type &&
                          (node.attrs.index as number) === annotation.index)
                    ) {
                      targetPosition = nodePos
                      return false
                    }
                  })

                  return targetPosition !== null
                    ? navigateToEditorPosition(editor, targetPosition)
                    : false
                }}
                onUpdateAnnotation={(annotation: AnnotationPanelEntry, text: string) => {
                  if (modeRef.current === "rich" && editor) {
                    const updated = editor.commands.updateAnnotation(
                      annotation.type as AnnotationType,
                      annotation.index,
                      text,
                      annotation.id,
                    )
                    if (!updated) return false
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                    return true
                  }

                  const result = updateMarkdownAnnotation(markdownValue, annotation, text)
                  return result.found && applyMarkdownFromPanel(result.markdown)
                }}
                onUpdateAnnotationType={(annotation: AnnotationPanelEntry, newType: AnnotationType) => {
                  if (modeRef.current === "rich" && editor) {
                    const updated = editor.commands.updateAnnotationType(
                      annotation.type as AnnotationType,
                      annotation.index,
                      newType,
                      undefined,
                      annotation.id,
                    )
                    if (!updated) return false
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                    return true
                  }

                  const result = changeMarkdownAnnotationType(markdownValue, annotation, newType)
                  return result.found && applyMarkdownFromPanel(result.markdown)
                }}
                onDeleteAnnotation={(annotation: AnnotationPanelEntry) => {
                  if (modeRef.current === "rich" && editor) {
                    const deleted = editor.commands.deleteAnnotation(
                      annotation.type as AnnotationType,
                      annotation.index,
                      annotation.id,
                    )
                    if (!deleted) return false
                    setRichFootnoteRevision((r) => r + 1)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                    return true
                  }

                  const result = removeMarkdownAnnotation(markdownValue, annotation)
                  return result.found && applyMarkdownFromPanel(result.markdown)
                }}
                onUpdateHighlight={(anchorText: string, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => {
                  if (!id) return false
                  if (modeRef.current === "markdown") {
                    const result = annotateMarkdownStandaloneHighlight(
                      markdownValue,
                      { id, anchor_text: anchorText, anchor_start: anchorStart, anchor_end: anchorEnd },
                      "highlight",
                      text,
                      id,
                    )
                    return result.found && applyMarkdownFromPanel(result.markdown)
                  }
                  if (!editor || !anchorText) return false
                  const converted = convertStandaloneHighlight(anchorText, "highlight", text, anchorStart, anchorEnd, id)
                  if (!converted) return false
                  setRichFootnoteRevision((r) => r + 1)
                  updateDerivedEditorState(editor)
                  void persistEditorSnapshot(editor)
                  return true
                }}
                onConvertHighlight={(anchorText: string, newType: AnnotationType, text: string, anchorStart?: number, anchorEnd?: number, id?: string) => {
                  if (!id) return false
                  const nextText = newType === "ai" ? text.trim() || anchorText : text
                  if (modeRef.current === "markdown") {
                    const result = annotateMarkdownStandaloneHighlight(
                      markdownValue,
                      { id, anchor_text: anchorText, anchor_start: anchorStart, anchor_end: anchorEnd },
                      newType,
                      nextText,
                      id,
                    )
                    return result.found && applyMarkdownFromPanel(result.markdown)
                  }
                  if (!editor || !anchorText) return false
                  const converted = convertStandaloneHighlight(anchorText, newType, nextText, anchorStart, anchorEnd, id)
                  if (!converted) return false
                  setRichFootnoteRevision((r) => r + 1)
                  updateDerivedEditorState(editor)
                  void persistEditorSnapshot(editor)
                  return true
                }}
                onDeleteHighlight={(anchorText: string, anchorStart?: number, anchorEnd?: number, id?: string) => {
                  if (modeRef.current === "markdown") {
                    const result = removeMarkdownStandaloneHighlight(markdownValue, {
                      id,
                      anchor_text: anchorText,
                      anchor_start: anchorStart,
                      anchor_end: anchorEnd,
                    })
                    return result.found && applyMarkdownFromPanel(result.markdown)
                  }
                  if (!editor || !anchorText) return false
                  const resolution = deleteStandaloneHighlight(editor, {
                    anchorText,
                    anchorStart,
                    anchorEnd,
                  })
                  if (resolution.status !== "found") {
                    return false
                  }

                  setRichFootnoteRevision((r) => r + 1)
                  updateDerivedEditorState(editor)
                  void persistEditorSnapshot(editor)
                  return true
                }}
              />
            ) : activePanel === "properties" || activePanel === "share" ? (
              <PropertiesPanel
                tab={activePanel}
                writingId={currentWritingId}
                lifecycle={lifecycle}
                status={writingStatus}
                artifactType={artifactType}
                visibility={writingVisibility}
                metrics={textMetrics}
                canonicalPath={canonicalPath}
                onExportMarkdown={exportMarkdown}
                onExportPdf={() => exportBinary("pdf")}
                onExportDocx={() => exportBinary("docx")}
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
                onArtifactTypeChange={(nextArtifactType) => {
                  if (nextArtifactType === artifactType) {
                    return
                  }

                  setArtifactType(nextArtifactType)
                  void applyPanelMetaChange(editor, { artifactType: nextArtifactType }, {
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
              />
            ) : (
              <CorrectionsPanel
                suggestions={automaticCorrectionSuggestions}
                markdown={currentDocumentMarkdown}
                showCorrections={showCorrections}
                analysisStatus={{
                  runState: correctionAnalysisRunState,
                  progress: correctionAnalysisProgress,
                }}
                onAcceptSuggestion={handleAcceptCorrection}
                onRejectSuggestion={handleRejectCorrection}
                onLearnWord={handleLearnWord}
                onAcceptAll={handleAcceptAllCorrections}
                onRejectAll={handleRejectAllCorrections}
                learnedWords={learnedWords}
                learnedWordsLoading={learnedWordsLoading}
                onRemoveLearnedWord={handleRemoveLearnedWord}
                onAnalyze={startCorrectionAnalysis}
                onRetryFailed={retryFailedCorrectionPackages}
                onCancel={cancelCorrectionAnalysis}
                onShowCorrectionsChange={setShowCorrections}
              />
            )}
          </Suspense>
          </div>
          </aside>
        ) : null}

        {editorSession.tabs.length > 0 ? (
          <div
            data-testid="workspace-agent-focus-host"
            aria-hidden={isFocusMode}
            className={cn(
              "-mb-2.5 -mt-1.5 flex min-h-0 shrink-0 self-stretch",
              isFocusMode && "hidden",
            )}
          >
            {isAgentPanelOpen || hasOpenedAgentPanel ? (
              <Suspense fallback={null}>
                <WorkspaceAgentPanel
                  scope={{ kind: "document", id: currentWritingId ?? "current-artifact" }}
                  workspaceRootPath={agentWorkspaceRootPath}
                  scopeLabel={title.trim() || UNTITLED_WRITING_TITLE}
                  open={isAgentPanelOpen}
                  onOpenChange={setIsAgentPanelOpen}
                />
              </Suspense>
            ) : (
              <button
                type="button"
                data-testid="workspace-agent-rail"
                aria-label="Open Workspace agent"
                onClick={() => {
                  setHasOpenedAgentPanel(true)
                  setIsAgentPanelOpen(true)
                }}
                className="flex h-full min-h-0 w-9 shrink-0 items-center justify-center border-l-[0.5px] border-border bg-muted/70 text-ink-3 transition-colors hover:bg-muted-hover hover:text-ink"
              >
                <Bot className="h-4 w-4" strokeWidth={1.5} />
              </button>
            )}
          </div>
        ) : null}
        </div>
      </div>

      <EditorShortcutsDialog
        open={isShortcutHelpOpen}
        onOpenChange={setIsShortcutHelpOpen}
      />

      {correctionToast ? (
        <div
          className="fixed bottom-12 left-1/2 z-50 -translate-x-1/2 rounded-[8px] border-[0.5px] border-border bg-sb px-3 py-2 text-[11px] text-ink-3 shadow-float-md"
          role="status"
          aria-live="polite"
        >
          {correctionToast.message ?? (correctionToast.phase === "complete"
            ? "Review complete"
            : correctionToast.phase === "error"
              ? "Corrections are temporarily unavailable"
              : correctionToast.completed === 0
                ? "Revisando documento..."
                : `${correctionToast.completed} de ${correctionToast.total} bloques revisados`)}
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

      <BackupImageModal
        open={localImageBackup !== null}
        source={localImageBackup?.source ?? null}
        uploading={localImageBackupUploading}
        error={localImageBackupError}
        onOpenChange={(open) => {
          if (!open) {
            setLocalImageBackup(null)
            setLocalImageBackupError(null)
          }
        }}
        onConfirm={() => void handleBackupLocalImage()}
      />

      <ImagePresentationViewer
        open={imageViewerSource !== null}
        editor={editor}
        initialSource={imageViewerSource}
        resolveImage={resolveImage}
        onOpenChange={(open) => {
          if (!open) {
            setImageViewerSource(null)
            const scroll = imageViewerScrollRef.current
            if (scroll) {
              window.requestAnimationFrame(() => {
                const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
                editorViewport?.scrollTo(scroll.left, scroll.top)
              })
            }
          }
        }}
      />

      <SelectionPopup
        position={pendingRichSelection?.popupPosition ?? null}
        onSelectType={handleEditorSelectType}
        onDismiss={dismissSelectionPopup}
      />

      <AnnotationBubble
        position={pendingAnnotation?.position ?? null}
        sessionId={pendingAnnotation?.sessionId ?? null}
        type={pendingAnnotation?.annotationType ?? "personal"}
        onConfirm={handleConfirmAnnotation}
        onCancel={() => setPendingAnnotation(null)}
      />
    </section>
  )
}
