# Recon de área

Especialidad de Planning. Investiga **una vez** el código de un área que van a tocar varios issues y deja todo listo para despachar. El builder después **valida** el pack (`architecture-recon`, modo validación) en vez de volver a explorar.

## Un proceso, dos usos

Es **un solo proceso**: workers que leen el código en profundidad, en solo lectura y con evidencia. La misma lectura sirve para **dos usos**, y cada uno deja algo para un lector distinto.

### El núcleo, que no se negocia en ningún modo

Por cada issue, los workers leen el código actual y responden dos preguntas:

1. **¿Cómo se construye bien?** El owner correcto (no el archivo más cercano ni el hotspot), qué reutilizar, qué no crear, el diseño más simple, qué invariantes preservar y cómo probarlo.
2. **Si se construye tal como está escrito, ¿qué se rompe, a quién afecta y qué nos frena?** Se siguen los consumidores, la sync, las APIs y sus reintentos, los datos, los permisos y producción. La mirada es **adversarial**: se busca lo que falla, no la confirmación del brief.

Reglas del núcleo:
- cada afirmación lleva evidencia (`archivo:líneas`) del commit declarado;
- se resuelve desde el código todo lo que se pueda; **solo se escala lo que el código no contesta**;
- nunca es un resumen de un Recon anterior: si se repite, se vuelve a leer el código y se corrige el pack si estaba mal.

Lo que esta lectura encontró en la tanda 3 del milestone 4 no salía de un mapa de construcción:
- el 404 que pedía ODE-660 habría roto la sync;
- un quinto punto de fuga en ODE-616;
- un filtro que habría escondido documentos públicos con invitación;
- un diseño más simple para ODE-657.

### Los dos usos

| | **Construir** | **Despachar** |
|---|---|---|
| Para quién | El builder | El humano y el coordinador |
| Lista de huecos (§ 2) | C1–C6: calidad del código | 1–9: lo que puede frenar la orquestación |
| Qué deja (§ 3) | Recon Pack con "Construir con", y el PR del mapa con el grafo de conflictos y las olas | Sección "Auditoría", decisiones con default, tareas humanas y el reporte de § 4 |
| Se verifica con | La fase 0R, por hechos | La respuesta del humano: comentario `## Decisiones` |

Un Recon que solo cubre "Despachar" deja al builder sin diseño: lo decide solo y tiende a crear piezas nuevas en vez de reutilizar. Uno que solo cubre "Construir" deja la orquestación expuesta a paradas que se podían ver antes.

### Modos de ejecución

- **Completo (por defecto, para una tanda que va a orquestarse):** una sola pasada; cada worker aplica las dos listas a su cluster. Así se hizo en la tanda 3 ("Recon+audit").
- **Solo construir:** uno o pocos issues que no van a orquestarse.
- **Solo despachar ("ronda N"):** cuando `main` avanzó o justo antes de lanzar. **Es igual de profundo**: vuelve a leer el código, corrige el pack y actualiza la auditoría. Es lo que `/wf-audit` hace sobre una tanda (`skill-audit-planning`).

## Cuándo aplica, y cuándo no

- **Aplica** cuando varios issues comparten un área de código, o cuando una tanda va a orquestarse.
- **No aplica** a una pregunta puntual ("¿qué podría romper la opción B?"). Eso es un **análisis**: la respuesta queda en el chat y, si sirve, como comentario en el issue. Sin PR.

**Quién lo hace:** el planner (Claude Code, o un worker con ese rol). Nunca el builder. Antes de construir, el mapa lo verifica **otro agente** (fase 0R, § 5).

## 1. Método

1. Declarar el commit de `main` contra el que se verifica. Si `main` avanza durante el Recon, revalidar contra el commit nuevo.
2. Partir la tanda en **clusters**: issues que comparten owner o archivos.
3. Lanzar **un worker por cluster, en paralelo y en solo lectura**: sin tocar Linear ni el repo. Cada worker:
   - usa el método de `.agents/skills/architecture-recon/SKILL.md` (buscar por símbolo y rango, no paginar hotspots);
   - aplica el núcleo y recorre, por cada issue, las listas de huecos (§ 2) de los usos del modo elegido; en modo completo, las dos;
   - **resuelve desde el código** todo lo que pueda, con evidencia (`archivo:líneas`);
   - **escala solo lo que el código no contesta.**
4. El planner consolida: escribe en Linear, abre el PR del mapa y entrega el reporte (§ 3 y § 4).

## 2. Lista de huecos

**Uso "Construir": calidad del código:**

| # | Hueco | Qué buscar | Dónde termina |
|---|---|---|---|
| C1 | **Owner** | Dónde debe vivir el cambio según el contrato, y si el brief apunta a un hotspot o a un archivo que no es el owner | Recon Pack, campo "Qué cambiar" |
| C2 | **Reutilización** | La API, el helper, el hook o el doble del harness que ya cubre el caso; el sibling cuya **forma** seguir si hace falta una pieza nueva | Recon Pack, campo "Construir con" |
| C3 | **Duplicación** | Una segunda implementación que el brief, tal como está, obligaría a crear | Recon Pack, campo "Construir con" (qué **no** crear) |
| C4 | **Diseño más simple** | Si el código permite una solución más simple que la del brief, con menos piezas o sin estado nuevo | Corrección en "Auditoría"; si cambia el alcance, decisión humana |
| C5 | **Invariantes y orden** | Lo que el cambio no puede romper: orden de efectos, refs en callbacks de larga vida, identidad, escritores únicos | Recon Pack, campo "Trampas" |
| C6 | **Cómo probarlo** | Test canónico a extender, punto de entrada de producción, helpers del harness, la mutación que discrimina el bug | Recon Pack, campo "Dónde probar" |

**Uso "Despachar": lo que puede frenar la orquestación:**

| # | Hueco | Qué buscar | Dónde termina |
|---|---|---|---|
| 1 | **Contrato** | `Architecture Contract` con sus 6 campos (todo Capability Proof lo activa) y `Reference docs` con contenido | Se completa en el brief |
| 2 | **Brief contra código** | Un símbolo, owner o flujo distinto del que dice el brief; un alcance que rompería algo (p. ej., un 404 que rompía la sync en ODE-660) | Corrección en la sección "Auditoría" |
| 3 | **Seguridad o pérdida de datos** | Fugas, accesos indebidos, sobrescrituras silenciosas | Hallazgo; si cambia el alcance, decisión humana |
| 4 | **Contrato externo** | API, sync, RPC o migración que el cambio rompería | Decisión humana con default |
| 5 | **Conflictos entre issues** | Archivos compartidos: owner de producción, doble del harness, fixture o test. **No cuentan** el mapa de capabilities, el catálogo de harnesses ni los ledgers | Grafo de conflictos y olas |
| 6 | **Requisitos operativos** | Permisos del agente, Docker, Supabase local, workspace de Linear correcto, secretos, producción | Tarea humana |
| 7 | **Momento de cada tarea humana** | Antes de arrancar, en la ola N, antes o después del merge de X | Tarea humana, agrupada por momento |
| 8 | **Trampas para el builder** | Timing de tests, harness, orden de efectos, dobles que copian código | Recon Pack, campo "Trampas" |
| 9 | **Seguimientos** | Problemas reales fuera del alcance de la tanda | Se anotan, **no se crean** issues |

## 3. Qué deja (definición de hecho)

En modo completo, todo lo de abajo. En "Solo construir", el Recon Pack, el contrato y el PR del mapa. En "Solo despachar", la auditoría, las decisiones, el lint y el reporte, más las correcciones al pack si las hubo.

**En Linear, por issue:**
- el comentario `## Recon Pack (verificado en main@<sha>)`, con el formato de `issue-brief-schema.md` § Recon Pack, **incluido "Construir con"** (qué reutilizar, qué patrón seguir, qué no crear);
- una sección **"Auditoría (<fecha>)"** en la descripción: correcciones al brief con líneas y hallazgos ya resueltos;
- `Architecture Contract` y `Reference docs` completos en la descripción;
- cada decisión pendiente escrita como **"Default, pendiente de confirmar por <humano>"**.

**En el repo:** un **PR de docs, abierto y sin mergear**:
- el mapa del área en su documento existente (diagnóstico, catálogo de harnesses…), con el commit verificado;
- el grafo de conflictos y las olas propuestas;
- el comando de recuento, si aplica.

Reglas del PR: solo docs, label `process` y **ningún `ODE-###` en el asunto de los commits** (`ops:status:drift:strict` exigiría una fila de ledger por issue nombrado).

**Cómo publicar en el tracker:** con el CLI o la API del proyecto, no con un MCP que apunte a otro workspace. En Odessay: comentarios y estados con `node scripts/linear-cli.mjs`; editar la descripción por GraphQL (`scripts/lib/linear-client.mjs`), añadiendo la sección sin reescribir el brief y sin duplicarla si ya existe.

**Antes de publicar,** pasar el lint en seco sobre el contenido final (descripción + sección, comentarios + pack) con `lintIssueBrief` de `scripts/lib/issue-brief-lint.mjs`. Así se ve qué fallaba antes y qué pasa después.

**Gate:** `npm run ops:brief:lint -- <todos los issues> --require-contract --require-recon` en verde.

**En el chat:** el reporte de § 4. Al terminar no quedan copias de trabajo en `.cache/`.

## 4. Reporte al humano

En el idioma del humano, a nivel de producto y sin jerga. Seis partes, en este orden:

1. **Cómo quedó cada issue.** Tabla `Issue | Estado | Nota`. Estados: *Listo*, *Listo con un cambio de contrato*, *Espera a <issue>*, *Sin brief todavía*.
2. **Lo que la auditoría encontró y ya quedó resuelto.** Cada punto contado por su efecto para el usuario. Ejemplo: "basta con que dos personas te compartan un documento llamado 'Notes' para que el enlace dé error". Incluye las **simplificaciones de diseño** ("más simple que el original: ya no hace falta…") y lo que se va a **reutilizar en vez de crear**.
3. **Decisiones tuyas**, con letras (A, B…). Por cada una:
   - la pregunta;
   - qué pasa hoy;
   - **"Por defecto: …"**;
   - la alternativa.

   Decir explícitamente si alguna bloquea. Si ninguna bloquea: "Si no dices nada, se aplica el valor por defecto".
4. **Lo que tienes que hacer tú**, agrupado por momento: antes de arrancar, en la ola N, durante el PR X.
5. **Seguimientos que no se crearon.** Se crean al cerrar la tanda, para no abrir frentes.
6. **Una sola pregunta.** Normalmente: "¿Aceptas los valores por defecto de A a <X>?".

Referencia: el reporte de la tanda 3 del milestone 4 (2026-10-01), con 12 issues, 7 decisiones (A–G), 5 tareas humanas y 4 seguimientos.

## 5. Después del Recon

- **Fase 0R:** otro agente verifica hechos, no redacción (`.agents/skills/skill-code-review/SKILL.md` § Review de un Recon). Con PASS, mergea el PR del mapa. Nada se despacha antes.
- **Respuestas del humano:** como comentario `## Decisiones (<humano>, <fecha>)` en cada issue. Un "— ajuste" posterior manda sobre la decisión original. Ningún issue se despacha sin ese comentario.
- **BUILD:** valida el pack (`architecture-recon`, modo validación, 10 minutos o menos). Sus `Recon corrections` vuelven al mapa del área.
