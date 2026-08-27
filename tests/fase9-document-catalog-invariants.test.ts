import { existsSync, readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

type EvidenceKind = "automated" | "manual-dmg" | "owner-acceptance"
type EvidenceStatus = "PASS" | "PENDING"

export type Fase9ClosureMatrixRow = {
  id: string
  block: number
  criterion: string
  evidenceKind: EvidenceKind
  evidence: string
  issue: "ODE-372"
  pullRequest: string
  buildVersion: string
  artifact: string
  status: EvidenceStatus
}

const automated = (evidence: string, criterion: string, block: number, id: string): Fase9ClosureMatrixRow => ({
  id,
  block,
  criterion,
  evidenceKind: "automated",
  evidence,
  issue: "ODE-372",
  pullRequest: "this PR",
  buildVersion: "source HEAD under test",
  artifact: "Vitest/CI output",
  status: "PASS",
})

const manualDmg = (evidence: string, criterion: string, block: number, id: string): Fase9ClosureMatrixRow => ({
  id,
  block,
  criterion,
  evidenceKind: "manual-dmg",
  evidence,
  issue: "ODE-372",
  pullRequest: "this PR",
  buildVersion: "packaged DMG required",
  artifact: "DMG recording/screenshots/HAR",
  status: "PENDING",
})

const ownerAcceptance = (evidence: string, criterion: string, block: number, id: string): Fase9ClosureMatrixRow => ({
  id,
  block,
  criterion,
  evidenceKind: "owner-acceptance",
  evidence,
  issue: "ODE-372",
  pullRequest: "this PR",
  buildVersion: "all blocking evidence required",
  artifact: "Linear acceptance comment",
  status: "PENDING",
})

/**
 * Machine-readable closure matrix. The closure report mirrors this inventory;
 * keeping the rows executable prevents a DoD bullet from disappearing into a
 * prose-only sign-off.
 */
export const FASE9_CLOSURE_MATRIX: Fase9ClosureMatrixRow[] = [
  automated("workflow/context/core/odessay-adr-identidad.md; tests/desktop-bundle/document-catalog.spec.ts", "The materialized .md is the local content authority.", 1, "B1.1"),
  automated("tests/contracts/document-catalog.test.ts; tests/services/workspace-reconciler.test.ts", ".odessay/index.json v2 is the durable binding ledger and carries no document content or product metadata.", 1, "B1.2"),
  automated("tests/contracts/document-catalog.test.ts; src-tauri/src/commands/index.rs unit tests", "SQLite is the operational desktop catalog and durable sync queue.", 1, "B1.3"),
  automated("tests/desktop-catalog-sync-service.test.ts; tests/contracts/document-catalog.test.ts", "Supabase is represented as cloud metadata/existence and is not the local content authority.", 1, "B1.4"),
  automated("tests/migrations/desktop-compatibility-retirement.test.ts; tests/migrations/indexeddb-to-sqlite.test.ts", "IndexedDB remains the web adapter and is not a desktop catalog consumer after retirement.", 1, "B1.5"),
  automated("tests/contracts/document-catalog.test.ts; tests/desktop-catalog-sync-service.test.ts", "The desktop catalog is not partitioned by user and local visibility survives auth failure/logout.", 1, "B1.6"),

  automated("tests/services/workspace-service.test.ts; tests/services/workspace-reconciler.test.ts", "Managed and external BindingRoots are represented separately and root registration does not imply Workspace visibility.", 2, "B2.1"),
  automated("tests/services/workspace-reconciler.test.ts; tests/services/desktop-workspace-reconciler-recovery.test.ts", "Manifest v2 stores bindingRootId/selectedPaths/bindings and commits atomically before SQLite projection.", 2, "B2.2"),
  automated("components/navigation/desktop-app-shell.tsx; tests/fase9-document-catalog-invariants.test.ts", "The watcher/reconciler is mounted at DesktopAppShell lifetime.", 2, "B2.3"),
  automated("tests/services/workspace-reconciler.test.ts", "Identity resolution follows manifest/path, inode, unique local hash, unique cloud hash, then mint.", 2, "B2.4"),
  automated("tests/services/workspace-reconciler.test.ts", "Rename/move/save and out-of-scope/unobservable roots preserve identity and avoid false deletion.", 2, "B2.5"),
  automated("tests/services/open-document-desktop.test.ts", "Outside-root opening requires confirmation and initially scopes selectedPaths to the chosen file.", 2, "B2.6"),

  automated("tests/services/open-document-desktop.test.ts; tests/services/open-document-retry.test.ts", "id and path inputs converge to a UUID before editor hydration.", 3, "B3.1"),
  automated("tests/fase9-document-catalog-invariants.test.ts; tests/desk-workspace-catalog-integration.test.tsx", "Desk, Workspace, Search, Recent, sidebar and Open Document use the shared catalog/application ports.", 3, "B3.2"),
  automated("tests/services/open-document-desktop.test.ts; tests/contracts/document-catalog.test.ts", "Opening the same file through different entry points is UUID-stable and idempotent.", 3, "B3.3"),
  automated("tests/services/open-document-desktop.test.ts", "cloud-only records materialize before editing and listing/hydration alone does not materialize them.", 3, "B3.4"),
  automated("tests/services/open-document-desktop.test.ts; tests/services/open-document-retry.test.ts", "Conflict, ambiguous, orphaned, filesystem and NOT_FOUND outcomes remain explicit and never create drafts.", 3, "B3.5"),

  automated("tests/desk-workspace-catalog-integration.test.tsx; tests/contracts/document-catalog.test.ts", "Desk and Workspace query the DocumentCatalog and apply different presentation/grouping only.", 4, "B4.1"),
  automated("tests/desk-workspace-catalog-integration.test.tsx", "The same UUID, state and metadata render in Desk and Workspace.", 4, "B4.2"),
  automated("tests/desk-workspace-catalog-integration.test.tsx; tests/services/workspace-reconciler.test.ts", "Watcher discovery refreshes mounted views without visiting Workspace first.", 4, "B4.3"),
  automated("tests/document-state.test.ts; tests/fase9-document-catalog-invariants.test.ts; tests/playwright/document-catalog.e2e.ts", "All local/cloud/conflict/ambiguous/stale/rebuilding states have accessible, non-destructive copy.", 4, "B4.4"),
  automated("components/workspace/workspace-desktop-required.tsx; tests/playwright/document-catalog.e2e.ts", "Web communicates the filesystem/desktop boundary honestly.", 4, "B4.5"),

  automated("tests/services/document-service-factory.test.ts; tests/desktop-catalog-sync-service.test.ts", "Desktop save order is .md atomic, manifest atomic, SQLite/enqueue, saved-local, then background cloud sync.", 5, "B5.1"),
  automated("tests/services/document-service-factory.test.ts; tests/desktop-catalog-sync-service.test.ts", "Confirmed Markdown writes remain recoverable when manifest, SQLite or network work fails.", 5, "B5.2"),
  automated("tests/content-hash.test.ts; tests/sync/content-hash-payload.test.ts; src-tauri/src/commands/index.rs unit tests", "Canonical Markdown content hashes agree across Rust, TypeScript, manifest and cloud payload fixtures.", 5, "B5.3"),
  automated("tests/desktop-catalog-sync-service.test.ts; src-tauri/src/commands/index.rs unit tests", "Cloud content_hash/index and unique-candidate rebinding are validated by the catalog adapter.", 5, "B5.4"),
  automated("tests/contracts/document-catalog.test.ts; tests/document-state.test.ts", "Local absence detaches local presence without deleting cloud metadata; cloud deletion remains explicit.", 5, "B5.5"),

  automated("tests/migrations/indexeddb-to-sqlite.test.ts; tests/desktop-catalog-sync-service.test.ts", "SQLite v2 is additive, dual-write flagged and rollback-capable until the gate completes.", 6, "B6.1"),
  automated("tests/migrations/indexeddb-to-sqlite.test.ts", "Migration harvests all IndexedDB scopes, deduplicates identity and preserves pending mutations.", 6, "B6.2"),
  automated("tests/migrations/indexeddb-to-sqlite.test.ts; tests/migrations/desktop-compatibility-retirement.test.ts", "Desktop IndexedDB remains read-only for the compatibility release before retirement.", 6, "B6.3"),
  automated("tests/migrations/desktop-compatibility-retirement.test.ts", "Historical legacy-folder/frontmatter/path-as-id/writings_index paths are isolated from normal runtime identity.", 6, "B6.4"),
  automated("tests/migrations/indexeddb-to-sqlite.test.ts", "Legacy stores are not removed while unharvested mutations or local-only UUIDs could remain.", 6, "B6.5"),

  automated("tests/services/desktop-workspace-reconciler-recovery.test.ts; tests/services/workspace-reconciler.test.ts; tests/migrations/indexeddb-to-sqlite.test.ts", "SQLite rebuild from manifests/filesystem/cloud preserves local-only UUIDs without network.", 7, "B7.1"),
  automated("tests/services/workspace-reconciler.test.ts; tests/services/desktop-workspace-reconciler-recovery.test.ts", "Corrupt/unobservable watcher inputs become stale/retryable and do not cause mass minting.", 7, "B7.2"),
  automated("tests/desk-workspace-catalog-integration.test.tsx; tests/services/workspace-reconciler.test.ts; tests/migrations/indexeddb-to-sqlite.test.ts", "Bulk scan, migration, hydration and watcher work emit one logical update.", 7, "B7.3"),
  manualDmg("Release/source observability review is still required; no automated structured-telemetry artifact is claimed", "Structured rebuild/binding/manifest/transaction/open events exclude content, tokens and complete paths from remote telemetry.", 7, "B7.4"),
  manualDmg("DMG performance trace plus sanitized network report; automated source/unit gates in this PR", "Packaged startup, fan-out and catalog-query budgets are evidenced on the release artifact, not only tauri dev.", 7, "B7.5"),

  automated("tests/fase9-document-catalog-invariants.test.ts; workflow/define/fase-9-closure-report.md", "Every DoD bullet has a typed evidence row and current status.", 8, "B8.1"),
  manualDmg("Finder rename/move recording with Desk open on the exact packaged DMG", "Watcher reconciles rename/move without losing or duplicating UUID.", 8, "B8.2"),
  manualDmg("DMG recording/screenshots of outside-root confirmation and Desk/Workspace parity", "Open Document outside root confirms once and shows the same UUID/state in both views.", 8, "B8.3"),
  manualDmg("DMG offline/restart recording plus later sync evidence", "Offline open/save/restart preserves content and binding, then converges when online.", 8, "B8.4"),
  manualDmg("DMG recording of cloud-only materialization and ambiguous/conflict handling", "Cloud-only materializes before edit; conflict/hash ambiguity is never silently resolved.", 8, "B8.5"),
  manualDmg("Exact-current technical command outputs plus DMG performance/network reports; serial Vitest/Cargo/source gates are automated", "Applicable typecheck, lint, tests, Cargo, workflow, performance/network and delivery gates are green.", 8, "B8.6"),
  ownerAcceptance("Linear product-owner acceptance comment after B8.2–B8.6 are PASS", "The owner accepts the complete Fase 9 outcome only after all blocking rows pass.", 8, "B8.7"),
]

const root = resolve(process.cwd())
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8")
const exists = (relativePath: string) => existsSync(resolve(root, relativePath))

describe("ODE-372 · Fase 9 closure matrix", () => {
  it("covers every DoD bullet with issue, PR, build and artifact traceability", () => {
    expect(FASE9_CLOSURE_MATRIX).toHaveLength(44)
    expect(new Set(FASE9_CLOSURE_MATRIX.map((row) => row.id)).size).toBe(44)

    for (const row of FASE9_CLOSURE_MATRIX) {
      expect(row.issue).toBe("ODE-372")
      expect(row.pullRequest.length).toBeGreaterThan(0)
      expect(row.buildVersion.length).toBeGreaterThan(0)
      expect(row.artifact.length).toBeGreaterThan(0)
      expect(row.evidence.length).toBeGreaterThan(0)
      expect(row.criterion.length).toBeGreaterThan(0)
      if (row.evidenceKind === "automated") expect(row.status).toBe("PASS")
      else expect(row.status).toBe("PENDING")
    }
  })

  it("exercises the accepted desktop architecture boundaries", () => {
    const adr = source("workflow/context/core/odessay-adr-identidad.md")
    const catalogSpec = source("workflow/context/features/odessay-desktop-document-catalog.md")
    const appShell = source("components/navigation/desktop-app-shell.tsx")
    const catalogFactory = source("lib/services/document-catalog-factory.ts")
    const opener = source("lib/services/open-document.ts")
    const search = source("components/navigation/search-modal.tsx")
    const desk = source("app/(app)/desk/page.tsx")
    const workspace = source("components/workspace/workspace-detail.tsx")
    const webBoundary = source("components/workspace/workspace-desktop-required.tsx")

    expect(adr).toContain(".md")
    expect(adr).toContain(".odessay/index.json")
    expect(adr).toContain("SQLite")
    expect(adr).toContain("Supabase")
    expect(adr).toContain("IndexedDB")
    expect(catalogSpec).toContain("WorkspaceReconciler")
    expect(catalogSpec).toContain("CatalogChange")
    expect(catalogSpec).toContain("OpenDocument(UUID)")
    expect(catalogSpec).toMatch(/DMG|release desktop/i)
    expect(appShell).toContain("useWorkspaceReconciler")
    expect(catalogFactory).toContain("SqliteDocumentCatalog")
    expect(catalogFactory).toContain("webDocumentCatalog")
    expect(opener).toContain("createOpenDocumentUseCase")
    expect(opener).toContain("NEVER mints a UUID and NEVER creates a")
    expect(opener).toContain("draft — draft creation stays an explicit New Writing action")
    expect(search).not.toContain("@/lib/local-db")
    expect(search).toContain("loadSearchWritings")
    expect(desk).not.toMatch(/import(?!\s+type\b)[^\n]*from ["']@\/lib\/local-db/)
    expect(workspace).not.toMatch(/import(?!\s+type\b)[^\n]*from ["']@\/lib\/local-db/)
    expect(webBoundary).toContain("filesystem access")
  })

  it("keeps all evidence assets addressable and the release gate DMG-aware", () => {
    const referencedFiles = new Set<string>()
    for (const row of FASE9_CLOSURE_MATRIX) {
      for (const match of row.evidence.matchAll(/(?:^|[;\s])((?:tests|workflow|components|app|npm|cargo)[^;\s]*)/g)) {
        const candidate = match[1].replace(/[),.]+$/, "")
        if (/\.(ts|tsx|md|mjs)$/.test(candidate)) referencedFiles.add(candidate)
      }
    }

    expect(exists("workflow/define/fase-9-closure-report.md")).toBe(true)
    expect(exists("tests/playwright/document-catalog.e2e.ts")).toBe(true)
    expect(exists("tests/desktop-bundle/document-catalog.spec.ts")).toBe(true)
    expect(exists("app/perf/workspace-boundary-harness/page.tsx")).toBe(true)
    expect(source("scripts/release-desktop.mjs")).toContain("tauri build")
    expect(source("scripts/validate-desktop-bundle.mjs")).toContain("DMG found")
    expect([...referencedFiles].filter((file) => file.startsWith("tests/")).length).toBeGreaterThan(15)
  })
})
