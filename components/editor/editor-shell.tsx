"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type SetStateAction } from "react"
import { getMarkRange } from "@tiptap/core"
import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
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
import {
  useEditorCommands,
  type PendingAnnotationSnapshot,
  type PendingRichSelectionSnapshot,
} from "@/hooks/useEditorCommands"
import { useEditorPersistence } from "@/hooks/useEditorPersistence"
import {
  useExternalDocumentChanges,
  type ExternalContentConflict,
  type ExternalFileNotice,
} from "@/hooks/useExternalDocumentChanges"
import { type EditorCursorSnapshot, useFindReplace } from "@/hooks/useFindReplace"
import { type FocusModeRestoration, useFocusMode } from "@/hooks/useFocusMode"
import { useSessionRestore } from "@/hooks/useSessionRestore"
import { useTableOfContents } from "@/hooks/useTableOfContents"
import { useWorkspaceTabOpening } from "@/hooks/useWorkspaceTabOpening"
import { useWorkspaceTabs } from "@/hooks/useWorkspaceTabs"
import {
  formatSaveStateDiagnostic,
  mapSyncLifecycleToSaveState,
  reconcileSaveStateFromDurable,
  saveStateToHasPendingSync,
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
import { AnnotationBubble, nextAnnotationSessionId } from "@/components/reading/margins/annotation-bubble"
import { SelectionPopup } from "@/components/reading/margins/selection-popup"
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
import { getEditorShortcutAction } from "@/lib/editor/shortcuts"
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
  getEditorSessionState,
  initializeEditorSessionStore,
  openWritingTab,
  publishTabState,
  saveTabViewState,
  updateTabSaveState,
  useEditorSessionStore,
} from "@/lib/stores/editor-session-store"
import { setSidebarMode } from "@/lib/stores/ui-shell-store"
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

type OwnedMarkdownSelectionSnapshot = MarkdownSelectionSnapshot & {
  writingId: string
}

type MarkdownSelectionRead = {
  selection: MarkdownSelectionSnapshot | null
  belongsToOtherDocument: boolean
}

const markdownSelectionOwnerId = (writingId: string | null) => writingId ?? EDITOR_DRAFT_TAB_ID

function readMarkdownSelectionForActiveDocument(
  cached: OwnedMarkdownSelectionSnapshot | null,
  activeWritingId: string | null,
  source?: string,
): MarkdownSelectionRead {
  const ownerId = markdownSelectionOwnerId(activeWritingId)
  if (!cached || cached.writingId === ownerId) {
    return { selection: cached, belongsToOtherDocument: false }
  }

  // A cached selection belongs to a different document. Use the active tab's
  // own saved selection while its deferred restore is pending; never fall back
  // to the shared textarea's selection, which can still hold the prior tab's
  // range.
  const viewState = getEditorSessionState().session.tabs.find((tab) => tab.id === ownerId)?.view_state
  const start = viewState?.markdownSelectionStart
  const end = viewState?.markdownSelectionEnd
  if (typeof start === "number" && typeof end === "number") {
    return {
      selection: { start, end, text: source?.slice(start, end) ?? "" },
      belongsToOtherDocument: true,
    }
  }

  return { selection: null, belongsToOtherDocument: true }
}

type EditorPanel = "notes" | "properties" | "grammar" | "share" | null

type RenameWritingSnapshot = {
  title: string
  bodyText: string
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

// ODE-605: el debounce durable vive con su único consumidor, el hook de
// persistencia; se re-exporta aquí porque los tests de la shell lo importan
// desde este módulo.
export { DESKTOP_PERSISTENCE_DEBOUNCE_MS } from "@/hooks/useEditorPersistence"

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
  // ODE-624: espejo de la fase para los callbacks de larga vida. Se escribe
  // junto al estado en `applyHydrationPhase` (mismo patrón que
  // `setActiveWritingId`/`applySyncStatus`), no en un efecto espejo: el
  // cleanup de unmount lee la fase vigente, y una escritura de fase en el
  // mismo tick que una salida no puede quedar por detrás.
  const hydrationPhaseRef = useRef<HydrationPhase>(
    initialHydrationSession.hydrationWritingId ? "loading" : "ready",
  )
  /**
   * Único escritor de la fase de hidratación: estado y ref en el mismo paso.
   * Los callbacks de larga vida — `persistCurrentWorkspaceViewState`, y el
   * cleanup de unmount que lo llama — no pueden depender de `hydrationPhase`
   * sin recrearse en cada transición (eso volvería a correr el cleanup, que
   * guarda la vista, en cada cambio de fase); leen el ref.
   */
  const applyHydrationPhase = useCallback((next: SetStateAction<HydrationPhase>) => {
    const resolved = typeof next === "function" ? next(hydrationPhaseRef.current) : next
    hydrationPhaseRef.current = resolved
    setHydrationPhase(resolved)
  }, [])
  const [title, setTitle] = useState(UNTITLED_WRITING_TITLE)
  const [hasExplicitTitle, setHasExplicitTitle] = useState(false)
  const [mode, setMode] = useState<"rich" | "markdown">("rich")
  const [markdownValue, setMarkdownValue] = useState("")

  const [bodyText, setBodyText] = useState("")
  const [markdownSelectionState, setMarkdownSelectionState] = useState<MarkdownSelectionSnapshot | null>(null)
  const [syncStatus, setSyncStatus] = useState<EditorSaveState>("saved")
  // ODE-542: único escritor del estado de guardado. El ref lo lee la
  // reconciliación contra el catálogo durable, que puede correr en el mismo
  // bloque síncrono que una escritura: estado y ref se escriben a la vez para
  // que nunca lea un `current` rancio.
  const syncStatusRef = useRef<EditorSaveState>("saved")
  const applySyncStatus = useCallback((next: EditorSaveState) => {
    syncStatusRef.current = next
    setSyncStatus(next)
  }, [])
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
   * WATCH-07 — true only between a real editor change and handing that
   * content to `persistenceCoordinator.persist()`. The desktop debounce
   * means this pre-handoff window exists before the coordinator knows about
   * the edit. The coordinator owns the distinct post-handoff lifecycle via
   * `hasUnconfirmedContent()`; `computeHasPendingLocalEdit` combines both.
   * Programmatic `setContent` calls are already guarded by
   * `isApplyingContentRef`.
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
      applyHydrationPhase(activationHydrates(target.writingId, reason) ? "loading" : "ready")
      setActivationSeq((current) => current + 1)
      if (target.href !== undefined) {
        replaceEditorHistory(target.href)
      }
    },
    [applyHydrationPhase, setActiveWritingId],
  )
  /**
   * ODE-542: reconcilia el estado de guardado del documento activo (status bar
   * y su pestaña) desde el catálogo durable. Los eventos de sync son solo
   * invalidaciones: disparan esta lectura O(1), nunca fijan un estado terminal
   * por sí mismos. Un evento perdido no deja la UI atascada en "Saving…",
   * porque terminar de hidratar (también tras materializar un borrador) y el
   * `cloud-snapshot` del catálogo convergen por la misma lectura. Solo cura hacia un terminal durable, y
   * nunca borra un `error` local (ODE-461).
   */
  const reconcileActiveSaveState = useCallback(
    async (reason: string) => {
      const writingId = currentWritingIdRef.current
      if (!writingId) {
        return
      }

      try {
        const { getCatalogRecord } = await import("@/lib/queries/document-catalog")
        const record = await getCatalogRecord(writingId)
        if (!record || currentWritingIdRef.current !== writingId) {
          return
        }

        const current = syncStatusRef.current
        const next = reconcileSaveStateFromDurable({
          current,
          durable: { syncStatus: record.syncStatus, cloudPresent: record.cloudPresent },
          isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
        })
        if (!next) {
          return
        }

        console.info(formatSaveStateDiagnostic({ writingId, durableSyncStatus: record.syncStatus, current, next, reason }))
        applySyncStatus(next)
        updateTabSaveState({ tabId: writingId, saveState: next, hasPendingSync: saveStateToHasPendingSync(next) })
      } catch (error) {
        // El contenido sigue abierto; el siguiente evento de sync, cambio del
        // catálogo o activación reintenta.
        console.error("[editor:save-state] reconcile read failed", {
          writingId,
          error: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [applySyncStatus],
  )
  // Los callbacks del coordinador de persistencia se crean una vez; leen la
  // versión vigente por ref.
  const reconcileActiveSaveStateRef = useRef(reconcileActiveSaveState)
  useEffect(() => {
    reconcileActiveSaveStateRef.current = reconcileActiveSaveState
  }, [reconcileActiveSaveState])
  const hydrationGenerationOwnerRef = useRef<ReturnType<typeof createHydrationGenerationOwner> | null>(null)
  if (hydrationGenerationOwnerRef.current === null) {
    hydrationGenerationOwnerRef.current = createHydrationGenerationOwner()
  }
  const currentCanonicalPathRef = useRef<string | null>(null)
  const focusModeRestorationRef = useRef<FocusModeRestoration | null>(null)

  // ODE-602: focus mode (mudanza mecánica; mismos callbacks, en esta posición).
  const { exitFocusMode, toggleFocusMode } = useFocusMode({
    activePanel,
    focusModeRestorationRef,
    isFindReplaceOpen,
    isFocusMode,
    setActivePanel,
    setIsFindReplaceOpen,
    setIsFocusMode,
  })
  const navigatedToDraftRef = useRef(false)
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
  const markdownSelectionRef = useRef<OwnedMarkdownSelectionSnapshot | null>(null)
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
    writingId: string
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

  const updateDerivedEditorState = useCallback((editorInstance: Editor) => {
    setBodyText(editorInstance.getText())
  }, [])

  // Lo que la shell tenga en cola hacia el coordinador al desmontarse: la
  // edición rich en su debounce de desktop (150 ms) y el guardado de markdown
  // (800 ms). Lo asigna un efecto más abajo,
  // donde vive la función; se lee aquí, al cerrar el coordinador.
  const flushPendingEditOnUnmountRef = useRef<(() => void) | null>(null)

  // ODE-605 — corte 5, paso 1: el cluster de guardado vive en su hook (mudanza
  // mecánica; el estado y los refs siguen siendo de la shell). Se llama aquí,
  // donde estaba el `useMemo` del coordinador, así que el orden de efectos
  // (activar → volcar + dispose → asignar el volcado) no cambia.
  const {
    persistenceCoordinator,
    persistEditorSnapshot,
    flushQueuedRichModeUpdate,
    scheduleMarkdownSave,
    handleEditorUpdate,
  } = useEditorPersistence({
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
    applySyncStatus,
    activateDocument,
    applyDocumentMetadata,
    updateDerivedEditorState,
    createDesktopDraftFn,
    createWritingId,
    deriveAutoTitle,
    navigateToWriting,
    untitledWritingTitle: UNTITLED_WRITING_TITLE,
  })

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

  const refreshRichFootnotes = useCallback(() => {
    setRichFootnoteRevision((revision) => revision + 1)
  }, [])

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
      const writingId = markdownSelectionOwnerId(currentWritingIdRef.current)
      const requestedIsStillValid = options?.isStillValid
      const isStillValid = () =>
        markdownSelectionOwnerId(currentWritingIdRef.current) === writingId &&
        (!requestedIsStillValid || requestedIsStillValid())

      // The latest selection wins, but a pending completion callback is never
      // dropped with the request it came with: hydration finishes through
      // this queue (`onSettled: finishHydration`), and a plain restore
      // coalescing over it used to leave the phase on "loading" (ODE-582).
      // Only callbacks carry over; each request keeps its own validity check.
      const supersededOnSettled = pendingMarkdownSelectionRef.current?.onSettled
      const onSettled =
        supersededOnSettled && options?.onSettled
          ? () => {
              supersededOnSettled()
              options.onSettled?.()
            }
          : supersededOnSettled ?? options?.onSettled
      pendingMarkdownSelectionRef.current = { start, end, ...options, writingId, isStillValid, onSettled }

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
          writingId: pendingSelection.writingId,
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
      onUpdate: handleEditorUpdate,
    },
    [editorExtensions, handleEditorUpdate],
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

  // ODE-602: tabla de contenidos (mudanza mecánica; mismos efectos, en el
  // mismo orden y en esta posición).
  const { navigateToTableOfContentsItem } = useTableOfContents({
    activeTableOfContentsItemIdRef,
    editor,
    selectedTableOfContentsItemId,
    setSelectedTableOfContentsItemId,
    tableOfContentsItems,
    tableOfContentsItemsRef,
    tableOfContentsScrollRafRef,
  })

  const persistCurrentWorkspaceViewState = useCallback(() => {
    // ODE-624: mientras la hidratación del documento activo no terminó, lo que
    // hay en el editor todavía no es la vista del documento. `setContent` dejó
    // el cursor al final y el scroll/selección del documento se restauran en
    // frames diferidos; `hydrationPhase` sigue en "loading" hasta que esos
    // frames corren — rich mode llama a `finishHydration` (la única transición
    // a "ready") dentro del segundo frame, después de aplicar los scrolls
    // (`useDocumentHydration.ts`), y markdown en el `onSettled` del restore,
    // tras sus re-aplicaciones. Guardar aquí la vista previa a restaurar pisa
    // la vista propia que la pestaña ya tenía (hallazgo de ODE-600).
    // El ref, no el estado: este callback es de larga vida (cleanup de
    // unmount) y no debe recrearse con cada transición de fase.
    if (hydrationPhaseRef.current !== "ready") {
      return
    }

    const tabId = currentWritingIdRef.current ?? EDITOR_DRAFT_TAB_ID
    const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
    const shellViewport = document.querySelector<HTMLElement>("main")
    const currentTab = getEditorSessionState().session.tabs.find((tab) => tab.id === tabId)
    const markdownSelection = readMarkdownSelectionForActiveDocument(
      markdownSelectionRef.current,
      currentWritingIdRef.current,
    )

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
            ? markdownSelection.selection?.start ??
              (markdownSelection.belongsToOtherDocument
                ? currentTab?.view_state?.markdownSelectionStart ?? null
                : markdownTextareaRef.current?.selectionStart ?? null)
            : null,
        markdownSelectionEnd:
          modeRef.current === "markdown"
            ? markdownSelection.selection?.end ??
              (markdownSelection.belongsToOtherDocument
                ? currentTab?.view_state?.markdownSelectionEnd ?? null
                : markdownTextareaRef.current?.selectionEnd ?? null)
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
    currentWritingIdRef,
    desktopSessionRestoreTimingRef,
    editorSession,
    ephemeralDraftWritingIdRef,
    forceNewWriting,
    isPerfHarness,
    navigatedToDraftRef,
    navigateToWriting,
    routeWritingId,
    router,
    sessionLoaded,
  })

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  // ODE-599: la conexión con desktop (suscripción al catálogo, avisos de
  // borrado/movimiento, recarga limpia y conflicto externo) vive en su hook.
  // Se llama aquí, donde estaba el efecto, así que el orden de efectos no
  // cambia; el estado y los refs siguen siendo de la shell.
  const { keepMyVersion, reloadExternalVersion } = useExternalDocumentChanges({
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
  })

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
    setHydrationPhase: applyHydrationPhase,
    setMode,
    setMarkdownValue,
    setBodyText,
    setSyncStatus: applySyncStatus,
    reconcileActiveSaveState: (reason: string) => {
      void reconcileActiveSaveStateRef.current(reason)
    },
    setIsBodyHydrating,
    activateDocument,
    applyDocumentMetadata,
    setExternalFileNotice,
    setCanonicalPath,
    refreshRichFootnotes,
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

  // ODE-542: una sola suscripción global a los eventos de sync. La identidad
  // se resuelve por ref en el momento del evento, nunca con un
  // `currentWritingId` capturado: un `synced` que llega durante la
  // materialización o la hidratación no se pierde en la ventana de
  // re-suscripción. Los eventos son invalidaciones: el documento activo
  // relee su estado durable (O(1)); los de fondo, en `synced`, releen la fila
  // de ese documento antes de proyectar su pestaña (ODE-590).
  useEffect(() => {
    return subscribeToSyncStatusChanges((event) => {
      const activeWritingId = currentWritingIdRef.current

      if (activeWritingId && event.writingId === activeWritingId) {
        // Sin conexión no hay transición durable que releer: el commit local
        // ya es durable y la nube no está disponible. Se proyecta "Saved
        // locally" directamente, salvo que un fallo local sea dueño del
        // indicador.
        if (event.status === "offline") {
          if (syncStatusRef.current !== "error") {
            applySyncStatus("saved-local")
            updateTabSaveState({
              tabId: activeWritingId,
              saveState: "saved-local",
              hasPendingSync: saveStateToHasPendingSync("saved-local"),
            })
          }
          return
        }

        void reconcileActiveSaveStateRef.current(`sync-${event.status}`)

        if (event.status !== "synced") {
          return
        }

        void (async () => {
          const localWriting = await localDB.writings.get(activeWritingId)

          if (!localWriting?.slug || routeWritingId === localWriting.slug) {
            return
          }

          applyDocumentMetadata({ slug: localWriting.slug })
          navigateToWriting(router, `/write/${localWriting.slug}`, { mode: "replace", skipOnDesktop: true })
        })()
        return
      }

      // Documento de fondo: converge su pestaña sin tocar la status bar
      // activa. ODE-590: un `synced` no basta para mostrar "Saved" — es una
      // invalidación como la del activo, así que se relee la fila durable de
      // ESE documento (O(1)) antes de proyectar. El resto de lifecycle
      // statuses no son terminales y se proyectan sin leer. Un evento perdido
      // se cura al activarlo (relectura durable tras hidratar); un `error`
      // local nunca lo borra un evento de la nube.
      const tab = getEditorSessionState().session.tabs.find(
        (candidate) => candidate.writing_id === event.writingId || candidate.id === event.writingId,
      )
      if (!tab || tab.save_state === "error") {
        return
      }

      if (event.status === "synced") {
        const tabId = tab.id
        void (async () => {
          try {
            const { getCatalogRecord } = await import("@/lib/queries/document-catalog")
            const record = await getCatalogRecord(event.writingId)
            if (!record) {
              return
            }
            // Si la pestaña pasó a ser el documento activo mientras la lectura
            // estaba en vuelo, la reconciliación activa manda: el resultado de
            // fondo no pisa el estado que esa transición ya calculó.
            if (currentWritingIdRef.current === event.writingId) {
              return
            }
            const currentTab = getEditorSessionState().session.tabs.find((candidate) => candidate.id === tabId)
            if (!currentTab || currentTab.save_state === "error") {
              return
            }
            const next = reconcileSaveStateFromDurable({
              current: currentTab.save_state,
              durable: { syncStatus: record.syncStatus, cloudPresent: record.cloudPresent },
              isOnline: typeof navigator === "undefined" ? true : navigator.onLine,
            })
            if (!next) {
              return
            }
            console.info(
              formatSaveStateDiagnostic({
                writingId: event.writingId,
                durableSyncStatus: record.syncStatus,
                current: currentTab.save_state,
                next,
                reason: "sync-synced-background",
              }),
            )
            updateTabSaveState({ tabId, saveState: next, hasPendingSync: saveStateToHasPendingSync(next) })
          } catch (error) {
            // La pestaña conserva su estado; el siguiente evento o su
            // activación reintenta.
            console.error("[editor:save-state] background reconcile read failed", {
              writingId: event.writingId,
              error: error instanceof Error ? error.message : String(error),
            })
          }
        })()
        return
      }

      const nextTabState = mapSyncLifecycleToSaveState(event.status)
      if (tab.save_state === nextTabState) {
        return
      }
      updateTabSaveState({
        tabId: tab.id,
        saveState: nextTabState,
        hasPendingSync: saveStateToHasPendingSync(nextTabState),
      })
    })
  }, [applyDocumentMetadata, applySyncStatus, routeWritingId, router])

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

  // ODE-603 — corte 4b, entrega 2: el despachador vive en su hook (mudanza
  // mecánica; el estado y los refs siguen siendo de la shell).
  const { handleRunAction } = useEditorCommands({
    applySyncStatus,
    captureRichSelectionSnapshot,
    createWorkspaceTabRef,
    currentWritingId,
    currentWritingIdRef,
    editor,
    hasUnconfirmedLocalEditRef,
    isApplyingContentRef,
    markdownSaveTimeoutRef,
    markdownSelectionOwnerId,
    markdownSelectionRef,
    markdownTextareaRef,
    markdownValue,
    modeRef,
    openFindReplacePanel,
    openInsertImageModal,
    persistEditorSnapshot,
    queueMarkdownSelectionRestore,
    readMarkdownSelectionForActiveDocument,
    router,
    scheduleMarkdownSave,
    selectAdjacentTabRef,
    selectionRef,
    setActivePanel,
    setBodyText,
    setFootnoteModalOpen,
    setIsShortcutHelpOpen,
    setIsTabBarVisible,
    setIsTopbarVisible,
    setLinkModalOpen,
    setMarkdownValue,
    setPendingAnnotation,
    setPendingRichSelection,
    setTableModalOpen,
    toggleFocusMode,
  })

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

      applySyncStatus("saving")

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
    [applySyncStatus, editor, persistEditorSnapshot, scheduleMarkdownSave],
  )

  const handleInsertLink = useCallback(
    (payload: { text: string; url: string }) => {
      if (modeRef.current === "markdown") {
        const source = markdownValue
        const textarea = markdownTextareaRef.current
        const fallbackCursor = source.length
        const markdownSelection = readMarkdownSelectionForActiveDocument(
          markdownSelectionRef.current,
          currentWritingIdRef.current,
          source,
        )
        const start = markdownSelection.selection?.start ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionStart ?? fallbackCursor)
        const end = markdownSelection.selection?.end ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionEnd ?? fallbackCursor)
        const selectedText = markdownSelection.selection?.text?.trim() ??
          (markdownSelection.belongsToOtherDocument ? "" : source.slice(start, end).trim())
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

        applySyncStatus("saving")

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
    [applySyncStatus, editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore, scheduleMarkdownSave],
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
      applySyncStatus("saving")

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
    [applySyncStatus, mode, editor, markdownValue, persistEditorSnapshot, scheduleMarkdownSave],
  )

  const handleInsertImage = useCallback(
    (payload: { src: string; alt: string }) => {
      if (modeRef.current === "markdown") {
        const source = markdownValue
        const textarea = markdownTextareaRef.current
        const fallbackCursor = source.length
        const markdownSelection = readMarkdownSelectionForActiveDocument(
          markdownSelectionRef.current,
          currentWritingIdRef.current,
          source,
        )
        const start = markdownSelection.selection?.start ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionStart ?? fallbackCursor)
        const end = markdownSelection.selection?.end ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionEnd ?? fallbackCursor)
        const imageMarkdown = `![${payload.alt}](${payload.src})`
        const nextMarkdown = `${source.slice(0, start)}${imageMarkdown}${source.slice(end)}`
        const nextSelectionStart = start + imageMarkdown.length

        setMarkdownValue(nextMarkdown)
        hasUnconfirmedLocalEditRef.current = true
        applySyncStatus("saving")

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
    [applySyncStatus, editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore, scheduleMarkdownSave],
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

  // ODE-602: buscar y reemplazar (mudanza mecánica; mismos efectos, en el
  // mismo orden y en esta posición).
  const findReplace = useFindReplace({
    currentWritingId,
    currentWritingIdRef,
    editor,
    editorCursorSnapshotRef,
    findActiveIndex,
    findCaseSensitive,
    findInputRef,
    findQuery,
    handleMarkdownChange,
    isFindReplaceOpen,
    markdownSelectionOwnerId,
    markdownSelectionRef,
    markdownTextareaRef,
    markdownValue,
    mode,
    modeRef,
    persistEditorSnapshot,
    queueMarkdownSelectionRestore,
    replaceInputRef,
    replaceValue,
    setFindActiveIndex,
    setFindQuery,
    setIsFindReplaceOpen,
    setReplaceValue,
    updateDerivedEditorState,
  })
  const {
    activeMatchIndex,
    closeFindReplacePanel,
    handleReplaceAllMatches,
    handleReplaceCurrentMatch,
    markdownOverlayHtml,
    matchCount,
    navigateFindMatches,
  } = findReplace
  // `handleRunAction`, más arriba, abre la búsqueda. Antes de ODE-602 esto era
  // una declaración de función aquí mismo, y se elevaba; sigue siéndolo, así
  // que el atajo la encuentra, y solo lee el resultado del hook al ejecutarse,
  // cuando el render ya lo creó. Se recrea en cada render, como antes.
  function openFindReplacePanel(options?: { focusReplace?: boolean }) {
    findReplace.openFindReplacePanel(options)
  }

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
    currentWritingId,
    editor,
    editorSession,
    ephemeralDraftWritingIdRef,
    hydrationPhase,
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
        let writingId = currentWritingIdRef.current
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
          const durable = await persistEditorSnapshot(editor, { title: nextTitle }, { awaitDurability: true })
          if (!durable) return false

          // ODE-585: if a materialization was already in flight, the file was
          // born under the draft's old title and the queued save above cannot
          // rename it — on desktop the title comes from the `.md` name. Name
          // the materialized document through the regular rename below; when
          // the draft materialized under this very name, that is a no-op. The
          // shell adopted it by now (`onMaterialized` runs before the write
          // settles); without an identity the name was not applied, so say so.
          writingId = currentWritingIdRef.current
          if (!writingId) return false
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
    currentWritingIdRef,
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
    refreshRichFootnotes,
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
                onClick={reloadExternalVersion}
              >
                Reload external
              </Button>
              <Button
                type="button"
                size="sm"
                onClick={keepMyVersion}
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
                      const writingId = markdownSelectionOwnerId(currentWritingId)
                      if (markdownSelectionOwnerId(currentWritingIdRef.current) !== writingId) return

                      markdownSelectionRef.current = {
                        ...selection,
                        writingId,
                      }
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
                  const writingId = markdownSelectionOwnerId(currentWritingId)
                  if (markdownSelectionOwnerId(currentWritingIdRef.current) !== writingId) return false

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
                      writingId,
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
