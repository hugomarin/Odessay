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
