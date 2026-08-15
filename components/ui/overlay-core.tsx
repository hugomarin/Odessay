"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * Shared behavior of the five overlay patterns — docs/design/overlays.md.
 *
 * Geometry lives in each primitive; everything that must be identical across
 * the closed inventory lives here: the single-overlay rule, the dirty-field
 * guard on scrim close, and the focus return when the trigger is gone.
 */

/* ---------------------------------------------------------------- one at a time */

const openModals = new Map<string, string>()

/**
 * Registers an open modal so a second one is loud in development.
 * A dropdown inside a modal is allowed; a modal from a modal is not — it
 * becomes a step of the flow modal instead.
 */
export function useSingleModalGuard(open: boolean, name: string): void {
  const id = React.useId()

  React.useEffect(() => {
    if (!open) return

    if (openModals.size > 0 && process.env.NODE_ENV !== "production") {
      const others = Array.from(openModals.values()).join(", ")
      console.error(
        `[overlay] "${name}" opened while "${others}" is already open. Only one overlay at a time — ` +
          "turn the second modal into a step of the first (docs/design/overlays.md)."
      )
    }

    openModals.set(id, name)
    return () => {
      openModals.delete(id)
    }
  }, [id, name, open])
}

/** Test seam: the guard is module state, so it has to be resettable. */
export function __resetOverlayRegistry(): void {
  openModals.clear()
}

/* ------------------------------------------------------------------ focus return */

/**
 * Radix returns focus to the trigger. When the trigger is unmounted while the
 * overlay is open — the row was deleted, the tab was closed — it falls back to
 * `body`, which strands the keyboard. This returns focus to a stable anchor
 * instead: `[data-overlay-focus-anchor]`, then `main`.
 */
function focusStableAnchor(): boolean {
  if (typeof document === "undefined") return false

  const anchor =
    document.querySelector<HTMLElement>("[data-overlay-focus-anchor]") ??
    document.querySelector<HTMLElement>("main")

  if (!anchor) return false

  if (!anchor.hasAttribute("tabindex")) {
    anchor.setAttribute("tabindex", "-1")
  }
  anchor.focus()
  return true
}

const INTERACTIVE_SELECTOR = "button,a[href],input,select,textarea,summary,[contenteditable='true']"

function isInteractiveControl(element: Element): boolean {
  if (element.matches(INTERACTIVE_SELECTOR)) return true
  const tabIndex = element.getAttribute("tabindex")
  return tabIndex !== null && Number(tabIndex) >= 0
}

/* -------------------------------------------------------------------- close guard */

export interface OverlayCloseGuardOptions {
  /** Whether the overlay is open. The trigger is only tracked while it is not. */
  open?: boolean
  /** A field inside the overlay has unsaved input. Scrim clicks then confirm first. */
  dirty?: boolean
  /** Called when the overlay actually closes. */
  onClose?: () => void
}

export interface OverlayCloseGuard {
  /** Props to spread on the Radix content element of any modal pattern. */
  contentProps: {
    onInteractOutside: (event: { preventDefault: () => void }) => void
    onCloseAutoFocus: (event: Event) => void
  }
  /** True while the discard confirmation is showing. */
  confirming: boolean
  /** Keep the overlay open with its state intact. */
  cancelClose: () => void
  /** Discard and close. */
  confirmClose: () => void
}

/**
 * Wires the two shared close rules: a scrim click closes unless a field is
 * dirty (then it confirms), and focus returns to a stable anchor when the
 * trigger has gone away. `Esc` is left to Radix — it closes always, including
 * during the 260ms entrance.
 */
export function useOverlayCloseGuard({
  open = false,
  dirty = false,
  onClose
}: OverlayCloseGuardOptions = {}): OverlayCloseGuard {
  const [confirming, setConfirming] = React.useState(false)
  const triggerRef = React.useRef<Element | null>(null)

  // The trigger is the last thing focused *before* the overlay opened. Tracking
  // stops while it is open, so focus moving inside — or landing on a container
  // as the overlay unmounts — never overwrites where focus has to return.
  React.useEffect(() => {
    if (typeof document === "undefined" || open) return

    const remember = () => {
      const active = document.activeElement
      if (!active || active === document.body) return
      // Only an interactive control is a trigger. Containers that take focus
      // programmatically — a `main` with `tabindex="-1"` during teardown, for
      // one — must not overwrite where focus has to return.
      if (!isInteractiveControl(active)) return
      // Anything inside an open overlay — including the focus guards it renders
      // around itself — is not the trigger.
      if (active.hasAttribute("data-radix-focus-guard")) return
      for (let node: Element | null = active; node; node = node.parentElement) {
        const role = node.getAttribute("role")
        if (role === "dialog" || role === "alertdialog" || role === "menu") return
      }
      triggerRef.current = active
    }

    remember()
    // `focus` in the capture phase covers environments that do not bubble
    // `focusin` for programmatic focus.
    document.addEventListener("focusin", remember, true)
    document.addEventListener("focus", remember, true)
    return () => {
      document.removeEventListener("focusin", remember, true)
      document.removeEventListener("focus", remember, true)
    }
  }, [open])

  React.useEffect(() => {
    if (!dirty) setConfirming(false)
  }, [dirty])

  const onInteractOutside = React.useCallback(
    (event: { preventDefault: () => void }) => {
      if (!dirty) return
      event.preventDefault()
      setConfirming(true)
    },
    [dirty]
  )

  // Focus return is driven here rather than left to the primitive's default:
  // the trigger when it survived, a stable anchor when it did not — never `body`.
  const onCloseAutoFocus = React.useCallback((event: Event) => {
    const trigger = triggerRef.current

    const focusable = trigger as HTMLElement | null
    if (focusable?.isConnected && typeof focusable.focus === "function") {
      event.preventDefault()
      focusable.focus()
      return
    }

    if (focusStableAnchor()) event.preventDefault()
  }, [])

  return {
    contentProps: { onInteractOutside, onCloseAutoFocus },
    confirming,
    cancelClose: React.useCallback(() => setConfirming(false), []),
    confirmClose: React.useCallback(() => {
      setConfirming(false)
      onClose?.()
    }, [onClose]),
  }
}

/* ------------------------------------------------------------- discard confirmation */

export interface DiscardConfirmProps {
  open: boolean
  onCancel: () => void
  onDiscard: () => void
  message?: string
  className?: string
}

/**
 * The confirmation for a dirty close. It is a layer inside the overlay, not a
 * second modal: cancelling leaves the overlay and its fields exactly as they
 * were.
 */
export function DiscardConfirm({ open, onCancel, onDiscard, message, className }: DiscardConfirmProps) {
  const cancelRef = React.useRef<HTMLButtonElement>(null)

  React.useEffect(() => {
    if (open) cancelRef.current?.focus()
  }, [open])

  if (!open) return null

  return (
    <div
      role="alertdialog"
      aria-modal="true"
      aria-label="Discard changes"
      data-testid="overlay-discard-confirm"
      className={cn(
        "absolute inset-0 z-10 flex flex-col items-center justify-center gap-4 bg-sb/95 px-8 text-center font-sans",
        className
      )}
    >
      <p className="max-w-[38ch] text-sm leading-relaxed text-ink-2">
        {message ?? "You have unsaved changes. Discard them?"}
      </p>
      <div className="flex items-center gap-2.5">
        <button
          ref={cancelRef}
          type="button"
          onClick={onCancel}
          className="inline-flex h-9 items-center rounded-[9px] border-[0.5px] border-border bg-sb px-3.5 text-[13px] font-medium text-ink-2 transition-colors hover:bg-muted"
        >
          Keep editing
        </button>
        <button
          type="button"
          onClick={onDiscard}
          className="inline-flex h-9 items-center rounded-[9px] px-3.5 text-[13px] font-medium text-cursor transition-colors hover:bg-muted"
        >
          Discard
        </button>
      </div>
    </div>
  )
}
