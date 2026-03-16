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
- Retorna respuestas consistentes: `{ data, error }`.

## Supabase (server-side)

- Usa `createServerClient` de `@supabase/ssr` para el cliente server-side.
- Nunca uses el `service_role` key desde el cliente. Solo en API routes server-side cuando necesites bypass RLS (raro).
- Confía en RLS para control de acceso. No reimplementes permisos en código.
- Types generados desde el schema: `supabase gen types typescript`.

## Autenticación

- Supabase Auth con email + contraseña.
- Middleware de Next.js para proteger rutas privadas. Redirect a `/login` si no hay sesión.
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

## Auto-save

- El auto-save es un PATCH a la API que actualiza `body_json`, `body_text`, y `updated_at`.
- El endpoint debe ser idempotente y rápido. El usuario no debe notar latencia.
- No bloquees la UI mientras se guarda. Fire-and-forget con retry silencioso si falla.
- Debounce de 1-2 segundos en el cliente antes de llamar.

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

- [ ] ¿Toda ruta protegida verifica autenticación?
- [ ] ¿Input validado con Zod?
- [ ] ¿No hay API keys expuestas al cliente?
- [ ] ¿RLS cubre el acceso a datos?
- [ ] ¿Errores manejados con mensajes amables?
- [ ] ¿El AI editor nunca genera texto en el response?
- [ ] ¿Variables de entorno correctas para el ambiente (staging/prod)?
