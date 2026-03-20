# ODESSAY — Runbooks de Fase 1

## Alcance

Procedimientos operativos específicos por issue/fase (playbooks ejecutables).

## Cuándo se usa

- Solo cuando el issue actual coincide con uno de los runbooks definidos aquí.
- Como guía de ejecución paso a paso para tareas operativas puntuales.

## No incluye

- Reglas globales de proceso (ver `workflow/process/governance.md`).
- Setup técnico base (ver `workflow/setup/environment.md`).
- Criterios generales de testing/observabilidad (ver `workflow/quality/testing-observability.md`).

## ODE-12 — Deploy en Vercel + previews por PR

Issue principalmente humano (UI de Vercel).

1. Dashboard Vercel → Add New Project → Import `hugomarin/Odessay`.
2. Confirmar framework `Next.js`.
3. Configurar variables para `Preview` y `Production`.
4. Ejecutar primer deploy de `main`.
5. Abrir PR de prueba y verificar preview deployment.

Evidencia mínima para cierre:

- Link deploy de `main`.
- Link preview deployment del PR de prueba.

## ODE-14 — Migraciones iniciales de base de datos

1. Crear `supabase/config.toml` y migraciones en `supabase/migrations/`.
2. Aplicar migraciones en orden cronológico.

```bash
for migration in $(find supabase/migrations -maxdepth 1 -name '*.sql' | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

3. Verificar tablas, columnas críticas, RLS y triggers.
4. Adjuntar evidencia en Linear: PR, SHA, validaciones, verificación SQL.

Sin verificación SQL, no pasa a `In Review`.

## ODE-15 — Authentication flow

- Auth con Supabase (`@supabase/ssr`) y email/password.
- `/login` y `/signup` públicas; sesión activa redirige a `/desk`.
- Rutas privadas protegidas por middleware y `next` param.
- Signup envía `display_name` y `username` en `raw_user_meta_data`.
- Validación pública de username usa `public.public_profiles`.

## ODE-16 — IndexedDB local-first

- Base local: `odessay-local-first-{userId}` o `...-anonymous`.
- Object stores clave: `writings`, `sync-mutations`.
- Inspección/reset: DevTools → Application → Storage → IndexedDB.
- Sync worker: debounce 1.5s + retry al volver `online`.
