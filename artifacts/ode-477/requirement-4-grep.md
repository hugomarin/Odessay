# ODE-477 — requirement 4 grep: local vocabulary versions

Run: 2026-09-04T01:33:54Z

## lib/writings/status-color.ts / artifact-type-color.ts (must not exist)
```
ls: lib/writings/artifact-type-color.ts: No such file or directory
ls: lib/writings/status-color.ts: No such file or directory
```

## switch over vocabulary values in components/ (must be empty)
```
(none found)
```

## WRITING_STATUS_VALUES / ARTIFACT_TYPE_VALUES outside their own definitions
```
app/api/user/settings/route.ts:4:import { WRITING_STATUS_VALUES } from "@/lib/writings/status"
app/api/user/settings/route.ts:8:  disabled_statuses: z.array(z.enum(WRITING_STATUS_VALUES)).optional(),
```

(The one match, app/api/user/settings/route.ts, is the documented legacy
base-only write path — see workflow/context/features/odessay-artifact-vocabulary.md.)
