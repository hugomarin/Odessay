"use client"

/**
 * El despachador de comandos del editor: cada `EditorShortcutAction` —la lista
 * única de `lib/editor/shortcuts.ts`— a su efecto, en modo Rich y en modo
 * Markdown, más los modales de link, tabla, footnote e imagen y la navegación
 * del chrome.
 *
 * ODE-603 — corte 4b de `components/editor/editor-shell.tsx`, entrega 2.
 * MUDANZA MECÁNICA, como ODE-602/ODE-587: el cuerpo de `handleRunAction` es el
 * que vivía en la shell; ODE-530 agrega aquí Tip/Info/Card para conservar la
 * semántica de sus comandos tras la extracción. La propiedad del estado NO cambia: el
 * estado y los refs siguen siendo de la shell y llegan por `input` (identidades
 * estables, así que la memoización no cambia). Los helpers puros de la shell
 * (`markdownSelectionOwnerId` y `readMarkdownSelectionForActiveDocument`) llegan
 * por `input` para no crear un ciclo de imports, como en ODE-587. Sin efectos:
 * el orden de efectos de la shell no cambia. La lista de acciones no se
 * duplica aquí; el hook la consume por tipo.
 *
 * Los tipos `PendingRichSelectionSnapshot` y `PendingAnnotationSnapshot` viven
 * aquí porque el contrato de `input` los expone; la shell los importa.
 *
 * Red: `tests/editor-shell-commands.test.tsx` (las 41 acciones en ambos modos),
 * que pasa idéntica antes y después de esta mudanza.
 */
import { useCallback } from "react"
import { type JSONContent } from "@tiptap/core"
import { generateHTML } from "@tiptap/html"
import { type Editor } from "@tiptap/react"
import { useRouter } from "next/navigation"
import { type EditorRightPanelTab } from "@/components/editor/panels/editor-right-panel-tabs"
import { type EditorSaveState } from "@/components/editor/save-state"
import type { CorrectionToastState } from "@/hooks/useCorrectionActions"
import { type AnnotationBubblePosition } from "@/components/reading/margins/annotation-bubble"
import { type SelectionPopupPosition } from "@/components/reading/margins/selection-popup"
import type { MarkdownSelectionSnapshot } from "@/hooks/useEditorSelection"
import { getEditorMarkdown } from "@/lib/editor/extensions"
import { materializeMarkdownForRichParser, toggleMarkdownInlineMarker } from "@/lib/editor/markdown-format"
import { type EditorShortcutAction } from "@/lib/editor/shortcuts"
import { type RichSelectionRange } from "@/lib/editor/topbar-compact"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { toggleSidebarMode } from "@/lib/stores/ui-shell-store"

export type PendingAnnotationSnapshot = {
  from: number
  to: number
  text: string
  position: AnnotationBubblePosition
  /** Draft identity — stable across repositioning (ODE-409). */
  sessionId: string
  annotationType?: "personal" | "ai" | "footnote"
}

export type PendingRichSelectionSnapshot = {
  from: number
  to: number
  text: string
  writingId: string | null
  popupPosition: SelectionPopupPosition
  bubblePosition: AnnotationBubblePosition
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

/** El panel lateral abierto; el mismo tipo que `EditorPanel` de la shell. */
type OpenPanel = EditorRightPanelTab | null

export type EditorCommandsInput = {
  applySyncStatus: (next: EditorSaveState) => void
  captureRichSelectionSnapshot: () => PendingRichSelectionSnapshot | null
  createWorkspaceTabRef: React.RefObject<((options?: { skipConfirm?: boolean }) => Promise<void>) | null>
  currentWritingId: string | null
  currentWritingIdRef: React.RefObject<string | null>
  editor: Editor | null
  hasUnconfirmedLocalEditRef: React.RefObject<boolean>
  isApplyingContentRef: React.RefObject<boolean>
  markdownSaveTimeoutRef: React.RefObject<number | null>
  markdownSelectionOwnerId: (writingId: string | null) => string
  markdownSelectionRef: React.RefObject<OwnedMarkdownSelectionSnapshot | null>
  markdownTextareaRef: React.RefObject<HTMLTextAreaElement | null>
  markdownValue: string
  modeRef: React.RefObject<"rich" | "markdown">
  openFindReplacePanel: (options?: { focusReplace?: boolean }) => void
  openInsertImageModal: () => Promise<void>
  persistEditorSnapshot: (editorInstance: Editor) => Promise<boolean>
  queueMarkdownSelectionRestore: (
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
  ) => void
  readMarkdownSelectionForActiveDocument: (
    cached: OwnedMarkdownSelectionSnapshot | null,
    activeWritingId: string | null,
    source?: string,
  ) => MarkdownSelectionRead
  router: ReturnType<typeof useRouter>
  scheduleMarkdownSave: (run: () => void) => number
  selectAdjacentTabRef: React.RefObject<((direction: number) => void) | null>
  selectionRef: React.RefObject<SelectionSnapshot | null>
  showCorrectionToast: (toast: CorrectionToastState, durationMs: number) => void
  setActivePanel: React.Dispatch<React.SetStateAction<OpenPanel>>
  setBodyText: React.Dispatch<React.SetStateAction<string>>
  setFootnoteModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setIsShortcutHelpOpen: React.Dispatch<React.SetStateAction<boolean>>
  setIsTabBarVisible: React.Dispatch<React.SetStateAction<boolean>>
  setIsTopbarVisible: React.Dispatch<React.SetStateAction<boolean>>
  setLinkModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  setMarkdownValue: React.Dispatch<React.SetStateAction<string>>
  setPendingAnnotation: React.Dispatch<React.SetStateAction<PendingAnnotationSnapshot | null>>
  setPendingRichSelection: React.Dispatch<React.SetStateAction<PendingRichSelectionSnapshot | null>>
  setTableModalOpen: React.Dispatch<React.SetStateAction<boolean>>
  toggleFocusMode: () => void
}

export function useEditorCommands(input: EditorCommandsInput) {
  const {
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
    showCorrectionToast,
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
  } = input

  const handleRunAction = useCallback(
    (action: EditorShortcutAction, options?: { richSelection?: RichSelectionRange }) => {
      const writingId = markdownSelectionOwnerId(currentWritingId)
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
        if (markdownSelectionOwnerId(currentWritingIdRef.current) !== writingId) {
          return
        }

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
          writingId,
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

        applySyncStatus("saving")

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
        const markdownSelection = readMarkdownSelectionForActiveDocument(
          markdownSelectionRef.current,
          currentWritingIdRef.current,
          markdownValue,
        )
        const start = markdownSelection.selection?.start ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionStart ?? fallbackCursor)
        const end = markdownSelection.selection?.end ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionEnd ?? fallbackCursor)
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
        const markdownSelection = readMarkdownSelectionForActiveDocument(
          markdownSelectionRef.current,
          currentWritingIdRef.current,
          markdownValue,
        )
        const selectionStart = markdownSelection.selection?.start ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionStart ?? fallbackCursor)
        const selectionEnd = markdownSelection.selection?.end ??
          (markdownSelection.belongsToOtherDocument ? fallbackCursor : textarea?.selectionEnd ?? fallbackCursor)
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
        case "tipBlock":
          editor.chain().focus().insertTip().run()
          return
        case "infoBlock":
          editor.chain().focus().insertInfo().run()
          return
        case "cardBlock": {
          const selectedRange = getValidatedRichSelection()
          let chain = editor.chain().focus()
          if (selectedRange) chain = chain.setTextSelection(selectedRange)
          if (selectedRange && selectedRange.from !== selectedRange.to) {
            if (!chain.convertSelectionToCard().run()) {
              showCorrectionToast(
                {
                  phase: "error",
                  completed: 0,
                  total: 0,
                  message: "Those blocks cannot be placed in a Card.",
                },
                4000,
              )
            }
          } else {
            chain.insertCard().run()
          }
          return
        }
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
      showCorrectionToast,
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
    ],
  )

  return { handleRunAction }
}
