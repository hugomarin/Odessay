/**
 * Pure domain helpers for the desktop filename ⇄ title contract.
 *
 * Architecture Contract (ODE-324):
 *  - The filename (without .md extension) is the canonical human name of a document.
 *  - `title` (app + cloud) reflects the filename; the filename is the single source of truth.
 *  - `titleToFilename` only sanitises filesystem-illegal characters; it preserves
 *    case, accents, and spaces.
 *  - `filenameToTitle` performs the inverse with minimal transformation (strip extension).
 */

export const UNTITLED_DOCUMENT_NAME = "Untitled"
export const DEFAULT_DOCUMENT_EXTENSION = ".md"

/**
 * Sanitise a string so it is safe to use as a filename on macOS/Windows/Linux.
 * Removes control characters and filesystem-reserved characters (\/:*?"<>|)
 * and trims leading/trailing spaces/dots. Does NOT normalise case, accents,
 * or spaces — those are part of the human name.
 */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[\x00-\x1f]/g, "")
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/^[\s.]+|[\s.]+$/g, "")
  return cleaned.length > 0 ? cleaned : UNTITLED_DOCUMENT_NAME
}

/**
 * Convert a document title into a safe filename (including .md by default).
 */
export function titleToFilename(
  title: string,
  extension: string = DEFAULT_DOCUMENT_EXTENSION,
): string {
  const sanitized = sanitizeFileName(title.trim())
  return `${sanitized}${extension}`
}

/**
 * Convert a filename into the document title. The stem of the filename is the
 * title verbatim; we only strip the .md (case-insensitive) extension.
 */
export function filenameToTitle(filename: string): string {
  const base = filename.split(/[\\/]/).pop() ?? filename
  return base.replace(/\.md$/i, "")
}

/**
 * Split an absolute canonical path into its root directory and relative file
 * segment. The separator is the last slash or backslash. This is a pure string
 * operation: it does not access the filesystem.
 *
 * Returns `{ rootPath: ".", relativePath: path }` when the path has no parent
 * segment, so callers never receive an empty rootPath.
 */
export function splitCanonicalPath(path: string): { rootPath: string; relativePath: string } {
  const separator = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"))
  return separator < 0
    ? { rootPath: ".", relativePath: path }
    : { rootPath: path.slice(0, separator), relativePath: path.slice(separator + 1) }
}

/**
 * Resolve a unique filename inside a directory, appending " 2", " 3", … when
 * the desired name already exists. Comparison is case-insensitive to respect
 * case-insensitive filesystems (APFS/HFS+/NTFS).
 */
export function resolveUniqueFilename(
  desiredFilename: string,
  existingFilenames: string[],
): string {
  const existingLower = new Set(existingFilenames.map((name) => name.toLowerCase()))
  if (!existingLower.has(desiredFilename.toLowerCase())) {
    return desiredFilename
  }

  const extIndex = desiredFilename.toLowerCase().lastIndexOf(".md")
  const hasExtension = extIndex !== -1
  const stem = hasExtension ? desiredFilename.slice(0, extIndex) : desiredFilename
  const extension = hasExtension ? desiredFilename.slice(extIndex) : ""

  let counter = 2
  while (existingLower.has(`${stem} ${counter}${extension}`.toLowerCase())) {
    counter++
  }
  return `${stem} ${counter}${extension}`
}
