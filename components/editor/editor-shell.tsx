"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
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
import { EditorFindReplace } from "@/components/editor/editor-find-replace"
import { EditorStatusBar } from "@/components/editor/status-bar"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { MobileWriteNotice } from "@/components/editor/mobile-write-notice"
import { AnnotationBubble } from "@/components/reading/margins/annotation-bubble"
import { SelectionPopup } from "@/components/reading/margins/selection-popup"
import { InsertFootnoteModal } from "@/components/editor/modals/insert-footnote-modal"
import { InsertLinkModal } from "@/components/editor/modals/insert-link-modal"
import { InsertTableModal } from "@/components/editor/modals/insert-table-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import {
  appendMarkdownFootnote,
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
import { FOOTNOTE_REF_EVENT, getEditorFootnotes, getMarkdownWithFootnoteDefinitions } from "@/lib/editor/footnote-node"
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
import { useEditorSelection, type MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type { LocalWriting, PublicationSuggestion, WritingLifecycle, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { enqueueWritingUpsert } from "@/lib/sync"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
import { hydrateLocalWritingFromRemote } from "@/lib/sync/remote-bootstrap"
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

const NotesPanel = lazy(() =>
  import("@/components/editor/panels/notes-panel").then((module) => ({ default: module.NotesPanel })),
)

const PropertiesPanel = lazy(() =>
  import("@/components/editor/panels/properties-panel").then((module) => ({
    default: module.PropertiesPanel,
  })),
)

const PublicationPanel = lazy(() =>
  import("@/components/editor/panels/publication-panel").then((module) => ({
    default: module.PublicationPanel,
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

export function EditorShell({ writingId }: EditorShellProps) {
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
  const [version, setVersion] = useState(0)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [writingSlug, setWritingSlug] = useState<string | null>(null)
  const [writingStatus, setWritingStatus] = useState<WritingStatus>("draft")
  const [writingVisibility, setWritingVisibility] = useState<WritingVisibility>("private")
  const [lifecycle, setLifecycle] = useState<WritingLifecycle>("local-only")
  const lifecycleRef = useRef<WritingLifecycle>("local-only")
  const [activePanel, setActivePanel] = useState<EditorPanel>(null)
  const [spellcheckScope, setSpellcheckScope] = useState(() => getLocalDBScope())
  const [spellcheckPreference, setSpellcheckPreference] = useState<EditorSpellcheckPreference>("system")
  const [isPublicationModeEnabled, setIsPublicationModeEnabled] = useState(false)
  const [publicationSuggestions, setPublicationSuggestions] = useState<PublicationSuggestion[]>([])

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
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
  const editorExtensions = useMemo(() => createEditorExtensions(), [])
  const spellcheckConfig = useMemo(
    () => buildEditorSpellcheckConfig(spellcheckPreference),
    [spellcheckPreference],
  )

  const updateDerivedEditorState = useCallback((editorInstance: Editor) => {
    setBodyText(editorInstance.getText())
  }, [])

  const persistEditorSnapshot = useCallback(
    async (editorInstance: Editor, overrides?: PersistSnapshotOverrides) => {
      const nowIso = new Date().toISOString()
      const nextId = currentWritingId ?? createWritingId()
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

      if (!currentWritingId) {
        const nextWritingSession = createNewWritingSessionState(nextId)
        currentWritingIdRef.current = nextWritingSession.activeWritingId
        setCurrentWritingId(nextWritingSession.activeWritingId)
        setHydrationWritingId(nextWritingSession.hydrationWritingId)

        if (!routeWritingId && !navigatedToDraftRef.current) {
          navigatedToDraftRef.current = true
          router.replace(`/write/${nextId}`)
        }
      }

      setSyncStatus("saving")

      const nextLifecycle = !currentWritingId ? "local-only" : lifecycleRef.current

      const nextWriting: LocalWriting = {
        id: nextId,
        title: nextTitle,
        body_json: editorInstance.getJSON() as Record<string, unknown>,
        body_text: nextBodyText,
        status: overrides?.status ?? statusRef.current,
        visibility: overrides?.visibility ?? visibilityRef.current,
        version: nextVersion,
        sync_status: "pending",
        lifecycle: nextLifecycle,
        created_at: baseCreatedAt,
        updated_at: nowIso,
        local_updated_at: Date.now(),
      }

      try {
        await enqueueWritingUpsert(nextWriting)
        versionRef.current = nextVersion
        setVersion(nextVersion)
        createdAtRef.current = baseCreatedAt
        setCreatedAt(baseCreatedAt)
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            nextWriting.sync_status,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
      } catch {
        setSyncStatus(typeof navigator !== "undefined" && !navigator.onLine ? "saved-local" : "saving")
      }
    },
    [currentWritingId, routeWritingId, router],
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

    saveTabViewState({
      tabId,
      viewState: {
        mode: modeRef.current,
        scrollTop: editorViewport?.scrollTop ?? 0,
        scrollLeft: editorViewport?.scrollLeft ?? 0,
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

  useEffect(() => {
    if (!editor || activePanel !== "publication" || mode !== "rich") {
      return
    }

    setEditorPublicationSuggestions(editor, publicationSuggestions)
  }, [editor, activePanel, mode, publicationSuggestions])

  useEffect(() => {
    if (!editor || activePanel === "publication" || mode !== "rich") {
      return
    }

    clearPublicationSuggestions(editor)
  }, [editor, activePanel, mode])

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
    if (!sessionLoaded || routeWritingId) {
      return
    }

    if (editorSession.active_tab_id && editorSession.active_tab_id !== EDITOR_DRAFT_TAB_ID) {
      const activeTab = editorSession.tabs.find((tab) => tab.id === editorSession.active_tab_id)
      if (activeTab?.writing_id) {
        router.replace(`/write/${activeTab.slug ?? activeTab.writing_id}`)
        return
      }
    }

    openDraftTab()
  }, [editorSession.active_tab_id, editorSession.tabs, routeWritingId, router, sessionLoaded])

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  useEffect(() => {
    document.body.classList.toggle("od-editor-focus-mode", isFocusMode)

    if (isFocusMode) {
      if (activePanel === "publication") {
        setIsPublicationModeEnabled(false)
      }
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

    updateDerivedEditorState(editor)

    if (!currentWritingId) {
      setWritingStatus("draft")
      setWritingVisibility("private")
      return
    }

    if (!hydrationWritingId) {
      return
    }

    let cancelled = false
    const targetWritingId = hydrationWritingId

    const hydrateEditor = async () => {
      let localWriting = await localDB.writings.get(targetWritingId)

      if (!localWriting) {
        try {
          await hydrateLocalWritingFromRemote(targetWritingId)
        } catch {
          // The writing might not exist remotely yet; keep local fallback behavior.
        }

        if (cancelled) {
          return
        }

        localWriting = await localDB.writings.get(targetWritingId)
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
          const nextMarkdown = normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(getEditorMarkdown(editor), getEditorFootnotes(editor)))
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
              },
            )
          })
        } else if (viewState) {
          modeRef.current = "rich"
          setMode("rich")
          window.requestAnimationFrame(() => {
            const editorViewport = document.querySelector<HTMLElement>('[data-testid="editor-writing-area"]')
            if (editorViewport) {
              editorViewport.scrollTop = viewState.scrollTop
              editorViewport.scrollLeft = viewState.scrollLeft
            }

            if (
              typeof viewState.selectionFrom === "number" &&
              typeof viewState.selectionTo === "number" &&
              viewState.selectionFrom >= 1 &&
              viewState.selectionTo >= viewState.selectionFrom
            ) {
              editor
                .chain()
                .focus()
                .setTextSelection({ from: viewState.selectionFrom, to: viewState.selectionTo })
                .run()
            }
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
  }, [currentWritingId, editor, editorSession.tabs, hydrationWritingId, queueMarkdownSelectionRestore, routeWritingId, updateDerivedEditorState])

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

      richUpdateRafRef.current = null
      richUpdateEditorRef.current = null
      markdownSelectionRafRef.current = null
      pendingMarkdownSelectionRef.current = null
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
    if (activePanel === "publication") {
      setIsPublicationModeEnabled(false)
    }

    setActivePanel(null)
  }, [activePanel])

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
            router.push("/write")
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
      .setTextSelection(pendingRichSelection.to)
      .run()

    setPendingRichSelection(null)
    updateDerivedEditorState(editor)
    void persistEditorSnapshot(editor)
  }, [editor, pendingRichSelection, persistEditorSnapshot, updateDerivedEditorState])

  const handleAnnotateSelection = useCallback(() => {
    if (!pendingRichSelection) {
      return
    }

    setPendingAnnotation({
      from: pendingRichSelection.from,
      to: pendingRichSelection.to,
      text: pendingRichSelection.text,
      position: pendingRichSelection.bubblePosition,
    })
    setPendingRichSelection(null)
  }, [pendingRichSelection])

  const handleConfirmAnnotation = useCallback(
    (note: string) => {
      if (!editor || !pendingAnnotation) {
        return
      }

      const trimmedNote = note.trim()
      if (!trimmedNote) {
        return
      }

      suppressNextSelectionPopupRef.current = true
      editor
        .chain()
        .focus()
        .setTextSelection({ from: pendingAnnotation.from, to: pendingAnnotation.to })
        .setHighlight()
        .addFootnote(trimmedNote)
        .setTextSelection(pendingAnnotation.to)
        .run()

      setPendingAnnotation(null)
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
      setActivePanel("notes")
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
        const bodyMarkdown = getEditorMarkdown(editor)
        const footnoteNodes = getEditorFootnotes(editor)
        setMarkdownValue(normalizeMarkdownForRoundTrip(getMarkdownWithFootnoteDefinitions(bodyMarkdown, footnoteNodes)))
        return
      }

      const normalizedMarkdown = normalizeMarkdownForRoundTrip(markdownValue)
      modeRef.current = "rich"
      isApplyingContentRef.current = true
      editor.commands.setContent(materializeMarkdownForRichParser(normalizedMarkdown))
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
      const contentRevision = version
      void contentRevision
      return editor ? getEditorFootnotes(editor) : []
    }

    return getMarkdownFootnotes(markdownValue)
  }, [editor, markdownValue, mode, version])
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

    publishTabState({
      routeWritingId,
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

  const jumpToPublicationTarget = useCallback(
    (targetText: string) => {
      const normalizedTarget = targetText.trim()

      if (!normalizedTarget) {
        return
      }

      if (modeRef.current === "markdown") {
        const matches = findTextMatches(markdownValue, normalizedTarget, false)
        const targetMatch = matches[0]

        if (!targetMatch || !markdownTextareaRef.current) {
          return
        }

        markdownTextareaRef.current.focus()
        markdownTextareaRef.current.setSelectionRange(targetMatch.start, targetMatch.end)
        markdownTextareaRef.current.scrollIntoView({ block: "nearest" })
        markdownSelectionRef.current = {
          start: targetMatch.start,
          end: targetMatch.end,
          text: markdownTextareaRef.current.value.slice(targetMatch.start, targetMatch.end),
        }
        return
      }

      if (!editor) {
        return
      }

      const matches = findDocumentMatches(editor.state.doc, normalizedTarget, false)
      const targetMatch = matches[0]

      if (!targetMatch) {
        return
      }

      const transaction = editor.state.tr
      transaction.setSelection(TextSelection.create(transaction.doc, targetMatch.from, targetMatch.to))
      transaction.scrollIntoView()
      transaction.setMeta("addToHistory", false)
      editor.view.dispatch(transaction)
      editor.commands.focus()
    },
    [editor, markdownValue],
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

  const handleCreateWorkspaceTab = useCallback(async () => {
    if (editorSession.tabs.length >= 10) {
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

    if (isActiveDraft) {
      const nowIso = new Date().toISOString()
      const nextWritingId = createWritingId()
      const nextTitle = deriveAutoTitle("", nowIso)

      await localDB.writings.save({
        id: nextWritingId,
        title: nextTitle,
        body_json: EMPTY_EDITOR_JSON as Record<string, unknown>,
        body_text: "",
        status: "draft",
        visibility: "private",
        version: 0,
        sync_status: "synced",
        lifecycle: "local-only",
        created_at: nowIso,
        updated_at: nowIso,
        local_updated_at: Date.now(),
      })

      openWritingTab({
        writingId: nextWritingId,
        title: nextTitle,
        saveState: "saved",
        hasPendingSync: false,
      })
      currentWritingIdRef.current = nextWritingId
      setCurrentWritingId(nextWritingId)
      setHydrationWritingId(nextWritingId)
      window.history.replaceState(null, "", `/write/${nextWritingId}`)
      return
    }

    openDraftTab()
    currentWritingIdRef.current = null
    setCurrentWritingId(null)
    setHydrationWritingId(null)
    window.history.replaceState(null, "", "/write")
  }, [currentWritingId, editorSession.tabs, persistCurrentWorkspaceViewState])

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
    const objectUrl = URL.createObjectURL(blob)
    const anchor = document.createElement("a")

    anchor.href = objectUrl
    anchor.download = filename
    anchor.rel = "noreferrer"
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0)
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

      const response = await fetch(`/api/writings/${currentWritingId}/export?format=${format}`)
      if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as
          | { error?: { message?: string } }
          | null
        throw new Error(payload?.error?.message ?? `Failed to export ${format.toUpperCase()}.`)
      }

      const blob = await response.blob()
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
            isPublicationModeEnabled={isPublicationModeEnabled}
            tabs={editorSession.tabs}
            activeTabId={editorSession.active_tab_id}
            onSelectTab={handleSelectWorkspaceTab}
            onCloseTab={handleCloseWorkspaceTab}
            onNewTab={handleCreateWorkspaceTab}
            onToggleFocusMode={() => setIsFocusMode((currentState) => !currentState)}
            onTogglePanel={(panel) => {
              if (panel === "publication") {
                setIsPublicationModeEnabled((currentState) => {
                  const nextEnabled = !currentState
                  setActivePanel(nextEnabled ? "publication" : null)
                  return nextEnabled
                })
                return
              }

              setActivePanel((current) => (current === panel ? null : panel))
            }}
            onRunAction={handleRunAction}
          />
        ) : null}

        <div className="flex min-h-0 flex-1">
          <div className="relative flex min-w-0 flex-1 flex-col">
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
                onToggleMode={handleToggleMode}
              />
            ) : null}
          </div>
        </div>

        {!isFocusMode && activePanel ? (
          <Suspense fallback={null}>
            {activePanel === "notes" ? (
              <NotesPanel
                footnotes={footnotes}
                onClose={closeActivePanel}
                onAddFootnote={(text) => {
                  if (mode === "rich" && editor) {
                    editor.commands.addFootnote(text)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  } else {
                    const nextMarkdown = appendMarkdownFootnote(markdownValue, text)
                    applyMarkdownFromPanel(nextMarkdown)
                  }
                }}
                onUpdateFootnote={(index, text) => {
                  if (mode === "rich" && editor) {
                    editor.commands.updateFootnote(index, text)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  } else {
                    const nextMarkdown = updateMarkdownFootnote(markdownValue, index, text)
                    applyMarkdownFromPanel(nextMarkdown)
                  }
                }}
                onDeleteFootnote={(index) => {
                  if (mode === "rich" && editor) {
                    editor.commands.deleteFootnote(index)
                    updateDerivedEditorState(editor)
                    void persistEditorSnapshot(editor)
                  } else {
                    const nextMarkdown = removeMarkdownFootnote(markdownValue, index)
                    applyMarkdownFromPanel(nextMarkdown)
                  }
                }}
              />
            ) : activePanel === "properties" ? (
              <PropertiesPanel
                writingId={currentWritingId}
                title={displayTitle}
                status={writingStatus}
                visibility={writingVisibility}
                metrics={textMetrics}
                spellcheckPreference={spellcheckPreference}
                spellcheckLanguage={spellcheckConfig.language}
                publicationModeEnabled={isPublicationModeEnabled}
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
                onTogglePublicationMode={(nextEnabled) => {
                  setIsPublicationModeEnabled(nextEnabled)
                  setActivePanel(nextEnabled ? "publication" : null)
                }}
              />
            ) : (
              <PublicationPanel
                writingId={currentWritingId}
                title={displayTitle}
                markdown={currentDocumentMarkdown}
                bodyText={bodyText}
                onApplyMarkdown={applyMarkdownFromPanel}
                onJumpToText={jumpToPublicationTarget}
                onClose={closeActivePanel}
                onSuggestionsChange={setPublicationSuggestions}
              />
            )}
          </Suspense>
        ) : null}
      </div>

      <div className="md:hidden">
        <MobileWriteNotice />
      </div>

      <RenameWritingModal
        open={renameModalOpen}
        title={displayTitle}
        onOpenChange={setRenameModalOpen}
        onConfirm={(nextTitle) => {
          setTitle(nextTitle)
          setHasExplicitTitle(nextTitle !== UNTITLED_WRITING_TITLE)

          if (editor) {
            void persistEditorSnapshot(editor, { title: nextTitle })
          }
        }}
      />

      <InsertLinkModal
        open={linkModalOpen}
        initialText={selectionRef.current?.text ?? ""}
        onOpenChange={setLinkModalOpen}
        onConfirm={handleInsertLink}
      />

      <InsertFootnoteModal open={footnoteModalOpen} onOpenChange={setFootnoteModalOpen} onConfirm={handleInsertFootnote} />

      <InsertTableModal open={tableModalOpen} onOpenChange={setTableModalOpen} onConfirm={handleInsertTable} />

      <SelectionPopup
        position={pendingRichSelection?.popupPosition ?? null}
        onMark={handleMarkSelection}
        onAnnotate={handleAnnotateSelection}
        onDismiss={dismissSelectionPopup}
      />

      <AnnotationBubble
        position={pendingAnnotation?.position ?? null}
        onConfirm={handleConfirmAnnotation}
        onCancel={() => setPendingAnnotation(null)}
      />
    </section>
  )
}
