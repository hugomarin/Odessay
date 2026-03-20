# ODESSAY — Calidad y Observabilidad

## Alcance

Reglas mínimas de calidad técnica y observabilidad para aceptar entregas.

## Cuándo se usa

- Antes de mover un issue a `In Review`.
- Cuando se define/ajusta estrategia de testing.
- Cuando se instrumenta monitoreo y logging de errores.

## No incluye

- Setup de entorno y variables (ver `workflow/setup/environment.md`).
- Gobernanza de flujo en Linear/Git (ver `workflow/process/governance.md`).
- Runbooks operativos por issue (ver `workflow/runbooks/phase-1-operations.md`).

## Hermetic testing

Principio no negociable: `npm test` debe pasar sin dependencias externas.

- Supabase: cliente mockeado.
- API/fetch: interceptado (`msw` o equivalente).
- Datos: fixtures/factories locales.
- Entorno de tests: `.env.test` (sin depender de `.env.local`).

Sí pueden usar servicios reales:

- E2E con Playwright contra staging.
- Scripts de migración (operación de infra, no test unitario).

Si pasa solo porque hay datos en staging, el test está roto.

## Observabilidad

### Build failures

Vercel notifica fallos de build por email (y opcionalmente Slack).

```bash
vercel ls
```

### Runtime errors — Sentry

Config mínima:

```bash
npx @sentry/wizard@latest -i nextjs
```

`NEXT_PUBLIC_SENTRY_DSN` en `.env.local` y en Vercel.

### Logging estructurado

Siempre loggear con contexto.

```ts
console.error('[sync:remote]', {
  userId,
  writingId,
  operation: 'PATCH',
  error: error.message,
})
```
