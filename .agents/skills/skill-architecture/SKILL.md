---
name: skill-architecture
description: Guía de arquitectura de Odessay para clasificar trabajo entre UI, aplicación, dominio, adapters y runtimes. Usar cuando un cambio toque desktop, multi-runtime, shared core, save path, sync/hydration, parser/serializer, contratos de servicio o boundaries entre frontend y backend.
---

# Skill: Architecture

Usa este skill cuando la tarea ya no sea solo “frontend”, “backend” o “database”, sino una pregunta de **dónde vive una responsabilidad** y **quién debe depender de quién**.

No inventa arquitectura nueva. Opera sobre la arquitectura ya definida en:

1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Si estos documentos no bastan, el problema es de contexto/documentación y debe hacerse explícito. No improvisar una arquitectura paralela dentro del skill.

---

## Cuándo activar este skill

Actívalo si el prompt, issue o diff toca cualquiera de estas señales:

- desktop
- Tauri / Electron
- mobile
- multi-runtime
- shared core
- adapters
- `DocumentService`, `SyncService`, `AIService`, `AuthService`, `SharingService`, `AssetService`
- save path
- sync / hydration
- parser / serializer
- `.md` como contrato documental
- `body_json` vs Markdown
- boundaries entre UI y servicios
- refactors que cruzan frontend/backend/database

Si la tarea cruza capas y no sabes si pertenece a frontend, backend o database, este skill aplica por default.

---

## Objetivo

Responder cuatro preguntas antes de implementar:

1. ¿Qué tipo de trabajo es?
2. ¿En qué capa debe vivir?
3. ¿Qué runtime o adapter toca?
4. ¿Qué contratos o invariantes deben preservarse?

Sin estas respuestas, frontend/backend/database tienden a resolver localmente algo que era una decisión de arquitectura.

---

## Secuencia obligatoria

### Paso 1 — Cargar contexto correcto

Leer en este orden:

1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Después, cargar solo los docs técnicos del área específica:

- editor / sync / prosemirror si el cambio toca documento o write-path
- backend / database si toca adapters web o capa remota

### Paso 2 — Clasificar el trabajo

Cada cambio debe clasificarse en una de estas categorías dominantes:

- `UI only`
- `Application / use case`
- `Domain`
- `Shared core`
- `Web adapter`
- `Desktop adapter`
- `Remote / cloud service`

Se puede tocar más de una categoría, pero debe haber una dominante.

### Paso 3 — Declarar ownership

Responder explícitamente:

- qué parte pertenece a frontend
- qué parte pertenece a backend
- qué parte pertenece a database
- qué parte no debe resolverse localmente en ninguno de ellos porque requiere contrato primero

### Paso 4 — Declarar boundaries

Antes de tocar código, responder:

- qué inputs recibe la capa
- qué outputs produce
- de qué puede depender
- de qué no puede depender

### Paso 5 — Declarar invariantes

Como mínimo, verificar:

- contrato documental
- ownership del write-path
- boundary entre core y adapter
- qué runtime es el actual y cuál es el objetivo

---

## Heurística de clasificación

### `UI only`

Es `UI only` si:

- cambia render, layout, estados visuales o interacción local
- no redefine contratos
- no toca save path, sync, parser o adapters

### `Application / use case`

Es aplicación si:

- coordina pasos de una operación
- decide orden de ejecución
- orquesta save, share, AI, export, sync

Pregunta guía:

> “Cuando el usuario hace X, ¿qué pasos sigue el sistema?”

### `Domain`

Es dominio si:

- cambia significado del producto
- cambia reglas de writings, visibility, sharing, correspondencias, márgenes
- cambia el contrato del documento o sus invariantes

Pregunta guía:

> “¿Qué debe seguir siendo verdad aunque cambie la plataforma?”

### `Web adapter`

Es adapter web si:

- depende de Next
- depende de `app/api/*`
- depende de cookies SSR
- depende de Supabase browser/server clients
- resuelve infraestructura del runtime web

### `Desktop adapter`

Es adapter desktop si:

- depende de filesystem
- depende de secure local storage
- depende de APIs nativas
- resuelve write-path local desktop

### `Remote / cloud service`

Es servicio remoto si:

- coordina estado compartido fuera del dispositivo
- usa auth remota, AI remota, sharing, publishing o backup

---

## Reglas de dependencia

### Regla 1

La UI no decide arquitectura.

### Regla 2

Un adapter no redefine dominio.

### Regla 3

Si el cambio toca `.md`, `body_json`, save path o sync, no puede resolverse solo como frontend.

### Regla 4

Si el cambio toca `app/api/*`, no asumir que pertenece al core; por default es adapter web.

### Regla 5

Si el cambio introduce o altera un servicio (`DocumentService`, etc.), primero se define el contrato y luego la implementación por runtime.

---

## Output esperado de este skill

Cuando se use este skill, debe producir explícitamente algo como:

### Architectural classification

- Dominant layer: `...`
- Secondary layers: `...`

### Runtime scope

- Current runtime affected: `web | desktop | cloud`
- Target runtime affected: `web | desktop | mobile | shared`

### Ownership

- Frontend owns: `...`
- Backend owns: `...`
- Database owns: `...`
- Needs architectural contract first: `yes | no`

### Contracts touched

- `DocumentService`
- `SyncService`
- `...`

### Invariants

- `...`

### Required docs for the issue

- `...`

Si no puedes producir este output, el contexto todavía no es suficiente.

---

## Qué hacer si detectas un hueco

### Caso 1 — El issue está mal clasificado

Ejemplo:
- viene como frontend
- pero en realidad toca save path o shared core

Acción:
- reetiquetar mentalmente el problema como arquitectónico
- pedir brief o issue actualizado si hace falta

### Caso 2 — El brief no trae los docs correctos

Acción:
- marcar `Context Gap`
- no resolver la arquitectura implícitamente desde implementación local

### Caso 3 — El corpus se contradice

Acción:
- privilegiar la secuencia desktop
- dejar explícita la contradicción documental
- no “promediar” dos arquitecturas incompatibles

---

## Relación con otros skills

- `skill-product-manager` usa este skill para decidir en qué capa vive un issue y qué docs debe citar
- `skill-frontend` lo consulta cuando el cambio deja de ser solo UI
- `skill-backend` lo consulta cuando una route o servicio cruza core/adapters
- `skill-database` lo consulta cuando schema y contrato documental empiezan a divergir

Orden correcto:

1. PM define problema y scope
2. Architecture clasifica capa, contracts y invariants
3. Frontend / Backend / Database implementan dentro de esos límites

---

## Regla final

Si un cambio te hace preguntar:

> “¿Esto vive en frontend, backend, database o en otra capa?”

la respuesta no es improvisar.

La respuesta es activar este skill.
