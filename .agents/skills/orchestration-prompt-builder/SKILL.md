---
name: orchestration-prompt-builder
description: Orchestration Prompt Builder. Dado un conjunto de issues, escribe el prompt /orchestration COMPLETO que ejecuta el coordinador de Orca (orchestration-v<N>.md + delta), con DAG por PR y olas, roles y modelos comprobados, gates humanos, reglas de BUILD/REVIEW, cierre y ledger, control de tiempo y paradas. No es el skill "orchestration" de Orca (ese ejecuta el prompt), y no se limita a escribir specs de worker.
---

# Orchestration Prompt Builder

## Contrato de salida (leer primero)

**Terminado** = existe `orchestration-v<N>.md`:
- con **todas** las secciones de `specialties/prompt-template.md`, en ese orden;
- autosuficiente, porque el coordinador no estuvo en ninguna conversación;
- con su delta `orchestration-v<N>-delta.md`;
- con la autocomprobación de § 5 pasada.

**No es terminado:**
- **Specs de worker sueltos** ("Target / Change / Constraints / Ownership / Observable acceptance"). Son una pieza que va **dentro** del prompt, en la plantilla de spec. Sin el DAG, los roles, el cierre, el ledger, los gates, el tiempo y las paradas, el coordinador no tiene con qué orquestar.
- **Cargar el skill `orchestration` de Orca** (`orca skills get orchestration`). Ese skill lo usa el coordinador para **ejecutar** el prompt; este skill **lo escribe**.
- **Crear un Run o lanzar workers.** Este skill solo escribe el prompt; lanzarlo es del humano.

## 1. Objetivo

Dado un conjunto de issues, producir **el prompt que el coordinador de Orca ejecuta** con `/orchestration`: un plan completo y autosuficiente para que workers construyan y revisen cada issue, en paralelo donde se puede y en serie donde hace falta, sin que la orquestación se frene por algo que se podía ver antes.

Pregunta guía: **¿Qué necesita saber un coordinador que no estuvo en ninguna conversación para llevar esta tanda de "brief listo" a "PR mergeado, ledger al día e issue en Done", sin preguntar nada que no sea una decisión humana?**

El prompt es el único contexto del coordinador y, a través de él, de cada worker. Lo que el prompt no dice, el coordinador no lo sabe. Por eso cada regla del prompt existe por un incidente concreto (`specialties/lessons.md`), y **ningún detalle es decorativo**.

## 2. Ámbito y activación

**Aplica** cuando el humano entrega una lista de issues para orquestar en Orca, o pide la siguiente tanda de un proyecto.

**No aplica:**
- a un solo issue que un agente construye en la conversación (eso es `/wf-build`);
- a la planificación de una fase (eso es `/wf-define` con `skill-planning`);
- a preguntas sobre el estado de una orquestación en curso.

**Quién lo usa:** el planner (Claude Code). El prompt resultante lo ejecuta el coordinador de Orca.

## 3. Entradas y fuentes de autoridad

**Del humano:**
- los IDs de los issues de la tanda;
- opcionalmente: el nombre de la tanda, el prompt anterior a tomar como base y restricciones (fecha, herramientas no disponibles).

**Del tracker y del repo**, verificadas, no recordadas:
- el brief de cada issue, sus comentarios (`## Recon Pack`, `## Decisiones`, "— ajuste") y su sección "Auditoría";
- las relaciones entre issues (blocks / blocked by);
- el commit actual de `main` y los PRs abiertos que la tanda necesita mergeados;
- el estado de la orquestación anterior (Run cerrado, sin dispatches vivos).

**Precedencia** cuando dos fuentes chocan:
1. las decisiones del humano (un "— ajuste" manda sobre la decisión original);
2. la Auditoría;
3. el Recon Pack;
4. el brief.

Si el choque cambia el alcance, no se resuelve en el prompt: es una pregunta al humano antes de entregar.

**Del propio skill:**
- `specialties/prompt-template.md`: estructura y bloques fijos del prompt;
- `specialties/dag-and-waves.md`: grafo, olas, merges y gates;
- `specialties/roles-and-models.md`: herramientas, modelos, lanzamiento y fallback;
- `specialties/lessons.md`: el porqué de cada regla;
- la especialidad local del proyecto (en Odessay, `specialties/odessay-binding.md`).

## 4. Método y criterios

1. **Ingesta y verificación.** Leer cada issue en el tracker correcto. Confirmar que existe, en qué estado y en qué proyecto está. Anotar el commit de `main`. Un issue que no existe, está en otro equipo o ya está Done se reporta antes de seguir.
2. **Precondiciones.** Listar lo que debe estar cerrado antes de arrancar: la orquestación anterior, los PRs de los que depende la tanda y los checks mecánicos que el prompt va a invocar (que existan en `main`). Cada una con el comando que la verifica.
3. **Preparación: Recon y decisiones.** Ningún issue entra al plan sin el Recon de área en modo completo (`skill-planning/specialties/area-recon.md`): Recon Pack, Auditoría, contrato completo, decisiones con default y PR del mapa.
   - Si falta, se hace **antes** de escribir el prompt (lo preferido: así el prompt arranca en la fase 0R), o se incluye como fase 0 del prompt.
   - Las decisiones pendientes se le presentan al humano en **una sola pregunta** (fase H). El prompt no despacha un issue sin el comentario `## Decisiones`.
   - Gate mecánico: el lint de briefs con **contrato y Recon exigidos** debe pasar para todos.
4. **Grafo y olas.** Construir el DAG con `specialties/dag-and-waves.md`:
   - nodos (un nodo por PR, no por issue);
   - aristas duras (dependencias reales, archivos compartidos, gates);
   - olas;
   - concurrencia máxima;
   - orden de merge preferente;
   - prioridad al llenar huecos.
5. **Roles y modelos.** Elegirlos con `specialties/roles-and-models.md`, **comprobando la configuración actual** de cada herramienta (modelo, esfuerzo, permisos) en vez de copiarla del prompt anterior. Garantizar la independencia entre quien construye y quien revisa.
6. **Gates humanos y paradas.** Convertir cada tarea humana de la Auditoría en un gate con momento, mensaje exacto y verificación posterior. Fijar las paradas obligatorias.
7. **Notas por issue.** De cada pack, Auditoría y decisiones, extraer solo lo que el worker necesita para no equivocarse: owner, qué reutilizar, el test y su punto de entrada, la mutación, las trampas, los commits esperados y el estado de fila esperado. Dejar escrito que mandan la Auditoría y las Decisiones.
8. **Ensamblar** con `specialties/prompt-template.md`: bloques fijos (BUILD, REVIEW, coordinador, tiempo, reportes, paradas) más los bloques de la tanda.
9. **Autocomprobación.** Recorrer la lista de § 5 sobre el prompt escrito. Lo que no pasa se corrige antes de entregar.
10. **Entrega.** Escribir el prompt versionado y su delta respecto del anterior, guardarlos, y explicar al humano cómo lanzarlo y qué gates le van a llegar.

**Criterios:**
- Paralelo donde no hay conflicto, serie donde lo hay. Los merges siempre de uno en uno.
- Una regla sin incidente que la justifique no entra. Una lección registrada no se pierde al pasar de versión.
- El prompt dice qué hacer y cómo verificarlo. Nunca deja una decisión de producto al coordinador.

## 5. Resultado y evidencia

**Entregables:**
- `orchestration-v<N>.md`, el prompt completo y autosuficiente, en la carpeta de trabajo local que defina el proyecto;
- `orchestration-v<N>-delta.md`: qué cambia respecto de la versión anterior y por qué, con el incidente que motiva cada cambio;
- una copia en el archivo de prompts del proyecto, si existe;
- un mensaje al humano con: la tabla del DAG, los gates que le llegarán y en qué momento, las precondiciones pendientes y cómo lanzarlo.

**Autocomprobación del prompt, obligatoria antes de entregar:**
- [ ] Cada issue de la tanda aparece en el DAG, y nada fuera de la tanda.
- [ ] Cada nodo tiene sus dependencias, ola y tamaño. No hay ciclos. Ningún nodo depende de una rama sin mergear.
- [ ] Las precondiciones tienen su comando de verificación.
- [ ] El gate de lint exige **contrato y Recon** (no solo Recon).
- [ ] Roles: cada rol tiene 1.ª opción y fallback, y nadie revisa lo que construyó. Los detalles de lanzamiento de cada herramienta coinciden con su configuración actual.
- [ ] Cada tarea humana es un gate con mensaje exacto, momento y verificación.
- [ ] Las reglas de cierre están completas: cerrar primero, ledger fuera del checkout principal, una fila por PR, notas de entrega parcial, asunto de los rechazos y estado del tracker en entregas parciales.
- [ ] Están el control de tiempo, el formato de reporte y las paradas obligatorias.
- [ ] Los recordatorios del orquestador van en cada spec de worker.
- [ ] Cada lección vigente de `specialties/lessons.md` tiene su regla en el prompt, o una razón escrita para omitirla.
- [ ] El delta explica cada cambio con su incidente.

## 6. Manejo de fallos e incertidumbre

- **Un issue sin Recon, sin contrato o con decisiones pendientes** no entra al DAG hasta resolverse. Se reporta con qué le falta.
- **Una dependencia ambigua** (dos issues que tocan el mismo archivo sin orden claro) se resuelve con el grafo de conflictos del mapa. Si el mapa no la cubre, se trata como conflicto y se serializa.
- **Una herramienta no disponible**, o con una configuración que cambió, cambia los roles; no se copia la tabla anterior a ciegas.
- **Un choque entre fuentes que cambia el alcance** se pregunta al humano antes de entregar el prompt.
- Si el humano pide algo que una lección prohíbe (por ejemplo, que el builder mergee), se explica la lección y se pide confirmación explícita antes de quitar la regla.

## 7. Relaciones y ownership

- **`skill-planning`** produce los briefs. Su especialidad `area-recon.md` hace el Recon y la Auditoría, que son la entrada de este skill. **Este skill no investiga el código:** consume el Recon. Si el Recon falta, lo pide o lo incluye como fase 0.
- **`skill-code-review`** define cómo se revisa un PR y un Recon (fase 0R). El prompt la invoca, no la repite.
- **`workflow/workflow.md`** es dueño de `/wf-build` y `/wf-review`. El prompt los invoca y solo declara los overrides de Orca (por ejemplo, que el reviewer mergea).
- **El coordinador de Orca** ejecuta el prompt. Las reglas para él van en el bloque "Coordinador".

## 8. Recursos asociados

- [specialties/prompt-template.md](specialties/prompt-template.md): esqueleto del prompt, bloques fijos y plantillas de spec de worker (build y review).
- [specialties/dag-and-waves.md](specialties/dag-and-waves.md): cómo construir el DAG, las olas, el orden de merge y los gates.
- [specialties/roles-and-models.md](specialties/roles-and-models.md): roles, modelos, lanzamiento en Orca, fallback e independencia.
- [specialties/lessons.md](specialties/lessons.md): catálogo de lecciones (incidente → regla) de cada versión del prompt. Leerlo entero antes de escribir.
- [specialties/odessay-binding.md](specialties/odessay-binding.md): hechos del proyecto Odessay (repo, tracker, CLI, checks, ledger, Supabase local, producción, carpetas).
- `skill-planning/specialties/area-recon.md`: Recon de área y Auditoría, el insumo de este skill.
