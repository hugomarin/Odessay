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
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import {
  appendMarkdownFootnote,
  getMarkdownFootnotes,
  removeMarkdownFootnote,
  updateMarkdownFootnote,
} from "@/lib/editor/footnote-extension"
import { FOOTNOTE_REF_EVENT } from "@/lib/editor/footnote-node"
import { resolveEscapeIntent } from "@/lib/editor/panel-behavior"
import { applyPanelMarkdownChange, applyPanelMetaChange } from "@/lib/editor/panel-sync"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { type EditorShortcutAction, getEditorShortcutAction } from "@/lib/editor/shortcuts"
import { calculateTextMetrics } from "@/lib/editor/text-metrics"
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
  const editorExtensions = useMemo(() => createEditorExtensions(), [])

  const updateDerivedEditorState = useCallback((editorInstance: Editor) => {
    setWordCount(getWordCount(editorInstance))
    setMarkdownValue(getEditorMarkdown(editorInstance))
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
      onUpdate: ({ editor: nextEditor }) => {
        if (isApplyingContentRef.current || modeRef.current === "markdown") {
          return
        }

        updateDerivedEditorState(nextEditor)
        void persistEditorSnapshot(nextEditor)
      },
    },
    [editorExtensions, persistEditorSnapshot, updateDerivedEditorState],
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
        editor.commands.setContent(localWriting.body_json)
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
      if (!editor) {
        return
      }

      const captureSelection = () => {
        const { from, to } = editor.state.selection
        selectionRef.current = {
          from,
          to,
          text: editor.state.doc.textBetween(from, to, " "),
        }
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
        case "focusMode":
          setIsFocusMode((currentState) => !currentState)
          return
        default:
          return
      }
    },
    [editor],
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
        setMarkdownValue(getEditorMarkdown(editor))
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
        updateDerivedEditorState(editor)
        void persistEditorSnapshot(editor)
        markdownSaveTimeoutRef.current = null
      }, MARKDOWN_SAVE_DEBOUNCE_MS)
    },
    [editor, persistEditorSnapshot, updateDerivedEditorState],
  )

  const handleInsertLink = useCallback(
    (payload: { text: string; url: string }) => {
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
    [editor],
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

  const handleInsertFootnote = useCallback(
    (note: string) => {
      if (!editor) {
        return
      }

      const snapshot = selectionRef.current

      if (snapshot) {
        editor.chain().focus().setTextSelection({ from: snapshot.from, to: snapshot.to }).run()
      } else {
        editor.commands.focus()
      }

      editor.commands.addFootnote(note)
      updateDerivedEditorState(editor)
      setActivePanel("notes")
    },
    [editor, updateDerivedEditorState],
  )

  const footnotes = useMemo(() => getMarkdownFootnotes(markdownValue), [markdownValue])
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

      if (renameModalOpen || linkModalOpen || footnoteModalOpen) {
        return
      }

      const action = getEditorShortcutAction(event)

      if (!action) {
        return
      }

      if (modeRef.current === "markdown" && action !== "focusMode") {
        return
      }

      event.preventDefault()
      handleRunAction(action)
    }

    window.addEventListener("keydown", onWindowKeyDown)

    return () => {
      window.removeEventListener("keydown", onWindowKeyDown)
    }
  }, [activePanel, footnoteModalOpen, handleRunAction, isFocusMode, linkModalOpen, renameModalOpen])

  return (
    <section id="editor" data-page="editor" className="min-h-screen bg-bg">
      <div className="EditorLayout flex min-h-screen flex-col">
        {!isFocusMode ? (
          <EditorTopbar
            editor={editor}
            mode={mode}
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
                  const nextMarkdown = appendMarkdownFootnote(markdownValue, text)
                  applyMarkdownFromPanel(nextMarkdown)
                }}
                onUpdateFootnote={(index, text) => {
                  const nextMarkdown = updateMarkdownFootnote(markdownValue, index, text)
                  applyMarkdownFromPanel(nextMarkdown)
                }}
                onDeleteFootnote={(index) => {
                  const nextMarkdown = removeMarkdownFootnote(markdownValue, index)
                  applyMarkdownFromPanel(nextMarkdown)
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
    </section>
  )
}
