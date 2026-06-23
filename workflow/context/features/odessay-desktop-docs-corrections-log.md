# ODESSAY — Desktop Docs Corrections Log

**Log de consolidación documental posterior a revisión adversarial.**

Este documento registra correcciones aplicadas al corpus para reducir contradicciones entre:

- runtime web actual
- capa cloud/remota actual
- dirección desktop/multi-runtime

No redefine arquitectura. Funciona como trazabilidad de cambios documentales y de skills.

**Estado:** documento histórico. No forma parte de la secuencia normativa `odessay-desktop-*` que PM, BUILD y REVIEW deben cargar para decisiones de arquitectura.

---

## Objetivo de esta consolidación

Después de la revisión adversarial se identificó que el corpus seguía enseñando dos arquitecturas incompatibles:

- una web/cloud-first basada en `body_json`, `localDB` y Supabase como verdad universal
- una desktop/multi-runtime basada en `.md`, filesystem y core compartido

La meta de esta corrección es bajar esa contradicción haciendo tres cosas:

1. marcar explícitamente qué documentos describen **estado actual web/cloud**
2. marcar qué documentos gobiernan la **dirección desktop**
3. enseñar esa distinción a workflow y skills

---

## Correcciones aplicadas

### 2026-05-26 — Modelo de datos

Archivo:

- `workflow/context/core/odessay-modelo-datos.md`

Corrección:

- el documento ahora se presenta explícitamente como modelo de datos remoto/cloud y estado actual del runtime web
- `body_json` deja de presentarse como verdad universal del producto
- se aclara que desktop converge a `.md` como documento canónico

Motivo:

- evitar que schema remoto y contrato documental se confundan

### 2026-05-26 — Editor

Archivo:

- `workflow/context/features/odessay-editor.md`

Corrección:

- se introduce framing explícito de runtime actual vs dirección desktop
- el modo source y el reparse a `body_json` se relabelan como comportamiento del runtime web actual

Motivo:

- evitar que el editor dicte por sí solo la verdad persistida del producto

### 2026-05-26 — ProseMirror / TipTap backbone

Archivo:

- `workflow/context/features/odessay-prosemirror-tiptap.md`

Corrección:

- `body_json` queda descrito como persistencia web/cloud actual, no como verdad universal
- la sección de persistencia ya distingue runtime actual y dirección desktop

Motivo:

- evitar que el backbone rico invalide la estrategia documental desktop

### 2026-05-26 — Sync

Archivo:

- `workflow/context/features/odessay-sync.md`

Corrección:

- el documento pasa a declararse principalmente como spec del runtime web actual
- la sección desktop deja de afirmar SQLite/localDB como write-path canónico
- se explicita que el contrato de sync descrito es el del runtime web actual

Motivo:

- evitar que sync siga enseñando desktop como simple adaptación de la web

### 2026-05-26 — Decisiones globales

Archivo:

- `workflow/decisions.json`

Corrección:

- se reemplaza la decisión absoluta “body_json como fuente de verdad” por una formulación por runtime
- se matiza IndexedDB como decisión del runtime web actual

Motivo:

- evitar que una decisión global antigua anule toda la secuencia desktop

### 2026-05-26 — Roadmap

Archivo:

- `workflow/define/roadmap.md`

Corrección:

- se agrega framing explícito para que el roadmap se lea junto a la secuencia desktop en temas de runtime/portabilidad
- Fase 0 se aclara como base del runtime web actual
- Fase 7 deja de describirse como “empaquetar la web y reemplazar IndexedDB por SQLite”

Motivo:

- reducir el sesgo web-first en `/wf-define`

### 2026-05-26 — Workflow BUILD

Archivo:

- `workflow/workflow.md`

Corrección:

- se agrega una excepción explícita de `Context Gap` bloqueante si un brief de desktop/shared core/runtime no cita la secuencia desktop

Motivo:

- evitar que `/wf-build` ejecute briefs desalineados con la arquitectura nueva

### 2026-05-26 — Skills técnicos

Archivos:

- `.agents/skills/skill-frontend/SKILL.md`
- `.agents/skills/skill-backend/SKILL.md`
- `.agents/skills/skill-database/SKILL.md`
- `.agents/skills/skill-product-manager/SKILL.md`

Corrección:

- frontend, backend y database ahora cargan también el diagnóstico en temas de arquitectura/save/sync/parser
- frontend deja de afirmar de forma universal que Markdown nunca es modelo persistido
- PM deja de usar un ejemplo de DoD que canonizaba `body_json en Supabase` como cierre universal

Motivo:

- alinear el comportamiento de los agentes con la secuencia desktop

### 2026-05-26 — Inventario canónico

Archivo:

- `workflow/docs.json`

Corrección:

- se reescriben descripciones para diferenciar:
  - arquitectura vigente / runtime web actual
  - modelo cloud/remoto actual
  - estrategia desktop/multi-runtime

Motivo:

- mejorar la jerarquía de descubrimiento desde `workflow/docs.json`

### 2026-06-16 — Ronda 2: cierre de la polaridad (ADR de identidad)

Contexto:

- la consolidación de 2026-05-26 reemplazó "body_json como verdad universal" por una **formulación por runtime**, pero solo en core (`arquitectura`, `modelo-datos`, `stack`, `editor`, `prosemirror-tiptap`). **No se propagó** a la capa de anotaciones/márgenes/correspondencias, que seguían afirmando `body_json`/`body_text` como fuente de verdad. La polaridad quedó viva, ahora ubicada en esa capa.

Resolución:

- se crea `workflow/context/core/odessay-adr-identidad.md` como **fuente de verdad de la arquitectura de documento**. El ADR **cierra** la polaridad (ya no "por runtime aplazado"): `.md` canónico, `body_json` derivado, metadata en la nube (no en frontmatter), una sola identidad (UUID de cliente = UUID de nube), binding por ruta+inode+content_hash.

Archivos reconciliados en esta ronda:

- `features/odessay-anotaciones-ai.md`, `features/odessay-margenes.md`, `features/odessay-correspondencias.md`, `features/odessay-fase4-runtime-contract-audit.md`, `core/odessay-modelo-datos.md` (índice de anotaciones) → `body_json`/`body_text` dejan de ser verdad; modelo D3.
- `features/odessay-workspace.md` → `.odyssey` → `.odessay` (typo de marca).
- `core/odessay-watched-folders.md` → metadata a la nube (no `meta.json` en disco); `content_hash` marcado como pendiente.
- los cuatro `odessay-desktop-*` y los skills `architecture/backend/database` → referencian el ADR.

Motivo:

- terminar lo que la ronda 1 dejó a medias y darle un dueño (el ADR) a la decisión que ningún skill estaba facultado para tomar.

---

### 2026-06-23 — Runtime alineado con D4: frontmatter siempre es contenido

Corrección:

- se eliminó `parseCanonicalFrontmatter` del runtime; Odessay ya no clasifica ningún bloque YAML como metadata propia.
- todo frontmatter entra al editor como contenido y round-trippea intacto, incluso si contiene solo las claves históricas `id/slug/status/visibility/version/created_at/updated_at`.

Motivo:

- D4 establece trato uniforme para todos los archivos: el `.md` nunca es un casillero de metadata de Odessay. La clasificación legacy podía descartar datos al abrir y guardar.

---

## Pendientes reconocidos

Esta consolidación reduce contradicciones, pero no convierte automáticamente todo el corpus en una arquitectura desktop resuelta.

Pendientes estructurales todavía abiertos:

- recortar más `odessay-desktop-app.md` si se quiere una separación todavía más estricta entre dirección, diagnóstico, target y plan
- revisar otros skills o docs secundarios que aún usen lenguaje demasiado web-first
- traducir esta consolidación documental en la primera fase de implementación (`DocumentService`)

---

## Relación con la secuencia desktop

Este log acompaña la secuencia, pero no la reemplaza:

1. `workflow/context/features/odessay-desktop-app.md`
2. `workflow/context/features/odessay-desktop-migration-diagnostic.md`
3. `workflow/context/features/odessay-desktop-target-architecture.md`
4. `workflow/context/features/odessay-desktop-migration-plan.md`

Su función es dejar trazabilidad de qué se corrigió en el corpus y por qué.
