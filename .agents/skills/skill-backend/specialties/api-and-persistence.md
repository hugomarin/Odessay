# API, persistencia y autenticación de Odessay

Este recurso describe decisiones y convenciones vigentes de Odessay para este skill. AGENTS.md y los contratos aceptados conservan la precedencia normativa.

Consultar este recurso para los contratos locales de API routes, lógica server-side y persistencia; [Backend](../SKILL.md) decide cuándo cargarlo.

---

## Principio rector

El backend de Odessay debe ser rápido, seguro y silencioso. La arquitectura transversal de performance —forma de carga, crecimiento, batching, deduplicación y evidencia— vive en `.agents/skills/skill-performance/SKILL.md`.

Backend conserva la responsabilidad específica de diseñar respuestas, queries y servicios que no obliguen al cliente a descargar o solicitar trabajo innecesario. Si una route agrega carga, bootstrap, enriquecimiento o procesamiento por elemento, debe activar `skill-performance` y declarar su estrategia de escala.

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
- Si el cambio altera la forma de carga, el costo de crecimiento, batching, deduplicación o trabajo background, cargar también `.agents/skills/skill-performance/SKILL.md`.
- Si ese contrato no declara `Layer`, `Runtime scope`, `Owner`, `Contracts touched` e `Invariants`, marcar `Context Gap` y no fijar arquitectura desde una route o helper server-side.

## Arquitectura multi-runtime — awareness obligatoria

Si el trabajo toca:

- rutas `app/api/*` que hoy actúan como backend implícito del producto
- sync, hydration o bootstrap remoto
- auth/session boundaries
- documento canónico o serializer/parser
- servicios que luego existirán en desktop también

cargar además, según aplique:

- aplicar primero la precedencia de AGENTS.md: ADR de identidad cuando cambia el contrato documental; añadir el spec del catálogo cuando cambia la operación desktop de catálogo, apertura, save o sync;
- consultar documentos de dirección, diagnóstico, target architecture y migration plan solo cuando la pregunta dependa de producto, estado vigente, diseño objetivo o secuencia de transición, respectivamente.

Reglas generales:

- Tratar `app/api/*` como adapters web cuando el issue toca arquitectura, no como núcleo del producto.
- No introducir nuevas dependencias del frontend a endpoints internos si el cambio puede expresarse como contrato de servicio.
- **Autoridad por runtime (ADR `odessay-adr-identidad.md`, D1/D10):** el `.md` materializado gobierna el contenido desktop; Supabase gobierna metadata y existencia cloud. IndexedDB es el adapter local-first de web y compatibilidad transitoria en desktop. `body_json` y Supabase cumplen el papel de copia o proyección de contenido que fija el contrato documental, sin sustituir la autoridad del `.md` desktop.
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
| **List** (`GET /api/{recurso}`) | Devuelve resumen suficiente para listar/filtrar/ordenar. | El presupuesto aplicable lo define `skill-performance` y el instrumento seleccionado. | Columnas grandes: `body_json`, `body_text`, blobs, payloads anidados. |
| **Detail** (`GET /api/{recurso}/:id`) | Devuelve el recurso completo. | La evidencia y el comportamiento esperado los define el `Performance Architecture Contract` cuando el endpoint afecta un camino crítico. | — |
| **Summary opcional** (`?include=body`) | Permite a un cliente específico pedir más, sin penalizar al caso general. | Opt-in explícito por query param. | — |

**Instrumento de red.** Si `skill-performance` selecciona evidencia de red, usar el instrumento versionado disponible y justificar qué decisión arquitectónica prueba. No convertir una captura Network en requisito universal para toda route.

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
// Un listado que devuelve el cuerpo completo de muchos writings multiplica
// innecesariamente el payload y el trabajo de bootstrap.
```

**Cómo decidir la clase al crear un endpoint nuevo.** En el comentario de cabecera de la route, escribir una línea: `// class: list | detail | summary(opt-in)`. La forma de respuesta debe corresponder al consumidor; si el contrato de performance selecciona evidencia o un límite operativo, documentar la decisión allí. No hay clase "lista que también incluye el body".

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
  // se usa para telemetría futura, no para bloquear. Ver workflow/context/features/odessay-sync.md §Conflictos de sincronización.

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
- Middleware de Next.js para proteger rutas privadas — implementación vigente en `middleware.ts` y `lib/supabase/middleware.ts`.
- El trigger `on_auth_user_created` crea el profile automáticamente.
- Sesión disponible en Server Components vía `createServerClient`.

## Auto-save y sincronización

El auto-save confirma el guardado local antes de sincronizar en background. El orden concreto depende del runtime:

- **Web:** guardar en IndexedDB y encolar el sync remoto según `workflow/context/features/odessay-sync.md`.
- **Desktop:** escribir `.md` atómicamente → manifest atómico → transacción SQLite con enqueue → sync cloud en background. `AGENTS.md` y `workflow/context/features/odessay-desktop-document-catalog.md` poseen este contrato.

El coalescing y el backoff se aplican a la cola del runtime correspondiente según su contrato de sync.

El endpoint de sync es idempotente. Estrategia de conflictos: **last-write-wins silencioso** — no se bloquean escrituras, no hay UI de resolución. El campo `version` se incrementa como auditoría, no como control de concurrencia.

**Fuentes de sync:** `workflow/context/features/odessay-sync.md` describe el flujo web y resume D10; `workflow/context/features/odessay-desktop-document-catalog.md` define el orden y la cola desktop.

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

Este checklist cubre lo específico de backend durante la implementación. Antes de abrir el PR, usar `.agents/skills/skill-code-review/SKILL.md` para la revisión técnica completa.

- [ ] ¿Toda ruta protegida verifica autenticación?
- [ ] ¿Input validado con Zod?
- [ ] ¿No hay API keys expuestas al cliente?
- [ ] ¿RLS cubre el acceso a datos?
- [ ] ¿Errores manejados con mensajes amables?
- [ ] ¿Cada endpoint nuevo declara su clase de respuesta (list / detail / summary opt-in) en la cabecera?
- [ ] Si es `list`, ¿la respuesta evita `body_json` / `body_text` / blobs salvo que el contrato lo justifique?
- [ ] Si la vista que consume este endpoint puede pedirlo varias veces durante bootstrap, ¿hay paginación / dedup / cache que evite repetir el viaje?
- [ ] Si el cambio activa `skill-performance`, ¿el `Performance Architecture Contract` y su evidencia están completos?
- [ ] ¿Cada endpoint AI respeta su contrato por scope (AI editor residente vs AI writing assist)?
- [ ] Si el issue toca rutas AI: ¿se leyó la documentación del proveedor para el modo de salida usado?
- [ ] ¿`max_tokens` cubre el peor caso de output (mínimo 4096 para correcciones estructuradas)?
- [ ] ¿Se hizo QA manual con el proveedor real con texto corto y texto ≥300 palabras?
- [ ] ¿Variables de entorno correctas para el ambiente (staging/prod)?
- [ ] ¿El auto-save guarda local primero, sync remoto en background?
