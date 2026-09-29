import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import ts from "typescript"
import { describe, expect, it } from "vitest"

// ODE-609: assignment-only effects create a passive copy with a stale window.
// Existing ratchets scan plain patterns/counts, which cannot distinguish a
// cleanup or comments from an assignment-only body. Parse TS/TSX here instead.
type Mirror = { key: string; line: number }
type Exception = { count: number; kind: "latest-callback" | "lifecycle-reset" | "debt"; reason: string }
const baseline = JSON.parse(readFileSync("architecture/editor-shell-mirrors.baseline.json", "utf8")) as {
  allowed: Record<string, Exception>
}

function listSources(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name)
    return entry.isDirectory() ? listSources(path) : /\.tsx?$/.test(path) ? [path] : []
  })
}

function assignmentOnlyEffects(path: string, text: string): Mirror[] {
  const source = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true)
  const names = new Set(["useEffect"])
  const namespaces = new Set(["React"])
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || statement.moduleSpecifier.getText(source) !== '"react"' && statement.moduleSpecifier.getText(source) !== "'react'") continue
    const clause = statement.importClause
    if (clause?.name) namespaces.add(clause.name.text)
    if (clause?.namedBindings && ts.isNamespaceImport(clause.namedBindings)) namespaces.add(clause.namedBindings.name.text)
    if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        if ((element.propertyName ?? element.name).text === "useEffect") names.add(element.name.text)
      }
    }
  }
  const found: Mirror[] = []
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node)) {
      const callee = node.expression
      const isEffect = ts.isIdentifier(callee) ? names.has(callee.text)
        : ts.isPropertyAccessExpression(callee) && ts.isIdentifier(callee.expression)
          && namespaces.has(callee.expression.text) && callee.name.text === "useEffect"
      const callback = node.arguments[0]
      if (isEffect && callback && (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback))) {
        const body = callback.body
        const expression = ts.isBlock(body)
          ? body.statements.length === 1 && ts.isExpressionStatement(body.statements[0]) ? body.statements[0].expression : null
          : body
        if (expression && ts.isBinaryExpression(expression) && expression.operatorToken.kind === ts.SyntaxKind.EqualsToken
          && ts.isPropertyAccessExpression(expression.left) && expression.left.name.text === "current") {
          found.push({ key: `${path}:${expression.left.expression.getText(source)}`, line: source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1 })
        }
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
  return found
}

function counts(mirrors: Mirror[]): Record<string, number> {
  const result: Record<string, number> = {}
  for (const { key } of mirrors) result[key] = (result[key] ?? 0) + 1
  return result
}

describe("editor shell mirrors ratchet", () => {
  const mirrors = [...listSources("components/editor"), ...listSources("hooks")]
    .flatMap((path) => assignmentOnlyEffects(path, readFileSync(path, "utf8")))
  const actual = counts(mirrors)

  it("no new mirrors or duplicate copies behind an allowed ref", () => {
    const violations = mirrors.filter(({ key }) => !baseline.allowed[key] || actual[key] > baseline.allowed[key].count)
    expect(violations, "Use a synchronous state/ref owner; latest callbacks require a specific reason.").toEqual([])
  })

  it("paid debt and removed callbacks cannot stay allowed", () => {
    const stale = Object.entries(baseline.allowed).filter(([key, entry]) => actual[key] !== entry.count)
    expect(stale, "Remove an exception when its assignment-only effect disappears.").toEqual([])
  })

  it("every exception names its kind and a concrete reason", () => {
    for (const entry of Object.values(baseline.allowed)) {
      expect(entry.count).toBe(1)
      expect(["latest-callback", "lifecycle-reset", "debt"]).toContain(entry.kind)
      expect(entry.reason.trim().length).toBeGreaterThan(20)
    }
  })

  it("parses compact, multiline, generic and aliased effects", () => {
    const source = `import { useEffect as effect } from 'react';
      useEffect(() => { firstRef.current = value }, [value]);
      effect(() => { /* comment */ secondRef.current = value ?? null; }, [value]);
      React.useEffect(() => thirdRef.current = callback, [callback]);
      useEffect<void>(() => { fourthRef.current = () => doWork() }, [doWork]);`
    expect(assignmentOnlyEffects("fixture.tsx", source).map(({ key }) => key)).toEqual([
      "fixture.tsx:firstRef", "fixture.tsx:secondRef", "fixture.tsx:thirdRef", "fixture.tsx:fourthRef",
    ])
  })

  it("does not mistake synchronous writers or resource lifecycles for mirrors", () => {
    const source = `const write = (value) => { externalContentConflictRef.current = value; setState(value) };
      useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, []);
      editorInstanceRef.current = editor;`
    expect(assignmentOnlyEffects("fixture.tsx", source)).toEqual([])
  })
})
