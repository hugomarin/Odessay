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
