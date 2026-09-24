#!/usr/bin/env node
/**
 * Inventario reproducible de los portadores del "documento activo" del editor
 * (ADR workflow/context/core/odessay-adr-documento-activo.md, ODE-566).
 *
 * Imprime, por cada función o efecto que cambia el documento activo, qué
 * portadores actualiza a mano. Sirve para medir cada fase de la migración:
 * cuando la decisión del ADR esté implementada, cada transición debería
 * tocar UN portador (la fuente) y nada más.
 *
 * Es un análisis por patrones de texto, no un parser: localiza la función o
 * `useEffect` que encierra cada escritura por indentación. Suficiente para
 * contar y comparar entre fases; ante una duda concreta, abrir el código.
 *
 * La URL se cuenta en dos columnas (ODE-569): `project` es una proyección
 * escrita a mano (`replaceEditorHistory`, lo que `activateDocument({ href })`
 * ya hace por la transición); `navigate` es una navegación del router de Next
 * (`navigateToWriting`), que no es un portador del documento activo sino ir a
 * otra página, y por eso no suma al total.
 *
 * Uso: node scripts/report-active-document-carriers.mjs
 */
import { readFileSync } from "node:fs"

const FILES = ["components/editor/editor-shell.tsx", "hooks/useDocumentHydration.ts"]

const CARRIERS = [
  // Entrada única (ADR, D2): la transición pasa por la función dueña.
  // Sin punto delante: `persistenceCoordinator.activateDocument` es otro
  // portador (el #6 del ADR), no la entrada única.
  ["activate", /(?<![.\w])activateDocument\(/],
  ["shell", /\bsetActiveWritingId\(|\bsetCurrentWritingId\(|\bcurrentWritingIdRef\.current\s*=[^=]/],
  ["store", /\b(focusTab|openWritingTab|closeTab|openDraftTab|reconcileMaterializedDraftTab|reconcileUnavailableWritingTab|publishTabState)\(/],
  ["tabRef", /\bactiveEditorTabIdRef\.current\s*=[^=]/],
  ["hydration", /\bsetHydrationWritingId\(/],
  ["project", /\breplaceEditorHistory\(/],
  ["navigate", /\bnavigateToWriting\(|\brouter(Ref\.current)?\.(replace|push)\(/],
]

const ENCLOSING = [
  /^\s*const (\w+) = (?:useCallback|useMemo|async|\()/,
  /^\s*(?:async )?function (\w+)/,
  /^\s*(on\w+|\w+): (?:async )?\(/,
]

function enclosingName(lines, index) {
  for (let i = index; i >= Math.max(0, index - 700); i -= 1) {
    const line = lines[i]
    for (const pattern of ENCLOSING) {
      const match = line.match(pattern)
      if (match) return match[1]
    }
    if (line.trim().startsWith("useEffect(")) return `useEffect@L${i + 1}`
  }
  return "?"
}

const rows = new Map()
for (const file of FILES) {
  const lines = readFileSync(file, "utf8").split("\n")
  lines.forEach((line, index) => {
    const trimmed = line.trim()
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return
    for (const [carrier, pattern] of CARRIERS) {
      if (!pattern.test(line)) continue
      const name = `${enclosingName(lines, index)}${file.includes("hooks/") ? " (hook)" : ""}`
      if (!rows.has(name)) rows.set(name, new Set())
      rows.get(name).add(carrier)
    }
  })
}

// Los dueños no son transiciones: son donde terminan todas.
const OWNERS = new Set(["setActiveWritingId", "activateDocument"])
const identityRows = [...rows.entries()].filter(
  ([name, carriers]) => (carriers.has("shell") || carriers.has("activate")) && !OWNERS.has(name),
)
identityRows.sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))

const names = CARRIERS.map(([carrier]) => carrier)
// "total" cuenta solo portadores escritos a mano (sin activate ni navigate).
const NOT_CARRIERS = new Set(["activate", "navigate"])
const width = Math.max(...identityRows.map(([name]) => name.length), 10)
console.log(`${"transición".padEnd(width)}  ${names.map((n) => n.padEnd(11)).join("")}total`)
for (const [name, carriers] of identityRows) {
  const cells = names.map((n) => (carriers.has(n) ? "✓" : "·").padEnd(11)).join("")
  const direct = [...carriers].filter((carrier) => !NOT_CARRIERS.has(carrier)).length
  console.log(`${name.padEnd(width)}  ${cells}${direct}`)
}

const shell = readFileSync(FILES[0], "utf8").split("\n")
const mirrors = shell.filter(
  (line, i) =>
    line.trim() === "useEffect(() => {" &&
    /^\s+\w+Ref\.current = [\w.]+$/.test(shell[i + 1] ?? "") &&
    /^\s+\}, \[/.test(shell[i + 2] ?? ""),
).length
console.log(`\ntransiciones que cambian la identidad: ${identityRows.length}`)
const directCount = (carriers) => [...carriers].filter((carrier) => !NOT_CARRIERS.has(carrier)).length
const viaActivate = identityRows.filter(([, carriers]) => carriers.has("activate")).length
console.log(`pasan por activateDocument: ${viaActivate}/${identityRows.length}`)
console.log(`portadores escritos a mano por transición (media): ${(identityRows.reduce((s, [, c]) => s + directCount(c), 0) / identityRows.length).toFixed(1)}`)
const projections = identityRows.filter(([, carriers]) => carriers.has("project")).length
const navigations = identityRows.filter(([, carriers]) => carriers.has("navigate")).length
console.log(`proyecciones de URL escritas a mano: ${projections}`)
console.log(`transiciones que además navegan (navigateToWriting): ${navigations}`)
console.log(`efectos espejo en editor-shell.tsx: ${mirrors}`)
