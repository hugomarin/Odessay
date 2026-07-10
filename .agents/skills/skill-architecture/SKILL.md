---
name: skill-architecture
description: Guía de arquitectura de Odessay para clasificar trabajo entre UI, aplicación, dominio, adapters y runtimes. Usar cuando un cambio toque desktop, multi-runtime, shared core, save path, sync/hydration, parser/serializer, contratos de servicio o boundaries entre frontend y backend.
---

# Skill: Architecture

Usa este skill cuando la tarea ya no sea solo “frontend”, “backend” o “database”, sino una pregunta de **dónde vive una responsabilidad** y **quién debe depender de quién**.

No inventa arquitectura nueva. Opera sobre la arquitectura ya definida en:

0. `workflow/context/core/odessay-adr-identidad.md` — **fuente de verdad de la arquitectura de documento** (identidad, fuente de verdad, metadata). Cierra la polaridad A1/A2/A3 que antes se aplazaba: `.md` canónico, `body_json` copia de trabajo, metadata en la nube, un solo UUID cliente=nube. **Prevalece** sobre los cuatro docs siguientes en cualquier discrepancia de contrato documental.
0.1. `workflow/context/features/odessay-desktop-document-catalog.md` — **fuente de verdad operacional del catálogo desktop** (BindingRoots, manifest `.odessay`, SQLite, reconciliador global, Desk/Workspace/Open, migración de IndexedDB). Se subordina al ADR y prevalece sobre descripciones históricas del runtime desktop.
1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Si estos documentos no bastan, el problema es de contexto/documentación y debe hacerse explícito. No improvisar una arquitectura paralela dentro del skill. Una vez ejecutado el ADR (D1/D5), **no** elegir fuente de verdad por `canonical_path` ni "promediar" arquitecturas: el contrato es fijo (D1).

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

Responder cinco preguntas antes de implementar:

1. ¿Qué tipo de trabajo es?
2. ¿En qué capa debe vivir?
3. ¿Qué runtime o boundary toca?
4. ¿Quién es owner de cada parte?
5. ¿Qué contratos o invariantes deben preservarse?

Sin estas respuestas, frontend/backend/database tienden a resolver localmente algo que era una decisión de arquitectura.

---

## Secuencia obligatoria

### Paso 1 — Cargar contexto correcto

Leer en este orden:

0. `workflow/context/core/odessay-adr-identidad.md`
0.1. `workflow/context/features/odessay-desktop-document-catalog.md` cuando el cambio toque Desk, Workspace, Open Document, watcher, BindingRoots, SQLite, IndexedDB desktop, identidad o lifecycle local/cloud.
1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Después, cargar solo los docs técnicos del área específica:

- editor / sync / prosemirror si el cambio toca documento o write-path
- backend / database si toca adapters web o capa remota

### Paso 2 — Clasificar el trabajo en tres ejes

No mezclar en una sola etiqueta cosas que pertenecen a ejes distintos.

Cada cambio debe clasificarse en:

- `Layer`
- `Runtime scope`
- `Owner`

Solo después de eso se puede derivar un rótulo resumido como `UI only`, `Application`, `Web adapter`, etc.

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

## Taxonomía operativa

### Eje 1 — `Layer`

Usa uno dominante y opcionalmente secundarios:

- `UI`
- `Application`
- `Domain`
- `Adapter`

`Adapter` puede ser luego especializado por runtime (`web`, `desktop`, `cloud`), pero la capa sigue siendo adapter.

### Eje 2 — `Runtime scope`

Usa uno dominante y opcionalmente secundarios:

- `shared-core`
- `web`
- `desktop`
- `cloud`
- `mobile-future`

Si un cambio afecta más de un runtime, declararlo explícitamente. No esconderlo bajo “shared core” si en realidad depende de Next o Supabase.

### Eje 3 — `Owner`

Declarar un owner principal:

- `frontend`
- `backend`
- `database`
- `architecture-first`

`architecture-first` significa: antes de implementar, alguien debe fijar contrato y boundaries. No es válido “resolverlo en frontend” o “resolverlo en backend” por inercia.

---

## Heurística por layer

### `UI`

Es `UI` si:

- cambia render, layout, estados visuales o interacción local
- no redefine contratos
- no toca save path, sync, parser o adapters

### `Application`

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

### `Adapter`

Es `Adapter` si:

- conecta el core con tecnología concreta
- depende de HTTP, cookies, filesystem, IndexedDB, Supabase, Next, APIs nativas o storage específico
- implementa un contrato de servicio para un runtime concreto

#### `Adapter` + runtime `web`

Es `Adapter` con runtime `web` si:

- depende de Next
- depende de `app/api/*`
- depende de cookies SSR
- depende de Supabase browser/server clients
- resuelve infraestructura del runtime web

#### `Adapter` + runtime `desktop`

Es `Adapter` con runtime `desktop` si:

- depende de filesystem
- depende de secure local storage
- depende de APIs nativas
- resuelve write-path local desktop

#### `Adapter` + runtime `cloud`

Es `Adapter` con runtime `cloud` si:

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

Este output es **obligatorio** cuando la tarea toca desktop, shared core, runtime boundaries, save path, sync/hydration, parser/serializer, contratos de servicio o boundaries entre frontend/backend. PM lo debe poner en el brief y BUILD/REVIEW deben tratarlo como contrato operativo.

Cuando se use este skill, debe producir explícitamente algo como:

### Architectural classification

- Layer:
  - Dominant: `UI | Application | Domain | Adapter`
  - Secondary: `...`

### Runtime scope

- Current runtime affected: `shared-core | web | desktop | cloud | mobile-future`
- Target runtime affected: `shared-core | web | desktop | cloud | mobile-future`

### Ownership

- Primary owner: `frontend | backend | database | architecture-first`
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

### Boundaries

- Allowed dependencies: `...`
- Forbidden dependencies: `...`

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
- reetiquetar el problema usando `Layer`, `Runtime scope` y `Owner`
- pedir brief o issue actualizado si hace falta

### Caso 2 — El brief no trae los docs correctos

Acción:
- marcar `Context Gap`
- no resolver la arquitectura implícitamente desde implementación local

### Caso 3 — El corpus se contradice

Acción:
- emitir `Context Gap — Desktop Document Architecture` con fuentes y conducta exactas
- clasificar el hallazgo como `stale-doc`, `legacy-code`, `incomplete-brief` o `normative-conflict`
- aplicar precedencia: ADR → spec del catálogo desktop → target architecture/plan/docs de feature → código vigente como evidencia
- no “promediar” dos arquitecturas incompatibles ni asumir que el código actual gana por existir
- si ADR y spec del catálogo se contradicen entre sí, detenerse y pedir decisión humana
- si es código legacy, no expandirlo; solo modificarlo cuando el issue actual posea explícitamente su migración, rollback y evidencia

Reporte mínimo:

```text
Context Gap — Desktop Document Architecture
Source: <archivo/brief + sección o líneas>
Observed behavior: <qué afirma o hace>
Violated invariant: <invariante exacto>
Classification: stale-doc | legacy-code | incomplete-brief | normative-conflict
Required action: <corregir doc | actualizar brief | issue de migración | decisión humana>
```

---

## Relación con otros skills

- `skill-product-manager` usa este skill para decidir en qué capa vive un issue y qué docs debe citar
- `skill-frontend` lo consulta cuando el cambio deja de ser solo UI
- `skill-backend` lo consulta cuando una route o servicio cruza core/adapters
- `skill-database` lo consulta cuando schema y contrato documental empiezan a divergir

Orden correcto:

1. PM define problema y scope
2. Architecture clasifica `Layer`, `Runtime scope`, `Owner`, contracts e invariants
3. Frontend / Backend / Database implementan dentro de esos límites

---

## Regla final

Si un cambio te hace preguntar:

> “¿Esto vive en frontend, backend, database o en otra capa?”

la respuesta no es improvisar.

La respuesta es activar este skill.
