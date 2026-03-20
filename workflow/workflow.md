# Odessay — Protocolo de Comandos

Define qué hace cada comando `/wf-*`, qué contexto carga, qué output produce y qué gate debe pasar antes de continuar.

---

## `/wf-define [fase?]` — PLAN

**Objetivo:** descomponer una fase del roadmap en issues ejecutables y cargarlos en Linear.

PLAN no parte de issues existentes — parte de una fase definida en el roadmap. El output es el conjunto de issues que el agente de BUILD va a ejecutar.

**Resolución de fase:**
- Con argumento (`/wf-define fase-2`): usar la fase indicada.
- Sin argumento (`/wf-define`): leer `workflow/status.json` → tomar `active_phase` como fase a planificar. Si la fase activa ya tiene todos sus issues creados en Linear, confirmar al humano antes de continuar.

**Contexto a cargar:**
1. `workflow/status.json` — fase activa y qué está construido.
2. `workflow/define/roadmap.md` — alcance y dependencias de la fase.
3. El subconjunto estricto de documentos de `workflow/context/` citados en la línea `Referencia` de cada issue del roadmap.
4. `.agents/skills/skill-product-manager/SKILL.md` — cómo estructurar issues ejecutables, jerarquía en Linear y template de Issue Brief.

**No cargar por defecto:** skills técnicos (frontend, backend, database), testing. Solo si un issue de la fase los requiere explícitamente.

**Secuencia (Diálogo de Alineación y Ejecución):**
1. Resolver la fase (ver lógica de fallback arriba).
2. Leer `workflow/status.json` y localizar la fase en `workflow/define/roadmap.md`.
3. Actualizar `workflow/status.json` definiendo explícitamente la `active_phase` actual.
4. Buscar si existe un documento `workflow/define/dod-[fase].md` (ej. `dod-fase-1.md`) para la fase actual.
5. **Si no existe el DoD:** Pausar y co-crear el DoD iterando con el humano, basándose en el roadmap y los objetivos de experiencia.
6. **Si existe el DoD:** El agente cruza el Roadmap contra el DoD. Si hay asimetrías de alcance, el agente dialoga con el humano para **complementar** el Roadmap y/o el DoD. Nada se borra, se enriquece el contrato.
7. Una vez que ambos documentos están alineados y el humano da luz verde, proceder.
8. Leer `.agents/skills/skill-product-manager/SKILL.md`.
9. Descomponer la fase en issues atómicos. **Para cada issue, leer ÚNICAMENTE los documentos de contexto listados en su línea `Referencia:`**.
10. Redactar el Issue Brief estructurándolo según las guías de `.agents/skills/skill-product-manager/SKILL.md`. El agente DEBE inyectar como *Proof of Work/Acceptance Criteria* las pruebas rigurosas exigidas por el DoD para ese alcance.
11. Crear los issues en Linear con su brief incluido.
12. Confirmar al humano: lista de issues creados, dependencias entre ellos y orden de ejecución sugerido. Ofrecer un comando `/wf-audit` si el humano quiere revisar la calidad de los issues contra el DoD.

**Gate de salida:** todos los issues de la fase creados en Linear con su Issue Brief. Sin brief por issue no hay BUILD.

**Restricción:** no abrir ramas ni escribir código en esta etapa.

---

## `/wf-build [issue-id?]` — BUILD

**Objetivo:** implementar sobre el brief aprobado.

**Estado Linear:** `Todo` o `Backlog` (con brief) → `In Progress` al iniciar → `In Review` al dejar PR listo.

**Resolución de issue:**
- Con argumento (`/wf-build ODE-22`): usar el issue indicado.
- Sin argumento (`/wf-build`): consultar Linear → buscar issues en estado `Todo` o `Backlog` que tengan Issue Brief y pertenezcan a la fase activa en `status.json` → tomar el de mayor prioridad según orden del roadmap → confirmar al humano el issue seleccionado antes de iniciar.

**Contexto a cargar:**
1. El Issue Brief desde Linear.
2. Los skills técnicos que corresponden al área del issue (frontend, backend, database, design — consultar `workflow/docs.json`).

**No cargar por defecto:** documentos core, fundacional, flujos, páginas. Esa información debe estar sintetizada en el brief. Si falta algo crítico, es un error del brief — corregir en PLAN antes de continuar.

**Secuencia:**
1. Verificar que existe el Issue Brief en Linear.
2. Correr pre-flight: `node --version && npm run env:check && npm run ops:status:drift`.
3. Crear rama desde `main` actualizado con convención: `feat/{issue-id}-{descripcion}` o `fix/`, `docs/`, `chore/`.
4. Implementar según el brief. Commits atómicos: `tipo(scope): descripción [ISSUE-ID]`.
5. Correr gate de entrega: `npm run ops:delivery:gate` (typecheck + lint + tests).
6. Abrir PR con evidencia (output del gate).
7. Mover issue a `In Review` en Linear.
8. Dejar comentario en Linear: qué se construyó + link al PR + evidencia.

**Gate de salida:** `npm run ops:delivery:gate` en verde + PR abierto.

---

## `/wf-review [issue-id?]` — REVIEW

**Objetivo:** verificar calidad del PR y cerrar la trazabilidad del issue.

**Estado Linear:** `In Review` → `Done` (si aprobado, tras merge del humano) o `In Progress` (si rechazado).

**Resolución de issue:**
- Con argumento (`/wf-review ODE-22`): usar el issue indicado.
- Sin argumento (`/wf-review`): consultar Linear → buscar issues en estado `In Review` de la fase activa → si hay uno, tomarlo directamente. Si hay más de uno, listarlos y pedir al humano que confirme cuál revisar.

**Contexto a cargar:**
1. El Issue Brief desde Linear.
2. El diff del PR.
3. `.agents/skills/skill-code-review/SKILL.md`.

**No cargar por defecto:** documentos core, features, roadmap.

**Secuencia — si aprobado:**
1. Verificar gate: `npm run ops:delivery:gate` en verde.
2. Revisar diff contra el brief (scope, calidad, seguridad, performance).
3. Dejar comentario en Linear: resultado de revisión + confirmación de que el humano puede mergear.
4. Mover issue a `Done` solo después de que el humano confirme merge.
5. Una vez en `Done`, agregar el issue completado a la lista `built` en `workflow/status.json` especificando la fase terminada.

**Secuencia — si rechazado:**
1. Dejar comentario en Linear con hallazgos específicos que bloquean aprobación.
2. Mover issue a `In Progress`.
3. No cerrar ni eliminar el PR — mantener rama activa.

**Restricción:** no agregar alcance nuevo en REVIEW. Solo correcciones derivadas del review.

---

## `/wf-debrief [issue-id?]` — POST-ENTREGA

**Objetivo:** capturar observaciones post-entrega y convertir las relevantes en issues de mejora en Linear, sin reabrir ni modificar el issue original.

Este comando existe porque la realidad después de un merge rara vez coincide exactamente con lo planeado. No es un error de planificación — es información nueva que emerge al ver el producto funcionando. La política es: **la entrega se acepta como está**. Lo que no quedó perfecto se captura aquí y entra al ciclo normal de BUILD.

**Resolución de issue:**
- Con argumento (`/wf-debrief ODE-22`): trabajar sobre ese issue específico.
- Sin argumento (`/wf-debrief`): consultar Linear → tomar el issue más recientemente movido a `Done` en la fase activa.

**Contexto a cargar:**
1. El issue original desde Linear (brief + comentarios de BUILD y REVIEW).
2. `workflow/define/debrief.md` — sección de la fase activa, para agregar entradas y consultar el historial.

**No cargar por defecto:** documentos core, features, skills técnicos. Si una observación requiere validar comportamiento esperado, consultar el doc de feature correspondiente usando `workflow/docs.json`.

**Secuencia:**
1. Resolver el issue de referencia (ver fallback arriba).
2. Leer el issue original en Linear: brief, comentarios de BUILD, comentarios de REVIEW.
3. Por cada observación del humano o hallazgo propio: crear una entrada en `workflow/define/debrief.md` bajo la sección de la fase activa, con ID estable (`IMP-YYYY-MM-DD-NN`), descripción, tipo y prioridad sugerida.
4. Clasificar cada entrada por tipo: `bug` / `mejora` / `ux-friction` / `deuda-tecnica`.
5. Clasificar cada entrada por prioridad sugerida: `next-sprint` / `backlog` / `won't-do`.
6. Presentar al humano el resumen de entradas capturadas y proponer cuáles crear como issues en Linear.
7. Para las que el humano aprueba: crear el issue en Linear con el tipo correcto (Bug, Improvement, etc.), referencia al issue original y un brief mínimo.
8. Dejar comentario en el issue original de Linear enlazando los nuevos issues creados.

**Gate de salida:** entradas en `workflow/define/debrief.md` + issues aprobados creados en Linear.

**Restricción:** no modificar el scope ni reabrir el issue original. No cambiar código en esta etapa.

---

## `/wf-update-docs` — MANTENIMIENTO DE DOCS

**Objetivo:** mantener `workflow/docs.json` sincronizado con el estado real del disco.

**Dos modos de uso:**

**Modo puntual (tras una tarea):** si la tarea creó, movió o eliminó un documento, actualizar solo esa entrada en `docs.json`. No releer todo el disco.

**Modo profundo (mantenimiento explícito):** cuando se invoca `/wf-update-docs` directamente.

**Secuencia modo profundo:**
1. Listar todos los archivos en `workflow/` y `.agents/skills/` que sean documentos de contexto (`.md`, `.json` relevantes).
2. Comparar contra el `registry` en `workflow/docs.json`.
3. Para cada archivo en disco que no está en el registry: agregar entrada con `path`, `type` y `description` basada en el contenido real del archivo.
4. Para cada entrada en el registry que no existe en disco: eliminar la entrada.
5. Para archivos que existen en ambos pero cuya descripción está desactualizada respecto al contenido: actualizar solo la descripción afectada.
6. No tocar entradas que no tienen cambios.

**Restricción:** no leer todos los documentos por defecto — leer solo los que tienen discrepancia entre descripción en `docs.json` y su contenido real.

---

## `/wf-decision` — GESTIÓN DE DECISIONES

**Objetivo:** registrar formalmente una decisión técnica o de arquitectura en el historial canónico.

**Resolución de issue:**
- Se ejecuta sin argumentos adicionales: `/wf-decision`.

**Contexto a cargar:**
1. El issue actual y la discusión en Linear.
2. `workflow/decisions.json`.
3. El documento en `workflow/context/` más afín al dominio de la decisión (consultar `workflow/docs.json`).

**Secuencia:**
1. Extraer la decisión tomada, el contexto y a qué documento afecta.
2. Identificar si es una decisión global (para todo el proyecto) o de fase activa (solo para el ciclo actual).
3. Actualizar `workflow/decisions.json` añadiendo la decisión en el bloque correspondiente con su respectiva referencia documental.
4. Si la decisión modifica algo sustancial, sugerir en la respuesta actualizar el documento de contexto relacionado.
5. Imprimir al humano el registro actualizado para confirmar.

**Gate de salida:** JSON actualizado en `workflow/decisions.json`.

---

## Frontera humano / agente

Algunos issues requieren acciones que el agente no puede completar solo — credenciales, configuración de servicios externos, decisiones de negocio. Cuando un issue tiene esta dependencia, debe declararla explícitamente en el Issue Brief bajo una sección `Dependencias humanas`.

**El agente no bloquea silenciosamente.** Cuando encuentra una dependencia humana, emite el protocolo de handoff y pausa.

**Siempre hace el humano:**
- Aprobar y mergear PRs a `main`.
- Asignar issues en Linear.
- Proveer credenciales, variables de entorno y accesos externos.
- Aprobar qué entradas de `/wf-debrief` se convierten en issues.

**Siempre hace el agente:**
- Ejecutar la secuencia `/wf-*` respetando los gates.
- Mover estados en Linear según este documento.
- Actualizar `workflow/status.json` estableciendo la fase en PLAN y agregando los issues completados a `built` al pasar a `Done` en REVIEW.
- Dejar comentario de trazabilidad en Linear al cerrar cada etapa.

## Protocolo de handoff (bloqueo externo)

Cuando el agente encuentra una dependencia humana y no puede continuar:

```
⏸ HANDOFF REQUERIDO

Etapa actual: [PLAN|BUILD|REVIEW]
Bloquea: [qué no puede avanzar]
Completé: [trabajo ya realizado]
Necesito que tú: [acción concreta y específica]
Evidencia esperada: [qué debe compartir el humano para reanudar]
Reanudación: [acción exacta que hará el agente al recibir evidencia]
```

Durante un handoff en BUILD, el issue permanece en `In Progress`. No mover a `In Review` mientras exista handoff pendiente.
