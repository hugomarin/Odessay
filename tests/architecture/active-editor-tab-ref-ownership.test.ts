import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"
import { describe, expect, it } from "vitest"

// ODE-609 (opción B de ODE-608): `activeEditorTabIdRef` tiene un único
// escritor, el listener del store de sesión dentro de `useActiveEditorTabIdRef`.
// Ni el efecto espejo de la shell ni las antiguas escrituras manuales de
// `useWorkspaceTabs`/`useWorkspaceTabOpening` pueden volver. El ratchet general
// de espejos es el PR 9 de ODE-609; esta es la regla de ownership del ref.
const ROOT = process.cwd()
const OWNER = resolve(ROOT, "hooks/useActiveEditorTabIdRef.ts")
const WRITER_PATTERN = /activeEditorTabIdRef\.current\s*=(?!=)/
const WATCHED_DIRS = [resolve(ROOT, "components/editor"), resolve(ROOT, "hooks")]

function listFilesRecursive(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listFilesRecursive(fullPath))
    } else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

const watchedFiles = WATCHED_DIRS.flatMap(listFilesRecursive)

describe("activeEditorTabIdRef ownership", () => {
  it("has exactly one writer, at its canonical owner", () => {
    const writers = watchedFiles.filter((filePath) => WRITER_PATTERN.test(readFileSync(filePath, "utf8")))

    expect(writers, "un solo archivo escribe activeEditorTabIdRef.current").toEqual([OWNER])
  })

  it("the owner writes it exactly once, from the store listener", () => {
    const owner = readFileSync(OWNER, "utf8")
    const assignments = owner.match(/activeEditorTabIdRef\.current\s*=(?!=)/g) ?? []

    expect(assignments, "una sola asignación: el listener").toHaveLength(1)
    expect(owner, "y la copia se mantiene con la suscripción pública del store").toContain(
      "subscribeToEditorSessionStore",
    )
  })
})
