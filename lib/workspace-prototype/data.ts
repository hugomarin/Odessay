export type WorkspaceFolder = {
  id: string
  name: string
  itemCount: number
  updatedAt: string
}

export type WorkspaceFile = {
  id: string
  name: string
  size: string
  updatedAt: string
  kind?: "pinned" | "file"
  preview?: string
  content?: string
}

export type WorkspacePrototype = {
  slug: string
  name: string
  path: string
  status?: "ready" | "missing"
  missingReason?: string | null
  description?: string
  updatedAt: string
  fileCount: number
  folderCount: number
  pinnedFileId?: string
  folders: WorkspaceFolder[]
  files: WorkspaceFile[]
}

export const WORKSPACES: WorkspacePrototype[] = [
  {
    slug: "writing-harness",
    name: "Writing Harness",
    path: "~/Documents/Workspace/Writing Harness",
    status: "ready",
    missingReason: null,
    description: "Core writing system, notes, and reference material.",
    updatedAt: "Updated 2h ago",
    fileCount: 12,
    folderCount: 3,
    pinnedFileId: "instructions-md",
    folders: [
      { id: "drafts", name: "drafts", itemCount: 8, updatedAt: "May 19, 2025 at 3:21 PM" },
      { id: "references", name: "references", itemCount: 3, updatedAt: "May 18, 2025 at 11:02 AM" },
      { id: "assets", name: "assets", itemCount: 1, updatedAt: "May 17, 2025 at 5:18 PM" },
    ],
    files: [
      {
        id: "instructions-md",
        name: "instructions.md",
        size: "1.4 KB",
        updatedAt: "May 20, 2025 at 9:41 AM",
        kind: "pinned",
        preview: "Pinned guidance for how this workspace should be used.",
        content: `# Writing Harness\n\nUse these materials to generate clear, structured drafts.\n\n- Ground claims in the provided research.\n- Prefer clarity over flourish.\n- Keep outputs easy to revise into essays.\n- Treat transcript excerpts as raw material, not final prose.`,
      },
      {
        id: "brief-md",
        name: "brief.md",
        size: "2.1 KB",
        updatedAt: "May 20, 2025 at 9:40 AM",
        preview: "Scope and goals for the current writing cycle.",
        content: `# Brief\n\nThis workspace collects source notes, transcripts, and draft fragments for the Writing Harness initiative.\n\n## Goal\n\nCreate a reliable loop for:\n\n1. gathering material\n2. shaping arguments\n3. drafting with context\n4. exporting writing without losing source traceability`,
      },
      {
        id: "research-notes-md",
        name: "research-notes.md",
        size: "6.4 KB",
        updatedAt: "May 20, 2025 at 9:38 AM",
        preview: "Loose research fragments, questions, and source notes.",
        content: `# Research notes\n\n- Compare file-first tools vs cloud-native systems.\n- Track moments where context is scattered across transcripts, notes, and drafts.\n- Evaluate whether the workspace should privilege folders, recent files, or pinned guidance.`,
      },
      {
        id: "transcript-session-3-md",
        name: "transcript-session-3.md",
        size: "12.7 KB",
        updatedAt: "May 19, 2025 at 4:11 PM",
        preview: "Interview transcript used as source material for analysis.",
        content: `Sergio:\n\nAhí también me estaban diciendo por el otro lado...\n\nHugo:\n\nEs decir, hay contratación y todo, pero yo lo que veo es que sí puede cambiar mucho...`,
      },
      {
        id: "ideas-md",
        name: "ideas.md",
        size: "1.3 KB",
        updatedAt: "May 18, 2025 at 10:47 AM",
        preview: "Open questions and possible article directions.",
        content: `# Ideas\n\n- Workspace as a folder hub, not a PM system.\n- Pinned files instead of app-owned context objects.\n- Search should privilege filenames before deep metadata.`,
      },
      {
        id: "outline-md",
        name: "outline.md",
        size: "1.8 KB",
        updatedAt: "May 17, 2025 at 6:03 PM",
        preview: "Early structure for the long-form draft.",
        content: `# Outline\n\n## 1. Why file-based work matters\n## 2. Where cloud tools create friction\n## 3. How a workspace can keep writing in context`,
      },
      {
        id: "meeting-notes-2025-05-15-md",
        name: "meeting-notes-2025-05-15.md",
        size: "3.2 KB",
        updatedAt: "May 15, 2025 at 2:28 PM",
        preview: "Project discussion notes.",
        content: `# Meeting notes\n\nDecided to test a lighter Workspace model.\n\nQuestions:\n- Is the index a grid or list?\n- Should New file create markdown directly in the folder?`,
      },
      {
        id: "todo-md",
        name: "todo.md",
        size: "1.0 KB",
        updatedAt: "May 14, 2025 at 9:16 AM",
        preview: "Open implementation tasks.",
        content: `# Todo\n\n- Prototype workspace index\n- Prototype detail page\n- Validate open-file flow into editor`,
      },
    ],
  },
  {
    slug: "market-notes",
    name: "Market Notes",
    path: "~/Documents/Workspace/Market Notes",
    status: "ready",
    missingReason: null,
    description: "Research, interviews, and market observations.",
    updatedAt: "Updated 1d ago",
    fileCount: 84,
    folderCount: 5,
    folders: [],
    files: [],
  },
  {
    slug: "claude-transcripts",
    name: "Claude Transcripts",
    path: "~/Documents/Workspace/Claude Transcripts",
    status: "ready",
    missingReason: null,
    description: "Interviews and conversations with Claude.",
    updatedAt: "Updated 2d ago",
    fileCount: 63,
    folderCount: 4,
    folders: [],
    files: [],
  },
  {
    slug: "odessay-docs",
    name: "Odessay Docs",
    path: "~/Documents/Workspace/Odessay Docs",
    status: "ready",
    missingReason: null,
    description: "Product docs, guides, and internal notes.",
    updatedAt: "Updated 3d ago",
    fileCount: 41,
    folderCount: 6,
    folders: [],
    files: [],
  },
  {
    slug: "ai-readiness",
    name: "AI Readiness",
    path: "~/Documents/Workspace/AI Readiness",
    status: "ready",
    missingReason: null,
    description: "Strategy, frameworks, and implementation plans.",
    updatedAt: "Updated 5d ago",
    fileCount: 99,
    folderCount: 7,
    folders: [],
    files: [],
  },
  {
    slug: "letters-drafts",
    name: "Letters Drafts",
    path: "~/Documents/Workspace/Letters Drafts",
    status: "ready",
    missingReason: null,
    description: "Personal letters, essays, and longform drafts.",
    updatedAt: "Updated 6d ago",
    fileCount: 28,
    folderCount: 2,
    folders: [],
    files: [],
  },
]

export function getWorkspaceBySlug(slug: string) {
  return WORKSPACES.find((workspace) => workspace.slug === slug) ?? null
}

export function getWorkspaceFile(workspaceSlug: string, fileId: string) {
  const workspace = getWorkspaceBySlug(workspaceSlug)
  if (!workspace) {
    return null
  }

  return workspace.files.find((file) => file.id === fileId) ?? null
}
