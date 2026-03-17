# ODESSAY — Setup del entorno

**Leer antes de empezar cualquier tarea.** Este documento responde: ¿cómo levanto el proyecto, qué credenciales necesito, qué tools debo tener disponibles, y cómo trabajo con Git?

---

## Frontera humano / agente

Defines quién hace qué. Antes de ejecutar un issue, el agente debe saber si hay un checkpoint humano pendiente.

### Siempre hace el humano

- Crear repositorios en GitHub y configurar branch protection cuando el plan lo permite
- Si branch protection no está disponible (por ejemplo: repo privado en plan sin esa feature), confirmar en Linear el fallback operativo: no push directo a `main` y merge solo vía PR aprobado por humano
- Crear proyectos en Supabase (staging y producción) y copiar las API keys
- Conectar el repositorio a Vercel desde la UI y configurar las variables de entorno en Vercel
- Revisar y aprobar (merge) pull requests
- Autorizar herramientas y permisos (MCPs, tokens, accesos)
- Llenar `.env.local` con valores reales después de crear los servicios
- **Asignar issues en Linear** — el humano es el assignee de todos los issues. El agente trabaja bajo instrucción del humano, no de forma autónoma sobre issues no asignados.

### Siempre hace el agente

- Escribir código, crear archivos, modificar configuración
- Crear migraciones de base de datos y ejecutarlas en staging
- Correr `typecheck`, `lint` y `tests` — pegar output en el PR
- Abrir PRs y mover issues en Linear entre estados (`Backlog` → `In Progress` → `In Review`)
- Crear `.env.example` con las keys esperadas (valores vacíos)
- Actualizar `docs/ops/status.json` y `docs/ops/SETUP.md` cuando el issue lo requiere
- Mover el issue a `Done` una vez que el PR está mergeado y el humano lo confirma

### Responsabilidades en Linear — tabla de referencia rápida

| Acción en Linear | Responsable |
|---|---|
| Crear proyectos (uno por fase) | Agente (bajo instrucción explícita) |
| Crear issues dentro del proyecto | Agente (bajo instrucción explícita) |
| Asignar issues a una persona | **Humano** |
| Mover issue a `In Progress` | Agente (al empezar a trabajar) |
| Mover issue a `In Review` | Agente (al abrir el PR) |
| Mover issue a `Done` | Agente (tras confirmación de merge del humano) |
| Agregar comentarios de bloqueo | Agente (cuando encuentra un bloqueador) |
| Crear milestones | Agente (solo si la fase los justifica, ver §Milestone) |

### Issues con checkpoint humano (requieren handoff)

Algunos issues tienen una parte que el agente no puede ejecutar. El agente completa lo que puede, luego **para** y comunica explícitamente qué necesita del humano antes de continuar.

El agente señaliza el checkpoint así:

```
⏸ HANDOFF REQUERIDO

Completé: [qué hizo el agente]
Necesito que tú: [acción concreta del humano]
Una vez listo: [qué hará el agente a continuación]
```

El agente no avanza al siguiente issue hasta recibir confirmación de que el checkpoint está resuelto.

---

## Pre-flight: verificar antes de empezar

Antes de tocar un archivo, un agente debe confirmar que tiene todo lo necesario. Si algún item falta, no empezar — documentar el bloqueo en el issue de Linear y escalar.

```bash
# 1. Verificar integridad del registry — detecta nodos huérfanos en ambas direcciones:
#    a) docs declarados en registry que no existen en disco
#    b) docs en disco que no están declarados en registry (contenido sin conexión)
node -e "
const config = require('./docs.json');
const fs = require('fs');
const path = require('path');
const glob = require('fs');

// a) Registry → disco: verificar que todo lo declarado existe
const missing = [];
config.registry.forEach(doc => {
  if (!doc.path.endsWith('/') && !fs.existsSync(doc.path)) {
    missing.push({ problem: 'declarado pero no existe en disco', path: doc.path });
  }
});

// b) Disco → registry: verificar que todo lo que existe está declarado
const registryPaths = new Set(config.registry.map(d => d.path));
const scanDirs = ['docs/core', 'docs/features', 'docs/ops', 'framework', 'skills'];
const orphans = [];
scanDirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const walk = (d) => {
    fs.readdirSync(d).forEach(f => {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) { walk(full); return; }
      if (!f.endsWith('.md')) return;
      const rel = full.replace(/\\\\/g, '/');
      if (!registryPaths.has(rel)) {
        orphans.push({ problem: 'existe en disco pero NO está en registry (nodo huérfano)', path: rel });
      }
    });
  };
  walk(dir);
});

const issues = [...missing, ...orphans];
if (issues.length) {
  console.error('PROBLEMAS DETECTADOS:');
  issues.forEach(i => console.error(' -', i.problem + ':', i.path));
  process.exit(1);
}
console.log('Registry completo — sin nodos huérfanos ni referencias rotas.');
"

# 1b. Ver qué docs son always (lectura obligatoria independiente del issue)
node -e "
const config = require('./docs.json');
console.log('Docs always-read:');
config.registry
  .filter(doc => doc.scope === 'always')
  .forEach(doc => console.log(' -', doc.path));
"

# 2. Verificar Node
node --version   # debe ser >= 20

# 3. Verificar variables de entorno locales
ls .env.local    # si no existe: cp .env.example .env.local
npm run env:check

# 4. Verificar acceso a GitHub (si el issue requiere push/PR)
gh auth status

# 5. Verificar rama activa
git branch       # debe estar en la rama del issue, no en main
```

---

## Hermetic testing

**Principio no negociable desde Fase 1:** los tests deben correr con `npm test` sin ninguna dependencia externa — sin Supabase real, sin red, sin datos de producción. Un agente no puede validar su propio trabajo si los tests necesitan un servicio externo para pasar.

**Qué significa en la práctica:**

- **Supabase:** usar `supabase-js` con un cliente mockeado en tests. No conectar a la base de datos real en ningún test unitario ni de componente.
- **Fetch / API calls:** interceptar con `msw` (Mock Service Worker) o equivalente. Los tests no hacen llamadas de red reales.
- **Datos:** usar factories o fixtures definidos en `/tests/fixtures/`. No depender de datos en staging.
- **Variables de entorno:** los tests usan valores dummy definidos en `.env.test`. No necesitan `.env.local`.

**Qué sí puede conectar a servicios reales:**
- Tests E2E con Playwright (corren contra staging, no contra el entorno de CI básico).
- Scripts de migración de base de datos (no son tests — son operaciones de infra).

Si un test falla en CI pero pasa localmente porque "hay datos en staging", ese test está roto por diseño. Arreglarlo es parte del issue, no deuda técnica posterior.

---

## IndexedDB local-first (ODE-16)

La capa `localDB` del MVP web usa IndexedDB y arranca automáticamente al cargar la app en browser. Si necesitas inspeccionar o resetear el estado local durante desarrollo:

1. Abre DevTools del navegador.
2. Ve a `Application` → `Storage` → `IndexedDB`.
3. Busca la base `odessay-local-first`.
4. Revisa los object stores `writings` y `sync-mutations`, o elimina la base completa para reiniciar el estado local.

El sync worker corre en background y reintenta al volver la conectividad (`online`) además del debounce normal de 1.5s.

---

## Variables de entorno

`.env.example` es la plantilla canónica del proyecto. Crear `.env.local` en la raíz con:

```bash
cp .env.example .env.local
```

Nunca commitear `.env.local` (está en `.gitignore`).

Variables mínimas requeridas para ODE-11:

```env
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY=
# Compatibilidad legacy:
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
ANTHROPIC_API_KEY=
RESEND_API_KEY=
```

Validar el archivo antes de correr cualquier tarea:

```bash
npm run env:check
```

### Matriz de entornos (ODE-11)

**Decisión activa:** Un solo proyecto Supabase (`odessay-staging`) cubre local, Preview y Production hasta el lanzamiento real. El proyecto de producción separado se crea en Fase 5 cuando haya usuarios reales.

| Variable | Local (`.env.local`) | Vercel Preview | Vercel Production |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL preview de Vercel | Dominio productivo |
| `NEXT_PUBLIC_SUPABASE_URL` | URL de `odessay-staging` | URL de `odessay-staging` | URL de `odessay-staging` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | publishable key de `odessay-staging` | publishable key de `odessay-staging` | publishable key de `odessay-staging` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | opcional (legacy) | opcional (legacy) | opcional (legacy) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key de `odessay-staging` | service role key de `odessay-staging` | service role key de `odessay-staging` |
| `ANTHROPIC_API_KEY` | key activa de Anthropic | key activa de Anthropic | key activa de Anthropic |
| `RESEND_API_KEY` | key activa de Resend | key activa de Resend | key activa de Resend |

### Checklist de handoff humano (Supabase + Vercel)

1. Renombrar el proyecto Supabase existente a `odessay-staging` (Settings → General → Name).
2. Copiar `URL`, `publishable key` y `service role key` desde Supabase Dashboard → Settings → API → pestaña "Publishable and secret API keys".
3. Llenar `.env.local` con esos valores.
4. Configurar las mismas variables en Vercel (Preview y Production usan las mismas keys por ahora):
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.
5. Confirmar en Linear cuando variables estén listas para desbloquear migraciones (`ODE-14`) y deploy previews (`ODE-12`).

**Entornos:** Existen tres — `local` (`.env.local`), `staging` (Vercel preview), `production` (Vercel main). Las variables de Vercel las gestiona el humano, no el agente. El proyecto Supabase de producción separado se crea en Fase 5.

### ODE-12 — Deploy en Vercel + previews por PR

Este issue es principalmente humano: el agente no puede conectar el repositorio en la UI de Vercel.

Pasos operativos:

1. Ir a `https://vercel.com/dashboard` → `Add New Project` → `Import Git Repository` → seleccionar `hugomarin/Odessay`.
2. Confirmar framework detectado: `Next.js` (default de Vercel, sin overrides).
3. En `Environment Variables`, configurar para `Preview` y `Production`:
   `NEXT_PUBLIC_APP_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`.
4. Ejecutar primer deploy de `main` y validar build exitoso.
5. Abrir un PR de prueba para verificar preview deployment automático.

Evidencia mínima para cerrar ODE-12:

- Link deploy de `main` (production).
- Link preview deployment del PR de prueba.

Sin esos 2 links en Linear, ODE-12 no se mueve a `Done`.

---

### ODE-14 — Migraciones iniciales de base de datos

Este issue deja la base estructural de Supabase: schema, índices, RLS y triggers.

Pasos operativos:

1. Crear `supabase/config.toml` y las migraciones en `supabase/migrations/` con formato `{timestamp}_{descripcion}.sql`.
2. Aplicar migraciones en staging en orden cronológico:

```bash
for migration in $(find supabase/migrations -maxdepth 1 -name '*.sql' | sort); do
  psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f "$migration"
done
```

3. Verificar tablas, columnas críticas, RLS y triggers:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -c "select tablename from pg_tables where schemaname='public' and tablename in ('profiles','writings','correspondences','collections','writing_collections','writing_shares','ai_observations','margins','invitations') order by tablename;" \
  -c "select column_name,data_type from information_schema.columns where table_schema='public' and table_name='writings' and column_name in ('version','sync_status','deleted_at','slug') order by column_name;" \
  -c "select column_name,data_type from information_schema.columns where table_schema='public' and table_name='margins' and column_name in ('shared_at','updated_at') order by column_name;" \
  -c "select tablename, policyname, cmd from pg_policies where schemaname='public' and tablename in ('profiles','writings','correspondences','collections','writing_collections','writing_shares','ai_observations','margins','invitations') order by tablename, policyname;" \
  -c "select tgname from pg_trigger where not tgisinternal and tgname in ('on_auth_user_created','writings_before_set_derived_fields','writings_before_insert_assign_correspondence','writings_touch_correspondence_after_write','margins_manage_shared_at') order by tgname;"
```

4. Adjuntar en Linear evidencia de:
   - PR link
   - commit SHA
   - `typecheck` ✅, `lint` ✅, `test` ✅
   - verificación SQL en staging ✅

Sin verificación SQL de schema y políticas, ODE-14 no se mueve a `In Review`.

---

## Levantar el proyecto localmente

```bash
# Instalar dependencias
npm install

# Levantar en desarrollo
npm run dev      # http://localhost:3000

# Type check
npm run typecheck

# Lint
npm run lint

# Tests E2E (requiere servidor corriendo)
npm run test:e2e
```

### Baseline frontend (ODE-10)

La base del proyecto se inicializa con:

- Next.js 15 + App Router
- React 19
- TypeScript en modo `strict`
- Tailwind CSS
- ShadCN configurado con `style: default`, `baseColor: neutral`, `cssVariables: true`

Archivos base esperados tras ODE-10:

- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `components.json`
- `app/layout.tsx`
- `app/globals.css`

---

## Manifiesto de tools

### Tools hard-required (sin estos el agente no puede trabajar)

| Tool | Para qué |
|---|---|
| Bash / terminal | Correr comandos, git, npm, verificaciones |
| Filesystem read/write | Leer y editar archivos del codebase |
| Node.js >= 20 | Correr el proyecto y los tests |

### Tools soft-required (el agente opera con capacidad reducida sin ellos)

| Tool | Para qué | Degradación si no está |
|---|---|---|
| GitHub MCP o `gh` CLI | Crear PRs, ver PRs abiertos, detectar conflictos de archivos | El agente hace commit + push manual; el PR lo abre el humano |
| Linear MCP | Leer issues, mover estados, comentar bloqueos | El humano pasa el issue como texto al agente manualmente |
| Supabase MCP | Verificar schema y RLS en staging post-migración | La verificación se hace manualmente desde el dashboard |
| Playwright MCP | Validación E2E del flujo antes de mover a In Review | La validación la hace el humano manualmente |
| Sentry MCP | Consultar errores en producción | El agente no puede investigar bugs de producción de forma autónoma |

---

## Manifiesto de permisos

### Qué necesita el agente antes de empezar cualquier issue

| Permiso | Scope mínimo | Cómo verificar |
|---|---|---|
| GitHub token | `repo` (read/write), `pull_requests` | `gh auth status` |
| Supabase anon key | Operaciones autenticadas del cliente | Presente en `.env.local` |
| Anthropic API key | Acceso a Claude Sonnet | Presente en `.env.local` |

### Qué NO necesita el agente (lo gestiona el humano)

- Supabase service role key en producción
- Vercel deploy tokens
- Acceso directo a la base de datos de producción
- Variables de entorno de producción

---

## Estrategia de Git

### Ramas

`main` es producción. Siempre estable. Nunca push directo.

Si branch protection no puede habilitarse por limitación del plan de GitHub, esta regla se aplica como política operativa obligatoria y se documenta en el issue correspondiente de Linear antes de cerrar.

Formato de rama por tipo de issue:

```
feat/{issue-id}-{descripcion-corta}   → nueva funcionalidad
fix/{issue-id}-{descripcion-corta}    → corrección de bug
docs/{issue-id}-{descripcion-corta}   → solo documentación
chore/{issue-id}-{descripcion-corta}  → infra, config, dependencias
```

Ejemplos:
```
feat/ODY-12-writings-table
fix/ODY-34-autosave-debounce
docs/ODY-05-setup-guide
```

El agente crea la rama desde `main` actualizado:
```bash
git checkout main && git pull origin main
git checkout -b feat/ODY-XX-descripcion
```

### Commits

Formato: `tipo(scope): descripción [ODY-XX]`

```bash
feat(db): add writings table with RLS policies [ODY-12]
feat(editor): implement TipTap base with auto-save [ODY-18]
fix(editor): correct debounce timing on local save [ODY-18]
test(editor): add E2E test for auto-save flow [ODY-18]
```

**Cuándo commitear:** Al completar una unidad lógica dentro del issue. No después de cada archivo — no al final de todo. El punto óptimo es: una vez que algo funciona de forma independiente y no rompe lo anterior.

**Cuándo pushear:** Al terminar cada subtarea significativa dentro del issue, y siempre al final antes de abrir el PR.

### Coordinación paralela

Antes de empezar un issue, verificar conflictos potenciales:

```bash
git fetch origin
git branch -r                          # ver ramas activas remotamente
gh pr list --state open                # ver PRs abiertos y qué archivos tocan
```

Si un PR abierto toca los mismos archivos que el issue que vas a empezar: comentar en el issue de Linear y esperar a que el PR se mergee antes de continuar. No trabajar en paralelo sobre los mismos archivos.

### WORKFLOW.md — instrucciones específicas por issue

Inspirado en Symphony: si un issue requiere comportamiento del agente diferente al default (contexto extra, restricciones adicionales, pasos de validación específicos), el agente puede crear un `WORKFLOW.md` en la raíz de la rama antes de empezar.

Este archivo sobreescribe `agent.md` para esa rama únicamente. Se commitea como parte del PR y se borra al mergear a main — nunca llega a producción.

```markdown
# WORKFLOW.md — ODY-XX

## Contexto adicional
Este issue toca el componente FootnoteExtension. Leer odessay-editor.md §FootnoteExtension antes de empezar.

## Restricciones específicas
No modificar el schema de ProseMirror de nodos ya existentes.

## Validación requerida
Correr el test suite de extensiones TipTap antes de mover a In Review.
```

Si el issue no tiene particularidades, no se crea WORKFLOW.md. Es una herramienta para casos donde el contexto del issue justifica instrucciones extra — no un trámite obligatorio.

### Flujo completo de entrega

```
1. Crear rama desde main actualizado
2. Mover issue a In Progress en Linear
3. Crear WORKFLOW.md si el issue lo justifica
4. Desarrollar con commits atómicos
5. Push al branch remoto al terminar cada subtarea
6. Ejecutar validaciones (typecheck, lint, tests) — pegar output en el PR
7. Abrir PR con descripción del issue
8. Comentar en el issue de Linear: link al PR + SHA del commit + resultado de validaciones
9. Mover issue a In Review en Linear
── STOP: el turno del agente termina aquí ──────────────────────────────────
10. El revisor (agente o humano) aprueba y hace merge
11. Una vez mergeado: mover issue a Done y agregar entrada en `docs/ops/status.json`
```

**Regla de parada — una issue a la vez:** Al llegar al paso 9, el agente detiene todo trabajo. No abre nuevas ramas. No empieza el siguiente issue. No hace commits en ningún otro branch. Su tarea termina cuando el issue está en In Review. El siguiente issue solo puede empezar después de que el PR sea mergeado y el issue esté en Done.

**Nota sobre el merge:** el owner del proyecto es no técnico — no hace code review del código. El merge es una aprobación de go/no-go basada en el proof of work que el agente dejó en el PR y en el comentario de Linear. Si las validaciones pasaron y el agente las documentó, el humano aprueba. Si algo falta o hay un error en el output, el humano rechaza y el agente debe corregir antes de volver a pedir merge.

---

## Observabilidad: cómo enterarse si algo se rompe

### Build failures

Vercel notifica por email cuando un build falla en staging o producción. Configurar el canal de Slack de Vercel si se prefiere notificación allí. El agente puede consultar el estado del último deploy con:

```bash
vercel ls          # si Vercel CLI está instalado
```

### Runtime errors — Sentry

Sentry captura errores de JavaScript en cliente y excepciones en API routes. Configuración mínima requerida:

```bash
npx @sentry/wizard@latest -i nextjs
```

El `NEXT_PUBLIC_SENTRY_DSN` va en `.env.local` y en las variables de Vercel. Sin esta configuración, los errores en producción son invisibles hasta que un usuario reporta.

### Errores silenciosos — logging estructurado

Los errores que no llegan al usuario (sync background, AI silencioso, RLS bloqueando silenciosamente) se loggean server-side con contexto:

```ts
// ✓ Log estructurado con contexto
console.error('[sync:remote]', {
  userId,
  writingId,
  operation: 'PATCH',
  error: error.message
})

// ✗ Log sin contexto — inútil en producción
console.error('Error:', error)
```

Estos logs son visibles en Vercel Functions → Logs. En una fase posterior se puede integrar con Sentry para capturarlos también.
