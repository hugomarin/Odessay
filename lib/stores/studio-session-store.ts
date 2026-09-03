"use client"

import { useSyncExternalStore } from "react"
import type { EditorTabSaveState, LocalEditorSessionTab } from "@/lib/local-db/schema"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

export type StudioArtifact = {
  id: string
  writingId: string | null
  title: string
  href: string
  saveState: EditorTabSaveState
  hasPendingSync: boolean
  lastTouchedAt: number
}

type StudioSessionState = {
  activeArtifactId: string | null
  artifacts: StudioArtifact[]
}

type StudioSessionListener = () => void

const DEFAULT_STATE: StudioSessionState = {
  activeArtifactId: null,
  artifacts: [],
}

let state: StudioSessionState = DEFAULT_STATE
const listeners = new Set<StudioSessionListener>()

function emitChange() {
  listeners.forEach((listener) => listener())
}

function subscribe(listener: StudioSessionListener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return state
}

function getArtifactHref(tab: LocalEditorSessionTab) {
  // Resolve the editor view URL via the shared helper so desktop (static export)
  // gets /write?id=<uuid> while web keeps /write/<slug>. Hardcoding the path form
  // here would fail with "Load failed" on hard navigation in the DMG.
  return tab.writing_id
    ? buildWritingRouteHref("/write", { id: tab.writing_id, slug: tab.slug })
    : "/write?new=1"
}

function toStudioArtifact(tab: LocalEditorSessionTab): StudioArtifact {
  return {
    id: tab.id,
    writingId: tab.writing_id,
    title: tab.title?.trim() || "Untitled artifact",
    href: getArtifactHref(tab),
    saveState: tab.save_state,
    hasPendingSync: tab.has_pending_sync,
    lastTouchedAt: tab.last_touched_at,
  }
}

function areArtifactsEqual(left: StudioArtifact[], right: StudioArtifact[]) {
  if (left.length !== right.length) {
    return false
  }

  return left.every((item, index) => {
    const other = right[index]
    return Boolean(other) &&
      item.id === other.id &&
      item.writingId === other.writingId &&
      item.title === other.title &&
      item.href === other.href &&
      item.saveState === other.saveState &&
      item.hasPendingSync === other.hasPendingSync &&
      item.lastTouchedAt === other.lastTouchedAt
  })
}

function setStudioSession(nextState: StudioSessionState) {
  if (
    nextState.activeArtifactId === state.activeArtifactId &&
    areArtifactsEqual(nextState.artifacts, state.artifacts)
  ) {
    return
  }

  state = nextState
  emitChange()
}

export function useStudioSessionStore() {
  return useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_STATE)
}

export function getStudioSessionState() {
  return state
}

export function syncStudioSessionFromEditorTabs(
  tabs: LocalEditorSessionTab[],
  activeTabId: string | null,
) {
  const artifacts = tabs.map(toStudioArtifact)
  const nextActiveArtifactId = activeTabId && artifacts.some((artifact) => artifact.id === activeTabId)
    ? activeTabId
    : artifacts[0]?.id ?? null

  setStudioSession({
    activeArtifactId: nextActiveArtifactId,
    artifacts,
  })
}

export function resetStudioSessionForTests() {
  state = DEFAULT_STATE
  emitChange()
}
