"use client"

import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
import { useRouter } from "next/navigation"
import {
  mapLocalSyncStatusToSaveState,
  mapSyncLifecycleToSaveState,
  type EditorSaveState,
} from "@/components/editor/save-state"
import { WritingEditorContent } from "@/components/editor/editor-content"
import { EditorStatusBar } from "@/components/editor/status-bar"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { MobileWriteNotice } from "@/components/editor/mobile-write-notice"
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
import { getLocalDBScope, localDB, subscribeToLocalDBScopeChanges } from "@/lib/local-db"
import type { LocalWriting, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { enqueueWritingUpsert } from "@/lib/sync"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
import { hydrateLocalWritingFromRemote } from "@/lib/sync/remote-bootstrap"
import { setSidebarMode } from "@/lib/stores/ui-shell-store"

type EditorShellProps = {
  writingId?: string
}

type SelectionSnapshot = {
  from: number
  to: number
  text: string
}

type MarkdownSelectionSnapshot = {
  start: number
  end: number
  text: string
}

type EditorPanel = "notes" | "properties" | null

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

const getWordCount = (editor: Editor | null) => {
  if (!editor) {
    return 0
  }

  const words = editor.storage.characterCount?.words

  if (typeof words !== "function") {
    return 0
  }

  return words()
}

export function EditorShell({ writingId }: EditorShellProps) {
  const router = useRouter()
  const routeWritingId = writingId ?? null

  const [currentWritingId, setCurrentWritingId] = useState<string | null>(routeWritingId)
  const [title, setTitle] = useState(UNTITLED_WRITING_TITLE)
  const [hasExplicitTitle, setHasExplicitTitle] = useState(false)
  const [mode, setMode] = useState<"rich" | "markdown">("rich")
  const [markdownValue, setMarkdownValue] = useState("")
  const [bodyText, setBodyText] = useState("")
  const [wordCount, setWordCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState<EditorSaveState>("saved")
  const [version, setVersion] = useState(0)
  const [createdAt, setCreatedAt] = useState<string | null>(null)
  const [writingStatus, setWritingStatus] = useState<WritingStatus>("draft")
  const [writingVisibility, setWritingVisibility] = useState<WritingVisibility>("private")
  const [activePanel, setActivePanel] = useState<EditorPanel>(null)
  const [spellcheckScope, setSpellcheckScope] = useState(() => getLocalDBScope())
  const [spellcheckPreference, setSpellcheckPreference] = useState<EditorSpellcheckPreference>("system")

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const hasExplicitTitleRef = useRef(hasExplicitTitle)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const statusRef = useRef<WritingStatus>(writingStatus)
  const visibilityRef = useRef<WritingVisibility>(writingVisibility)
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  const isApplyingContentRef = useRef(false)
  const hydratedIdRef = useRef<string | null>(null)
  const navigatedToDraftRef = useRef(false)
  const selfNavigatedIdRef = useRef<string | null>(null)
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const markdownSelectionRef = useRef<MarkdownSelectionSnapshot | null>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
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
  const editorExtensions = useMemo(() => createEditorExtensions(), [])
  const spellcheckConfig = useMemo(
    () => buildEditorSpellcheckConfig(spellcheckPreference),
    [spellcheckPreference],
  )

  const updateDerivedEditorState = useCallback((editorInstance: Editor) => {
    setWordCount(getWordCount(editorInstance))
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
        // Mark the editor as already-hydrated for this new ID so the hydration
        // effect does not re-apply content and trigger a visible flicker.
        hydratedIdRef.current = nextId
        setCurrentWritingId(nextId)

        if (!routeWritingId && !navigatedToDraftRef.current) {
          navigatedToDraftRef.current = true
          selfNavigatedIdRef.current = nextId
          router.replace(`/write/${nextId}`)
        }
      }

      setSyncStatus("saving")

      const nextWriting: LocalWriting = {
        id: nextId,
        title: nextTitle,
        body_json: editorInstance.getJSON() as Record<string, unknown>,
        body_text: nextBodyText,
        status: overrides?.status ?? statusRef.current,
        visibility: overrides?.visibility ?? visibilityRef.current,
        version: nextVersion,
        sync_status: "pending",
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
    statusRef.current = writingStatus
  }, [writingStatus])

  useEffect(() => {
    visibilityRef.current = writingVisibility
  }, [writingVisibility])

  useEffect(() => {
    if (routeWritingId && routeWritingId === selfNavigatedIdRef.current) {
      // This route change was triggered by this editor creating a new draft.
      // Content is already in the editor — clear the marker and skip re-hydration.
      selfNavigatedIdRef.current = null
      return
    }
    setCurrentWritingId(routeWritingId)
    hydratedIdRef.current = null
    navigatedToDraftRef.current = false
  }, [routeWritingId])

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  useEffect(() => {
    document.body.classList.toggle("od-editor-focus-mode", isFocusMode)

    if (isFocusMode) {
      setActivePanel(null)
    }

    return () => {
      document.body.classList.remove("od-editor-focus-mode")
    }
  }, [isFocusMode])

  useEffect(() => {
    if (!editor) {
      return
    }

    updateDerivedEditorState(editor)

    if (!currentWritingId) {
      hydratedIdRef.current = null
      setWritingStatus("draft")
      setWritingVisibility("private")
      return
    }

    if (hydratedIdRef.current === currentWritingId) {
      return
    }

    let cancelled = false

    const hydrateEditor = async () => {
      let localWriting = await localDB.writings.get(currentWritingId)

      if (!localWriting) {
        try {
          await hydrateLocalWritingFromRemote(currentWritingId)
        } catch {
          // The writing might not exist remotely yet; keep local fallback behavior.
        }

        if (cancelled) {
          return
        }

        localWriting = await localDB.writings.get(currentWritingId)
      }

      if (cancelled) {
        return
      }

      if (localWriting) {
        isApplyingContentRef.current = true
        // Load JSON first to get the markdown serialization, then re-parse as markdown
        // so that footnote references are converted to footnoteReference nodes.
        editor.commands.setContent(localWriting.body_json)
        const loadedMarkdown = normalizeMarkdownForRoundTrip(getEditorMarkdown(editor))
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
        setWritingStatus(localWriting.status ?? "draft")
        setWritingVisibility(localWriting.visibility ?? "private")
        setSyncStatus(
          mapLocalSyncStatusToSaveState(
            localWriting.sync_status,
            typeof navigator === "undefined" ? true : navigator.onLine,
          ),
        )
        updateDerivedEditorState(editor)
      } else {
        setTitle(UNTITLED_WRITING_TITLE)
        setHasExplicitTitle(false)
        setVersion(0)
        setCreatedAt(null)
        setWritingStatus("draft")
        setWritingVisibility("private")
        setSyncStatus("saved")
        setBodyText("")
      }

      hydratedIdRef.current = currentWritingId
    }

    void hydrateEditor()

    return () => {
      cancelled = true
    }
  }, [currentWritingId, editor, updateDerivedEditorState])

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
    }
  }, [])

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

  const handleRunAction = useCallback(
    (action: EditorShortcutAction, options?: { richSelection?: RichSelectionRange }) => {
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
          setWordCount(getWordCount(editor))
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
          case "focusMode":
            setIsFocusMode((currentState) => !currentState)
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
          runWithRichSelection((chain) => chain.toggleHighlight())
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
        case "focusMode":
          setIsFocusMode((currentState) => !currentState)
          return
        default:
          return
      }
    },
    [editor, markdownValue, persistEditorSnapshot, queueMarkdownSelectionRestore],
  )

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
        setWordCount(getWordCount(editor))
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
            setWordCount(getWordCount(editor))
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
  const displayTitle = useMemo(
    () => (hasExplicitTitle ? title : deriveAutoTitle(bodyText, createdAt)),
    [hasExplicitTitle, title, bodyText, createdAt],
  )

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
        const intent = resolveEscapeIntent({
          hasOpenPanel: activePanel !== null,
          isFocusMode,
        })

        if (intent === "close-panel") {
          event.preventDefault()
          setActivePanel(null)
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
  }, [activePanel, footnoteModalOpen, handleRunAction, isFocusMode, linkModalOpen, renameModalOpen, tableModalOpen])

  return (
    <section id="editor" data-page="editor" className="min-h-screen bg-bg">
      <div className="EditorLayout hidden min-h-screen flex-col md:flex">
        {!isFocusMode ? (
          <EditorTopbar
            editor={editor}
            title={displayTitle}
            mode={mode}
            isFocusMode={isFocusMode}
            activePanel={activePanel}
            onToggleFocusMode={() => setIsFocusMode((currentState) => !currentState)}
            onTogglePanel={(panel) => {
              setActivePanel((current) => (current === panel ? null : panel))
            }}
            onOpenRenameModal={() => setRenameModalOpen(true)}
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
              }}
              markdownTextareaRef={markdownTextareaRef}
            />

            {!isFocusMode ? <EditorStatusBar mode={mode} wordCount={wordCount} saveState={syncStatus} onToggleMode={handleToggleMode} /> : null}
          </div>
        </div>

        {!isFocusMode && activePanel ? (
          <Suspense fallback={null}>
            {activePanel === "notes" ? (
              <NotesPanel
                footnotes={footnotes}
                onClose={() => setActivePanel(null)}
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
            ) : (
              <PropertiesPanel
                writingId={currentWritingId}
                title={displayTitle}
                status={writingStatus}
                visibility={writingVisibility}
                metrics={textMetrics}
                spellcheckPreference={spellcheckPreference}
                spellcheckLanguage={spellcheckConfig.language}
                onExportMarkdown={exportMarkdown}
                onExportPdf={() => exportBinary("pdf")}
                onExportDocx={() => exportBinary("docx")}
                onClose={() => setActivePanel(null)}
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
    </section>
  )
}
