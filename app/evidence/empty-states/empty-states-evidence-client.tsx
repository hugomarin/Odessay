"use client"

import { BookOpen, Command, Plus } from "lucide-react"
import { useSearchParams } from "next/navigation"

import { Sidebar } from "@/components/navigation/sidebar"
import { ViewHeader, VIEW_HEADER_ACTION_CLASS } from "@/components/navigation/view-header"
import { ViewTitlebarSpacer } from "@/components/navigation/view-titlebar-spacer"
import {
  FirstRunEmptyState,
  NoArtifactsEmptyState,
  NoWorkspaceEmptyState,
  STARTER_DOCUMENTS_UNAVAILABLE,
  type StarterArtifact,
} from "@/components/shared/view-empty-states"

/**
 * The two starter artifacts the prototype seeds. They are fixtures here: the
 * repo has no starter-document mechanism, which is the Context Gap raised on
 * ODE-438. Their copy is the prototype's, translated to the English the prose
 * carries.
 */
const STARTER_ARTIFACTS: StarterArtifact[] = [
  {
    id: "how-it-works",
    icon: BookOpen,
    title: "How Artifact Studio works",
    description:
      "What an artifact is, how it syncs with your folder, and why the editor never asks you to save.",
  },
  {
    id: "shortcuts",
    icon: Command,
    title: "Keyboard shortcuts",
    description:
      "The twelve that matter: create, search, move between workspaces and change an artifact's status.",
  },
]

const USER = { displayName: "Hugo Marin", email: "hugo@z9ne.com", username: "hugomarin" }

export function EmptyStatesEvidenceClient() {
  const searchParams = useSearchParams()
  const requested = searchParams.get("state")
  const state =
    requested === "no-artifacts" || requested === "no-workspace" ? requested : "first-run"
  const isWorkspace = state === "no-workspace"

  return (
    <Sidebar initialSidebarMode="expanded" user={USER}>
      <div data-testid="empty-states-evidence" className="flex min-h-full flex-col bg-bg">
        <ViewTitlebarSpacer />
        <ViewHeader
          title={isWorkspace ? "Workspace" : "Desk"}
          actions={
            <button type="button" className={VIEW_HEADER_ACTION_CLASS}>
              <Plus className="h-[17px] w-[17px]" strokeWidth={1.5} />
              {isWorkspace ? "New Workspace" : "New Artifact"}
            </button>
          }
        />

        <div className="relative mx-4 mb-4 flex min-h-0 flex-1 flex-col overflow-hidden rounded-[10px] bg-sb shadow-float">
          {state === "first-run" ? (
            <FirstRunEmptyState artifacts={STARTER_ARTIFACTS} />
          ) : state === "no-artifacts" ? (
            <NoArtifactsEmptyState restoreDisabledReason={STARTER_DOCUMENTS_UNAVAILABLE} />
          ) : (
            <NoWorkspaceEmptyState starterWorkspaceName="Artifact Studio" />
          )}
        </div>
      </div>
    </Sidebar>
  )
}
