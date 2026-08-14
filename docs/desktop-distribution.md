# Odessay Desktop — Distribution Guide

This document covers how to build and distribute the Odessay desktop app to known users without Apple code signing.

---

## Building a release

Run from the repository root:

```bash
npm run desktop:release
```

This command:
1. Validates that `package.json` and `src-tauri/tauri.conf.json` declare the same version — exits with an error if they differ.
2. Runs `tauri build`, which compiles the Rust backend and produces a bundled macOS `.app`.
3. Copies the resulting DMG to `dist/releases/Odessay-{version}-aarch64.dmg`.

Build time is typically 1–2 minutes on Apple Silicon.

### Output location

```
dist/releases/Odessay-{version}-aarch64.dmg
```

Each build writes a new file with the version in its name; previous releases are not overwritten.

### Version drift

If `package.json` and `src-tauri/tauri.conf.json` have different `version` values, the script exits immediately:

```
[desktop:release] VERSION DRIFT DETECTED
  package.json:         0.2.0
  tauri.conf.json:      0.1.0

  Fix: align both files to the same version before releasing.
```

Fix: update both files to the same version string before running `desktop:release` again.

### Runtime host

Every desktop build path — including a bare `npm run tauri:build` — runs `scripts/prepare-tauri-build.mjs` as `beforeBuildCommand`, and that script now resolves `NEXT_PUBLIC_APP_URL` the way Next.js does (shell variable first, then `.env.local` / `.env`) **before** exporting:

- a remote host → exported, recorded in `dist/odessay-runtime.json`, and corroborated against the emitted chunks;
- a local host or no host at all → the build aborts with `[tauri-build] INVALID RUNTIME HOST`.

Use `npm run desktop:release:prod:signed` (or export `NEXT_PUBLIC_APP_URL=https://odessay.vercel.app` yourself). For a local-server build, pass `--allow-localhost` — `desktop:release` forwards it as `DESKTOP_ALLOW_LOCAL_RUNTIME=1`, since flags cannot cross `beforeBuildCommand`.

The check exists because the shell variable and the value Next actually inlines can disagree: with `NEXT_PUBLIC_APP_URL` unset, the old gate saw an empty variable and passed while the build read `http://localhost:3000` from `.env.local` and baked it into every chunk. The resulting artifact told writers the transcription service lived on localhost.

---

## Distributing to known users

Share the DMG file directly (AirDrop, shared drive, email attachment, etc.).

### What the user sees on first open

Because the app is **not signed with an Apple Developer ID**, macOS Gatekeeper will block the first launch with a dialog like:

> _"Odessay" can't be opened because Apple cannot check it for malicious software._

### How to bypass Gatekeeper (one-time, per machine)

The user runs this command in Terminal **once** after receiving the DMG and installing the app:

```bash
xattr -d com.apple.quarantine /Applications/Odessay.app
```

Then launch the app normally. After this one-time step, Gatekeeper no longer blocks it.

Alternatively, the user can right-click the app in Finder → **Open** → click **Open** in the confirmation dialog. This also clears the quarantine flag for that app.

---

## Session token storage

Odessay stores authentication tokens in a local JSON file managed by `tauri-plugin-store` rather than in `localStorage` or the macOS Keychain. This ensures sessions survive app restarts without requiring code signing.

The store file lives in the app data directory:

```
~/Library/Application Support/com.odessay.app/secure.dat
```

No system dialog is shown on first sign-in. The file is created automatically when the user signs in for the first time.

### Why not the macOS Keychain?

macOS Keychain ACLs bind each entry to the code signature of the writing process. Ad-hoc signed apps (no Apple Developer ID) have no stable identity between executions: the write succeeds, but the read from the next process instance fails silently. `tauri-plugin-store` avoids this by writing to the app data directory, which is accessible to the app regardless of signing status.

When formal code signing is added (Apple Developer ID), migration to Keychain is a drop-in change — the `keychainStorage` TypeScript adapter contract (`getItem`/`setItem`/`removeItem`) remains unchanged and only the Rust commands need to be swapped back.

### Removing stored credentials manually

If a user wants to force a clean sign-in state, delete the store file:

```bash
rm ~/Library/Application\ Support/com.odessay.app/secure.dat
```

Or sign out from within the app — this calls `removeItem` on the stored tokens and clears the file automatically.

---

## Code signing — deferred debt

Code signing and notarization with an Apple Developer ID ($99/year) are **intentionally out of scope** for the current milestone. Without signing:

- Users on macOS must run the `xattr` command above once.
- The app cannot be distributed via the Mac App Store.
- Enterprise MDM policies that block unsigned apps will prevent installation.

When signing is added (future issue), the changes will be:
- Add `APPLE_SIGNING_IDENTITY`, `APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID` environment variables to the build environment.
- Set `bundle.macOS.signingIdentity` in `src-tauri/tauri.conf.json`.
- Add notarization step after `tauri build`.

---

## Versioning convention

The single source of truth for the version is `package.json`. Before each release, update both:

```json
// package.json
{ "version": "0.2.0" }

// src-tauri/tauri.conf.json
{ "version": "0.2.0" }
```

`npm run desktop:release` enforces consistency and will fail if they differ.

---

## DMG validation

### Automated checks

Run the automated bundle validator after every `desktop:release`:

```bash
npm run validate:desktop
```

This validates:
- DMG exists and mounts correctly
- `.app` bundle structure (binary, resources, `Info.plist`)
- Build-time version alignment (`package.json` ↔ `tauri.conf.json`)
- CSP includes `ipc:` / `http://ipc.localhost` (required for Tauri IPC in the bundle)
- `Cargo.toml` has `features = ["devtools"]` (Fase 7 requirement)
- `NEXT_PUBLIC_APP_URL` is not localhost in release builds
- Static export artifacts exist (`dist/index.html`)
- No obvious baked-in server redirects that break in the DMG
- Quarantine / code-signing state

If automated checks pass, proceed to the manual smoke-test checklist below.

### Semi-manual smoke-test checklist (Fase 7 critical flows)

> **Scope note (ODE-225):** This is a minimal, semi-manual checklist designed for the Fase 7 MVP. A full automated Playwright/WebDriver suite over the Tauri WebView is intentionally post-MVP. Each item below should be executed against the **actual DMG** (`npm run desktop:release`), not `tauri dev`.
>
> Record results as: ✅ Pass / ❌ Fail / ⏭️ Skipped (with reason).

#### Installation & launch
1. **Mount DMG** — double-click `Odessay-{version}-aarch64.dmg`, drag to `/Applications`.
2. **Gatekeeper bypass** — run `xattr -d com.apple.quarantine /Applications/Odessay.app`.
3. **First launch** — open from `/Applications`. App starts without crash. Splash / loading state resolves within 5s.
4. **DevTools** — right-click → Inspect (or `Cmd+Option+I`) opens DevTools (required for Fase 7 diagnostics).

#### Auth & session persistence
5. **Sign in** — complete OAuth/email flow. User lands in workspace.
6. **Close and reopen** — `Cmd+Q`, relaunch app. Session is restored without re-prompting login.
7. **Token invalidation recovery** — manually corrupt `~/Library/Application Support/com.odessay.app/secure.dat` (e.g., insert invalid JSON), relaunch. App detects invalid token, shows sign-in screen, and recovers cleanly after re-authentication.
8. **Sign out** — use in-app Sign Out. Token file is removed. App returns to auth screen. No hang or freeze.

#### Local file I/O (offline-first)
9. **Create writing** — create a new document, add Markdown content (headings, bold, list, code block). Save.
10. **Close and reopen** — `Cmd+Q`, relaunch. The new writing appears in recents and opens with content intact.
11. **Edit in Source mode** — switch to Source mode, edit raw `.md`, switch back to Rich mode. Changes are preserved.
12. **Open existing `.md` file** — use File → Open (or `Cmd+O`) to open a `.md` from the filesystem. Content renders correctly.
13. **Offline save** — disconnect Wi-Fi, edit a document, save. No error dialogs. Reconnect Wi-Fi; sync resumes without data loss.

#### Sync & web parity
14. **Sync to web** — with network on, edit a document in desktop. Open the same document in web. Content matches.
15. **Sync from web** — edit in web, refresh desktop. Changes appear in desktop.
16. **Correspondence / collections** — if correspondence features are active, verify that desktop and web show consistent collection trees.

#### AI capabilities (desktop → web AI proxy)
17. **AI title suggestions** — open a document, request AI title suggestions. Response arrives within 10s.
18. **AI publication review** — run publication review on a document. No "network error" due to missing auth token in desktop context.

#### Native menus & shortcuts
19. **App menu** — Odessay menu shows version and native items (Hide, Quit).
20. **File menu** — New, Open, Save, Save As work as expected.
21. **Edit menu** — Undo, Redo, Cut, Copy, Paste work in the editor.
22. **View menu** — Toggle Rich/Source mode, Toggle Sidebar.
23. **Window menu** — Minimize, Full Screen, Close window.
24. **Keyboard shortcuts** — `Cmd+N`, `Cmd+O`, `Cmd+S`, `Cmd+Shift+S`, `Cmd+Z`, `Cmd+Shift+Z`, `Cmd+,` (Settings) respond correctly.

#### Settings
25. **Settings persistence** — change a setting (e.g., font size), close app, reopen. Setting is restored.
26. **Settings parity** — desktop settings reflect the same options as web settings where applicable.

#### Cleanup
27. **Uninstall** — drag `Odessay.app` from `/Applications` to Trash. No residual background processes.

---

### Recording results

Create a dated copy of this checklist for each validation run:

```bash
cp docs/desktop-distribution.md "evidence/ode-225-smoke-$(date +%Y-%m-%d).md"
```

Fill in the results, then attach the file to the release notes or Linear issue.

---

## Auto-updater (Tauri updater + GitHub Releases)

Odessay desktop includes a built-in auto-updater that checks GitHub Releases for newer versions. The updater uses Tauri's official updater plugin with an Ed25519 signature verification.

### How it works

1. On launch, the app queries `https://api.github.com/repos/hugomarin/Odessay/releases/latest`.
2. If a newer version exists, the sidebar shows an **Install Update** banner.
3. The user must explicitly click **Install Update** — updates never install without consent.
4. The app downloads the signed `.app.tar.gz`, verifies the Ed25519 signature against the embedded public key, replaces the app bundle, and relaunches.

### Release artifacts

After `npm run desktop:release`, `dist/releases/` contains four files per release:

```
Odessay-{version}-aarch64.dmg                 # First-install DMG
Odessay_{version}_aarch64.app.tar.gz          # Auto-updater archive
Odessay_{version}_aarch64.app.tar.gz.sig      # Minisign signature
latest.json                                   # Tauri updater manifest
```

All four must be uploaded to the GitHub release for the updater to function.

### Signing key management

**Private key — never committed.**

- Generate a keypair once with the Tauri CLI:
  ```bash
  npx tauri signer generate --write-keys ./updater-key
  ```
- The command prints the public key and writes `./updater-key` (private) and `./updater-key.pub` (public).
- Paste the **public key** (second line of `updater-key.pub`) into `src-tauri/tauri.conf.json` → `plugins.updater.pubkey`.
- Store the **private key** in your password manager and CI secrets (`TAURI_SIGNING_PRIVATE_KEY` or `TAURI_SIGNING_PRIVATE_KEY_PATH`). A good local location on macOS is `~/.config/odessay/updater/odessay-updater-key` with `chmod 600`.
- If the private key is lost, generate a new pair and update the public key in a new app release. Older app versions will reject updates signed with the new key, so users on those versions must reinstall from the DMG.

### Creating a GitHub release

1. Bump version in `package.json` and `src-tauri/tauri.conf.json`.
2. Run `npm run desktop:release`.
3. Go to [GitHub Releases](https://github.com/hugomarin/Odessay/releases) → **Draft a new release**.
4. Tag: `app-v{version}` (e.g., `app-v0.2.0`).
5. Title: `Odessay Desktop v{version}`.
6. Upload the three artifacts from `dist/releases/`.
7. Publish the release.

The updater checks the **latest** release; pre-releases are ignored unless explicitly configured.

### Rollback policy

If a release is broken:

1. **Do not delete the release** — deleting breaks users who are mid-download.
2. Edit the release, mark it as a **pre-release**, and publish a newer fixed release.
3. The app will skip the broken pre-release and install the next stable one.
4. For urgent rollbacks, publish a new release with a higher patch version (e.g., `0.2.1`) containing the previous known-good code.

### Troubleshooting updater failures

| Symptom | Cause | Fix |
|---|---|---|
| "Update check timed out" | GitHub API rate limit or offline | Retry later; check network |
| "Signature verification failed" | Wrong private key used for signing | Ensure `TAURI_SIGNING_PRIVATE_KEY` matches the public key in `tauri.conf.json` |
| No update banner appears | Version not bumped or release not published | Verify tag exists and is the latest release |
| Download stuck | Large archive or slow connection | Wait; the updater has a 30s timeout |

### CI integration (future)

When GitHub Actions is added for desktop builds:

- Set `TAURI_SIGNING_PRIVATE_KEY` as an encrypted repository secret.
- Run `npm run desktop:release` in the workflow.
- Upload artifacts to the release automatically with `gh release upload`.
- This eliminates manual artifact handling.
