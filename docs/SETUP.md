# ODESSAY — Setup del entorno

**Leer antes de empezar cualquier tarea.** Este documento responde: ¿cómo levanto el proyecto, qué credenciales necesito, qué tools debo tener disponibles, y cómo trabajo con Git?

---

## Pre-flight: verificar antes de empezar

Antes de tocar un archivo, un agente debe confirmar que tiene todo lo necesario. Si algún item falta, no empezar — documentar el bloqueo en el issue de Linear y escalar.

```bash
# 1. Verificar que el framework está completo — todos los documentos declarados en config.json existen
node -e "
const config = require('./config.json');
const fs = require('fs');
const missing = [];
config.questions.forEach(q => {
  const docs = q.documents || [];
  docs.forEach(doc => {
    if (!doc.endsWith('/') && !fs.existsSync(doc)) missing.push({ q: q.id, doc });
  });
});
if (missing.length) { console.error('GAPS:', missing); process.exit(1); }
else console.log('Framework completo — todos los documentos existen.');
"

# 2. Verificar Node
node --version   # debe ser >= 20

# 3. Verificar que existe .env.local
ls .env.local    # si no existe, ver sección Variables de entorno

# 4. Verificar acceso a GitHub (si el issue requiere push/PR)
gh auth status

# 5. Verificar rama activa
git branch       # debe estar en la rama del issue, no en main
```

---

## Variables de entorno

Crear `.env.local` en la raíz del proyecto. Nunca commitear este archivo (está en `.gitignore`).

```env
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=      # solo para scripts de migración, nunca al cliente

# Claude API (para AI editor)
ANTHROPIC_API_KEY=

# Resend (para emails)
RESEND_API_KEY=

# Sentry (para error tracking)
NEXT_PUBLIC_SENTRY_DSN=
SENTRY_AUTH_TOKEN=              # solo para source maps en CI
```

**Entornos:** Existen tres — `local` (`.env.local`), `staging` (Vercel preview), `production` (Vercel main). Las variables de Vercel las gestiona el humano, no el agente.

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

### Flujo completo de entrega

```
1. Crear rama desde main actualizado
2. Mover issue a In Progress en Linear
3. Desarrollar con commits atómicos
4. Push al branch remoto al terminar cada subtarea
5. Ejecutar validaciones (typecheck, lint, tests)
6. Abrir PR con descripción del issue
7. Mover issue a In Review en Linear
8. Actualizar STATUS.md con el entregable completado
```

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
