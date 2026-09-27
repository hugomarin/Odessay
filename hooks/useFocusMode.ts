"use client"

/**
 * Entrar, salir y alternar el focus mode del editor. Al entrar se recuerdan
 * el panel lateral y la búsqueda que estaban abiertos, y se cierran; al salir
 * se restauran.
 *
 * ODE-602 — corte 4a de `components/editor/editor-shell.tsx`, entrega 2.
 * MUDANZA MECÁNICA, como ODE-587: los tres callbacks son los que vivían en la
 * shell, con las mismas dependencias, y la shell llama a este hook donde
 * estaban. No hay efectos, así que el orden de efectos de la shell no cambia.
 * El estado (`isFocusMode`, `activePanel`, `isFindReplaceOpen`) y el ref de la
 * restauración siguen siendo de la shell y llegan por `input`; el efecto que
 * pone la clase de focus mode en `<body>` se queda en la shell, en su sitio.
 * Red: `tests/editor-shell-chrome-focus-panels.test.tsx`.
 */
import { useCallback } from "react"
import type { EditorRightPanelTab } from "@/components/editor/panels/editor-right-panel-tabs"

/** El panel lateral abierto; el mismo tipo que `EditorPanel` de la shell. */
type OpenPanel = EditorRightPanelTab | null

export type FocusModeRestoration = {
  activePanel: OpenPanel
  isFindReplaceOpen: boolean
}

export type FocusModeInput = {
  activePanel: OpenPanel
  focusModeRestorationRef: React.RefObject<FocusModeRestoration | null>
  isFindReplaceOpen: boolean
  isFocusMode: boolean
  setActivePanel: React.Dispatch<React.SetStateAction<OpenPanel>>
  setIsFindReplaceOpen: React.Dispatch<React.SetStateAction<boolean>>
  setIsFocusMode: React.Dispatch<React.SetStateAction<boolean>>
}

export function useFocusMode(input: FocusModeInput) {
  const {
    activePanel,
    focusModeRestorationRef,
    isFindReplaceOpen,
    isFocusMode,
    setActivePanel,
    setIsFindReplaceOpen,
    setIsFocusMode,
  } = input

  const enterFocusMode = useCallback(() => {
    if (isFocusMode) {
      return
    }

    focusModeRestorationRef.current = { activePanel, isFindReplaceOpen }

    setActivePanel(null)
    setIsFindReplaceOpen(false)
    setIsFocusMode(true)
  }, [activePanel, focusModeRestorationRef, isFindReplaceOpen, isFocusMode, setActivePanel, setIsFindReplaceOpen, setIsFocusMode])

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
  }, [focusModeRestorationRef, isFocusMode, setActivePanel, setIsFindReplaceOpen, setIsFocusMode])

  const toggleFocusMode = useCallback(() => {
    if (isFocusMode) {
      exitFocusMode()
    } else {
      enterFocusMode()
    }
  }, [enterFocusMode, exitFocusMode, isFocusMode])

  return { enterFocusMode, exitFocusMode, toggleFocusMode }
}
