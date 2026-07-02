"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { buildWritingRouteHref } from "@/lib/writings/writing-route"

type AddToMyWritingsButtonProps = {
  source: "preview" | "shared"
  token?: string
  writingId?: string
  loginHref?: string | null
  autoStart?: boolean
  buttonClassName?: string
  errorClassName?: string
}

type ImportResponse =
  | { id: string }
  | { error?: { code?: string; message?: string } }

const getImportErrorMessage = (errorCode?: string, fallback = "Could not create your copy right now.") => {
  switch (errorCode) {
    case "UNAUTHORIZED":
      return "Login is required before creating a copy."
    case "PREVIEW_NOT_FOUND":
    case "PREVIEW_REVOKED":
      return "This preview link is no longer available."
    case "FORBIDDEN":
      return "You do not have access to this shared writing anymore."
    case "NOT_FOUND":
      return "This shared writing is no longer available."
    default:
      return fallback
  }
}

export function AddToMyWritingsButton({
  source,
  token,
  writingId,
  loginHref = null,
  autoStart = false,
  buttonClassName,
  errorClassName = "max-w-[220px] text-right text-[11px] text-destructive",
}: AddToMyWritingsButtonProps) {
  const router = useRouter()
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoStartedRef = useRef(false)

  const runImport = useCallback(async () => {
    if (loginHref) {
      router.push(loginHref)
      return
    }

    setIsSubmitting(true)
    setError(null)

    const payload =
      source === "preview"
        ? { source, token }
        : { source, writingId }

    try {
      const response = await fetch("/api/writings/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      })
      const result = (await response.json().catch(() => null)) as ImportResponse | null

      if (!response.ok || !result || !("id" in result) || typeof result.id !== "string") {
        setError(
          getImportErrorMessage(
            result && "error" in result ? result.error?.code : undefined,
            result && "error" in result ? result.error?.message : undefined,
          ),
        )
        return
      }

      router.push(buildWritingRouteHref("/write", { id: result.id, slug: null }))
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Could not create your copy right now.")
    } finally {
      setIsSubmitting(false)
    }
  }, [loginHref, router, source, token, writingId])

  useEffect(() => {
    if (!autoStart || loginHref || autoStartedRef.current) {
      return
    }

    autoStartedRef.current = true
    void runImport()
  }, [autoStart, loginHref, runImport])

  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => void runImport()}
        disabled={isSubmitting}
        className={
          buttonClassName ??
          "ml-1 flex h-8 items-center rounded-[8px] border-[0.5px] border-border bg-bg px-3.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-muted disabled:cursor-wait disabled:opacity-60"
        }
        data-testid="add-to-my-writings-btn"
      >
        {isSubmitting ? "Adding..." : "Add to my writings"}
      </button>
      {error ? (
        <p className={errorClassName} data-testid="add-to-my-writings-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
