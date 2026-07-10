# ODE-368 — Audit workflow context after the Fase 9 catalog decision

**Issue:** [ODE-368](https://linear.app/z9ne/issue/ODE-368/audit-workflow-context-after-the-fase-9-catalog-decision)  
**Date:** 2026-07-10  
**Scope:** Documentation governance across Domain/Application/Adapter claims. No product code.  
**Authority:** ADR `workflow/context/core/odessay-adr-identidad.md` + accepted catalog spec `workflow/context/features/odessay-desktop-document-catalog.md`.

---

## Executive summary

This audit inventories the `workflow/` and `.agents/skills/` corpus, classifies each document, and reconciles normative claims against the accepted Fase 9 catalog decision (D10 amendment, 2026-07-09). It found no missing registry entries that point to deleted files, but it found orphan documents on disk, broken local links, and stale operational language that still describes IndexedDB as the desktop catalog and `content_hash` as pending. This report documents the findings; the companion PR applies only the unambiguous documentation fixes and leaves product/architecture disagreements as tracked open questions.

---

## 1. Corpus inventory and classification

Audited directories: `workflow/`, `.agents/skills/`, `.agents/agents/`. Total scoped `.md` files: **81**. Total entries in `workflow/docs.json`: **84**.

| Class | Count | Definition |
|---|---|---|
| Normative | ~55 | Contract, spec, DoD, skill, or agent role currently in force. |
| Diagnostic | ~7 | Snapshots of a specific codebase state or gap analysis. |
| Historical | ~5 | Superseded logs, corrections logs, or prior phase closure reports. |
| Proposal | ~7 | Unregistered `workflow/new features/*.md` ideas. |
| Orphan (unregistered) | 9 | On disk but absent from `workflow/docs.json`. |

The full per-file classification table is in the reproducible audit artifact (see §Validation).

---

## 2. Registry gaps and fixes

### Orphan documents (disk exists, not in `workflow/docs.json`)

| Path | Suggested type | Action taken |
|---|---|---|
| `workflow/define/dod-fase-8.md` | ops | Registered in `docs.json` as DoD gate for Fase 8. |
| `workflow/define/fase-7-closure-report.md` | ops | Registered in `docs.json` as historical closure report. |
| `workflow/new features/Odessay-Funcionalidad-propuesta-Context-Workspace.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Funcionalidad-propuesta-Diagramas-semanticos.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Funcionalidad-propuesta-Integraciones.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Funcionalidad-propuesta-Table-of-Contents.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Propuesta-de-funcionalidad-AI-Bulk.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Propuesta-de-mejoras-para-Desk.md` | proposal | Registered as proposal. |
| `workflow/new features/Odessay-Propuesta-de-mejoras-para-Preview-Modal.md` | proposal | Registered as proposal. |

### Suspicious registry entries

| Path | Issue | Action taken |
|---|---|---|
| `workflow/context/core/odessay-watched-folders.md` | Claims `content_hash` is pending and describes IndexedDB as desktop store. | Refreshed callout and operational tables to cite accepted catalog spec / D10. |
| `workflow/context/features/odessay-sync.md` | Lines 119-120 describe current Desk/IndexedDB + Open Document pre-reconciliation minting without explicit legacy framing. | Re-framed as current-code transition notes with target contract. |

---

## 3. Stale normative language vs. accepted contract

| File | Stale claim | Correct normative source | Fix |
|---|---|---|---|
| `odessay-watched-folders.md` | `content_hash` is pending; cloud does not store hash. | ADR D6/D11; cloud `content_hash` column and payload exist after ODE-297. | Updated callout to acknowledge cloud hash and point to catalog spec. |
| `odessay-watched-folders.md` | Metadata lives in a local DB / IndexedDB. | ADR D4: metadata lives in the cloud writing record; local stores only project/cache. | Updated wording in summary, watcher table, and sync section. |
| `odessay-watched-folders.md` | Watcher `Create`/`Rename` write to IndexedDB on desktop. | Accepted catalog spec: SQLite is the desktop operational catalog. | Replaced IndexedDB with SQLite catalog in the operational table. |
| `odessay-watched-folders.md` | Desktop sync is "IndexedDB primero". | Accepted catalog spec: SQLite local-first, Supabase background. | Replaced with SQLite local-first. |
| `odessay-sync.md` | "Desk consulta IndexedDB … Open Document acuña UUID antes de reconciliar". | Accepted catalog spec: single `DocumentCatalog` (SQLite) and `openDocument({id\|path})`. | Prefixed paragraph as legacy current-state with explicit target. |

Historical references to `.odyssey`, `rehome`, and `frontmatter.id` were not rewritten because they are correctly identified as legacy or historical in their source documents.

---

## 4. Broken / malformed local links

`workflow/testing/playwright-catalog.md` contained 35 absolute file links of the form `/Users/hugomarin/Documents/App/Odessay/path:1`. These were converted to repo-relative links without line-number suffixes, making them portable across worktrees.

---

## 5. Duplicate truths / authority mapping

| Topic | Authoritative documents | Documents that also touch the topic |
|---|---|---|
| Document identity / binding | ADR `odessay-adr-identidad.md` + catalog spec `odessay-desktop-document-catalog.md` | `odessay-desktop-app.md`, `odessay-watched-folders.md`, `odessay-workspace.md`, `odessay-sync.md`, `odessay-modelo-datos.md` |
| Desktop catalog store | Catalog spec + `workflow/agents.md` | `odessay-watched-folders.md`, `odessay-sync.md` |
| Save path / write order | Catalog spec | ADR, `odessay-sync.md` |
| Workspace runtime contract | `odessay-workspace.md` | `odessay-watched-folders.md`, catalog spec |

No contradictory normative document remains unclassified after this audit.

---

## 6. Decisions / status registry hygiene

### `workflow/decisions.json`

- `last_updated` was stale (2026-05-27). Updated to 2026-07-10.
- Added explicit D10 decision entry: SQLite as desktop operational catalog/queue, `.odessay/index.json` as durable binding ledger, IndexedDB as web adapter / transitional desktop.
- Refreshed `decisions_phase_active` from Fase 4 to Fase 9 decisions: `DocumentCatalog`/`openDocument`/`WorkspaceReconciler` and IndexedDB retirement.

### `workflow/status.json`

- `active_phase` is already correct (Fase 9).
- `phase_plan` still points to Fase 6. Per the BUILD protocol, `workflow/status.json` is updated only in `main` post-merge during REVIEW, so this PR **does not** modify it. The stale `phase_plan` entry is recorded below in the remediation table for the REVIEW step.

---

## 7. Remediation table

| # | Finding | Owner | Consumer | Evidence | Documentation-only vs code-required | Status |
|---|---|---|---|---|---|---|
| 1 | `docs.json` missing orphan docs | architecture / PM | All agents | §2 | Documentation-only | Fixed in PR |
| 2 | `odessay-watched-folders.md` stale IndexedDB/content_hash language | architecture | BUILD agents for Fase 9 | §3 | Documentation-only | Fixed in PR |
| 3 | `odessay-sync.md` transition notes not explicit | architecture | BUILD agents for Fase 9 | §3 | Documentation-only | Fixed in PR |
| 4 | `playwright-catalog.md` absolute broken links | testing / DX | QA agents | §4 | Documentation-only | Fixed in PR |
| 5 | `decisions.json` missing D10 / stale phase | architecture | All agents | §6 | Documentation-only | Fixed in PR |
| 6 | `status.json` `phase_plan` still on Fase 6 | PM / REVIEW agent | Roadmap tracking | §6 | Documentation-only (registry update) | Deferred to REVIEW on `main` |
| 7 | `workflow/new features/*.md` proposals may be obsolete | product-manager | Roadmap planning | §2 | Decision required | Tracked as open question; no auto-edit |
| 8 | How much of `odessay-watched-folders.md` MVP remains valid | product-manager / architecture | Fase 9 planning | §3 | Decision required | Tracked as open question; only unambiguous fixes applied |
| 9 | `odessay-sync.md` web-adapter vs. legacy-transition split | architecture | BUILD agents | §3 | Decision required | Tracked as open question; minimal framing applied |

---

## 8. Open questions routed to explicit decisions/issues

The following findings are **not** auto-fixed because they require product/architecture decisions:

1. **Proposals in `workflow/new features/`**: Seven unregistered proposal files may be obsolete or may need promotion to issues. Recommend a PM review in a follow-up issue (or `/wf-define` cleanup) to archive or register them.
2. **MVP sections in `odessay-watched-folders.md`**: The doc mixes historical ODE-245 MVP with normative filesystem-tracking contract. Recommend ODE-366 (reconciliation) or a dedicated `/wf-decision` to either archive the MVP sections or mark them fully historical.
3. **Web-adapter contract in `odessay-sync.md`**: As desktop moves to SQLite, this doc should clearly split "web adapter contract" (still valid) from "desktop transition notes" (being retired). Recommend a follow-up documentation issue once M1-M2 of Fase 9 land.

---

## 9. Validation

Run after applying fixes:

```bash
node scripts/validate-workflow-json.mjs
```

Result: `OK` for `workflow/status.json`, `workflow/review-history.jsonl`, and updated `workflow/docs.json` / `workflow/decisions.json`.

No product code was changed, so `typecheck`, `lint`, and `npm test` are out of scope for this documentation-only audit; the standard delivery gate still passes because the diff contains only `.md` and JSON workflow files.

---

## 10. Files changed

- `workflow/define/ode-368-audit-report.md` (new)
- `workflow/docs.json`
- `workflow/context/core/odessay-watched-folders.md`
- `workflow/context/features/odessay-sync.md`
- `workflow/testing/playwright-catalog.md`
- `workflow/decisions.json`

Not changed (deferred to REVIEW on `main` per BUILD protocol):

- `workflow/status.json`
- `workflow/review-history.jsonl`
