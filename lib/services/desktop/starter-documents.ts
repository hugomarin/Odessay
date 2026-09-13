/**
 * Starter documents (ODE-449).
 *
 * Two seed artifacts, written once into the managed BindingRoot — the app-owned
 * local workspace that never touches a user folder (spec: `ensureManagedRoot`
 * in desktop-settings-service.ts). "Already seeded" has no dedicated flag:
 * presence of a non-deleted catalog record at the seed's fixed UUID *is* the
 * durable signal. That makes a user deleting a seed and a stale restore click
 * the same code path — both just see "missing" and recreate it — and it means
 * an edited seed is never touched again, since it is never "missing".
 */

import { appConfigDir, join } from "@tauri-apps/api/path"
import { DesktopSettingsService } from "@/lib/services/desktop/desktop-settings-service"
import { MANAGED_ROOT_DIRNAME } from "@/lib/services/desktop/open-document-desktop"
import { isDesktopRuntime } from "@/lib/services/desktop/runtime-detection"
import { SqliteDocumentCatalog } from "@/lib/services/desktop/sqlite-document-catalog"
import { createDesktopDraft } from "@/lib/services/document-service-factory"
import { parseMarkdownToSnapshot } from "@/lib/editor/document-serialization"

export const STARTER_WORKSPACE_DISPLAY_NAME = "Artifact Studio"

export type StarterDocumentIcon = "book-open" | "command"

export type StarterDocumentSpec = {
  id: string
  filename: string
  title: string
  description: string
  icon: StarterDocumentIcon
  markdown: string
}

const HOW_IT_WORKS_MARKDOWN = `# How Artifact Studio Works

**Artifacts are plain markdown.** Every artifact you write is a normal \`.md\` file on disk. There is nothing proprietary in it — open it in any text editor, put it under your own version control, or read it with any other tool.

**Nothing to save.** The editor writes to disk as you type. There is no save button and no "unsaved changes" warning, because there is never anything unsaved for more than a moment.

**Workspaces are folders you already have.** A workspace is a folder on your machine that Artifact Studio watches. Connecting one does not move or copy anything — your files stay exactly where they are, and the app simply keeps its list in sync with what is on disk.

**Sync happens in the background.** When you are signed in, artifacts sync to the cloud automatically. The sync indicator at the bottom of the window tells you the current state; you never have to trigger it yourself.

**These two documents are yours.** Edit them, delete them, or move them to a workspace of your own — they behave exactly like anything you write from scratch. If you ever delete both, "Restore starter documents" brings back whichever ones are missing without touching anything you kept.
`

const KEYBOARD_SHORTCUTS_MARKDOWN = `# Keyboard Shortcuts

The twelve that matter most day to day.

## Create and find

| Shortcut | Action |
| --- | --- |
| \`⌘N\` | New artifact |
| \`⌘K\` | Search |

## Move around

| Shortcut | Action |
| --- | --- |
| \`⌘⌥1\` | Go to Desk |
| \`⌘⌥2\` | Go to Workspace |
| \`⌘⌥3\` | Go to Studio |
| \`⌘⇧]\` | Next tab |
| \`⌘⇧[\` | Previous tab |
| \`⌘\\\` | Toggle sidebar |

## While writing

| Shortcut | Action |
| --- | --- |
| \`⌘B\` | Bold |
| \`⌘L\` | Bullet list |
| \`⌘⇧F\` | Focus mode |
| \`⌘⌥P\` | Document properties |

Press \`⌘/\` any time to bring this list back up.
`

export const STARTER_DOCUMENTS: readonly StarterDocumentSpec[] = [
  {
    id: "8f1f9e6a-8f0a-4b8e-9a6a-0f7a2c9d1a01",
    filename: "How Artifact Studio Works.md",
    title: "How Artifact Studio Works",
    description: "What an artifact is, how it syncs with your folder, and why the editor never asks you to save.",
    icon: "book-open",
    markdown: HOW_IT_WORKS_MARKDOWN,
  },
  {
    id: "8f1f9e6a-8f0a-4b8e-9a6a-0f7a2c9d1a02",
    filename: "Keyboard Shortcuts.md",
    title: "Keyboard Shortcuts",
    description: "The twelve that matter: create, search, move between workspaces, and format as you write.",
    icon: "command",
    markdown: KEYBOARD_SHORTCUTS_MARKDOWN,
  },
]

export const STARTER_DOCUMENT_IDS: ReadonlySet<string> = new Set(
  STARTER_DOCUMENTS.map((doc) => doc.id),
)

export type StarterSeedResult = {
  created: string[]
  kept: string[]
  failed: { id: string; title: string; message: string }[]
}

async function resolveManagedRootPath(configDir: string): Promise<string> {
  const settings = new DesktopSettingsService(configDir)
  const roots = await settings.getBindingRoots()
  const managed = roots.find((root) => root.kind === "managed")
  if (managed) return managed.rootPath
  const created = await settings.ensureManagedRoot(await join(configDir, MANAGED_ROOT_DIRNAME))
  return created.rootPath
}

/**
 * Create whichever starter documents are missing (never created, or deleted
 * by the user) and leave the rest untouched. Safe to call on every app launch
 * and from the "Restore starter documents" button — both go through this.
 */
export async function seedStarterDocuments(): Promise<StarterSeedResult> {
  const result: StarterSeedResult = { created: [], kept: [], failed: [] }
  if (!isDesktopRuntime()) return result

  const configDir = await appConfigDir()
  const catalog = new SqliteDocumentCatalog(await join(configDir, "desktop-index.sqlite3"))
  const managedRootPath = await resolveManagedRootPath(configDir)

  for (const doc of STARTER_DOCUMENTS) {
    const existing = await catalog.getById(doc.id)
    if (existing && existing.deletedAt === null) {
      result.kept.push(doc.id)
      continue
    }

    try {
      const { bodyJson } = parseMarkdownToSnapshot(doc.markdown)
      const preferredPath = await join(managedRootPath, doc.filename)
      const created = await createDesktopDraft({
        writingId: doc.id,
        title: doc.title,
        preferredPath,
        initialBodyJson: bodyJson as Record<string, unknown>,
      })
      if (created.error) {
        result.failed.push({ id: doc.id, title: doc.title, message: created.error.message })
        continue
      }
      result.created.push(doc.id)
    } catch (error) {
      result.failed.push({
        id: doc.id,
        title: doc.title,
        message: error instanceof Error ? error.message : "Failed to create the starter document",
      })
    }
  }

  return result
}
