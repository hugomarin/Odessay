"use client"

import { useSyncExternalStore } from "react"

export type SidebarMode = "expanded" | "collapsed"
export type SidebarPanel = "collections" | null

export type UiShellState = {
  sidebarMode: SidebarMode
  panel: SidebarPanel
}

type UiShellListener = () => void

const STORAGE_KEY = "odessay-ui-shell"
const DEFAULT_STATE: UiShellState = {
  sidebarMode: "expanded",
  panel: null,
}

let state: UiShellState = DEFAULT_STATE
const listeners = new Set<UiShellListener>()
let hasHydratedFromStorage = false

function emitChange() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: UiShellListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return state
}

function persist(nextState: UiShellState) {
  if (typeof window === "undefined") {
    return
  }

  window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(nextState))
}

function loadFromStorage() {
  if (typeof window === "undefined" || hasHydratedFromStorage) {
    return
  }

  hasHydratedFromStorage = true
  const rawState = window.sessionStorage.getItem(STORAGE_KEY)

  if (!rawState) {
    return
  }

  try {
    const parsedState = JSON.parse(rawState) as Partial<UiShellState>

    state = {
      sidebarMode: parsedState.sidebarMode === "collapsed" ? "collapsed" : "expanded",
      panel: parsedState.panel === "collections" ? "collections" : null,
    }
  } catch {
    state = DEFAULT_STATE
  }
}

function setState(updater: (current: UiShellState) => UiShellState) {
  loadFromStorage()

  const nextState = updater(state)
  if (nextState.sidebarMode === state.sidebarMode && nextState.panel === state.panel) {
    return
  }

  state = nextState
  persist(nextState)
  emitChange()
}

export function useUiShellStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE)
}

export function initializeUiShellStore() {
  const previousState = state
  loadFromStorage()

  if (previousState.sidebarMode !== state.sidebarMode || previousState.panel !== state.panel) {
    emitChange()
  }
}

export function setSidebarMode(sidebarMode: SidebarMode) {
  setState((current) => ({
    ...current,
    sidebarMode,
  }))
}

export function toggleSidebarMode() {
  setState((current) => {
    if (current.sidebarMode === "expanded") {
      return {
        sidebarMode: "collapsed",
        panel: null,
      }
    }

    return {
      sidebarMode: "expanded",
      panel: current.panel,
    }
  })
}

export function setSidebarPanel(panel: SidebarPanel) {
  setState((current) => ({
    ...current,
    panel,
  }))
}

export function syncSidebarPanelWithPath(pathname: string) {
  const panel = pathname.startsWith("/collections") ? "collections" : null

  setState((current) => ({
    ...current,
    panel,
  }))
}
