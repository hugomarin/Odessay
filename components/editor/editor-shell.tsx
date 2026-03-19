"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { Editor } from "@tiptap/react"
import { useEditor } from "@tiptap/react"
import { useRouter } from "next/navigation"
import { WritingEditorContent } from "@/components/editor/editor-content"
import { EditorTopbar } from "@/components/editor/editor-topbar"
import { InsertFootnoteModal } from "@/components/editor/modals/insert-footnote-modal"
import { InsertLinkModal } from "@/components/editor/modals/insert-link-modal"
import { RenameWritingModal } from "@/components/editor/modals/rename-writing-modal"
import { EMPTY_EDITOR_JSON, createEditorExtensions, getEditorMarkdown } from "@/lib/editor/extensions"
import { type EditorShortcutAction, getEditorShortcutAction } from "@/lib/editor/shortcuts"
import { localDB } from "@/lib/local-db"
import type { LocalWriting } from "@/lib/local-db/schema"
import { enqueueWritingUpsert } from "@/lib/sync"
import { setSidebarMode } from "@/lib/stores/ui-shell-store"

type EditorShellProps = {
  writingId?: string
}

type SyncStatus = "saved" | "saving" | "error"

type SelectionSnapshot = {
  from: number
  to: number
  text: string
}

const MARKDOWN_SAVE_DEBOUNCE_MS = 800

const createWritingId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID()
  }

  return `writing-${Date.now()}`
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
  const [mode, setMode] = useState<"rich" | "markdown">("rich")
  const [markdownValue, setMarkdownValue] = useState("")
  const [wordCount, setWordCount] = useState(0)
  const [syncStatus, setSyncStatus] = useState<SyncStatus>("saved")
  const [lastSavedAt, setLastSavedAt] = useState<string | null>(null)
  const [version, setVersion] = useState(0)
  const [createdAt, setCreatedAt] = useState<string | null>(null)

  const [renameModalOpen, setRenameModalOpen] = useState(false)
  const [linkModalOpen, setLinkModalOpen] = useState(false)
  const [footnoteModalOpen, setFootnoteModalOpen] = useState(false)
  const [isFocusMode, setIsFocusMode] = useState(false)

  const modeRef = useRef(mode)
  const titleRef = useRef(title)
  const versionRef = useRef(version)
  const createdAtRef = useRef<string | null>(createdAt)
  const markdownSaveTimeoutRef = useRef<number | null>(null)
  const isApplyingContentRef = useRef(false)
  const hydratedIdRef = useRef<string | null>(null)
  const navigatedToDraftRef = useRef(false)
  const selectionRef = useRef<SelectionSnapshot | null>(null)
  const editorExtensions = useMemo(() => createEditorExtensions(), [])

  const persistEditorSnapshot = useCallback(
    async (editorInstance: Editor, titleOverride?: string) => {
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
        title: (titleOverride ?? titleRef.current).trim() || "Untitled writing",
        body_json: editorInstance.getJSON() as Record<string, unknown>,
        body_text: editorInstance.getText(),
        status: "draft",
        visibility: "private",
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
        setLastSavedAt(nowIso)
        setSyncStatus("saved")
      } catch {
        setSyncStatus("error")
      }
    },
    [currentWritingId, routeWritingId, router],
  )

  const editor = useEditor({
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

      setWordCount(getWordCount(nextEditor))
      setMarkdownValue(getEditorMarkdown(nextEditor))
      void persistEditorSnapshot(nextEditor)
    },
  }, [editorExtensions, persistEditorSnapshot])

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
    setCurrentWritingId(routeWritingId)
    hydratedIdRef.current = null
    navigatedToDraftRef.current = false
  }, [routeWritingId])

  useEffect(() => {
    setSidebarMode("collapsed")
  }, [])

  useEffect(() => {
    document.body.classList.toggle("od-editor-focus-mode", isFocusMode)

    return () => {
      document.body.classList.remove("od-editor-focus-mode")
    }
  }, [isFocusMode])

  useEffect(() => {
    if (!editor) {
      return
    }

    setWordCount(getWordCount(editor))
    setMarkdownValue(getEditorMarkdown(editor))

    if (!currentWritingId) {
      hydratedIdRef.current = null
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

        setTitle(localWriting.title ?? "Untitled writing")
        setVersion(localWriting.version)
        setCreatedAt(localWriting.created_at)
        setLastSavedAt(localWriting.updated_at)
        setWordCount(getWordCount(editor))
        setMarkdownValue(getEditorMarkdown(editor))
      } else {
        setTitle("Untitled writing")
        setVersion(0)
        setCreatedAt(null)
        setLastSavedAt(null)
      }

      hydratedIdRef.current = currentWritingId
    }

    void hydrateEditor()

    return () => {
      cancelled = true
    }
  }, [currentWritingId, editor])

  useEffect(() => {
    return () => {
      if (markdownSaveTimeoutRef.current) {
        window.clearTimeout(markdownSaveTimeoutRef.current)
      }
    }
  }, [])

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
      setWordCount(getWordCount(editor))
      void persistEditorSnapshot(editor)
    },
    [editor, markdownValue, persistEditorSnapshot],
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
        setWordCount(getWordCount(editor))
        void persistEditorSnapshot(editor)
        markdownSaveTimeoutRef.current = null
      }, MARKDOWN_SAVE_DEBOUNCE_MS)
    },
    [editor, persistEditorSnapshot],
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
      const nextMarkdown = getEditorMarkdown(editor)
      setMarkdownValue(nextMarkdown)
      setWordCount(getWordCount(editor))
    },
    [editor],
  )

  useEffect(() => {
    const onWindowKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        if (isFocusMode) {
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
  }, [footnoteModalOpen, handleRunAction, isFocusMode, linkModalOpen, renameModalOpen])

  const statusLabel = useMemo(() => {
    if (syncStatus === "saving") {
      return "Saving..."
    }

    if (syncStatus === "error") {
      return "Sync failed"
    }

    return "Saved"
  }, [syncStatus])

  return (
    <section
      id="editor"
      data-page="editor"
      className="min-h-screen bg-bg"
    >
      <div className="EditorLayout flex min-h-screen flex-col">
        {!isFocusMode ? (
          <EditorTopbar
            editor={editor}
            mode={mode}
            title={title}
            isFocusMode={isFocusMode}
            onToggleMode={handleToggleMode}
            onToggleFocusMode={() => setIsFocusMode((currentState) => !currentState)}
            onOpenRenameModal={() => setRenameModalOpen(true)}
            onRunAction={handleRunAction}
          />
        ) : null}

        <WritingEditorContent
          editor={editor}
          mode={mode}
          title={title}
          markdownValue={markdownValue}
          onTitleChange={setTitle}
          onTitleBlur={() => {
            if (editor) {
              void persistEditorSnapshot(editor)
            }
          }}
          onMarkdownChange={handleMarkdownChange}
        />

        {!isFocusMode ? (
          <div
            id="editor-statusbar"
            data-section="editor-statusbar"
            data-testid="editor-statusbar"
            className="EditorStatusbar flex h-8 items-center justify-between border-t-[0.5px] border-border px-4 text-[11px] text-ink-4"
          >
            <p>{statusLabel}</p>
            <div className="flex items-center gap-3">
              <span>{wordCount.toLocaleString()} words</span>
              {lastSavedAt ? <span>Last save {new Date(lastSavedAt).toLocaleTimeString()}</span> : null}
              <span>{mode === "markdown" ? "Markdown" : "Rich"}</span>
            </div>
          </div>
        ) : null}
      </div>

      <RenameWritingModal
        open={renameModalOpen}
        title={title}
        onOpenChange={setRenameModalOpen}
        onConfirm={(nextTitle) => {
          setTitle(nextTitle)

          if (editor) {
            void persistEditorSnapshot(editor, nextTitle)
          }
        }}
      />

      <InsertLinkModal
        open={linkModalOpen}
        initialText={selectionRef.current?.text ?? ""}
        onOpenChange={setLinkModalOpen}
        onConfirm={handleInsertLink}
      />

      <InsertFootnoteModal
        open={footnoteModalOpen}
        onOpenChange={setFootnoteModalOpen}
        onConfirm={handleInsertFootnote}
      />
    </section>
  )
}
