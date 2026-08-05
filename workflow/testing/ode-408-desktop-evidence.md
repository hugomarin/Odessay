# ODE-408 — Packaged desktop evidence

Captured on 2026-08-02 against the packaged Tauri application, not `tauri dev`.

## Build under test

- Command: `NEXT_PUBLIC_APP_URL=http://localhost:3000 npm run desktop:release:local`
- DMG: `dist/releases/ArtifactStudio-0.3.8-aarch64.dmg`
- SHA-256: `e3d3781e04b788a3433cac6faac1b88af9a9812a7362e9b33b028f197f3d8b00`
- App executed: `src-tauri/target/release/bundle/macos/Artifact Studio.app`
- Release gate before packaging: 52 Vitest tests and 2 Playwright lifecycle E2Es passed.
- The artifact intentionally embeds `http://localhost:3000` for local branch validation and must not be distributed.

## Fixture and removal lifecycle

The isolated BindingRoot contained `Alpha.md` and `Beta.md`. Adoption created a
v2 `.odessay/index.json` with empty `selectedPaths` and these stable identities:

- `Alpha.md` → `466a5c46-7348-42f3-b3ee-0bfbaac45bde`
- `Beta.md` → `b5217654-599e-4ba2-837c-4d7f16eb5367`

Observed packaged-app flow:

1. Both files rendered in Workspace and Desk.
2. The confirmation reported 2 tracked / 2 local-only documents and explicitly
   said that the folder, Markdown files and `.odessay` index remain untouched.
3. Confirming removal returned to the Workspace list in 719 ms observed
   end-to-end through Computer Use; Alpha and Beta disappeared immediately.
4. The application process was quit and relaunched. Neither document reappeared
   in Desk or Recent.
5. Re-adding the same folder restored both documents with the UUIDs above and no
   duplicate rows.
6. Markdown SHA-256 values stayed unchanged across removal and re-add:
   - Alpha: `6d35895948cb748526f578ab9a65fcdd12dcc062277eb11bfb6ed4954511a581`
   - Beta: `2e834fbeacd35e0a102935614e68075ebf803211af067d1e6b0a03a3a2a465df`

The manifest may refresh derived observation fields such as `lastSeen` during
re-adoption; `bindingRootId`, `selectedPaths`, file membership and UUID bindings
were preserved.

## Network and fan-out evidence

WebKit DevTools Network was cleared immediately before opening the confirmation
and performing removal in the packaged app.

- Filter `supabase.co`: 0 domains, 0 resources, 0 B.
- Filter `catalog_apply_workspace_removal`: exactly 1 IPC resource, 79 B response,
  247 B transferred.
- The native operation is one SQLite transaction for the entire BindingRoot; it
  does not download document bodies and does not issue one request per writing.
- `tests/contracts/document-catalog.test.ts` verifies one catalog invalidation for
  a committed logical batch and zero invalidations when the retirement fence
  rejects a late watcher callback.
- Native SQLite regressions verify a single durable cloud-delete mutation on
  retry/restart and rejection of late watcher reprojection.

Cloud-backed archival is covered at the native catalog/application boundary with
real SQLite transactions and a durable queue. The packaged fixture was kept
local-only deliberately so acceptance did not mutate a real user cloud record.

---

# Cloud lifecycle — packaged desktop evidence

Captured 2026-08-04 against a release build of the branch
(`npm run desktop:release:prod`), signed into a real account, with **two synced
documents**. This run covers what the 2026-08-02 pass deliberately left out: the
cloud archive/restore lifecycle on the packaged surface.

## Fixture

Folder `~/Documents/ode408/` with `Alpha.md` and `Beta.md`, both reaching the
`Synced` badge before removal.

| | UUID | inode at adoption |
|---|---|---|
| Alpha.md | `155950b3-eee3-47a4-8cb5-afc7fa6daef5` | 148181389 |
| Beta.md | `ff3a4ca5-6893-4b63-acca-8c90a4ddef3b` | 148181324 |

`bindingRootId`: `f70a727a-4564-4eba-8d09-f8e0023528d1`

`selectedPaths` normalized from `["Alpha.md","Beta.md"]` to `[]` on re-adoption —
the expected collapse to whole-folder scope when every file is covered.

## Confirmation dialog

Verbatim, with two synced documents:

> This workspace has 2 tracked documents. 2 synced documents will be archived in
> the cloud. The local folder, .md files, and .odessay index stay untouched.

Counts resolved correctly (2 tracked / 2 synced) and the local-only clause was
correctly absent. Cancelling produced no change to workspace, catalog or files.

## Offline removal and cloud archive

1. Network disabled, then Remove from Artifact Studio confirmed.
2. Both documents left Desk immediately — no wait on the network (41 → 39).
3. Cloud mutations queued durably with no connectivity.
4. Network restored: both appeared in Settings → Archived writings as
   **Cloud archived**, dated Aug 4, and did **not** return to Desk.

## Re-add — local wins, identity preserved

Across three complete remove/re-add cycles, including one that exposed and then
verified the fixes below:

- Same UUIDs and same `bindingRootId` throughout; no duplicate rows.
- Both documents returned to Desk as `Synced` and left Archived writings.
- The externally edited `.md` won: its content replaced the cloud copy, with no
  conflict UI and no overwrite of the local file.
- In one cycle both files were removed and re-added untouched; their SHA-256
  values were byte-for-byte identical before and after.

**Identity survived an inode change.** `Alpha.md` was edited by an editor that
saves atomically (write-temp-then-rename), so its inode moved from `148181389` to
`148191038` while `Beta.md` kept `148181324`. The UUID was preserved regardless,
confirming the manifest ledger — not inode correlation — governs identity.

## Two defects found by this run

Both were correctness bugs invisible to unit tests, caused by the same confusion
between **cloud ownership** (`cloud_account_id`, survives archival) and **cloud
liveness** (`cloud_present`, which hydration sets to 0 for a tombstoned row).

1. **Reactivation never matched after a restart** (fixed in `87c8f11`).
   `catalog_reactivate_binding_root` required `cloud_present=1 AND
   deleted_at_cache IS NOT NULL` — unsatisfiable once hydration has run. A
   document that survived an app restart was reclassified as local-only and
   stranded: hidden from Desk, still tombstoned in Archived writings.
2. **Removal misclassified an already-archived document** (fixed in `55e003e`).
   `catalog_apply_workspace_removal` branched on `cloud_present`, so a second
   removal sent a cloud-owned document down the local-only path: no tombstone, no
   queued mutation. It then disappeared from Desk *and* from Archived writings.

Both fixes carry native regressions verified to fail against the previous SQL.
The remaining sites of the same confusion are presentation-only and tracked in
ODE-416.

## Out of scope, blocked by ODE-415

The criterion *"offline, synced documents appear as archived/pending"* could not
be observed: with no connectivity, opening Settings crashes the whole application
with `SecurityError: Attempt to use history.replaceState() more than 100 times per
10 seconds`. Root cause is in the Settings account page, unrelated to workspace
removal, and reproduces by navigating to Settings offline without touching
Workspaces. Filed as ODE-415.

What that criterion protects — that removal converges locally and mutations
survive without network — **is** proven above.
