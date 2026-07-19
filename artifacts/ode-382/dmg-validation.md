# ODE-382 DMG validation

- Artifact: `dist/releases/ArtifactStudio-0.3.8-aarch64.dmg`
- Version: `0.3.8`
- Architecture: `aarch64`
- Size: `8.5 MB`
- SHA-256: `efc62a81ad7cbb3c3a8e337bbb06c5423e5a44157c5f13b04a546f2101cf7390`
- Build command: `npm run desktop:release:prod`
- Validation command: `NEXT_PUBLIC_APP_URL=https://odessay.vercel.app npm run validate:desktop -- --dmg dist/releases/ArtifactStudio-0.3.8-aarch64.dmg`

## Automated result

Passed with zero failures and zero warnings:

- DMG discovery and read-only mount
- `.app` binary, resources, and `Info.plist`
- bundle identifier `com.z9ne.odessay`
- package/Tauri version alignment
- CSP IPC and `connect-src`
- Tauri devtools feature
- production remote app URL
- Next.js static export
- redirect sanity
- ad-hoc signing state

The updater archive is intentionally unsigned because no `TAURI_SIGNING_PRIVATE_KEY` was present. This does not invalidate the DMG used for local acceptance evidence; unsigned updater delivery remains unavailable.

## Manual packaged-app result

The `.app` was copied directly from the generated DMG, launched independently from `/Applications/Artifact Studio.app`, and used to capture all eight ODE-382 evidence images. Desk and Workspace loaded the local catalog and authoritative Markdown descriptions without a crash or loading blocker.
