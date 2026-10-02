# Recon de área

Especialidad de Planning. Investiga **una vez** el código de un área que van a tocar varios issues, encuentra lo que podría frenar el BUILD o la orquestación, y deja todo listo para despachar. El builder después **valida** el pack (`architecture-recon`, modo validación) en vez de volver a explorar.

## Cuándo aplica, y cuándo no

- **Aplica** cuando varios issues comparten un área de código, o cuando una tanda va a orquestarse.
- **No aplica** a una pregunta puntual ("¿qué podría romper la opción B?"). Eso es un **análisis**: la respuesta queda en el chat y, si sirve, como comentario en el issue. Sin PR.

**Quién lo hace:** el planner (Claude Code, o un worker con ese rol). Nunca el builder. Antes de construir, lo verifica **otro agente** (fase 0R, § 5).

## 1. Método

1. Declarar el commit de `main` contra el que se verifica. Si `main` avanza durante el Recon, revalidar contra el commit nuevo.
2. Partir la tanda en **clusters**: issues que comparten owner o archivos.
3. Lanzar **un worker por cluster, en paralelo y en solo lectura**: sin tocar Linear ni el repo. Cada worker:
   - usa el método de `.agents/skills/architecture-recon/SKILL.md` (buscar por símbolo y rango, no paginar hotspots);
   - recorre la lista de huecos (§ 2) por cada issue;
   - **resuelve desde el código** todo lo que pueda, con evidencia (`archivo:líneas`);
   - **escala solo lo que el código no contesta.**
4. El planner consolida: escribe en Linear, abre el PR del mapa y entrega el reporte (§ 3 y § 4).

## 2. Lista de huecos

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

**En Linear, por issue:**
- el comentario `## Recon Pack (verificado en main@<sha>)`, con el formato de `issue-brief-schema.md` § Recon Pack;
- una sección **"Auditoría (<fecha>)"** en la descripción: correcciones al brief con líneas y hallazgos ya resueltos;
- `Architecture Contract` y `Reference docs` completos en la descripción;
- cada decisión pendiente escrita como **"Default, pendiente de confirmar por <humano>"**.

**En el repo:** un **PR de docs, abierto y sin mergear**:
- el mapa del área en su documento existente (diagnóstico, catálogo de harnesses…), con el commit verificado;
- el grafo de conflictos y las olas propuestas;
- el comando de recuento, si aplica.

Reglas del PR: solo docs, label `process` y **ningún `ODE-###` en el asunto de los commits** (`ops:status:drift:strict` exigiría una fila de ledger por issue nombrado).

**Gate:** `npm run ops:brief:lint -- <todos los issues> --require-contract --require-recon` en verde.

**En el chat:** el reporte de § 4. Al terminar no quedan copias de trabajo en `.cache/`.

## 4. Reporte al humano

En el idioma del humano, a nivel de producto y sin jerga. Seis partes, en este orden:

1. **Cómo quedó cada issue.** Tabla `Issue | Estado | Nota`. Estados: *Listo*, *Listo con un cambio de contrato*, *Espera a <issue>*, *Sin brief todavía*.
2. **Lo que la auditoría encontró y ya quedó resuelto.** Cada punto contado por su efecto para el usuario. Ejemplo: "basta con que dos personas te compartan un documento llamado 'Notes' para que el enlace dé error".
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
