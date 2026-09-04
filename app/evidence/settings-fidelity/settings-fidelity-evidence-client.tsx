"use client"

import { useSearchParams } from "next/navigation"

import { AccountForm } from "@/components/settings/account-form"
import { SettingsShell } from "@/components/settings/settings-shell"
import { VocabularyList } from "@/components/settings/vocabulary-list"
import { UserSettingsProvider } from "@/components/settings/user-settings-provider"
import { VocabularyCatalogBridge } from "@/components/vocabulary/vocabulary-provider"
import { getArtifactTypeVocabulary, getWritingStatusVocabulary } from "@/lib/settings/vocabulary"

const ACCOUNT_FIXTURE = {
  id: "evidence-user",
  email: "hmarinr@pm.me",
  displayName: "Hugo Marin",
  username: "hugomarin",
}

const SECTION_HREF = {
  account: "/settings/account",
  types: "/settings/types",
  status: "/settings/status",
} as const

export function SettingsFidelityEvidenceClient() {
  const searchParams = useSearchParams()
  const requested = searchParams.get("section")
  const section = requested === "account" || requested === "status" ? requested : "types"

  return (
    // ODE-475: VocabularyList now saves/deletes through UserSettingsProvider's
    // real SettingsService — this evidence page mounts it (and the catalog
    // bridge) exactly like app/(app)/layout.tsx does, so Save/Delete work here too.
    <UserSettingsProvider>
      <VocabularyCatalogBridge />
      <main
        data-testid="settings-fidelity-evidence"
        className="flex h-screen min-h-0 flex-col bg-bg pt-2.5 text-ink"
      >
        <SettingsShell section={SECTION_HREF[section]}>
          {section === "account" ? (
            <AccountForm initialAccount={ACCOUNT_FIXTURE} />
          ) : section === "status" ? (
            <VocabularyList
              kind="status"
              items={getWritingStatusVocabulary(["canceled"])}
              addLabel="New status"
              onToggle={() => {}}
              footnote="Hiding a status keeps it out of menus and filters. Artifacts already carrying it are left exactly as they are."
            />
          ) : (
            <VocabularyList
              kind="type"
              items={getArtifactTypeVocabulary()}
              addLabel="New type"
              footnote="The type is metadata about the artifact — it lives in the catalog and the cloud, not in the markdown frontmatter, so it never changes the file's bytes."
            />
          )}
        </SettingsShell>
      </main>
    </UserSettingsProvider>
  )
}
