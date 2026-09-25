"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getMarkRange, type JSONContent } from "@tiptap/core"
import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { generateHTML } from "@tiptap/html"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
import { TextSelection } from "@tiptap/pm/state"
import { useRouter } from "next/navigation"
import {
  activationHydrates,
  useDocumentHydration,
  type ActivationReason,
  type DocumentMetadataPatch,
  type HydrationPhase,
} from "@/hooks/useDocumentHydration"
import { useCorrectionActions, type CorrectionToastState } from "@/hooks/useCorrectionActions"
import { useCorrectionBlocks } from "@/hooks/useCorrectionBlocks"
import { useCorrectionLifecycle } from "@/hooks/useCorrectionLifecycle"
import { useSessionRestore } from "@/hooks/useSessionRestore"
import { useWorkspaceTabOpening } from "@/hooks/useWorkspaceTabOpening"
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs"
import {
  mapLocalSyncStatusToSaveState,
  mapSyncLifecycleToSaveState,
  type EditorSaveState,
} from "@/components/editor/save-state"
import { Button } from "@/components/ui/button"
import { WritingEditorContent } from "@/components/editor/editor-content"
import { ImagePresentationViewer } from "@/components/editor/image-presentation-viewer"
import { EditorEmptyState } from "@/components/editor/editor-empty-state"
import { EditorFindReplace } from "@/components/editor/editor-find-replace"
import { EditorSheetHeader } from "@/components/editor/editor-sheet-header"
import { EditorShortcutsDialog } from "@/components/editor/editor-shortcuts-dialog"
import { EditorStatusBar } from "@/components/editor/status-bar"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { EditorRightPanel } from "@/components/editor/editor-right-panel"
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
import {
  type CorrectionTriggerBlock,
} from "@/lib/editor/correction-trigger-plugin"
import {
  getVisibleCorrectionSuggestions,
  replaceBlockSuggestions,
} from "@/lib/editor/suggestion-engine"
import {
  CORRECTION_STALE_TIMEOUT_MS,
  dropExpiredStaleSuggestions,
  dropStaleSuggestionsForBlock,
  restorePendingSuggestions,
  type DeferredCorrectionBlocksState,
} from "@/lib/corrections/engine/lifecycle"
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
import {
  deleteLocalCorrectionBlocks,
  readLocalCorrectionBlocks,
} from "@/lib/corrections/persistence"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type {
  ArtifactType,
  LocalCorrectionBlock,
  PublicationSuggestion,
  WritingLifecycle,
  WritingStatus,
  WritingVisibility,
} from "@/lib/local-db/schema"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
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
import { computeHasPendingLocalEdit, resolveExternalContentChange } from "@/lib/editor/external-change-policy"
import type { CatalogChange } from "@/lib/services/contracts/document-catalog"
import {
  describeOpenOutcome,
  isUnifiedOpenEnabled,
  openDocumentByPath,
} from "@/lib/services/open-document-factory"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { useTauriMenuEvents } from "@/hooks/useTauriMenuEvents"
import { useTauriCloseGuard } from "@/hooks/useTauriCloseGuard"
import { useTauriEditorMenuEvents } from "@/hooks/useTauriEditorMenuEvents"
import type { WritingRecord } from "@/lib/services/contracts/document-service"
import { createHydrationGenerationOwner } from "@/lib/editor/hydration-generation"
import {
  createPersistenceCoordinator,
  type PersistenceCommitEvent,
  type PersistenceSnapshotOverrides,
  type PersistenceStateEvent,
} from "@/lib/editor/persistence-coordinator"
import {
  initializeEditorSessionStore,
  openWritingTab,
  publishTabState,
  reconcileMaterializedDraftTab,
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


type ExternalFileNotice =
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
type ExternalContentConflict = {
  externalContentHash: string
  path: string | null
}

// Lectura/borrado de la caché de bloques de corrección para la hidratación
// (ODE-562). Viven aquí, y no en el hook, a propósito: son deuda ya declarada
// de este archivo en architecture/boundaries.baseline.json, y moverlas a
// hooks/ la escondería en vez de pagarla. Pagarla es el corte de correcciones.

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

/**
 * La única salida de la shell hacia el router de Next para ir a un documento
 * (ODE-569). Una NAVEGACIÓN, no una proyección: la proyección de la URL del
 * documento activo es `activateDocument({ href })`.
 *
 * Conserva las dos excepciones que tenían los sitios sueltos:
 * - en el perf harness se proyecta en vez de navegar (ODE-389);
 * - `skipOnDesktop`: en el bundle estático la ruta ya no cambia de página, así
 *   que esos sitios no navegan en desktop.
 */
function navigateToWriting(
  router: Pick<ReturnType<typeof useRouter>, "push" | "replace">,
  href: string,
  { mode, skipOnDesktop }: { mode: "push" | "replace"; skipOnDesktop: boolean },
) {
  if (isPerfHarness()) {
    replaceEditorHistory(href)
    return
  }
  if (skipOnDesktop && isDesktopRuntime()) {
    return
  }
  router[mode](href)
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
  // Fase de hidratación del documento activo (ADR documento activo, Fase 4 —
  // ODE-570). Lo que se carga es siempre el documento activo; la fase solo dice
  // si su contenido ya está en el editor. Solo `activateDocument` la pone en
  // "loading"; la hidratación la devuelve a "ready" al terminar o fallar.
  // Una por cada llamada a `activateDocument` (ODE-572): el efecto de
  // hidratación la usa para aplicar el estado "sin documento" una vez por
  // transición, no en cada re-ejecución.
  const [activationSeq, setActivationSeq] = useState(0)
  const [hydrationPhase, setHydrationPhase] = useState<HydrationPhase>(
    initialHydrationSession.hydrationWritingId ? "loading" : "ready",
  )
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
  const [externalContentConflict, setExternalContentConflict] = useState<ExternalContentConflict | null>(null)
  const externalContentConflictRef = useRef<ExternalContentConflict | null>(null)
  /** WATCH-07 — has this document's durable-content-hash baseline been seeded into the coordinator yet, for the currently watched writingId? */
  const hasSeededBaselineRef = useRef(false)
  /**
   * WATCH-07 — true from the moment the editor's content genuinely diverges
   * from the last known durable baseline (set in TipTap's own `onUpdate`,
   * and the markdown-mode equivalents, on every real edit — never on a
   * programmatic setContent, which is already guarded by
   * isApplyingContentRef) until `persistEditorSnapshot` actually hands that
   * content to `persistenceCoordinator.persist()`. `hasPending()` alone is
   * NOT sufficient here: the desktop debounce (150ms rich /
   * MARKDOWN_SAVE_DEBOUNCE_MS markdown) means there is a real window after a
   * keystroke where the editor holds an unconfirmed edit but no persist
   * request exists yet for the coordinator to report as pending. Cleared as
   * soon as persist() is actually called — hasPending() is authoritative
   * for durability from that point on, so this ref only needs to cover the
   * gap before that call, not duplicate the coordinator's own tracking.
   */
  const hasUnconfirmedLocalEditRef = useRef(false)
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

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const hasExplicitTitleRef = useRef(hasExplicitTitle)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const statusRef = useRef<WritingStatus>(writingStatus)
  const artifactTypeRef = useRef<ArtifactType>(artifactType)
  const visibilityRef = useRef<WritingVisibility>(writingVisibility)
  /**
   * Único dueño de los metadatos del documento (ODE-563).
   *
   * Cada metadato vive dos veces: en estado (para renderizar) y en un ref
   * (lo que lee `persistEditorSnapshot` desde callbacks de larga vida).
   * Antes, un efecto espejo copiaba el estado al ref DESPUÉS del commit y
   * además varios caminos escribían el ref a mano; entre medias, el ref
   * podía llevar el valor del documento anterior. Aquí se escriben los dos
   * en el mismo paso, y es la única forma permitida de cambiarlos.
   *
   * `slug` no tiene ref: nadie lo leía (solo se escribía).
   */
  const applyDocumentMetadata = useCallback((patch: DocumentMetadataPatch) => {
    if (patch.title !== undefined) {
      titleRef.current = patch.title
      setTitle(patch.title)
    }
    if (patch.hasExplicitTitle !== undefined) {
      hasExplicitTitleRef.current = patch.hasExplicitTitle
      setHasExplicitTitle(patch.hasExplicitTitle)
    }
    if (patch.version !== undefined) {
      versionRef.current = patch.version
      setVersion(patch.version)
    }
    if (patch.createdAt !== undefined) {
      createdAtRef.current = patch.createdAt
      setCreatedAt(patch.createdAt)
    }
    if (patch.slug !== undefined) {
      setWritingSlug(patch.slug)
    }
    if (patch.status !== undefined) {
      statusRef.current = patch.status
      setWritingStatus(patch.status)
    }
    if (patch.artifactType !== undefined) {
      artifactTypeRef.current = patch.artifactType
      setArtifactType(patch.artifactType)
    }
    if (patch.visibility !== undefined) {
      visibilityRef.current = patch.visibility
      setWritingVisibility(patch.visibility)
    }
    if (patch.lifecycle !== undefined) {
      lifecycleRef.current = patch.lifecycle
      setLifecycle(patch.lifecycle)
    }
  }, [])
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  // El guardado de markdown pendiente (ODE-573): se guarda junto al timer para
  // poder ejecutarlo al desmontar en vez de perderlo.
  const pendingMarkdownSaveRef = useRef<(() => void) | null>(null)
  const scheduleMarkdownSave = useCallback((run: () => void) => {
    pendingMarkdownSaveRef.current = run
    return window.setTimeout(() => {
      pendingMarkdownSaveRef.current = null
      run()
    }, MARKDOWN_SAVE_DEBOUNCE_MS)
  }, [])
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
  }, [])
  const isApplyingContentRef = useRef(false)
  const currentWritingIdRef = useRef<string | null>(initialHydrationSession.activeWritingId)
  const activeEditorTabIdRef = useRef<string | null>(editorSession.active_tab_id)
  /**
   * Único dueño de la identidad del documento activo (ODE-564).
   *
   * El ref es lo que leen los callbacks de larga vida (guardado, imágenes,
   * correcciones); el estado es lo que re-renderiza y dispara efectos. Antes,
   * además de las escrituras imperativas, un efecto espejo copiaba el estado
   * al ref tras cada commit, y un espejo pendiente podía devolver el ref al
   * documento anterior después de que un handler ya había escrito el nuevo.
   * Aquí se escriben los dos en el mismo paso, y es la única forma de
   * cambiarlos.
   */
  const setActiveWritingId = useCallback((writingId: string | null) => {
    currentWritingIdRef.current = writingId
    setCurrentWritingId(writingId)
  }, [])
  /**
   * Único punto de entrada de toda transición del documento activo (ADR
   * `odessay-adr-documento-activo.md`, Fase 1 — ODE-567).
   *
   * Escribe la identidad de la instancia, la fase de hidratación y la
   * proyección de la ruta, en ese orden. El store se escribe en la misma
   * transición, al lado de esta llamada (ADR, enmienda de ODE-568).
   *
   * - Hidratación (Fase 4, ODE-570): la decide el motivo, no el handler. Ver
   *   `activationHydrates`.
   * - `href`: proyección de la ruta con `replaceEditorHistory`; omitido = la
   *   transición no toca la URL (o la toca con otro mecanismo, declarado en
   *   su sitio).
   */
  const activateDocument = useCallback(
    (
      target: { writingId: string | null; href?: string },
      reason: ActivationReason,
    ) => {
      setActiveWritingId(target.writingId)
      setHydrationPhase(activationHydrates(target.writingId, reason) ? "loading" : "ready")
      setActivationSeq((current) => current + 1)
      if (target.href !== undefined) {
        replaceEditorHistory(target.href)
      }
    },
    [setActiveWritingId],
  )
  const hydrationGenerationOwnerRef = useRef<ReturnType<typeof createHydrationGenerationOwner> | null>(null)
  if (hydrationGenerationOwnerRef.current === null) {
    hydrationGenerationOwnerRef.current = createHydrationGenerationOwner()
  }
  const currentCanonicalPathRef = useRef<string | null>(null)
  const focusModeRestorationRef = useRef<{
    activePanel: EditorPanel
    isFindReplaceOpen: boolean
  } | null>(null)

  const enterFocusMode = useCallback(() => {
    if (isFocusMode) {
      return
    }

    focusModeRestorationRef.current = { activePanel, isFindReplaceOpen }

    setActivePanel(null)
    setIsFindReplaceOpen(false)
    setIsFocusMode(true)
  }, [activePanel, isFindReplaceOpen, isFocusMode])

  const exitFocusMode = useCallback(() => {
    if (!isFocusMode) {
      return
    }

    const stateToRestore = focusModeRestorationRef.current
    focusModeRestorationRef.current = null
    if (stateToRestore) {
      setActivePanel(stateToRestore.activePanel)
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
  const richUpdateDebounceRef = useRef<number | null>(null)
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
    // Cross-document-leak guard (ODE-555 follow-up): this queue is shared by
    // every caller (typing, hydration, ...), and its deferred rAF has no
    // built-in notion of "which document this was for" — without a guard, a
    // hydration restore queued for A that hasn't fired yet would apply to
    // whatever document/DOM is current by the time the frame runs, even a
    // different one the user already switched to. Callers that care (only
    // hydration does today) pass `isStillValid`; callers that don't (plain
    // typing, always operating on the currently-active document) omit it and
    // get the prior, unguarded behavior.
    isStillValid?: () => boolean
    onSettled?: () => void
  } | null>(null)
  const suppressNextSelectionPopupRef = useRef(false)
  const currentDocumentMarkdownRef = useRef("")
  const automaticCorrectionSuggestionsRef = useRef<PublicationSuggestion[]>([])
  const learnedWordsRef = useRef<LearnedWordEntry[]>([])
  const learnedWordsLoadedRef = useRef(false)
  const persistedCorrectionBlocksRef = useRef(new Map<string, LocalCorrectionBlock>())
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

          if (!routeWritingIdRef.current && !navigatedToDraftRef.current) {
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
    [activateDocument, applyDocumentMetadata, createDesktopDraftFn],
  )

  useEffect(() => {
    persistenceCoordinator.activateDocument(currentWritingId)
  }, [currentWritingId, persistenceCoordinator])

  // Lo que la shell tenga en cola hacia el coordinador al desmontarse: la
  // edición rich en su debounce de desktop (150 ms) y el guardado de markdown
  // (800 ms). Lo asigna un efecto más abajo,
  // donde vive la función; se lee aquí, al cerrar el coordinador.
  const flushPendingEditOnUnmountRef = useRef<(() => void) | null>(null)

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
    [persistenceCoordinator],
  )

  /**
   * Al cambiar de documento se descarta el trabajo de correcciones pendiente
   * del anterior. Tras ODE-558 solo queda el flush diferido de bloques
   * suprimidos y el toast: la cola automatica, sus timers, reintentos y
   * circuit breaker eran inalcanzables y se eliminaron.
   */
  const resetCorrectionQueueState = useCallback(() => {
    if (suppressedCorrectionFlushTimerRef.current !== null) {
      window.clearTimeout(suppressedCorrectionFlushTimerRef.current)
      suppressedCorrectionFlushTimerRef.current = null
    }

    deferredSuppressedCorrectionBlocksRef.current = {
      blocksById: new Map(),
      flushAt: null,
    }
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
  // ODE-586: estado de sugerencias, admisión y caché de bloques de corrección.
  // Mudanza mecánica; el estado y los refs siguen siendo de la shell.
  const {
    correctionSuggestionBatcher,
    applyCorrectionSuggestionUpdate,
    setPersistedCorrectionBlocks,
    flattenPersistedSuggestions,
    createCorrectionAdmissionContext,
    admitCorrectionSuggestions,
    persistCorrectionBlockWriteThrough,
    updatePersistedBlocksFromSuggestions,
    deletePersistedBlocksForPosition,
    flushPendingCorrectionBlocks,
  } = useCorrectionBlocks({
    setAutomaticCorrectionSuggestions,
    editorInstanceRef,
    learnedWordsRef,
    persistedCorrectionBlocksRef,
  })

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
            ? titleRef.current.trim() || UNTITLED_WRITING_TITLE
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
      // Clear the "unconfirmed edit" flag now, synchronously, in the same
      // tick as the call below — persist() registers this request with the
      // coordinator's own pending/in-flight tracking synchronously too, so
      // there is no window where neither signal reports the edit as unsaved.
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
  }, [runRichModeUpdateSideEffects])

  useEffect(() => {
    flushPendingEditOnUnmountRef.current = () => {
      flushQueuedRichModeUpdate()
      flushPendingMarkdownSave()
    }
  }, [flushPendingMarkdownSave, flushQueuedRichModeUpdate])

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
  }, [flushQueuedRichModeUpdate])

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
        isStillValid?: () => boolean
        onSettled?: () => void
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

        // Checked at fire time, not schedule time: the document this
        // restore was queued for may no longer be current by the time this
        // frame actually runs (see the ref's own comment above).
        if (pendingSelection.isStillValid && !pendingSelection.isStillValid()) {
          pendingSelection.onSettled?.()
          return
        }

        const nextTextarea = markdownTextareaRef.current

        if (!nextTextarea) {
          pendingSelection.onSettled?.()
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

        // Each scroll target re-applies itself a second frame later (layout
        // can still settle after the first write) — that second write is
        // the true "last write wins" moment, so it needs the same validity
        // re-check (time has passed since the outer frame ran) and is what
        // onSettled must actually wait for, not the outer frame itself.
        let pendingNestedFrames = 0
        const scheduleNestedApply = (apply: () => void) => {
          pendingNestedFrames += 1
          window.requestAnimationFrame(() => {
            if (!pendingSelection.isStillValid || pendingSelection.isStillValid()) {
              apply()
            }
            pendingNestedFrames -= 1
            if (pendingNestedFrames === 0) {
              pendingSelection.onSettled?.()
            }
          })
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
          scheduleNestedApply(applyViewportScroll)
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
          scheduleNestedApply(applyShellScroll)
        }

        if (typeof pendingSelection.windowScrollX === "number" || typeof pendingSelection.windowScrollY === "number") {
          const applyWindowScroll = () => {
            window.scrollTo(
              typeof pendingSelection.windowScrollX === "number" ? pendingSelection.windowScrollX : window.scrollX,
              typeof pendingSelection.windowScrollY === "number" ? pendingSelection.windowScrollY : window.scrollY,
            )
          }

          applyWindowScroll()
          scheduleNestedApply(applyWindowScroll)
        }

        markdownSelectionRef.current = {
          start: pendingSelection.start,
          end: pendingSelection.end,
          text: nextTextarea.value.slice(pendingSelection.start, pendingSelection.end),
        }

        // No scroll target was scheduled (a plain selection-only restore) —
        // this frame's write was the last one, so settle now.
        if (pendingNestedFrames === 0) {
          pendingSelection.onSettled?.()
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
    },
    [editorExtensions, scheduleQueuedRichModeUpdate],
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

  /**
   * Protocolo de salida del documento activo (ADR documento activo, Hecho 4;
   * Fase 1 — ODE-567). Antes estaba copiado en cada handler de transición.
   *
   * Los tres pasos son explícitos porque hoy NO todas las transiciones hacen
   * los mismos, y la Fase 1 es una mudanza, no un cambio de comportamiento:
   * cada sitio declara lo que ya hacía. Uniformizarlos es una decisión aparte.
   * Va separado de `activateDocument` porque algunas transiciones (cerrar,
   * abrir) salen ANTES de un `await` y activan DESPUÉS.
   */
  const prepareDocumentExit = useCallback(
    (steps: { flushPendingEdit: boolean; snapshotDraft: boolean; saveViewState: boolean }) => {
      // La edición en cola todavía apunta al editor del documento saliente:
      // volcarla antes de que cambie la identidad (ODE-478 caso 2).
      if (steps.flushPendingEdit) {
        flushQueuedRichModeUpdate()
      }
      if (steps.snapshotDraft) {
        snapshotOutgoingDraftContent()
      }
      if (steps.saveViewState) {
        persistCurrentWorkspaceViewState()
      }
    },
    [flushQueuedRichModeUpdate, persistCurrentWorkspaceViewState, snapshotOutgoingDraftContent],
  )

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
    if (!isDesktopRuntime() || hydrationPhase !== "ready" || !currentWritingId) {
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
      applyDocumentMetadata({
        title: catalogTitle,
        hasExplicitTitle: catalogTitle !== UNTITLED_WRITING_TITLE,
      })
    }

    applyCatalogTitle()
    window.addEventListener(CATALOG_TITLE_CHANGE_EVENT, applyCatalogTitle)
    return () => window.removeEventListener(CATALOG_TITLE_CHANGE_EVENT, applyCatalogTitle)
  }, [applyDocumentMetadata, currentWritingId, hydrationPhase])

  useEffect(() => {
    const nextExternalLoad = resolveExternalWritingLoad(currentWritingIdRef.current, routeWritingId)

    if (!nextExternalLoad) {
      return
    }

    activateDocument(
      { writingId: nextExternalLoad.activeWritingId },
      "route",
    )
    navigatedToDraftRef.current = false
  }, [activateDocument, routeWritingId])

  useEffect(() => {
    activeEditorTabIdRef.current = editorSession.active_tab_id
  }, [editorSession.active_tab_id])

  useEffect(() => {
    setImageViewerSource(null)
  }, [currentWritingId])

  // ODE-587: entrada a la sesión (mudanza mecánica; mismos efectos, en el
  // mismo orden y en esta posición).
  useSessionRestore({
    activateDocument,
    applyDocumentMetadata,
    createDesktopDraftFn,
    currentWritingIdRef,
    deriveAutoTitle,
    desktopSessionRestoreTimingRef,
    desktopUntitledWritingTitle: DESKTOP_UNTITLED_WRITING_TITLE,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    identityEnsuredRef,
    isPerfHarness,
    navigatedToDraftRef,
    navigateToWriting,
    routeWritingId,
    router,
    sessionLoaded,
    setBodyText,
    setSyncStatus,
  })

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

        const syncCurrentWritingState = async (reason?: CatalogChange["reason"]) => {
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
            setExternalFileNotice(null)
            return
          }

          const decision = resolveExternalContentChange({
            baselineContentHash: persistenceCoordinator.getDurableContentHash(currentWritingId),
            currentContentHash: nextContentHash,
            hasPendingLocalEdit: computeHasPendingLocalEdit({
              hasUnconfirmedLocalEdit: hasUnconfirmedLocalEditRef.current,
              hasPendingPersistence: persistenceCoordinator.hasPending({ writingId: currentWritingId }),
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
            updateDerivedEditorState(liveEditor)
            persistenceCoordinator.setDurableContentHash(currentWritingId, nextContentHash)
            setExternalFileNotice({ kind: "content-changed", path: nextCanonicalPath })
          } catch {
            // Leave the stale content open and the previous notice in place;
            // the next catalog event or focus retries the reload.
          }
        }

        void syncCurrentWritingState()
        unsubscribeCatalog = subscribeToCatalog((change) => {
          if (change.documentIds.includes(currentWritingId)) {
            void syncCurrentWritingState(change.reason)
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
  }, [currentWritingId, persistenceCoordinator, updateDerivedEditorState])

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

  // Hidratación del documento activo (ODE-562: movida tal cual a un hook).
  // Se llama AQUÍ, en la posición que ocupaba el efecto: React ejecuta los
  // efectos en orden de declaración y moverla alteraría su orden respecto a
  // los espejos de refs y a la publicación de pestaña.
  useDocumentHydration({
    editor,
    currentWritingId,
    hydrationPhase,
    activationSeq,
    routeWritingId,
    editorSession,
    modeRef,
    isApplyingContentRef,
    hydrationGenerationOwnerRef,
    currentCanonicalPathRef,
    desktopSessionRestoreTimingRef,
    ephemeralDraftWritingIdRef,
    draftContentSnapshotRef,
    suppressCorrectionAnalysisUntilRef,
    setHydrationPhase,
    setMode,
    setMarkdownValue,
    setBodyText,
    setSyncStatus,
    setIsBodyHydrating,
    activateDocument,
    applyDocumentMetadata,
    setExternalFileNotice,
    setCanonicalPath,
    updateDerivedEditorState,
    applyCorrectionSuggestionUpdate,
    flattenPersistedSuggestions,
    admitCorrectionSuggestions,
    flushPendingCorrectionBlocks,
    queueMarkdownSelectionRestore,
    setPersistedCorrectionBlocks,
    readLocalCorrectionBlocks,
    deleteLocalCorrectionBlocks,
    untitledWritingTitle: UNTITLED_WRITING_TITLE,
    isExplicitWritingTitle,
  })

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

        applyDocumentMetadata({ slug: localWriting.slug })
        navigateToWriting(router, `/write/${localWriting.slug}`, { mode: "replace", skipOnDesktop: true })
      })()
    })
  }, [applyDocumentMetadata, currentWritingId, routeWritingId, router])

  useEffect(() => {
    return () => {
      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      if (richUpdateRafRef.current !== null) {
        window.cancelAnimationFrame(richUpdateRafRef.current)
      }

      if (richUpdateDebounceRef.current !== null) {
        window.clearTimeout(richUpdateDebounceRef.current)
      }

      if (markdownSelectionRafRef.current !== null) {
        window.cancelAnimationFrame(markdownSelectionRafRef.current)
      }

      // El timer del toast lo arma `showCorrectionToast` (useCorrectionActions)
      // en cualquier momento; hay que leer su valor al desmontar, no al montar.
      if (correctionToastDismissRef.current !== null) {
        // eslint-disable-next-line react-hooks/exhaustive-deps
        window.clearTimeout(correctionToastDismissRef.current)
      }

      richUpdateRafRef.current = null
      richUpdateDebounceRef.current = null
      richUpdateEditorRef.current = null
      markdownSelectionRafRef.current = null
      pendingMarkdownSelectionRef.current = null
      persistCurrentWorkspaceViewState()
    }
  }, [persistCurrentWorkspaceViewState])

  const applyMarkdownFromPanel = useCallback(
    (nextMarkdown: string) => {
      const normalizedMarkdown = normalizeMarkdownForRoundTrip(nextMarkdown)

      if (!editor) return false

      setMarkdownValue(normalizedMarkdown)
      // WATCH-07 — a real content mutation (from the AI panel), not a
      // programmatic re-sync; isApplyingContentRef only exists here to
      // suppress a duplicate onUpdate-triggered persist, not to mark this as
      // "nothing changed".
      hasUnconfirmedLocalEditRef.current = true
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

  // ODE-586: acciones sobre las sugerencias de corrección (mudanza mecánica).
  const {
    applyCorrectionSuggestions,
    handleAcceptCorrection,
    showCorrectionToast,
    handleRejectCorrection,
    handleLearnWord,
    handleRemoveLearnedWord,
    handleAcceptAllCorrections,
    handleRejectAllCorrections,
  } = useCorrectionActions({
    applyCorrectionSuggestionUpdate,
    applyMarkdownFromPanel,
    automaticCorrectionSuggestionsRef,
    correctionToastDismissRef,
    createCorrectionAdmissionContext,
    currentDocumentMarkdownRef,
    editor,
    isApplyingContentRef,
    learnedWordsRef,
    markdownSaveTimeoutRef,
    modeRef,
    persistEditorSnapshot,
    setCorrectionToast,
    setLearnedWords,
    suppressCorrectionAnalysisUntilRef,
    updateDerivedEditorState,
    updatePersistedBlocksFromSuggestions,
  })

  const closeActivePanel = useCallback(() => {
    setActivePanel(null)
  }, [])

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
        // WATCH-07 — see hasUnconfirmedLocalEditRef's own doc comment: real
        // edit, marked dirty immediately, before the debounce below.
        hasUnconfirmedLocalEditRef.current = true

        if (markdownSaveTimeoutRef.current) {
          window.clearTimeout(markdownSaveTimeoutRef.current)
        }

        setSyncStatus("saving")

        if (!editor) {
          return
        }

        markdownSaveTimeoutRef.current = scheduleMarkdownSave(() => {
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
        })
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
      scheduleMarkdownSave,
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
      // WATCH-07 — the markdown textarea's own onChange; see
      // hasUnconfirmedLocalEditRef's doc comment.
      hasUnconfirmedLocalEditRef.current = true

      if (!editor) {
        return
      }

      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }

      setSyncStatus("saving")

      markdownSaveTimeoutRef.current = scheduleMarkdownSave(() => {
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
      })
    },
    [editor, persistEditorSnapshot, scheduleMarkdownSave],
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
        hasUnconfirmedLocalEditRef.current = true

        if (markdownSaveTimeoutRef.current) {
          window.clearTimeout(markdownSaveTimeoutRef.current)
        }

        setSyncStatus("saving")

        if (editor) {
          markdownSaveTimeoutRef.current = scheduleMarkdownSave(() => {
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
          })
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
    [editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore, scheduleMarkdownSave],
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
      hasUnconfirmedLocalEditRef.current = true
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
      markdownSaveTimeoutRef.current = scheduleMarkdownSave(() => {
        if (modeRef.current !== "markdown") {
          markdownSaveTimeoutRef.current = null
          return
        }

        isApplyingContentRef.current = true
        editor.commands.setContent(materializeMarkdownForRichParser(nextMarkdown))
        isApplyingContentRef.current = false
        void persistEditorSnapshot(editor)
        markdownSaveTimeoutRef.current = null
      })
    },
    [mode, editor, markdownValue, persistEditorSnapshot, scheduleMarkdownSave],
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
        hasUnconfirmedLocalEditRef.current = true
        setSyncStatus("saving")

        if (editor) {
          if (markdownSaveTimeoutRef.current) {
            window.clearTimeout(markdownSaveTimeoutRef.current)
          }
          markdownSaveTimeoutRef.current = scheduleMarkdownSave(() => {
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
          })
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
    [editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore, scheduleMarkdownSave],
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

  // ODE-586: ciclo de vida de las correcciones (mudanza mecánica; mismos
  // efectos, en el mismo orden y en esta posición).
  const {
    correctionAnalysisRunState,
    correctionAnalysisProgress,
    startCorrectionAnalysis,
    retryFailedCorrectionPackages,
    cancelCorrectionAnalysis,
  } = useCorrectionLifecycle({
    admitCorrectionSuggestions,
    applyCorrectionSuggestionUpdate,
    applyCorrectionSuggestions,
    automaticCorrectionSuggestions,
    automaticCorrectionSuggestionsRef,
    createCorrectionAdmissionContext,
    currentDocumentMarkdownRef,
    currentWritingId,
    currentWritingIdRef,
    deferredSuppressedCorrectionBlocksRef,
    deletePersistedBlocksForPosition,
    editor,
    editorInstanceRef,
    flushPendingCorrectionBlocks,
    handleLearnWord,
    learnedWords,
    learnedWordsLoadedRef,
    learnedWordsRef,
    modeRef,
    persistCorrectionBlockWriteThrough,
    persistedCorrectionBlocksRef,
    setLearnedWords,
    setLearnedWordsLoading,
    showCorrectionToast,
    suppressCorrectionAnalysisUntilRef,
    suppressedCorrectionFlushTimerRef,
    titleRef,
    updatePersistedBlocksFromSuggestions,
  })
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
    // During + creation in desktop, the placeholder id never hydrates,
    // so this guard also blocks publishTabState from running with the stale displayTitle
    // and corrupting/replacing an existing tab.
    if (hydrationPhase !== "ready" || isCreatingWorkspaceTabRef.current) {
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
  }, [currentWritingId, displayTitle, hydrationPhase, routeWritingId, sessionLoaded, syncStatus, writingSlug])

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

  // ODE-587: pestañas del editor (mudanza mecánica; mismos efectos y orden).
  const {
    handleSelectWorkspaceTab,
    handleCloseWorkspaceTab,
    handleCloseOtherWorkspaceTabs,
    handleCloseAllWorkspaceTabs,
    handleRevealWorkspaceTab,
    handleRenameWorkspaceTab,
    handleRenameActiveWriting,
    handleReorderWorkspaceTab,
    tabStatuses,
  } = useWorkspaceTabs({
    activateDocument,
    activeEditorTabIdRef,
    editor,
    editorSession,
    ephemeralDraftWritingIdRef,
    materializedDraftIdsRef,
    navigatedToDraftRef,
    persistenceCoordinator,
    prepareDocumentExit,
    setRenameModalOpen,
    setRenameModalSnapshot,
    titleRef,
    untitledWritingTitle: UNTITLED_WRITING_TITLE,
    writingStatus,
  })


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
          applyDocumentMetadata({
            title: nextTitle,
            hasExplicitTitle: nextTitle !== DESKTOP_UNTITLED_WRITING_TITLE,
          })
          return persistEditorSnapshot(editor, { title: nextTitle }, { awaitDurability: true })
        }

        const result = await (await getDocumentService()).renameWriting({
          writingId,
          title: nextTitle,
          updatedAt: new Date().toISOString(),
        })
        if (result.error || !result.data) return false

        applyDocumentMetadata({
          title: result.data.title ?? nextTitle,
          hasExplicitTitle: (result.data.title ?? nextTitle) !== UNTITLED_WRITING_TITLE,
        })
        return true
      }

      applyDocumentMetadata({
        title: nextTitle,
        hasExplicitTitle: nextTitle !== UNTITLED_WRITING_TITLE,
      })

      if (editor) {
        return persistEditorSnapshot(editor, { title: nextTitle }, { awaitDurability: true })
      }
      return true
    },
    [applyDocumentMetadata, editor, persistEditorSnapshot],
  )

  // ODE-587: abrir documentos en pestañas (mudanza mecánica; mismo orden).
  const {
    handleCreateWorkspaceTab,
    handleOpenWorkspaceDocument,
  } = useWorkspaceTabOpening({
    activateDocument,
    activeEditorTabIdRef,
    createWorkspaceTabRef,
    createWritingId,
    currentWritingId,
    currentWritingIdRef,
    deriveAutoTitle,
    editor,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    forceNewWritingRequestedRef,
    handleSelectWorkspaceTab,
    isApplyingContentRef,
    isCreatingWorkspaceTabRef,
    navigatedToDraftRef,
    persistenceCoordinator,
    prepareDocumentExit,
    selectAdjacentTabRef,
    sessionLoaded,
    untitledWritingTitle: UNTITLED_WRITING_TITLE,
    updateDerivedEditorState,
  })

  const handleMenuOpenFile = useCallback(
    async (_path: string, content: string) => {
      // Same reasoning as the other document-switching handlers: the OS
      // "Open File" menu also detaches from whatever is currently active
      // (ODE-478 follow-up).
      prepareDocumentExit({ flushPendingEdit: true, snapshotDraft: true, saveViewState: true })

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
        activateDocument({ writingId: openedId }, "open")
        const openedTitle = result.record.title ?? filenameToTitle(_path)
        applyDocumentMetadata({ title: openedTitle })
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
          activateDocument({ writingId: result.data.id }, "open")
          applyDocumentMetadata({ title: result.data.title ?? nextTitle })
        } else {
          await (await getDocumentService()).saveWriting({ writing: record })
        }
      } catch {
        return
      }

      const openedWritingId = currentWritingIdRef.current ?? nextWritingId
      activateDocument({ writingId: openedWritingId }, "open")
      openWritingTab({
        writingId: openedWritingId,
        title: isDesktopRuntime() ? titleRef.current || nextTitle : nextTitle,
        saveState: "saved-local",
        hasPendingSync: false,
      })
      navigateToWriting(router, `/write/${nextWritingId}`, { mode: "push", skipOnDesktop: true })
    },
    [activateDocument, applyDocumentMetadata, prepareDocumentExit, router],
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
    applyDocumentMetadata({
      title: filenameTitle,
      hasExplicitTitle: filenameTitle !== DESKTOP_UNTITLED_WRITING_TITLE,
    })
    currentCanonicalPathRef.current = result.path
    setCanonicalPath(result.path)
    setExternalFileNotice(null)
    return result.path
  }, [applyDocumentMetadata, editor, persistEditorSnapshot])

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
        return false
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
          hasOpenPanel: activePanel !== null,
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
      data-hydration-phase={hydrationPhase}
      data-focus-mode={isFocusMode ? "true" : "false"}
      className="h-screen overflow-hidden bg-bg"
    >
      <div className="EditorLayout hidden h-full min-h-0 flex-col md:flex">
        {!isFocusMode && isTopbarVisible ? (
          <EditorTopbar
            isFocusMode={isFocusMode}
            activePanel={activePanel}
            tabs={editorSession.tabs}
            tabStatuses={tabStatuses}
            activeTabId={editorSession.active_tab_id}
            onSelectTab={handleSelectWorkspaceTab}
            onCloseTab={handleCloseWorkspaceTab}
            onCloseOtherTabs={handleCloseOtherWorkspaceTabs}
            onCloseAllTabs={handleCloseAllWorkspaceTabs}
            onRevealTab={isDesktopRuntime() ? handleRevealWorkspaceTab : undefined}
            onRenameTab={handleRenameWorkspaceTab}
            onReorderTab={handleReorderWorkspaceTab}
            onNewTab={handleCreateWorkspaceTab}
            onToggleFocusMode={toggleFocusMode}
            onTogglePanel={(panel) => {
              setActivePanel((current) => (current === panel ? null : panel))
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
            ) : externalFileNotice.kind === "content-changed" ? (
              <span>Updated externally — the editor reloaded the latest version from disk.</span>
            ) : (
              <span>
                This file was removed outside Artifact Studio. Your current content stays open here, but the
                source file is no longer on disk.
              </span>
            )}
          </div>
        ) : null}

        {!isFocusMode && externalContentConflict ? (
          <div className="flex items-center justify-between gap-4 border-b-[0.5px] border-border bg-amber-50 px-6 py-3 text-sm text-ink dark:bg-amber-950/30">
            <span>
              This file changed outside Artifact Studio while you had unsaved edits here. Choose which version to
              keep — saving is paused until you do.
            </span>
            <div className="flex shrink-0 gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => {
                  void (async () => {
                    const writingId = currentWritingIdRef.current
                    if (!writingId || !editor) return
                    const opened = await (await getDocumentService()).openWriting(writingId)
                    if (!opened.data) return
                    isApplyingContentRef.current = true
                    editor.commands.setContent(opened.data.content.richText ?? EMPTY_EDITOR_JSON)
                    isApplyingContentRef.current = false
                    updateDerivedEditorState(editor)
                    persistenceCoordinator.setDurableContentHash(writingId, externalContentConflict.externalContentHash)
                    externalContentConflictRef.current = null
                    setExternalContentConflict(null)
                    setExternalFileNotice({ kind: "content-changed", path: externalContentConflict.path })
                  })()
                }}
              >
                Reload external
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={() => {
                  const writingId = currentWritingIdRef.current
                  if (!editor || !writingId) return
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
                }}
              >
                Keep my version
              </Button>
            </div>
          </div>
        ) : null}

        <div
          data-testid="editor-band"
          className={cn(
            "EditorBand flex min-h-0 flex-1",
            isFocusMode ? "gap-0 px-0 pb-0 pt-[46px]" : "gap-1.5 pb-1 pr-2.5 pt-1.5",
          )}
        >
          <div className="relative flex min-w-0 flex-1 flex-col gap-1">
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
                      "EditorSheet relative mb-[5px] flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-sb",
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
                  </div>
                </div>
              </>
            )}
          </div>

        {!isFocusMode && activePanel && editorSession.tabs.length > 0 ? (
          <EditorRightPanel>
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

                  applyDocumentMetadata({ status: nextStatus })
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

                  applyDocumentMetadata({ artifactType: nextArtifactType })
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

                  applyDocumentMetadata({ visibility: nextVisibility })
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
          </EditorRightPanel>
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
