import { readFileSync, readdirSync } from "node:fs"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

/**
 * Ratchet del andamiaje de pruebas (ODE-560).
 *
 * Hace visible, sin depender de que nadie recuerde el catálogo, que un test
 * está montando su propio escenario en vez de usar el andamiaje compartido.
 * Misma semántica monotónica que `boundaries.baseline.json`: un archivo nuevo
 * por encima del umbral falla, y una entrada del baseline que ya no viola
 * también — la deuda pagada no puede reaparecer ahí en silencio.
 *
 * IMPORTANTE, y por eso el mensaje de fallo es largo: el número de dobles es
 * una señal de arranque, NO un veredicto. La auditoría de ODE-560 clasificó
 * los ocho archivos que el conteo señalaba y **cinco resultaron legítimos al
 * leerlos**. Lo que decide es qué se dobla (boundary externo vs. seam interno
 * de la app) y qué dice ser el test. Este ratchet solo fuerza que alguien
 * mire y deje escrito el porqué.
 */
const ROOT = process.cwd()
const TESTS_DIR = resolve(ROOT, "tests")
const CATALOG = "workflow/testing/integration-harness-catalog.md"

type Baseline = {
  threshold: number
  allowed: Record<string, string>
}

const baseline = JSON.parse(
  readFileSync(resolve(ROOT, "architecture/test-scaffolding.baseline.json"), "utf8"),
) as Baseline

function listTestFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const fullPath = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath))
    } else if (/\.test\.(ts|tsx)$/.test(entry.name)) {
      files.push(fullPath)
    }
  }
  return files
}

function countModuleDoubles(contents: string): number {
  return (contents.match(/\bvi\.mock\(/g) ?? []).length
}

function toRepoRelative(absolutePath: string): string {
  return absolutePath.slice(ROOT.length + 1)
}

describe("test scaffolding ratchet", () => {
  const offenders = new Map<string, number>()

  for (const file of listTestFiles(TESTS_DIR)) {
    const count = countModuleDoubles(readFileSync(file, "utf8"))
    if (count > baseline.threshold) {
      offenders.set(toRepoRelative(file), count)
    }
  }

  it("ningún test nuevo monta su propio escenario sin declararlo", () => {
    const undeclared = [...offenders.entries()]
      .filter(([path]) => !(path in baseline.allowed))
      .map(([path, count]) => `${path} (${count} dobles)`)
      .sort()

    expect(
      undeclared,
      undeclared.length === 0
        ? ""
        : [
            "",
            `Estos tests declaran más de ${baseline.threshold} dobles de módulo y no están en el baseline:`,
            ...undeclared.map((entry) => `  - ${entry}`),
            "",
            "Eso NO significa automáticamente que estén mal. Significa que hay que mirarlos.",
            `Lee ${CATALOG} y responde:`,
            "  1. ¿Estás doblando boundaries externos (red, IPC nativo, SO, proveedor de AI),",
            "     o seams internos de la propia app? Lo segundo está prohibido en un proof",
            "     de integración (regla 3 de capability-proof-contract.md).",
            "  2. ¿Existe ya un andamiaje para este escenario? tests/support/ para nivel",
            "     componente, tests/integration/documents/support/ para nivel servicio.",
            "     Si casi encaja, se extiende en su canonical owner; no se clona.",
            "",
            "Si tras mirarlo el escenario propio está justificado, añádelo a",
            "architecture/test-scaffolding.baseline.json CON su razón en una línea.",
            "El baseline no es una lista de vergüenza: es la constancia de que alguien miró.",
          ].join("\n"),
    ).toEqual([])
  })

  it("el baseline no conserva entradas que ya dejaron de violar", () => {
    const stale = Object.keys(baseline.allowed)
      .filter((path) => !offenders.has(path))
      .sort()

    expect(
      stale,
      stale.length === 0
        ? ""
        : [
            "",
            "Estas entradas del baseline ya no superan el umbral y deben borrarse de",
            "architecture/test-scaffolding.baseline.json:",
            ...stale.map((path) => `  - ${path}`),
            "",
            "Dejarlas permitiría que la deuda reaparezca ahí sin que nadie lo note.",
          ].join("\n"),
    ).toEqual([])
  })

  it("cada entrada del baseline trae una razón escrita", () => {
    const withoutReason = Object.entries(baseline.allowed)
      .filter(([, reason]) => reason.trim().length < 20)
      .map(([path]) => path)
      .sort()

    expect(withoutReason, "Una entrada sin razón es exactamente el 'apúntame en la lista' que este ratchet existe para evitar").toEqual([])
  })
})
