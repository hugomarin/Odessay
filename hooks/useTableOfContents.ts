"use client"

/** TOC state/ref ownership and its scroll/navigation wiring (ODE-602/609).
 * State writers update their live refs in the same synchronous step. */
import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { type Editor } from "@tiptap/react"

/** Called before the editor extensions are created; introduces no effects. */
export function useTableOfContentsState() {
  const [tableOfContentsItems, commitItems] = useState<TableOfContentDataItem[]>([])
  const [selectedTableOfContentsItemId, commitActive] = useState<string | null>(null)
  const tableOfContentsItemsRef = useRef<TableOfContentDataItem[]>([])
  const activeTableOfContentsItemIdRef = useRef<string | null>(null)
  const setTableOfContentsItems = useCallback((next: SetStateAction<TableOfContentDataItem[]>) => {
    const resolved = typeof next === "function" ? next(tableOfContentsItemsRef.current) : next
    tableOfContentsItemsRef.current = resolved
    commitItems(resolved)
  }, [])
  const setSelectedTableOfContentsItemId = useCallback((next: SetStateAction<string | null>) => {
    const resolved = typeof next === "function" ? next(activeTableOfContentsItemIdRef.current) : next
    activeTableOfContentsItemIdRef.current = resolved
    commitActive(resolved)
  }, [])
  return { tableOfContentsItems, selectedTableOfContentsItemId, tableOfContentsItemsRef,
    activeTableOfContentsItemIdRef, setTableOfContentsItems, setSelectedTableOfContentsItemId }
}

export type TableOfContentsInput = {
  activeTableOfContentsItemIdRef: React.RefObject<string | null>
  editor: Editor | null
  selectedTableOfContentsItemId: string | null
  setSelectedTableOfContentsItemId: React.Dispatch<React.SetStateAction<string | null>>
  tableOfContentsItems: TableOfContentDataItem[]
  tableOfContentsItemsRef: React.RefObject<TableOfContentDataItem[]>
  tableOfContentsScrollRafRef: React.RefObject<number | null>
}

export function useTableOfContents(input: TableOfContentsInput) {
  const {
    activeTableOfContentsItemIdRef,
    editor,
    selectedTableOfContentsItemId,
    setSelectedTableOfContentsItemId,
    tableOfContentsItems,
    tableOfContentsItemsRef,
    tableOfContentsScrollRafRef,
  } = input

  useEffect(() => {
    if (
      selectedTableOfContentsItemId &&
      !tableOfContentsItems.some((item) => item.id === selectedTableOfContentsItemId)
    ) {
      setSelectedTableOfContentsItemId(null)
    }
  }, [selectedTableOfContentsItemId, setSelectedTableOfContentsItemId, tableOfContentsItems])

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
      setSelectedTableOfContentsItemId(nextActiveItem.id)
    }
  }, [activeTableOfContentsItemIdRef, setSelectedTableOfContentsItemId, tableOfContentsItemsRef])

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
  }, [editor, syncActiveTableOfContentsItemFromScroll, tableOfContentsItems.length, tableOfContentsScrollRafRef])

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
    [editor, setSelectedTableOfContentsItemId],
  )

  return { navigateToTableOfContentsItem }
}
