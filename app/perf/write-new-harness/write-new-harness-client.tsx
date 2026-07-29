"use client"

import { useState } from "react"

import { EditorShell } from "@/components/editor/editor-shell"
import {
  getDesktopDraftLifecycleHarness,
  installDesktopDraftLifecycleHarness,
} from "@/lib/testing/desktop-draft-lifecycle-harness"

export function WriteNewHarnessClient() {
  useState(() => {
    if (!getDesktopDraftLifecycleHarness()) installDesktopDraftLifecycleHarness()
    return true
  })

  return (
    <>
      <EditorShell />
      <output
        className="sr-only"
        data-testid="desktop-draft-lifecycle-counters"
        aria-live="polite"
      >
        desktop draft lifecycle instrumentation installed
      </output>
    </>
  )
}
