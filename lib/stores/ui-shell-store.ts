"use client"

import { useSyncExternalStore } from "react"
import {
  parseSidebarModeCookie,
  SIDEBAR_MODE_COOKIE_KEY,
  SIDEBAR_MODE_COOKIE_MAX_AGE_SECONDS,
  type SidebarMode,
} from "@/lib/stores/ui-shell-state"

export type SidebarPanel = "collections" | null

export type UiShellState = {
  sidebarMode: SidebarMode
  panel: SidebarPanel
}

type UiShellListener = () => void

const DEFAULT_STATE: UiShellState = {
  sidebarMode: "collapsed",
  panel: null,
}

let state: UiShellState = DEFAULT_STATE
const listeners = new Set<UiShellListener>()
let hasPrimedInitialState = false

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
  if (typeof document === "undefined") {
    return
  }

  document.cookie = `${SIDEBAR_MODE_COOKIE_KEY}=${nextState.sidebarMode}; Path=/; Max-Age=${SIDEBAR_MODE_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax`
}

function setState(updater: (current: UiShellState) => UiShellState) {
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

export function initializeUiShellStore(initialState?: Partial<UiShellState>) {
  if (initialState) {
    const normalized: UiShellState = {
      sidebarMode:
        initialState.sidebarMode === undefined
          ? state.sidebarMode
          : parseSidebarModeCookie(initialState.sidebarMode),
      panel: initialState.panel === "collections" ? "collections" : null,
    }

    if (
      normalized.sidebarMode !== state.sidebarMode ||
      normalized.panel !== state.panel
    ) {
      state = normalized
      emitChange()
    }

    hasPrimedInitialState = true
    return
  }

  if (hasPrimedInitialState) {
    return
  }

  const previousState = state
  if (typeof document !== "undefined") {
    const cookieEntry = document.cookie
      .split("; ")
      .find((entry) => entry.startsWith(`${SIDEBAR_MODE_COOKIE_KEY}=`))
    const cookieValue = cookieEntry?.split("=")[1]
    state = {
      ...state,
      sidebarMode: parseSidebarModeCookie(cookieValue),
    }
  }

  hasPrimedInitialState = true

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
