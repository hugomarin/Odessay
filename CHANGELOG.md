# Changelog

## 0.7.1 - 2026-08-25

### Fixed

- Disabled the macOS App Sandbox for the ad-hoc desktop bundle so existing local settings, Workspaces, and document paths remain available after installation.
- Restored direct filesystem moves for documents saved to user-selected Workspace folders.

## 0.7.0 - 2026-08-25

### Added

- Redesigned Desk, Studio, Workspace, Settings, overlays, selection flows, and empty states.
- Added Workspace tree navigation with root and folder views.
- Added Filter, Group by, and Sort controls to Workspace, reusing the Desk filter system.
- Added artifact type and writing status surfaces.
- Added embedded image presentation in the editor.
- Added desktop document catalog, sync, autosave, and workspace improvements.

### Changed

- Renamed Workspace creation actions from "New file" to "New Artifact".
- Improved sidebar toggle placement and editor tab text alignment.
- Added root-only file filtering in Workspace and folder document visibility in Studio.
- Added status and artifact type icons with consistent visual tokens.

### Fixed

- Removed duplicated TOC and Workspace controls from the editor header.
- Made the Workspace root interactive and keyboard accessible.
- Prevented folders without child folders from displaying an expand chevron.
