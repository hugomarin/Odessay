"use client"

import { useSyncExternalStore } from "react"

export type HydrationProgressState = {
  active: boolean
  userId: string | null
  total: number
  completed: number
  message: string
  error: string | null
}

const HYDRATION_MARKER_PREFIX = "odessay.desktop.hydrated."

let state: HydrationProgressState = {
  active: false,
  userId: null,
  total: 0,
  completed: 0,
  message: "Syncing your writings…",
  error: null,
}

const listeners = new Set<() => void>()

function emit() {
  listeners.forEach((listener) => listener())
}

function setState(nextState: HydrationProgressState) {
  state = nextState
  emit()
}

function markerKey(userId: string) {
  return `${HYDRATION_MARKER_PREFIX}${userId}`
}

export function getHydrationProgressState(): HydrationProgressState {
  return state
}

export function subscribeToHydrationProgress(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useHydrationProgress(): HydrationProgressState {
  return useSyncExternalStore(
    subscribeToHydrationProgress,
    getHydrationProgressState,
    getHydrationProgressState,
  )
}

export function beginHydrationProgress(userId: string, total: number) {
  setState({
    active: true,
    userId,
    total,
    completed: 0,
    message: total > 0 ? `Syncing your writings… 0/${total}` : "Syncing your writings…",
    error: null,
  })
}

export function updateHydrationProgress(completed: number, total: number) {
  if (!state.active) {
    return
  }

  setState({
    ...state,
    total,
    completed,
    message: total > 0 ? `Syncing your writings… ${completed}/${total}` : "Syncing your writings…",
  })
}

export function completeHydrationProgress() {
  if (!state.active) {
    return
  }

  setState({
    ...state,
    active: false,
    completed: state.total,
    message: "Sync complete",
  })
}

export function failHydrationProgress(message: string) {
  setState({
    ...state,
    active: false,
    error: message,
    message: "Sync failed",
  })
}

export function resetHydrationProgress() {
  setState({
    active: false,
    userId: null,
    total: 0,
    completed: 0,
    message: "Syncing your writings…",
    error: null,
  })
}

export function hasHydratedUserOnDevice(userId: string): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return window.localStorage.getItem(markerKey(userId)) === "1"
}

export function markHydratedUserOnDevice(userId: string) {
  if (typeof window === "undefined") {
    return
  }

  window.localStorage.setItem(markerKey(userId), "1")
}
