# Design QA — ODE-382 Workspace visual parity

- Source visual truth: `/Users/hugomarin/Desktop/Screenshot 2026-07-17 at 4.53.44 p.m..png`
- Implementation screenshot inspected: `/var/folders/bf/r1y21ww51jz1ysw1mn41q3lc0000gn/T/com.openai.sky.CUAService/Artifact Studio Screenshot 2026-07-18 at 11.19.19 p.m..jpeg`
- Viewport: native Artifact Studio window, approximately 1228 × 768 px
- State: Workspace `writings`, populated FILES table, light theme

## Full-view comparison evidence

The source image was opened at original resolution and the populated Workspace was captured from the native app. The captured window belongs to the installed application process, not the development process serving this branch: its rows still use the pre-ODE-382 Lora layout and do not contain the new shared checkbox/actions/description markup. It therefore cannot serve as post-change visual evidence.

## Focused region comparison evidence

The row region was inspected closely because typography, checkbox alignment, inline actions, excerpt rhythm and property-control spacing are the fidelity-critical details. The source shows Geist title text, a leading checkbox, three inline actions, a two-line-capable excerpt slot and aligned Status/Type/Workspace controls. The installed-app capture shows the older row and is not a valid implementation capture.

## Findings

- [P1] Current branch cannot be visually compared in the controllable native window.
  - Location: Workspace FILES table.
  - Evidence: the running development process exists, but Computer Use resolves the shared bundle identifier to the installed app window; reloading preserves bundled pre-change markup.
  - Impact: code and DOM contracts are verified, but visual fidelity cannot be signed off from current rendered pixels.
  - Fix: capture the branch from a packaged development/release app whose window is uniquely addressable, then compare wide/medium/narrow views against the source.

## Verified without visual sign-off

- Desk and Workspace use the shared `ArtifactWritingCell` markup and Geist styles.
- Desk and Workspace use the shared `ArtifactRowSelection` markup.
- Workspace renders rename, preview and collections actions as native disabled buttons with accessible “coming soon” labels.
- Workspace renders the excerpt slot without substituting a filesystem path for content.
- Workspace uses the same 920 px responsive table minimum, leading-column width and row rhythm as Desk.
- TypeScript, lint and all 1,105 tests pass; lint retains six unrelated pre-existing editor warnings.

## Comparison history

- Initial pass: blocked because the only controllable native window is the installed pre-change build.
- No visual fixes were made from that stale capture; treating it as branch evidence would be misleading.

## Implementation checklist

- Package or expose the current development build with a unique controllable window.
- Capture Workspace at wide, medium and narrow widths.
- Compare the row region with the approved mock and Desk on the same UUID.
- Confirm disabled action opacity, checkbox alignment, excerpt spacing and confined horizontal overflow.

## Follow-up polish

- Replace the honest excerpt placeholder with the cached catalog excerpt when ODE-396 lands.

final result: blocked
