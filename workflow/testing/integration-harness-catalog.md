
## Harness Supabase local (ODE-616)

**Creado en:** ODE-616 PR1 (2026-10-01). El PR2 de ODE-616 construye encima el proof service-role de SHARE-04; además lo consumen ODE-617-B, la parte web de ODE-618, ODE-659 y ODE-660.

**Qué es.** Un harness de Vitest contra la única instancia Supabase local (`project_id "odessay"`, API 54321, DB 54322) para ejercitar los caminos que saltan RLS a propósito (cliente admin/service role) con Postgres real y la app real. pgTAP no alcanza ese camino porque el código bajo prueba es TypeScript; los tests unitarios existentes de esos caminos son mock-based.

**Owner de los archivos.**

- `vitest.supabase.config.ts` — `environment: "node"`; incluye `tests/**/*.supabase.test.{ts,tsx}`; setupFile `tests/support/supabase-local/guard.ts`; `fileParallelism: false`; `testTimeout: 30000`. **No** usa `mergeConfig` (el `exclude` base concatena arrays y heredaría `**/*.supabase.test.*`, con lo que la suite no correría nada) ni `loadEnv`. Sin `passWithNoTests`: 0 tests es un fallo.
- `scripts/run-supabase-tests.mjs` — `npm run test:supabase [archivo...]`.
- `scripts/supabase-locked.mjs` — `npm run supabase:locked -- <cmd>` (pgTAP, `psql`, DDL y migraciones).
- `scripts/lib/supabase-local-env.mjs`, `scripts/lib/supabase-lock.mjs`, `scripts/lib/supabase-local-db.mjs`.
- `tests/support/supabase-local/` — `guard.ts`, `local-supabase.ts`, `fixtures.ts`, `session.ts`, `route-fetch.ts`. Sin imports de la app.
- `vitest.config.ts` — excluye `**/*.supabase.test.*` y `**/.cache/**`; `package.json` — los dos scripts.

**Contrato del runner.**

- Toma el lock `$(git rev-parse --git-common-dir)/odessay-supabase-local.lock` (mkdir atómico con pid, worktree y hora; huérfano si el pid ya no existe; sin owner legible caduca a los 15 min). `supabase:locked` toma el mismo lock.
- Exige `supabase status -o json`; si el stack no está arriba, aborta con salida clara.
- Borra **toda** variable heredada que contenga `SUPABASE` (case-insensitive) y las `TAURI_*`, y exporta SOLO `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` y `SUPABASE_SERVICE_ROLE_KEY` locales. El `.env.local` de cada worktree es un symlink al del checkout principal y trae la service role de **producción**: ninguna corrida del harness puede verla.
- Preflight: si quedan funciones o triggers `zz_mutation_%` en `public` (una mutación anterior quedó a medias), aborta y muestra el comando de limpieza.
- El guard de Vitest corre antes de importar la app y aborta si el host no es `127.0.0.1`/`localhost`, si falta la service key o si la URL no coincide con `supabase status`.

**Cómo se usa.**

```sh
npm run test:supabase                                   # toda la suite .supabase.test.*
npm run test:supabase -- tests/integration/sharing/x.supabase.test.ts
npm run supabase:locked -- supabase test db --local
npm run supabase:locked -- psql "<DB_URL>" -c "<DDL>"
npm run supabase:locked -- psql "<DB_URL>" -f supabase/migrations/<nueva>.sql
```

**Helpers** (detalle en `tests/support/supabase-local/`).

- `seedUsers(tag, roles)` → `{id, email, password, username, accessToken, refreshToken}`. Crea con `auth.admin.createUser` (`email_confirm`, `user_metadata.username`; el trigger crea el profile), **lee el username real de `profiles`** (porque `ensure_unique_username` normaliza y agrega sufijos) y hace **un** `signInWithPassword` por usuario. `cleanupUsers` borra por `deleteUser` → cascada.
- `createLocalAdminClient()` (service role, PostgREST real) y `createUserClient(user)` (anon + `setSession` = RLS real).
- `seedWriting(admin, {...})` privilegiado; `seedShare` / `seedCollection` / `seedMembership` por RLS **como dueño**; `readRow`/`readRows` por admin.
- `session.ts` — `bearerRequest`, `serverClientAs`/`serverClientMockFactory` (sustituye `@/lib/supabase/server#createClient` por un cliente real, solo se fakea el transporte de cookies), `mockEmptyCookies`, `expectNotFound`/`expectRedirect` (digest `NEXT_HTTP_ERROR_FALLBACK;404` / `NEXT_REDIRECT`).
- `route-fetch.ts` — `createRouteFetch(routes, {as})`: `/api/...` entra al handler real con Bearer, `http://127.0.0.1:54321` usa fetch real y cualquier otra URL lanza.

**Aislamiento.** Un `runId`/tag por archivo; solo se borran los usuarios propios; nunca se trunca una tabla (la instancia se comparte entre worktrees). No copiar `supabase/.temp` a los worktrees: el checkout principal está linkeado a producción.

**Trampas pagadas.**

- **Volumen viejo vs. ACL de `service_role`.** Un volumen creado por una imagen anterior del stack deja la ACL por defecto de `public` con `service_role` en solo `Dxtm` (truncate/references/trigger), así que `createAdminClient` local recibe `permission denied for table ...`. Un volumen nuevo ya trae `ALL` (el init de la imagen lo concede). Verificar con `has_table_privilege('service_role','public.writings','select')`; si da `f`, reparar **solo local** bajo lock: `npm run supabase:locked -- psql "<DB_URL>" -c "grant all on all tables in schema public to service_role; grant all on all sequences in schema public to service_role; grant all on all functions in schema public to service_role; alter default privileges in schema public grant all on tables to service_role; alter default privileges in schema public grant all on sequences to service_role; alter default privileges in schema public grant all on functions to service_role;"`.
- **`[auth.rate_limit].sign_in_sign_ups`.** Con CLI 2.113 + gotrue v2.195 la clave se parsea pero no llega al contenedor: esa versión no tiene `GOTRUE_RATE_LIMIT_SIGN_IN_SIGN_UPS`. Sí se aplican `token_refresh` y `token_verifications` (`GOTRUE_RATE_LIMIT_TOKEN_REFRESH`, `GOTRUE_RATE_LIMIT_VERIFY`). La config se mantiene (no afecta a remoto y cubre versiones futuras), pero no asumir que sube el límite de sign-in en este stack.
- **pgTAP de `supabase/tests`.** Al 2026-10-01, `margins_enforce_identity.test.sql` y `enforce_invitation_writing_ownership.test.sql` fallan en main por drift test↔schema (insertan `profiles` sin `display_name`, que es `not null`; y esperan `42501` donde la migración lanza `P0001`). `writing_shares_permission_enforcement.test.sql` pasa (16/16). No es del harness; correr un archivo concreto con `npm run supabase:locked -- supabase test db --local <archivo>`.
- **`.cache/**`.** `npm test` recogía copias de recon alojadas ahí; desde este PR las dos configs de Vitest lo excluyen.
