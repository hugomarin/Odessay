"use client"

/**
 * El cableado de la tabla de contenidos (TOC) del editor: los dos espejos de
 * sus items y del item activo, descartar el activo cuando desaparece, seguir
 * el scroll para marcar el encabezado a la vista, y llevar el cursor al
 * encabezado pulsado.
 *
 * ODE-602 — corte 4a de `components/editor/editor-shell.tsx`, entrega 2.
 * MUDANZA MECÁNICA, como ODE-587: los cuerpos y los cuatro efectos son los que
 * vivían en la shell, en el mismo orden, y la shell llama a este hook donde
 * empezaba ese bloque (entre su primer efecto y el último no había ningún
 * otro). `navigateToTableOfContentsItem` vivía más abajo; es un callback sin
 * efectos, así que traerlo aquí no cambia ningún orden. El estado y los refs
 * siguen siendo de la shell y llegan por `input`; las dependencias son las de
 * la shell más esos refs y setters (identidades estables).
 *
 * Los dos espejos (`tableOfContentsItemsRef`, `activeTableOfContentsItemIdRef`)
 * se mueven tal cual: quién es su dueño lo decide el corte 7 (ODE-609).
 * Siguen en la shell, en su sitio, los dos callbacks que necesita la
 * extensión TableOfContents al crearse (`getTableOfContentsScrollParent` y
 * `scheduleTableOfContentsUpdate`, con su debounce) y los dos efectos de
 * limpieza del debounce: son triviales y moverlos cambiaría el orden.
 * Red: `tests/editor-shell-chrome-toc.test.tsx`.
 */
import { useCallback, useEffect } from "react"
import type { TableOfContentDataItem } from "@tiptap/extension-table-of-contents"
import { type Editor } from "@tiptap/react"

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
    tableOfContentsItemsRef.current = tableOfContentsItems
  }, [tableOfContentsItems, tableOfContentsItemsRef])

  useEffect(() => {
    activeTableOfContentsItemIdRef.current = selectedTableOfContentsItemId
  }, [activeTableOfContentsItemIdRef, selectedTableOfContentsItemId])

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
      activeTableOfContentsItemIdRef.current = nextActiveItem.id
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
