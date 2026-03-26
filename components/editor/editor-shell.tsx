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
import { FOOTNOTE_REF_EVENT, getEditorFootnotes, getMarkdownWithFootnoteDefinitions } from "@/lib/editor/footnote-node"
import { resolveEscapeIntent } from "@/lib/editor/panel-behavior"
import { applyPanelMarkdownChange, applyPanelMetaChange } from "@/lib/editor/panel-sync"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { type EditorShortcutAction, getEditorShortcutAction } from "@/lib/editor/shortcuts"
import { calculateTextMetrics } from "@/lib/editor/text-metrics"
import { shouldDeferRichModeSideEffects } from "@/lib/editor/transactions"
import { localDB } from "@/lib/local-db"
import type { LocalWriting, WritingStatus, WritingVisibility } from "@/lib/local-db/schema"
import { enqueueWritingUpsert } from "@/lib/sync"
import { subscribeToSyncStatusChanges } from "@/lib/sync/events"
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
  const [title, setTitle] = useState("Untitled writing")
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

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [tableModalOpen, setTableModalOpen] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const statusRef = useRef<WritingStatus>(writingStatus)
  const visibilityRef = useRef<WritingVisibility>(writingVisibility)
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  const isApplyingContentRef = useRef(false)
  const hydratedIdRef = useRef<string | null>(null)
  const navigatedToDraftRef = useRef(false)
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const markdownSelectionRef = useRef<MarkdownSelectionSnapshot | null>(null)
  const markdownTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const richUpdateRafRef = useRef<number | null>(null)
  const richUpdateEditorRef = useRef<Editor | null>(null)
  const markdownSelectionRafRef = useRef<number | null>(null)
  const pendingMarkdownSelectionRef = useRef<{ start: number; end: number } | null>(null)
  const editorExtensions = useMemo(() => createEditorExtensions(), [])

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

      if (!currentWritingId) {
        setCurrentWritingId(nextId)

        if (!routeWritingId && !navigatedToDraftRef.current) {
          navigatedToDraftRef.current = true
          router.replace(`/write/${nextId}`)
        }
      }

      setSyncStatus("saving")

      const nextWriting: LocalWriting = {
        id: nextId,
        title: (overrides?.title ?? titleRef.current).trim() || "Untitled writing",
        body_json: editorInstance.getJSON() as Record<string, unknown>,
        body_text: editorInstance.getText(),
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

  const queueMarkdownSelectionRestore = useCallback((start: number, end: number) => {
    pendingMarkdownSelectionRef.current = { start, end }

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

      markdownSelectionRef.current = {
        start: pendingSelection.start,
        end: pendingSelection.end,
        text: nextTextarea.value.slice(pendingSelection.start, pendingSelection.end),
      }
    })
  }, [])

  const editor = useEditor(
    {
      extensions: editorExtensions,
      content: EMPTY_EDITOR_JSON,
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: "odessay-editor-content",
          spellcheck: "false",
        },
      },
      onUpdate: ({ editor: nextEditor, transaction }) => {
        if (isApplyingContentRef.current || modeRef.current === "markdown") {
          return
        }

        if (shouldDeferRichModeSideEffects(transaction)) {
          richUpdateEditorRef.current = nextEditor

          if (richUpdateRafRef.current !== null) {
            return
          }

          richUpdateRafRef.current = window.requestAnimationFrame(() => {
            flushQueuedRichModeUpdate()
          })
          return
        }

        if (richUpdateRafRef.current !== null) {
          window.cancelAnimationFrame(richUpdateRafRef.current)
          richUpdateRafRef.current = null
          richUpdateEditorRef.current = null
        }

        runRichModeUpdateSideEffects(nextEditor)
      },
    },
    [editorExtensions, flushQueuedRichModeUpdate, runRichModeUpdateSideEffects],
  )

  useEffect(() => {
    modeRef.current = mode
  }, [mode])

  useEffect(() => {
    titleRef.current = title
  }, [title])

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
      const localWriting = await localDB.writings.get(currentWritingId)

      if (cancelled) {
        return
      }

      if (localWriting) {
        isApplyingContentRef.current = true
        // Load JSON first to get the markdown serialization, then re-parse as markdown
        // so that footnote references are converted to footnoteReference nodes.
        editor.commands.setContent(localWriting.body_json)
        const loadedMarkdown = getEditorMarkdown(editor)
        if (loadedMarkdown) {
          editor.commands.setContent(loadedMarkdown)
        }
        isApplyingContentRef.current = false

        const loadedTitle = localWriting.title ?? "Untitled writing"
        setTitle(loadedTitle)
        setHasExplicitTitle(loadedTitle !== "Untitled writing" && loadedTitle !== "")
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
        setTitle("Untitled writing")
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
    })
  }, [currentWritingId])

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
      if (editor) {
        isApplyingContentRef.current = true
      }

      void applyPanelMarkdownChange(editor, nextMarkdown, {
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
    (action: EditorShortcutAction) => {
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
          editor.commands.setContent(nextMarkdown)
          isApplyingContentRef.current = false
          setWordCount(getWordCount(editor))
          setBodyText(editor.getText())
          void persistEditorSnapshot(editor)
          markdownSaveTimeoutRef.current = null
        }, MARKDOWN_SAVE_DEBOUNCE_MS)
      }

      const replaceMarkdownSelection = (
        replacement: string,
        options?: {
          selectionStart?: number
          selectionEnd?: number
        },
      ) => {
        const textarea = markdownTextareaRef.current
        const fallbackCursor = markdownValue.length
        const start = textarea?.selectionStart ?? fallbackCursor
        const end = textarea?.selectionEnd ?? fallbackCursor
        const nextMarkdown = `${markdownValue.slice(0, start)}${replacement}${markdownValue.slice(end)}`
        const nextSelectionStart = start + (options?.selectionStart ?? replacement.length)
        const nextSelectionEnd = start + (options?.selectionEnd ?? options?.selectionStart ?? replacement.length)

        persistMarkdownDraft(nextMarkdown)

        queueMarkdownSelectionRestore(nextSelectionStart, nextSelectionEnd)
      }

      const toggleMarkdownWrap = (marker: string) => {
        const textarea = markdownTextareaRef.current
        const fallbackCursor = markdownValue.length
        const start = textarea?.selectionStart ?? fallbackCursor
        const end = textarea?.selectionEnd ?? fallbackCursor
        const selectedText = markdownValue.slice(start, end)

        if (!selectedText) {
          replaceMarkdownSelection(`${marker}${marker}`, {
            selectionStart: marker.length,
            selectionEnd: marker.length,
          })
          return
        }

        if (
          selectedText.startsWith(marker) &&
          selectedText.endsWith(marker) &&
          selectedText.length >= marker.length * 2
        ) {
          const unwrapped = selectedText.slice(marker.length, selectedText.length - marker.length)
          replaceMarkdownSelection(unwrapped, {
            selectionStart: 0,
            selectionEnd: unwrapped.length,
          })
          return
        }

        replaceMarkdownSelection(`${marker}${selectedText}${marker}`, {
          selectionStart: marker.length,
          selectionEnd: marker.length + selectedText.length,
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
        const fallbackCursor = markdownValue.length
        const selectionStart = textarea?.selectionStart ?? fallbackCursor
        const selectionEnd = textarea?.selectionEnd ?? fallbackCursor
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

        queueMarkdownSelectionRestore(blockStart, nextSelectionEnd)
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

      switch (action) {
        case "bold":
          editor.chain().focus().toggleBold().run()
          return
        case "italic":
          editor.chain().focus().toggleItalic().run()
          return
        case "strike":
          editor.chain().focus().toggleStrike().run()
          return
        case "highlight":
          editor.chain().focus().toggleHighlight().run()
          return
        case "inlineCode":
          editor.chain().focus().toggleCode().run()
          return
        case "codeBlock":
          editor.chain().focus().toggleCodeBlock().run()
          return
        case "paragraph":
          editor.chain().focus().setParagraph().run()
          return
        case "heading1":
          editor.chain().focus().toggleHeading({ level: 1 }).run()
          return
        case "heading2":
          editor.chain().focus().toggleHeading({ level: 2 }).run()
          return
        case "heading3":
          editor.chain().focus().toggleHeading({ level: 3 }).run()
          return
        case "blockquote":
          editor.chain().focus().toggleBlockquote().run()
          return
        case "bulletList":
          editor.chain().focus().toggleBulletList().run()
          return
        case "orderedList":
          editor.chain().focus().toggleOrderedList().run()
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
        setMarkdownValue(getMarkdownWithFootnoteDefinitions(bodyMarkdown, footnoteNodes))
        return
      }

      modeRef.current = "rich"
      isApplyingContentRef.current = true
      editor.commands.setContent(markdownValue)
      isApplyingContentRef.current = false
      setMode("rich")
      updateDerivedEditorState(editor)
      void persistEditorSnapshot(editor)
    },
    [editor, markdownValue, persistEditorSnapshot, updateDerivedEditorState],
  )

  const handleMarkdownChange = useCallback(
    (nextMarkdown: string) => {
      setMarkdownValue(nextMarkdown)

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
        editor.commands.setContent(nextMarkdown)
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
            editor.commands.setContent(nextMarkdown)
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
        editor.commands.setContent(nextMarkdown)
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
      <div className="EditorLayout flex min-h-screen flex-col">
        {!isFocusMode ? (
          <EditorTopbar
            editor={editor}
            title={displayTitle}
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
                status={writingStatus}
                metrics={textMetrics}
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
              />
            )}
          </Suspense>
        ) : null}
      </div>

      <RenameWritingModal
        open={renameModalOpen}
        title={displayTitle}
        onOpenChange={setRenameModalOpen}
        onConfirm={(nextTitle) => {
          setTitle(nextTitle)
          setHasExplicitTitle(true)

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
