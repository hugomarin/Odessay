import { isTauriRuntime } from "@/lib/runtime/detect"

export type WebWritingAction = "publish" | "share"

type BuildWebWritingActionUrlInput = {
  writingId: string
  action: WebWritingAction
  appUrl?: string
}

const ensureHttpUrl = (value: string): URL | null => {
  try {
    const url = new URL(value)
    return url.protocol === "http:" || url.protocol === "https:" ? url : null
  } catch {
    return null
  }
}

export function getConfiguredWebOrigin(appUrl = process.env.NEXT_PUBLIC_APP_URL): string | null {
  if (!appUrl) {
    return null
  }

  const url = ensureHttpUrl(appUrl)
  return url?.origin ?? null
}

export function buildWebWritingActionUrl({
  writingId,
  action,
  appUrl,
}: BuildWebWritingActionUrlInput): string | null {
  const origin = getConfiguredWebOrigin(appUrl)
  if (!origin) {
    return null
  }

  const url = new URL(`/write/${encodeURIComponent(writingId)}`, origin)
  url.searchParams.set("desktop", "1")
  url.searchParams.set("action", action)
  return url.toString()
}

export async function openExternalUrl(url: string): Promise<void> {
  const externalUrl = ensureHttpUrl(url)
  if (!externalUrl) {
    throw new Error("External links must use http or https.")
  }

  if (isTauriRuntime()) {
    const { open } = await import("@tauri-apps/plugin-shell")
    await open(externalUrl.toString())
    return
  }

  if (typeof window === "undefined") {
    throw new Error("External links are only available in a browser runtime.")
  }

  window.open(externalUrl.toString(), "_blank", "noopener,noreferrer")
}
