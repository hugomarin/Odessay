# Plan de trabajo — Correcciones y refinamiento de contexto

> **Alcance:** reconciliar el corpus de **documentación** (context, specs, skills, memorias) con `workflow/context/core/odessay-adr-identidad.md`. **No** es el plan de implementación de código — ese es el plan de fases aparte. Donde un doc contradice al código, se **marca** para que el plan de fases lo recoja; aquí no se toca código (salvo el rename de marca `.odyssey`→`.odessay`, que en docs es texto).

## Inventario del contexto a corregir

### Grupo A — Núcleo de la polaridad (frontera que la ronda 1 del corrections-log dejó sin tocar)
- `features/odessay-anotaciones-ai.md` — quitar "body_json es la fuente de verdad" / "body_text nunca"; modelo D3 (`==highlight==`+marcador+id; payload en nube).
- `features/odessay-margenes.md` — anchors derivados del span highlight; estado durable (`resolved/shared`) por id estable; `body_json` deja de ser verdad del contenido anotado.
- `features/odessay-correspondencias.md` — `body_text` es derivado, no "fuente de verdad para anclajes".
- `features/odessay-fase4-runtime-contract-audit.md` — alinear el contrato de anotaciones a D1/D3.
- `core/odessay-modelo-datos.md` (índice `margins`) — `margins` = payload de nube keyed por el id estable inline; nota de `content_hash` (D11).

### Grupo B — Marca partida
- `features/odessay-workspace.md` — `.odyssey` → `.odessay` (D8).
- *(código, va al plan de fases)* `workspace.rs`, `tauri-fs-watch.ts` + migración de carpetas.

### Grupo C — Spec de Workspace
- `core/odessay-watched-folders.md` — metadata a la nube (no `meta.json` en disco, D4); `content_hash` marcado pendiente (D11, hoy el código solo tiene inode+size); referenciar el ADR.

### Grupo D — Comportamiento no documentado
- Documentar el **repliegue de `rehome`** (D7) en el doc de desktop correspondiente (hoy ausente de todo doc, contradice el spec).

### Grupo E — Gobernanza / referencias al ADR
- Los 4 `odessay-desktop-*` (app, migration-diagnostic, target-architecture, migration-plan) → referenciar el ADR.
- Core ya-corregidos (`arquitectura`, `modelo-datos`, `stack`, `editor`, `prosemirror-tiptap`) → **no** re-arreglar la polaridad; solo agregar ref al ADR + D4 (metadata en nube) + D11 (hash).

### Grupo F — Skills
- `skill-database` (doctrina "ahora vs dirección" → D10), `skill-backend` (regla blanda → dura), `skill-architecture` (agregar ADR como la resolución).
- `skill-product-manager` → **workstream aparte** (reforma del molde, no reconciliación de contenido).

### Grupo G — Memorias
- `project_studio_mirrors_editor_session.md` → borrar/revisar al redefinir Studio.

## Reglas de la pasada
1. No re-arreglar lo que la ronda 1 ya corrigió; en core solo agregar ref-ADR + D4/D11.
2. Todo doc editado referencia el ADR.
3. Distinguir spec de implementado (`content_hash`, sidecar, atomic save = objetivo; frontmatter, `.odyssey`, rehome = estado actual del código).
4. Consistencia ≠ corrección: validar contra el ADR/la intención, no contra "así estaba".
5. No tocar código en esta campaña; marcar divergencias doc↔código para el plan de fases.

## Definición de "hecho" (auditable)
- Ningún doc afirma "body_json/body_text es la fuente de verdad del contenido anotado/anclajes".
- Ningún doc-contrato **enseña** `.odyssey` como el nombre correcto de la carpeta de marca (el normativo `odessay-workspace.md` quedó corregido; `watched-folders.md` dice explícitamente "no `.odyssey`"). Las menciones legítimas que **deben** subsistir: el ADR documentando el rename (D8), este plan, el corrections-log (registro histórico) y el filename del mockup `editor-tabs-odyssey-mockup.html`. El rename de `.odyssey` en **código** + carpetas reales es trabajo del plan de fases, no de esta pasada de docs.
- `odessay-watched-folders.md` dice "metadata en la nube" y marca `content_hash` pendiente.
- Cada `odessay-desktop-*` y los skills de F referencian el ADR.
- El repliegue de `rehome` está documentado.

## Pendiente runtime (no estático)
- Conteo real de ids en conflicto frontmatter↔índice de workspace (requiere script).

## Gap descubierto durante ODE-331
El estado de sesión del editor (pestañas activas, `recent_writings`) es una **capa de cache/UI** separada del documento. La documentación de desktop/sync no trataba explícitamente la reconciliación de esa cache cuando un `writing_id` de sesión deja de tener `LocalWriting` o `canonical_path`. Se agregaron notas en `odessay-sync.md`, `odessay-desktop-migration-diagnostic.md` y `odessay-desktop-migration-plan.md` para que futuros BUILD no reintroduzcan el error de tratar un UUID de sesión como ruta de filesystem.
