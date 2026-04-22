# Claude Enhancement — Code Review Odessay

Este documento es una capa opcional sobre `SKILL.md`. Solo aplica cuando el agente ejecutor tiene acceso a la herramienta `Agent` (subagentes), como Claude Code.

Si el agente no soporta `Agent`, ignorar este archivo por completo. El review base ya es completo.

---

## Specialist Dispatch

### Detección de scope

Antes de lanzar especialistas, detectar qué toca el diff:

```bash
DIFF_LINES=$(git diff origin/main...HEAD --stat | tail -1 | grep -oE '[0-9]+ insertion|[0-9]+ deletion' | grep -oE '[0-9]+' | awk '{s+=$1} END {print s}')
echo "DIFF_LINES: ${DIFF_LINES:-0}"
```

También detectar scope semántico:
```bash
# Backend
[ $(git diff origin/main...HEAD --name-only | grep -c "app/api/") -gt 0 ] && echo "SCOPE_BACKEND: true"
# Frontend
[ $(git diff origin/main...HEAD --name-only | grep -c "components/\|app/(app)/\|app/(auth)/\|app/(public)/\|app/(reading)/") -gt 0 ] && echo "SCOPE_FRONTEND: true"
# DB/Migrations
[ $(git diff origin/main...HEAD --name-only | grep -c "supabase/migrations/") -gt 0 ] && echo "SCOPE_MIGRATIONS: true"
# API Routes
[ $(git diff origin/main...HEAD --name-only | grep -c "app/api/") -gt 0 ] && echo "SCOPE_API: true"
# Auth
[ $(git diff origin/main...HEAD --name-only | grep -c "auth/\|middleware\|supabase/") -gt 0 ] && echo "SCOPE_AUTH: true"
```

### Reglas de dispatch

**Si DIFF_LINES < 50:** Skip especialistas. El review base es suficiente.

**Si DIFF_LINES >= 50, lanzar en paralelo:**

| Especialista | Condición | Archivo de checklist |
|--------------|-----------|----------------------|
| **Testing** | Siempre si >= 50 líneas | `specialists/testing.md` |
| **Maintainability** | Siempre si >= 50 líneas | Review base (DRY, deuda técnica) |
| **Security** | Si `SCOPE_AUTH=true` O (`SCOPE_BACKEND=true` Y DIFF_LINES > 100) | `specialists/security.md` |
| **Performance** | Si `SCOPE_BACKEND=true` O `SCOPE_FRONTEND=true` | `specialists/performance.md` |
| **Data Migration** | Si `SCOPE_MIGRATIONS=true` | `specialists/data-migration.md` |

### Prompt para cada subagente

Construir un prompt por especialista:

```
Eres un code reviewer especialista en {dominio}.
Lee el checklist en {archivo-checklist}, luego ejecuta:
  git diff origin/main...HEAD
Aplica el checklist contra el diff.

Para cada finding, output JSON en una línea:
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"category","summary":"description","fix":"recommended fix","fingerprint":"path:line:category"}

Campos requeridos: severity, confidence, path, category, summary, specialist.
Opcionales: line, fix, fingerprint.

Si puedes escribir un test que detectaría este issue, inclúyelo en `test_stub`.
Si no hay findings: output `NO FINDINGS` y nada más.

Contexto del stack: Next.js 15, React 19, TypeScript strict, Supabase, TipTap, Tailwind.
CHECKLIST:
{contenido del archivo}
```

### Merge de findings

Cuando todos los subagentes terminen:

1. Parsear JSON de cada uno (ignorar líneas que no sean JSON válido o `NO FINDINGS`).
2. Computar fingerprint: `{path}:{line}:{category}`.
3. Si dos especialistas comparten fingerprint → marcar `MULTI-SPECIALIST CONFIRMED` y boostear confidence +1 (cap 10).
4. Aplicar confidence gates del `scoring.md`.
5. Incluir findings especializados en el PR Quality Score final.

---

## Red Team (condicional)

**Activación:** Solo si DIFF_LINES > 200 O algún especialista produjo un finding CRITICAL.

Lanzar un subagente adicional con instrucción adversarial:

```
Eres un red team reviewer. El código ya fue revisado por N especialistas que encontraron:
{resumen de findings mergeados}

Tu trabajo: encontrar lo que ELLOS SE PERDIERON.
Lee el diff con `git diff origin/main...HEAD`. Busca:
- Cross-cutting concerns que ningún especialista cubrió
- Integration boundary issues
- Failure modes silenciosos (corrupt data sin error)
- Race conditions entre componentes
- Trust boundary violations entre frontend y backend

Output: mismo formato JSON que los especialistas.
Especialist: "red-team"
```

Mergear findings del Red Team con los demás antes del score final.

---

## Adversarial Review

Subagente con mentalidad de chaos engineer.

**Cuándo correr:**
- Siempre si el diff toca `app/api/` o `supabase/migrations/` (cambios en API o DB son de alto riesgo incluso en pocas líneas).
- Si el diff tiene ≥ 50 líneas cambiadas.
- Si está activado explícitamente con flag `--adversarial`.

**Cuándo NO correr:**
- Diff < 50 líneas que NO toca API ni migraciones.

**Prompt:**
```
Eres un chaos engineer. Lee el diff con `git diff origin/main...HEAD`.
Tu trabajo: encontrar formas en que este código fallará en producción.
Busca edge cases, race conditions, resource leaks, silent data corruption,
error handling que swallows failures, y logic errors que produzcan resultados
incorrectos sin lanzar excepción.

Sé adversarial. Sé exhaustivo. Nada de cumplidos — solo problemas.
Clasifica cada finding como FIXABLE (sabés cómo arreglarlo) o INVESTIGATE (necesita juicio humano).

Output: SOLO líneas JSON. Nada de texto libre, markdown, headers o comentarios.
Para cada finding:
{"severity":"CRITICAL|HIGH|MEDIUM|LOW","confidence":N,"path":"file","line":N,"category":"category","summary":"description","fix":"recommended fix","specialist":"adversarial"}

Si no hay findings: output `NO FINDINGS` y nada más.
```

---

## Auto-fix vs Ask gate

En modo Claude Enhancement, clasificar findings automáticamente:

**AUTO-FIX** (aplicar sin preguntar):
- Typo en string/mensaje de error
- Import faltante
- `console.log` residual
- Formato inconsistente (fácil de verificar)

**ASK** (usar AskUserQuestion):
- Cambio arquitectónico
- Modificación de contrato de API
- Eliminación de código que "parece" no usarse
- Cualquier cambio en RLS o migraciones

Aplicar fixes AUTO antes de presentar el reporte final. Los findings que quedan son solo los que requieren decisión humana.
