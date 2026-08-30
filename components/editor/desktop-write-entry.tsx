"use client"

import { useSyncExternalStore } from "react"
import { EditorShell } from "@/components/editor/editor-shell"

/**
 * Desktop entry for the /write route.
 *
 * The packaged desktop app is a static export with no server, so dynamic path
 * segments like /write/<uuid> have no generated HTML and fail on hard
 * navigation. Desktop links instead point at /write?id=<uuid> (see
 * buildWritingRouteHref), and this client component reads the id from the query
 * string and feeds it to EditorShell.
 *
 * Why not useSearchParams: in `output: export`, /write is prerendered without a
 * query, and on a soft (client) navigation to /write?id=X the App Router hands
 * back the stale prerendered searchParams (empty) instead of the new query. The
 * result is writingId=undefined, so opening a writing from the sidebar/desk/
 * search silently spawns a blank "Untitled artifact" draft instead of loading
 * the target. This only reproduces in the packaged build, never in `tauri dev`
 * (which runs the Next dev server, where useSearchParams is reactive).
 *
 * The fix reads the id straight from window.location and re-reads it on every
 * navigation: popstate (back/forward) plus a patched history.pushState, which
 * is what Link/router.push emit when opening a writing. replaceState is left
 * untouched on purpose — replaceEditorHistory uses it for soft tab switches
 * that EditorShell already handles internally, and remounting on those would
 * cause a re-hydration flash on every tab switch.
 *
 * The key forces a remount when the target writing changes, matching the web
 * route's keying so per-writing editor state never leaks between documents.
 */

const LOCATION_CHANGE_EVENT = "odessay:locationchange"

let pushStatePatched = false

function ensurePushStatePatched() {
  if (pushStatePatched || typeof window === "undefined") {
    return
  }
  pushStatePatched = true

  const originalPushState = window.history.pushState.bind(window.history)
  window.history.pushState = function patchedPushState(
    ...args: Parameters<typeof originalPushState>
  ) {
    const result = originalPushState(...args)
    window.dispatchEvent(new Event(LOCATION_CHANGE_EVENT))
    return result
  }
}

function subscribeToLocation(onChange: () => void) {
  ensurePushStatePatched()
  window.addEventListener("popstate", onChange)
  window.addEventListener(LOCATION_CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("popstate", onChange)
    window.removeEventListener(LOCATION_CHANGE_EVENT, onChange)
  }
}

function getSearchSnapshot() {
  return window.location.search
}

function getServerSearchSnapshot() {
  return ""
}

export function DesktopWriteEntry() {
  const search = useSyncExternalStore(
    subscribeToLocation,
    getSearchSnapshot,
    getServerSearchSnapshot,
  )
  const params = new URLSearchParams(search)
  const writingId = params.get("id") ?? undefined
  const forceNewWriting = params.get("new") === "1"

  return (
    <EditorShell
      key={writingId ?? (forceNewWriting ? "write-new" : "write-root")}
      writingId={writingId}
      forceNewWriting={forceNewWriting}
    />
  )
}
