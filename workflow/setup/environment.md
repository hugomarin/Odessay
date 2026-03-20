# ODESSAY — Setup de entorno

## Alcance

Setup técnico del entorno local para poder ejecutar trabajo de implementación.

## Cuándo se usa

- Al iniciar una sesión técnica antes de tocar código.
- Cuando cambian variables de entorno, tools o permisos operativos.
- Cuando falla el pre-flight y hay que diagnosticar bloqueo de entorno.

## No incluye

- Proceso de entrega, estados de Linear o estrategia de Git (ver `workflow/process/governance.md`).
- Estándares de calidad/observabilidad (ver `workflow/quality/testing-observability.md`).
- Procedimientos específicos por issue/fase (ver `workflow/runbooks/phase-1-operations.md`).

## Pre-flight: verificar antes de empezar

Antes de tocar un archivo, un agente debe confirmar que tiene todo lo necesario. Si algo falta, documentar bloqueo en Linear y no empezar implementación.

```bash
# 1. Verificar integridad del registry (declarado <-> disco)
node -e "
const config = require('./workflow/docs.json');
const fs = require('fs');
const path = require('path');

const missing = [];
config.registry.forEach(doc => {
  if (!doc.path.endsWith('/') && !fs.existsSync(doc.path)) {
    missing.push({ problem: 'declarado pero no existe en disco', path: doc.path });
  }
});

const registryPaths = new Set(config.registry.map(d => d.path));
const scanDirs = [
  'workflow/core',
  'workflow/features',
  'workflow/setup',
  'workflow/process',
  'workflow/runbooks',
  'workflow/quality',
  'workflow/framework',
  'workflow/issues',
  '.agents/skills'
];
const orphans = [];
scanDirs.forEach(dir => {
  if (!fs.existsSync(dir)) return;
  const walk = (d) => {
    fs.readdirSync(d).forEach(f => {
      const full = path.join(d, f);
      if (fs.statSync(full).isDirectory()) { walk(full); return; }
      if (!f.endsWith('.md')) return;
      const rel = full.replace(/\\/g, '/');
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

# 1b. Ver docs always
node -e "
const config = require('./workflow/docs.json');
console.log('Docs always-read:');
config.registry
  .filter(doc => doc.scope === 'always')
  .forEach(doc => console.log(' -', doc.path));
"

# 1c. Drift informativo
npm run ops:status:drift

# 2. Node
node --version   # >= 20

# 3. Variables locales
ls .env.local    # si no existe: cp .env.example .env.local
npm run env:check

# 4. GitHub auth (si habrá push/PR)
gh auth status

# 5. Rama activa
git branch       # nunca trabajar en main
```

## Variables de entorno

`.env.example` es la plantilla canónica. Crear `.env.local` en la raíz:

```bash
cp .env.example .env.local
```

Nunca commitear `.env.local`.

Variables mínimas:

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

Validar:

```bash
npm run env:check
```

### Matriz de entornos

Decisión activa: un solo proyecto Supabase (`odessay-staging`) para local, Preview y Production hasta Fase 5.

| Variable | Local (`.env.local`) | Vercel Preview | Vercel Production |
|---|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `http://localhost:3000` | URL preview de Vercel | Dominio productivo |
| `NEXT_PUBLIC_SUPABASE_URL` | URL de `odessay-staging` | URL de `odessay-staging` | URL de `odessay-staging` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY` | publishable key de `odessay-staging` | publishable key de `odessay-staging` | publishable key de `odessay-staging` |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | opcional (legacy) | opcional (legacy) | opcional (legacy) |
| `SUPABASE_SERVICE_ROLE_KEY` | service role key de `odessay-staging` | service role key de `odessay-staging` | service role key de `odessay-staging` |
| `ANTHROPIC_API_KEY` | key activa de Anthropic | key activa de Anthropic | key activa de Anthropic |
| `RESEND_API_KEY` | key activa de Resend | key activa de Resend | key activa de Resend |

## Levantar el proyecto localmente

```bash
npm install
npm run dev      # http://localhost:3000
npm run typecheck
npm run lint
npm run test:e2e # requiere servidor activo
```

### Baseline frontend

Base esperada:

- Next.js 15 + App Router
- React 19
- TypeScript `strict`
- Tailwind CSS
- ShadCN con `style: default`, `baseColor: neutral`, `cssVariables: true`

Archivos núcleo:

- `package.json`
- `next.config.ts`
- `tsconfig.json`
- `postcss.config.mjs`
- `tailwind.config.ts`
- `components.json`
- `app/layout.tsx`
- `app/globals.css`

## Manifiesto de tools

### Hard-required

| Tool | Para qué |
|---|---|
| Bash / terminal | Comandos, git, npm, verificaciones |
| Filesystem read/write | Leer y editar el codebase |
| Node.js >= 20 | Correr app y tests |

### Soft-required

| Tool | Para qué | Degradación si no está |
|---|---|---|
| GitHub MCP o `gh` CLI | PRs y estado de cambios | El humano abre PR manual con instrucciones del agente |
| Linear MCP | Leer/mover issues y bloqueos | El humano transfiere contexto manualmente |
| Supabase MCP | Verificar schema y RLS | Verificación manual en dashboard |
| Playwright MCP | Validación E2E | Validación manual por humano |
| Sentry MCP | Investigar errores en producción | Sin investigación autónoma de prod |

## Manifiesto de permisos

### Requeridos para ejecutar issues

| Permiso | Scope mínimo | Cómo verificar |
|---|---|---|
| GitHub token | `repo` y `pull_requests` | `gh auth status` |
| Supabase anon/publishable key | Operaciones de cliente | Presente en `.env.local` |
| Anthropic API key | AI editor | Presente en `.env.local` |

### No requeridos para el agente

- Service role key en producción
- Vercel deploy tokens
- Acceso directo a DB de producción
- Variables productivas fuera de su flujo de trabajo
