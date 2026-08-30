"use client"

import { useSyncExternalStore } from "react"
import {
  DEFAULT_WRITING_STYLE,
  parseWritingStyle,
  WRITING_STYLE_STORAGE_KEY,
  type WritingStyle,
} from "@/lib/settings/writing-style"

const WRITING_STYLE_CHANGE_EVENT = "odessay:writing-style-change"

function applyWritingStyle(style: WritingStyle) {
  document.documentElement.dataset.writingStyle = style
}

function getSnapshot(): WritingStyle {
  if (typeof document === "undefined") {
    return DEFAULT_WRITING_STYLE
  }

  return parseWritingStyle(document.documentElement.dataset.writingStyle)
}

function subscribe(onStoreChange: () => void) {
  const handleWritingStyleChange = () => onStoreChange()
  const handleStorage = (event: StorageEvent) => {
    if (event.key !== WRITING_STYLE_STORAGE_KEY) {
      return
    }

    applyWritingStyle(parseWritingStyle(event.newValue))
    onStoreChange()
  }

  window.addEventListener(WRITING_STYLE_CHANGE_EVENT, handleWritingStyleChange)
  window.addEventListener("storage", handleStorage)

  return () => {
    window.removeEventListener(WRITING_STYLE_CHANGE_EVENT, handleWritingStyleChange)
    window.removeEventListener("storage", handleStorage)
  }
}

export function setWritingStyle(style: WritingStyle) {
  applyWritingStyle(style)

  try {
    window.localStorage.setItem(WRITING_STYLE_STORAGE_KEY, style)
  } catch {
    // The in-memory selection still applies when browser storage is unavailable.
  }

  window.dispatchEvent(new Event(WRITING_STYLE_CHANGE_EVENT))
}

export function useWritingStyle(): [WritingStyle, (style: WritingStyle) => void] {
  const style = useSyncExternalStore(subscribe, getSnapshot, () => DEFAULT_WRITING_STYLE)
  return [style, setWritingStyle]
}
