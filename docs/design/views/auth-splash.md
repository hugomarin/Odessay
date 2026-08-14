# Views — Splash, Sign in, Sign up, local-only entry

Routes: `app/(auth)/*` (`/login`, `/signup`, `/forgot-password`, `/reset-password`) plus the desktop splash. Repo files: `components/auth/*`, `app/(auth)/layout.tsx`, `components/navigation/desktop-startup-redirect.tsx`.
Prototype: `docs/design/reference/Artifact Studio Auth.dc.html`.

**Authority:** the prototype above is the **visual authority** for this view. This document is a reading of its decisions — it does not list every value in the render. Where this document is silent, read the value from the prototype. Where the two differ, the prototype wins and the divergence is recorded in the PR. `.agents/skills/skill-design/SKILL.md` and the tokens govern *how* a value is expressed in the repo (a token instead of a literal hex, 0.5px instead of the prototype's 1px) — never the geometry. Any value the prototype does not define is a question for the design owner, not an invention. Full protocol: `docs/design/migration-plan.md` §4.


Both screens sit on the shell background `#F3F2F0`, centered, with no rail and no titlebar chrome beyond the platform's.

## Splash (desktop launch)

```
mark tile      64px, radius 18, ink fill, mark 34px, shadow 0 12px 34px rgba(35,24,15,.22)
wordmark       Geist 500/30, -0.02em
progress       140 × 2px track #E4E1DC, 40 %-wide thumb #8E837B crawling
caption        12/400 ink-4 — "v0.4 · local-first" or "opening your desk…"
```

Animation: `odMarkIn` 420ms `cubic-bezier(.4,0,.15,1)` on the group, `odCrawl` 1200ms infinite on the thumb. The splash must never be the reason startup feels slow: it shows for as long as boot takes and no minimum.

## Auth card

440px, radius 18, `#FFFFFF`, padding 36, shadow `0 1px 2px rgba(35,24,15,.05), 0 24px 60px rgba(35,24,15,.12)`.

```
mark tile 44 (radius 13, ink)      → 22px bottom margin
h1 30/500 -0.02em                  Sign in: "Back to your desk" · Sign up: "Create your account"
subtitle 14/1.6 ink-3, max 42ch
fields (gap 14)                    Name (sign-up only) · Email · Password
primary                            full-width ink button 46px, radius 10
alternate                          "Continue without an account" option row
switch link                        "Already have an account? Sign in"
```

- Inputs 46px, radius 10, border `#E4E1DC`, focus `#B5ADA5`. Never a colored focus ring.
- Password: `eye` / `eye-off` reveal button 34px inside the field; hint line under it — "Minimum 8 characters." → "4 to go." → "Ready."
- Errors: one line under the field, terracotta, 12/1.5. Never a toast, never a red border alone.
- **Continue without an account**: option row with `hard-drive`, "Work locally — nothing leaves this machine." This is the local-first promise, so it is a peer of the primary action, not a footnote.

## Forgot / reset password

Same card, same rhythm. One field, one primary, one back link. Success is a state of the same card (green 52px tile + "Check your email"), not a new page.

## Rules

- Auth controls cloud capability, not access to local files. Nothing in this flow may imply that signing out deletes or hides local artifacts.
- The card is the only elevated surface; no second card, no illustration, no marketing copy — the landing does that job.
- Sign-in and sign-up are one component with a mode switch, matching the prototype.

## Checklist

- [ ] Tab order: fields → primary → alternate → switch link.
- [ ] `⏎` submits from any field.
- [ ] Password reveal state announced to screen readers.
- [ ] "Continue without an account" reachable in one tab from the primary.
- [ ] Splash has no artificial minimum duration.
