# Skill: Backend

**Consulta este skill antes de cualquier trabajo de API routes, lógica server-side, o integración con servicios.**

---

## Principio rector

El backend de Odessay es invisible para el usuario. Debe ser rápido, seguro y silencioso. El usuario nunca debería notar que existe.

---

## API Routes

- Viven en `/app/api/`. Usa Route Handlers de Next.js App Router.
- Server Actions para mutaciones simples desde Server Components.
- Siempre valida input. Usa Zod para schemas de validación.
- Siempre verifica autenticación antes de operar. `auth.uid()` en cada request.

### Contrato de respuesta

Toda API route devuelve el mismo envelope. Sin excepciones.

```ts
// Éxito
{ data: T, error: null }

// Error
{ data: null, error: { code: string, message: string } }
```

El campo `message` es para logging — nunca se muestra directamente al usuario. El cliente lee `error.code` para decidir qué mensaje amable mostrar.

### Códigos HTTP

| Caso | Código |
|---|---|
| Éxito con datos | `200` |
| Creación exitosa | `201` |
| Éxito sin datos (delete) | `204` |
| Input inválido (falla Zod) | `400` |
| Sin autenticación | `401` |
| Sin autorización (RLS / ownership) | `403` |
| Recurso no encontrado | `404` |
| Conflicto de versión (sync) | `409` |
| Error interno | `500` |

### Paginación

Las rutas que devuelven listas usan cursor-based pagination, no offset.

```ts
// Request
GET /api/writings?cursor=<id>&limit=20

// Response
{
  data: {
    items: Writing[],
    nextCursor: string | null  // null = no hay más páginas
  },
  error: null
}
```

### Ejemplo de route completa

```ts
// app/api/writings/[id]/route.ts
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const supabase = createServerClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return Response.json({ data: null, error: { code: 'UNAUTHORIZED', message: 'No session' } }, { status: 401 })

  const body = await req.json()
  const parsed = WritingPatchSchema.safeParse(body)
  if (!parsed.success) return Response.json({ data: null, error: { code: 'INVALID_INPUT', message: parsed.error.message } }, { status: 400 })

  // Conflicto de versión: last-write-wins silencioso.
  // No se rechaza la escritura — se actualiza siempre. El campo version
  // se usa para telemetría futura, no para bloquear. Ver decisión en skill-backend.md §Conflictos.

  const { data, error } = await supabase.from('writings').update(parsed.data).eq('id', params.id).select().single()
  if (error) return Response.json({ data: null, error: { code: 'DB_ERROR', message: error.message } }, { status: 500 })

  return Response.json({ data, error: null })
}
```

## Supabase (server-side)

- Usa `createServerClient` de `@supabase/ssr` para el cliente server-side.
- Nunca uses el `service_role` key desde el cliente. Solo en API routes server-side cuando necesites bypass RLS (raro).
- Confía en RLS para control de acceso. No reimplementes permisos en código.
- Types generados desde el schema: `supabase gen types typescript`.

## Autenticación

- Supabase Auth con email + contraseña.
- Middleware de Next.js para proteger rutas privadas — implementación en `skill-frontend.md` (sección: Rutas protegidas).
- El trigger `on_auth_user_created` crea el profile automáticamente.
- Sesión disponible en Server Components vía `createServerClient`.

## Claude API (AI Editor)

- Todas las llamadas a Claude son server-side. Nunca expongas el API key al cliente.
- Dos endpoints:
  - `/api/ai/observe` — Observaciones automáticas en pausas de escritura. Recibe body del writing + instrucciones de contexto.
  - `/api/ai/discuss` — Invocación directa y discusión. Recibe body + pregunta/instrucción del autor + historial de la conversación en sesión.
- El system prompt base está en `odessay-ai-editor.md`. No lo modifiques sin revisar ese documento.
- Siempre incluye la instrucción de que el agente nunca genera texto.
- Parsea la respuesta: si es "SILENCIO", no envíes nada al cliente.
- Modelo: Claude Sonnet para producción. Haiku para testing si se necesita volumen.

## Resend (Email)

- Templates de email en `/lib/email/`.
- Dos flujos principales: notificación de writing compartido, invitación epistolar.
- Emails simples, limpios, coherentes con la marca. No HTML pesado.
- En staging, usa dominio de testing. Verifica que los emails no lleguen a usuarios reales.

## Auto-save y sincronización

El auto-save es local-first. Secuencia invariable: guardar en base local (inmediato, sin debounce) → enqueue sync remoto (background, debounce 1.5s, backoff exponencial en retry).

El endpoint de sync es idempotente. Estrategia de conflictos: **last-write-wins silencioso** — no se bloquean escrituras, no hay UI de resolución. El campo `version` se incrementa como auditoría, no como control de concurrencia.

**Spec completa de sync:** `docs/features/odessay-sync.md` — interfaces TypeScript, flujo de auto-save, estados del statusbar, observabilidad.

## Observabilidad

El setup completo de observabilidad está en `docs/ops/SETUP.md` §Observabilidad. Resumen para el agente:

- **Sentry:** captura errores de cliente y excepciones en API routes. Requerido desde Fase 1. Sin Sentry, los errores en producción son invisibles. Configuración: `npx @sentry/wizard@latest -i nextjs`.
- **Logging estructurado:** todos los errores server-side llevan contexto (`userId`, `writingId`, operación). Sin contexto el log es inútil.

```ts
// ✓ Siempre así en API routes y sync workers
console.error('[sync:remote]', { userId, writingId, operation: 'PATCH', error: error.message })

// ✗ Nunca así
console.error('Error:', error)
```

- **Build failures:** Vercel notifica por email. No requiere configuración adicional.

## Manejo de errores

- Nunca muestres errores técnicos al usuario. Log server-side, mensaje amable client-side.
- Usa try/catch en todas las API routes.
- Errores de autenticación → redirect a login.
- Errores de autorización → 403 con mensaje claro.
- Errores de validación → 400 con detalle de qué falló.

## Variables de entorno

```
# Server-side only
SUPABASE_URL=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=

# Client-side (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
```

Nunca agregues un `NEXT_PUBLIC_` sin confirmar que el valor es seguro para exponer.

---

## Checklist antes de entregar

Este checklist cubre lo específico de backend durante la implementación. Antes de abrir el PR, usar `skill-code-review.md` para la validación completa.

- [ ] ¿Toda ruta protegida verifica autenticación?
- [ ] ¿Input validado con Zod?
- [ ] ¿No hay API keys expuestas al cliente?
- [ ] ¿RLS cubre el acceso a datos?
- [ ] ¿Errores manejados con mensajes amables?
- [ ] ¿El AI editor nunca genera texto en el response?
- [ ] ¿Variables de entorno correctas para el ambiente (staging/prod)?
- [ ] ¿El auto-save guarda local primero, sync remoto en background?
