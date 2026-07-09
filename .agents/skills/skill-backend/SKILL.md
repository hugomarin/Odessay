---
name: skill-backend
description: Arquitectura e implementación backend de Odessay (API routes, lógica server-side, integración con Supabase, AI provider, seguridad). Usar cuando implementes o revises rutas API, server actions, queries a base de datos, autenticación o cualquier integración de servicio externo.
---

# Skill: Backend

**Consulta este skill antes de cualquier trabajo de API routes, lógica server-side, o integración con servicios.**

---

## Principio rector

El backend de Odessay es invisible para el usuario. Debe ser rápido, seguro y silencioso. El usuario nunca debería notar que existe.

**Rápido tiene cinco dimensiones, no una.** Ver el contrato fundacional en `workflow/context/core/odessay-stack.md §Velocidad multidimensional`. El backend es responsable directo de tres de ellas:

- **Peso transferido** — cada endpoint devuelve la forma exacta del dato que el cliente va a usar, no la fila completa "por si acaso".
- **Forma del waterfall** — cada endpoint cabe en un único viaje; rutas de bootstrap permiten que el cliente cargue una vista en ≤ 6 fetches.
- **Tiempo a interactivo** — endpoints de bootstrap responden en ≤ 200 ms p95; nada de auth + dos joins + paginación implícita en la misma llamada.

Las otras dos dimensiones (latencia de interacción y fan-out reactivo) viven en el frontend, pero el backend las habilita o las rompe con el diseño de sus respuestas.

## Contexto documental obligatorio por tipo de trabajo

Antes de implementar, cargar docs según scope:
- API de AI corrections/title suggestions:
  - `workflow/context/features/odessay-ai-writing-assist.md`
- Cambios en proveedor/modelo/env vars AI:
  - `workflow/context/core/odessay-stack.md`
- Cambios que afectan serializer/parser/backbone del editor:
  - `workflow/context/features/odessay-prosemirror-tiptap.md`

Regla:
- No hardcodear modelo en rutas de negocio.
- Resolver proveedor/modelo por env y mantener contrato de error explícito de configuración.
- Si el cambio toca core vs adapter, runtime boundaries o extracción de servicios, cargar también `.agents/skills/skill-architecture/SKILL.md` antes de decidir la forma del backend.
- Si ese contrato no declara `Layer`, `Runtime scope`, `Owner`, `Contracts touched` e `Invariants`, marcar `Context Gap` y no fijar arquitectura desde una route o helper server-side.

## Arquitectura multi-runtime — awareness obligatoria

Si el trabajo toca:

- rutas `app/api/*` que hoy actúan como backend implícito del producto
- sync, hydration o bootstrap remoto
- auth/session boundaries
- documento canónico o serializer/parser
- servicios que luego existirán en desktop también

cargar además, según aplique:

- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`

Reglas generales:

- Tratar `app/api/*` como adapters web cuando el issue toca arquitectura, no como núcleo del producto.
- No introducir nuevas dependencias del frontend a endpoints internos si el cambio puede expresarse como contrato de servicio.
- **Regla dura (ADR `odessay-adr-identidad.md`, D1/D10):** el backend NO trata `body_json` ni Supabase como verdad del **contenido**. El `.md` canónico es la verdad del contenido; la nube es autoridad de la **metadata** + copia del contenido; IndexedDB es espejo. No diseñar backend que re-entronice `body_json`/Supabase como verdad universal.
- Si un cambio crea o altera un contrato de servicio, documentar explícitamente si pertenece al core compartido o al adapter web.
- Si el trabajo real cae en `Layer: Application` o `Layer: Domain`, backend no debe resolverlo enteramente dentro de `app/api/*`; debe respetar la partición definida por `skill-architecture`.

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

### Peso de respuesta — list vs detail

Cada endpoint declara y respeta una clase de respuesta. La clase decide qué campos viajan y qué presupuesto aplica.

| Clase | Qué afirma | Presupuesto | Qué NO devuelve |
|---|---|---|---|
| **List** (`GET /api/{recurso}`) | Devuelve resumen suficiente para listar/filtrar/ordenar. | ≤ 50 kB ungzip total. | Columnas grandes: `body_json`, `body_text`, blobs, payloads anidados. |
| **Detail** (`GET /api/{recurso}/:id`) | Devuelve el recurso completo. | Documentar p95 esperado en la cabecera del archivo de la route. | — |
| **Summary opcional** (`?include=body`) | Permite a un cliente específico pedir más, sin penalizar al caso general. | Opt-in explícito por query param. | — |

**Instrumento de red.** Los presupuestos numericos de peso y waterfall se miden con `workflow/perf-budgets-network.json` y `npm run ops:network:gate -- --har <captura.har>`. Si un PR toca sync, bootstrap, listados o rutas que participan en arranque/navegacion, el proof of work debe incluir una captura Network o justificar por que el instrumento no aplica.

**Afirmación positiva.** Un endpoint de lista es un índice, no un dump. Si una vista necesita el body de N writings al mismo tiempo, ese es síntoma de que la vista está mal modelada, no de que el endpoint deba devolver bodies.

```ts
// ✓ Correcto — list endpoint devuelve solo lo que el listado necesita
type WritingListItem = Pick<
  Writing,
  "id" | "title" | "slug" | "status" | "visibility"
    | "parent_id" | "correspondence_id" | "version"
    | "deleted_at" | "created_at" | "updated_at"
>
// El cliente que necesite el body de un writing concreto llama GET /api/writings/:id

// ✗ Incorrecto — list endpoint devuelve el documento entero
const { data } = await supabase.from("writings").select("*").eq("author_id", user.id)
// 50 writings × ~70 kB cada uno = 3.5 MB en un solo GET. Se carga 3-4 veces en bootstrap.
```

**Cómo decidir la clase al crear un endpoint nuevo.** En el comentario de cabecera de la route, escribir una línea: `// class: list | detail | summary(opt-in)`. Si la respuesta excede el presupuesto de su clase, se documenta el motivo o se cambia de clase. No hay clase "lista que también incluye el body".

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

## Supabase — Inicialización del cliente

Odessay usa el sistema nuevo de API keys de Supabase ("Publishable and secret API keys"), no el legacy ("anon, service_role").

### Cliente browser (componentes client-side)

```ts
// lib/supabase/client.ts
import { createBrowserClient } from '@supabase/ssr'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!
  )
}
```

### Cliente server-side (Server Components, API routes, middleware)

```ts
// lib/supabase/server.ts
import { createServerClient } from '@supabase/ssr'
import { cookies } from 'next/headers'

export async function createClient() {
  const cookieStore = await cookies()
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY!,
    {
      cookies: {
        getAll() { return cookieStore.getAll() },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options))
          } catch {}
        },
      },
    }
  )
}
```

### Cliente admin (bypass RLS — solo server-side, raro)

```ts
// lib/supabase/admin.ts
import { createClient } from '@supabase/supabase-js'

export function createAdminClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } }
  )
}
```

Solo usar `createAdminClient()` en API routes server-side cuando se necesita bypass RLS. Nunca exponer `SUPABASE_SERVICE_ROLE_KEY` al cliente.

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

## AI Provider Integration — Reglas obligatorias antes de implementar

### Paso 0: leer la documentación del proveedor

**Antes de implementar cualquier feature que use un proveedor AI** (Fireworks, Anthropic, OpenAI u otro), leer la documentación oficial del proveedor para el modo de salida que se va a usar:

- `json_schema` / structured outputs: ¿es compatible con streaming? ¿con el modelo configurado? ¿qué pasa si el proveedor rechaza el schema?
- `json_object`: ¿garantiza forma o solo un objeto válido? ¿puede devolver prose pese al mode?
- `stream: true` + structured output: ¿el proveedor emite `delta.content` o solo el objeto final? ¿está documentado el comportamiento de chunks vacíos?
- Límites del modelo: ¿cuál es el context window? ¿cuál es el máximo de output tokens permitido?

**No asumir que Fireworks se comporta como OpenAI** — el mismo parámetro puede tener comportamiento diferente entre proveedores y modelos.

### Presupuesto de tokens (obligatorio para endpoints de salida estructurada)

Antes de fijar `max_tokens` en cualquier llamada que devuelva JSON estructurado:

1. Estimar el peor caso de output: texto largo (≥300 palabras) × correcciones densas × schema con todos los campos llenos.
2. Calcular cuántos tokens ocupa ese JSON serializado (regla práctica: ~1 token ≈ 4 caracteres de ASCII/UTF-8 común).
3. Fijar `max_tokens` con margen razonable sobre ese peor caso. **El mínimo para cualquier respuesta de correcciones es 4096.** Si el texto puede crecer más, escalar proporcionalmente.
4. Si el provider-config tiene un `maxTokens` global bajo, usar `Math.max(config.maxTokens, ENDPOINT_MIN_TOKENS)` en la ruta específica — o corregir el default en `provider-config.ts`.

**Síntoma de presupuesto insuficiente:** JSON truncado a mitad del objeto → el parser siempre falla → retry loop → latencia alta → perf gate falla en CI. El origen real es el token budget, no el retry path.

### Prueba con proveedor real antes de BUILD submission

Los tests unitarios y mocks validan code paths. No validan el comportamiento del proveedor.

**Para issues que tocan rutas AI:** hacer QA manual con el proveedor real configurado en `.env.local` con textos de distintos tamaños (texto corto, texto ≥300 palabras) antes de abrir el PR. Si el proveedor devuelve prose en lugar de JSON, o streams vacíos, eso debe estar resuelto en el diff — no descubierto en review.

### Streaming sobre contrato de objeto JSON completo

Si el provider devuelve un único objeto JSON (no NDJSON ni tool-call events), **no asumir streaming real de items**. El objeto JSON parcial es inválido hasta que llega el `}` final. La arquitectura correcta:

1. Llamar al proveedor con structured output no-stream.
2. Parsear y validar una vez que llega la respuesta completa.
3. Emitir NDJSON propio desde la app al cliente a partir del JSON validado.
4. Introducir streaming real del proveedor solo si el contrato del modelo emite items incrementales (tool-call stream, function-call stream).

---

## AI Provider API (AI Editor / Writing Assist)

- Todas las llamadas AI son server-side. Nunca expongas keys al cliente.
- Dos endpoints:
  - `/api/ai/observe` — Observaciones automáticas en pausas de escritura. Recibe body del writing + instrucciones de contexto.
  - `/api/ai/discuss` — Invocación directa y discusión. Recibe body + pregunta/instrucción del autor + historial de la conversación en sesión.
- El system prompt base está en `odessay-ai-editor.md`. No lo modifiques sin revisar ese documento.
- Para endpoints del **AI editor residente** (`/api/ai/observe`, `/api/ai/discuss`): incluir instrucción de no generar texto y parsear `SILENCIO` como no-op.
- Para endpoints de **AI writing assist** (corrections/title suggestions): seguir el contrato específico en `workflow/context/features/odessay-ai-writing-assist.md` (sí hay suggestions/replacements estructurados, nunca auto-aplicación).
- Modelo/proveedor: configurables por entorno (env). No asumir modelo fijo en código.
- Para flujo de corrections y title suggestion, seguir contrato en `workflow/context/features/odessay-ai-writing-assist.md`.

## Resend (Email)

- Templates de email en `/lib/email/`.
- Dos flujos principales: notificación de writing compartido, invitación epistolar.
- Emails simples, limpios, coherentes con la marca. No HTML pesado.
- En staging, usa dominio de testing. Verifica que los emails no lleguen a usuarios reales.

## Auto-save y sincronización

El auto-save es local-first. Secuencia invariable: guardar en base local (inmediato, sin debounce) → enqueue sync remoto (background, debounce 1.5s, backoff exponencial en retry).

El endpoint de sync es idempotente. Estrategia de conflictos: **last-write-wins silencioso** — no se bloquean escrituras, no hay UI de resolución. El campo `version` se incrementa como auditoría, no como control de concurrencia.

**Spec completa de sync:** `workflow/context/features/odessay-sync.md` — interfaces TypeScript, flujo de auto-save, estados del statusbar, observabilidad.

## Observabilidad

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
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
FIREWORKS_API_KEY=
FIREWORKS_MODEL=
RESEND_API_KEY=

# Client-side (NEXT_PUBLIC_)
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=   # Nombre preferido (Supabase nuevo)
NEXT_PUBLIC_SUPABASE_ANON_KEY=                  # Alias legacy — backward compatible
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
- [ ] ¿Cada endpoint nuevo declara su clase de respuesta (list / detail / summary opt-in) en la cabecera?
- [ ] Si es `list`, ¿la respuesta queda ≤ 50 kB ungzip y no incluye `body_json` / `body_text` / blobs?
- [ ] Si la vista que consume este endpoint puede pedirlo varias veces durante bootstrap, ¿hay paginación / dedup / cache que evite repetir el viaje?
- [ ] Si toca sync, bootstrap o listados, ¿hay captura HAR evaluada con `npm run ops:network:gate -- --har <captura.har>` o justificación explícita de no aplicabilidad?
- [ ] ¿Cada endpoint AI respeta su contrato por scope (AI editor residente vs AI writing assist)?
- [ ] Si el issue toca rutas AI: ¿se leyó la documentación del proveedor para el modo de salida usado?
- [ ] ¿`max_tokens` cubre el peor caso de output (mínimo 4096 para correcciones estructuradas)?
- [ ] ¿Se hizo QA manual con el proveedor real con texto corto y texto ≥300 palabras?
- [ ] ¿Variables de entorno correctas para el ambiente (staging/prod)?
- [ ] ¿El auto-save guarda local primero, sync remoto en background?
