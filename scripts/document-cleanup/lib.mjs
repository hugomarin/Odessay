import crypto from "node:crypto"
import path from "node:path"

export function normalizeTitle(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex")
}

export function splitFrontmatter(markdown) {
  const source = String(markdown ?? "").replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n")
  const lines = source.split("\n")
  if (lines[0]?.trim() !== "---") {
    return { kind: "none", frontmatter: "", body: source }
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && (line.trim() === "---" || line.trim() === "..."),
  )
  if (closingIndex >= 0) {
    return {
      kind: "complete",
      frontmatter: lines.slice(1, closingIndex).join("\n"),
      body: lines.slice(closingIndex + 1).join("\n"),
    }
  }

  const fragmentLines = lines.slice(1).filter((line) => line.trim())
  const looksLikeYamlFragment =
    fragmentLines.length > 0 &&
    fragmentLines.every((line) =>
      /^(?:\s+.*|#.*|[-?]\s+.*|[A-Za-z0-9_.-]+\s*:\s*.*)$/.test(line),
    )
  return looksLikeYamlFragment
    ? { kind: "fragment", frontmatter: lines.slice(1).join("\n"), body: "" }
    : { kind: "none", frontmatter: "", body: source }
}

function stripComments(value) {
  return value.replace(/<!--[\s\S]*?-->/g, "")
}

export function canonicalizeMarkdown(value) {
  return String(value ?? "")
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[\t ]+$/g, ""))
    .join("\n")
    .trim()
}

export function classifyMarkdown(markdown, { filename = "", title = "" } = {}) {
  const frontmatter = splitFrontmatter(markdown)
  const canonicalBody = canonicalizeMarkdown(stripComments(frontmatter.body))
  const titleCandidates = new Set(
    [path.basename(filename, path.extname(filename)), title]
      .map(normalizeTitle)
      .filter(Boolean),
  )
  const headingMatch = canonicalBody.match(/^#{1,6}\s+(.+?)\s*#*$/)
  const headingOnly = Boolean(
    headingMatch &&
      (!titleCandidates.size || titleCandidates.has(normalizeTitle(headingMatch[1]))),
  )

  let emptyKind = null
  if (!canonicalBody) {
    if (frontmatter.kind === "complete") emptyKind = "frontmatter-only"
    else if (frontmatter.kind === "fragment") emptyKind = "frontmatter-fragment-only"
    else emptyKind = "blank"
  } else if (headingOnly) {
    emptyKind = "title-only"
  }

  return {
    frontmatterKind: frontmatter.kind,
    emptyKind,
    isEmpty: emptyKind !== null,
    canonicalMarkdown: canonicalizeMarkdown(markdown),
    canonicalBody,
    canonicalHash: sha256(canonicalizeMarkdown(markdown)),
    bodyHash: sha256(canonicalBody),
  }
}

export function isManagedRoot(rootPath, dbPath) {
  const configDir = path.dirname(path.resolve(dbPath))
  const resolvedRoot = path.resolve(rootPath)
  return (
    resolvedRoot === path.join(configDir, "Writings") ||
    resolvedRoot === path.join(configDir, "artifact-studio-managed")
  )
}

function protectionScore(entry) {
  if (entry.unsyncedMutationCount > 0) return 4
  if (["pending", "failed", "conflict"].includes(entry.syncStatus)) return 3
  if (entry.cloudPresent) return 2
  return 1
}

export function chooseNewestKeeper(entries) {
  return [...entries].sort((left, right) => {
    const protectedDifference = protectionScore(right) - protectionScore(left)
    if (protectedDifference) return protectedDifference
    const dateDifference = (right.decisionTimestampMs ?? 0) - (left.decisionTimestampMs ?? 0)
    if (dateDifference) return dateDifference
    return left.id.localeCompare(right.id)
  })[0]
}

export function autoDeleteBlockers(entry) {
  const blockers = []
  if (!entry.fileExists) blockers.push("file-missing")
  if (!entry.manifestMatches) blockers.push("manifest-binding-missing-or-mismatched")
  if (!entry.managedRoot) blockers.push("external-binding-root")
  if (entry.cloudPresent) blockers.push("cloud-record-present")
  if (entry.unsyncedMutationCount > 0) blockers.push("unsynced-mutation")
  if (["pending", "failed", "conflict"].includes(entry.syncStatus)) {
    blockers.push(`sync-status-${entry.syncStatus}`)
  }
  return blockers
}

export function buildCleanupRecommendations(entries) {
  const byId = new Map(
    entries.map((entry) => [
      entry.id,
      {
        ...entry,
        reasons: [],
        duplicateGroupId: null,
        recommendedAction: "keep",
        blockers: autoDeleteBlockers(entry),
      },
    ]),
  )

  const nonEmptyByBodyHash = new Map()
  for (const entry of entries) {
    if (!entry.fileExists || entry.isEmpty) continue
    const group = nonEmptyByBodyHash.get(entry.bodyHash) ?? []
    group.push(entry)
    nonEmptyByBodyHash.set(entry.bodyHash, group)
  }

  const duplicateGroups = []
  for (const [bodyHash, group] of nonEmptyByBodyHash) {
    if (group.length < 2) continue
    const keeper = chooseNewestKeeper(group)
    const groupId = `duplicate:${bodyHash.slice(0, 16)}`
    duplicateGroups.push({
      groupId,
      bodyHash,
      keeperId: keeper.id,
      memberIds: group.map((entry) => entry.id),
      count: group.length,
      decision: "protected identity first; newest file mtime among equivalent candidates",
    })
    for (const entry of group) {
      const item = byId.get(entry.id)
      item.duplicateGroupId = groupId
      item.reasons.push("duplicate-body")
      if (entry.id !== keeper.id) {
        item.recommendedAction = item.blockers.length ? "manual-review" : "delete-candidate"
      }
    }
  }

  for (const entry of entries) {
    if (!entry.isEmpty) continue
    const item = byId.get(entry.id)
    item.reasons.push(entry.emptyKind)
    item.recommendedAction = item.blockers.length ? "manual-review" : "delete-candidate"
  }

  return {
    entries: [...byId.values()],
    duplicateGroups: duplicateGroups.sort((a, b) => b.count - a.count),
  }
}

export function csvEscape(value) {
  const text = Array.isArray(value) ? value.join("|") : String(value ?? "")
  return /[",\n\r]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text
}

export function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`
}
