"use client"

import { useSyncExternalStore } from "react"
import {
  parseSidebarModeCookie,
  SIDEBAR_MODE_COOKIE_KEY,
  SIDEBAR_MODE_COOKIE_MAX_AGE_SECONDS,
  type SidebarMode,
} from "@/lib/stores/ui-shell-state"

export type UiShellState = {
  sidebarMode: SidebarMode
}

type UiShellListener = () => void

const DEFAULT_STATE: UiShellState = {
  sidebarMode: "collapsed",
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
  if (nextState.sidebarMode === state.sidebarMode) {
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
    }

    if (normalized.sidebarMode !== state.sidebarMode) {
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

  if (previousState.sidebarMode !== state.sidebarMode) {
    emitChange()
  }
}

export function setSidebarMode(sidebarMode: SidebarMode) {
  if (sidebarMode === state.sidebarMode) {
    persist(state)
    return
  }

  setState((current) => ({
    ...current,
    sidebarMode,
  }))
}

export function toggleSidebarMode() {
  setState((current) => ({
    sidebarMode: current.sidebarMode === "expanded" ? "collapsed" : "expanded",
  }))
}
