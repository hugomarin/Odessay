# ODESSAY — Runtime Coexistence Policy

This policy defines how Odessay operates while web and desktop coexist as two surfaces of the same product.

Desktop is not a packaged copy of the web runtime. In desktop, the writing exists first as a local Markdown document on the user's filesystem. Remote capabilities can authenticate, hydrate, sync, publish, share, or assist, but they do not define whether the document exists and they must never block the local write path.

## Runtime Roles

### Desktop

Desktop is the filesystem-first authoring runtime.

- New and edited writings are persisted to the local canonical `.md` path first.
- The local file is updated before any cloud sync, publishing, sharing, or AI operation can matter.
- Local indexes, previews, sync metadata, and cloud records are derived or secondary operational state.
- Auth is optional for local writing. Login enables remote capabilities; it is not a prerequisite for opening, editing, or saving local documents.

### Web

Web remains the hosted collaboration and publication runtime.

- Web owns the fully supported publishing and sharing flows in this phase.
- Web continues to use hosted auth, Supabase-backed sharing, preview links, public author pages, and shared reading surfaces.
- Web preserves the current flow for authors who already publish or share from the browser.

## Offline Behavior

Desktop works offline for the local writing path:

- open local writings;
- edit Rich or Source mode over the same canonical Markdown document;
- save changes to disk;
- keep derived local state current enough for the editing session.

The following do not run fully offline:

- first login and account validation;
- remote hydration from cloud;
- sync flush to Supabase;
- AI requests backed by a hosted provider;
- publishing to public web surfaces;
- preview-link creation, rotation, and revocation;
- direct sharing with other Odessay accounts.

When the network is unavailable, desktop keeps the document local and durable. Remote work resumes later when auth and connectivity are available.

## Login And Sync Order

The operating order is:

1. Persist the writing locally to the filesystem-backed `.md` document.
2. Update local derived state such as recent documents, metadata, and pending sync markers.
3. If the user is authenticated, sync eligible changes to the cloud in the background.
4. If the user chooses a web-only capability, open the hosted web runtime for that writing.

Sync never replaces the filesystem write path. Cloud state can hydrate or reconcile remote metadata, but it cannot become the primary write target for desktop.

## Publishing And Sharing

Publishing and sharing are web-only paths in this phase.

Desktop must not fail silently, hide the capability, or pretend to complete a partial local version of the flow. Instead, desktop presents explicit handoff actions:

- **Publish on web** opens the hosted web editor for the current writing.
- **Share with link** opens the hosted web editor for the current writing with sharing intent.

The user-facing promise is precise: the document already exists locally, and web is the supported place to publish or share it.

## Release And Versioning Policy

Web and desktop can ship on different release cadences, but they must preserve the same document contract.

- Web can deploy continuously.
- Desktop ships signed release artifacts.
- Desktop releases should declare the hosted web runtime they expect through `NEXT_PUBLIC_APP_URL`.
- A production desktop build must point to the hosted web runtime, not localhost.
- If auto-update is enabled in a future release, it must update the shell and adapters without changing the local Markdown source-of-truth policy.

Compatibility is judged by document and service contracts, not by identical implementation details.

## Compatibility Invariants

- Desktop is filesystem-first, not subordinate to web.
- Markdown remains the canonical durable document format for desktop.
- Web publishing and sharing remain the supported remote paths for this phase.
- Desktop sharing and publishing controls always give a clear path to web.
- Web behavior is preserved for browser users.
- Remote sync is a background capability over an already-local document.
