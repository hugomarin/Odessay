"use client"

import Link from "next/link"
import { FolderTree, Monitor } from "lucide-react"

/**
 * Web boundary for Workspace (ODE-373, requirement 6).
 *
 * Workspace manages BindingRoots on the local filesystem, which only exists in
 * the desktop runtime. On the web we explain that plainly instead of rendering a
 * folder picker that cannot work — the capability boundary is honest, not a fake
 * affordance. Documents themselves stay reachable from Desk on every runtime.
 */
export function WorkspaceDesktopRequired() {
  return (
    <section
      data-page="workspace"
      data-testid="workspace-desktop-required"
      className="flex min-h-screen flex-col items-center justify-center bg-bg px-6 text-center"
    >
      <div className="flex max-w-[420px] flex-col items-center gap-4">
        <div className="relative">
          <FolderTree className="h-10 w-10 text-ink-4" strokeWidth={1.25} />
          <Monitor
            className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-bg text-ink-3"
            strokeWidth={1.5}
          />
        </div>
        <h1 className="text-[20px] font-medium tracking-[-0.02em] text-ink">
          Workspaces live on the desktop app
        </h1>
        <p className="text-[14px] leading-relaxed text-ink-4">
          Workspaces connect your documents to folders on your computer, so they
          need filesystem access that the browser can’t provide. Open Odessay for
          Mac to organize documents by folder and manage watched roots.
        </p>
        <p className="text-[13px] text-ink-4">
          Your documents are still here — find and open them from the{" "}
          <Link href="/desk" className="text-cursor underline-offset-2 hover:underline">
            Desk
          </Link>
          .
        </p>
      </div>
    </section>
  )
}
