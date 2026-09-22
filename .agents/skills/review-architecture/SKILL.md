---
name: review-architecture
description: Lente de review para ownership, boundaries y Architecture Contract — incluye el checklist de bundle desktop (Tauri) y coherencia de documentación por scope. Usar en /wf-review cuando el diff toca desktop, shared core, runtime boundaries, save path, sync, parser/serializer o contratos de servicio.
---

# Skill: Review Architecture

## Pregunta

¿El diff extiende al owner canónico, o crea un segundo lugar que sabe lo mismo?

## Cuándo activar

Mismas señales que activan `skill-architecture` en BUILD: desktop/multi-runtime, shared core, adapters, `DocumentService`/`SyncService`/`AIService`/`AuthService`/`SharingService`/`AssetService`, save path, sync/hydration, parser/serializer, `.md` como contrato documental, boundaries entre UI y servicios, o cualquier PR con `Architecture Contract` declarado en el brief.

## Verificar

- el `Architecture Contract` declarado en el brief sigue coincidiendo con el código final
- `Layer` está respetado: UI no orquesta save/sync/infra; adapters no redefinen dominio
- `Runtime scope` es correcto: el diff no introduce dependencias web dentro de shared core, ni trata cloud/web como universales
- `Owner` coincide con la implementación real — no hay trabajo arquitectónico disfrazado de fix local en frontend/backend/database
- `Contracts touched` existen y siguen coherentes antes que las implementaciones concretas
- `Invariants` del contrato siguen siendo verdad después del diff
- los consumers dependen del owner en vez de reproducir su lógica
- no se introduce una segunda fuente de verdad para la misma responsabilidad
- el crecimiento de un hotspot es wiring, no ownership nuevo (ver `Hotspots` en `.agents/agents/build-agent.md`)

## Evidencia requerida para un finding

Nombrar ambos:

1. el owner/patrón canónico; y
2. la implementación competidora que introduce el diff.

Si no existe owner canónico, reportar `Architecture Gap` en vez de inventar uno durante el review.

## Desktop bundle — verificar cuando el diff toca Tauri o desktop

Aplicar este bloque si el diff toca cualquiera de: `src-tauri/`, `lib/runtime/`, `lib/supabase/desktop-client.ts`, `lib/services/desktop-*`, `lib/auth/secure-storage.ts`, `app/(app)/**/page.tsx` con server auth, o `scripts/prepare-tauri-build.mjs`.

**`tauri dev` y el DMG de producción son entornos distintos.** Lo que funciona en dev puede fallar silenciosamente en el bundle. Referencias: `odessay-desktop-migration-diagnostic.md §Diferencias entre tauri dev y tauri build`, `odessay-desktop-target-architecture.md §Storage de tokens`.

- [ ] **CSP incluye `ipc:` y `http://ipc.localhost` en `connect-src`.** Sin esto, todos los `invoke()` fallan silenciosamente (devuelven `null`, no throw). La primera señal es un error de consola "Refused to connect to ipc://localhost/..." — solo visible si DevTools está habilitado.
- [ ] **Se usa `createClient` de `@supabase/supabase-js`, no `createBrowserClient` de `@supabase/ssr`.** El wrapper SSR hardcodea cookies como storage y sobreescribe silenciosamente cualquier `auth.storage` custom. En el custom protocol del DMG las cookies no persisten.
- [ ] **`keyring` crate declara backend explícito.** `features = []` compila sin error pero usa mock en memoria: write devuelve Ok, read devuelve null. Para macOS: `features = ["apple-native"]`.
- [ ] **Toda página `app/(app)/**/page.tsx` nueva con `redirect("/login")` server-side tiene bifurcación `isTauriBuild`.** Sin esto, el redirect se bake en el RSC payload del static export y la página bouncea siempre, aunque haya sesión.
- [ ] **DevTools habilitado en el bundle** (`tauri = { features = ["devtools"] }` en `src-tauri/Cargo.toml`) mientras la distribución siga siendo ad-hoc. Sin consola en el DMG, los bugs de auth, IPC y CSP son indiagnosticables.
- [ ] **El flow fue probado en el DMG real**, no solo en `tauri dev`. Mínimo: signin → navegar a una ruta interna → cerrar app → reabrir → verificar sesión preservada.

Si alguno de estos checks falla → **rechazar**. Son bloqueantes porque los bugs resultantes no se detectan en tests unitarios ni en `tauri dev`.

## Base de datos y migraciones

El checklist detallado de migraciones (transacción, rollback, RLS, índices, schema drift) vive en `.agents/skills/skill-code-review/specialists/data-migration.md` — no lo repitas aquí. Esta lente solo verifica que el schema/RLS declarado en `Contracts touched` sea coherente con el `Owner` y `Runtime scope` del contrato.

## Documentación — coherencia por scope

Si el PR toca alguno de estos scopes, verificar coherencia con docs antes de aprobar:

- AI corrections / streaming / accept-reject memory → `workflow/context/features/odessay-ai-writing-assist.md` + checklist de `.agents/skills/skill-corrections/SKILL.md`
- TipTap / ProseMirror extensions / decorations / parser-serializer → `workflow/context/features/odessay-prosemirror-tiptap.md`
- Desktop / shared core / runtime boundaries / save path / sync / parser / services → `.agents/skills/skill-architecture/SKILL.md` + la secuencia `odessay-desktop-*` citada en el brief

Si el código final contradice el doc y el doc no fue actualizado, es rechazo por desalineación de contrato — no se mergea.

## Red flags — rechazar si aparecen

- el issue requería `Architecture Contract` y no lo trae, lo trae incompleto, o el diff lo contradice
- UI actúa como orquestador de save/sync/infra cuando el contrato declara `Application` o `Adapter`
- un módulo `shared core` introduce dependencias de Next, Supabase, cookies, `fetch`, `window` o filesystem concreto
- un adapter web/desktop redefine reglas de dominio en vez de implementar contratos ya fijados
- se agregó UI que el issue no pedía
- se usa `router.push()` para cambios de estado interno dentro de una vista funcional (tabs, filtros, paneles) — Odessay trata eso como estado de UI local-first, no como navegación de página
- se dispara navegación RSC (`?_rsc=`) para datos que ya están disponibles en `localDB`
- se implementan tabs, filtros o paneles como rutas navegables cuando son estado de UI, no destinos

**Referencias para esta clase de hallazgo:** `workflow/context/features/odessay-sync.md` (arquitectura local-first, caso de estudio del editor) y `workflow/context/core/odessay-arquitectura.md` (decisión de navegación interna vs navegación de página).

## Output

Findings con el formato de `.agents/skills/skill-code-review/scoring.md`. Un finding de arquitectura casi siempre es `[P0]` o `[P1]` — un boundary roto no se degrada solo, se propaga.
