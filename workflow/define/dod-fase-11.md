# ODESSAY — Fase 11 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 11 — Artifact Studio: Agente de Workspace**.
Si un punto no está cumplido, el agente no se considera una capacidad estable del producto, aunque las acciones individuales "funcionen".

Fase 10 le dio a Artifact Studio una sola identidad visual y un vocabulario de tipos/estados configurable por el usuario (`ODE-472`..`ODE-477`). Fase 11 no rediseña nada de eso: expone esa capa de contexto ya construida (catálogo, anotaciones, vocabulary, collections, learned words) a través de un agente invocado bajo demanda, que vive en el entorno local y que, con autorización explícita del usuario, puede leer, escribir, mover, editar y eliminar documentos del workspace.

El wireframe interactivo aprobado por el dueño (2026-09-05) es la referencia de **interacción** de esta fase — qué dispara qué, dónde vive cada estado, cómo se resuelve un hallazgo. No es la referencia visual: los colores, tipografía e iconografía del wireframe se descartan en favor del sistema real de Artifact Studio (`skill-design`, `app/globals.css`) al momento de implementar.

Referencias:

- `workflow/context/features/odessay-desktop-document-catalog.md` — contrato del catálogo que este agente consume, no reemplaza.
- `lib/queries/document-catalog.ts` — capa compartida de lectura (Desk/Workspace); metadata-only, sin body.
- `lib/services/document-service-factory.ts` — lectura acotada de body real por documento.
- `lib/services/contracts/ai-service.ts` — contrato `learnWord`/`listLearnedWords`/`deleteLearnedWord`, precedente ya en producción de "el usuario marca algo como válido".
- `lib/margins/margins.ts`, `lib/editor/footnote-node.ts` — anotaciones (`personal`/`ai`/`footnote`), consultables por `writing_id`.
- `lib/vocabulary/catalog.ts`, `lib/writings/status.ts`, `lib/writings/artifact-type.ts` — catálogo de vocabulary configurable (Fase 10, `ODE-472`..`ODE-477`).
- `lib/collections/collections.ts` — collections manuales con descripción libre.
- `lib/workspace/types.ts` — `WorkspaceRecord.rootPath` es siempre requerido; base de que `workflow.md` como convención de archivo no necesita esquema nuevo.
- `components/editor/panels/editor-right-panel-tabs.tsx` — infraestructura de tabs ya existente en Studio, punto de montaje del agente en ese host.
- `components/workspace/workspace-detail.tsx`, `components/workspace/workspace-tree.tsx` — host en Workspace (sin sistema de tabs ni drag-source hoy; se agregan en esta fase).
- `docs/design/system-app.md`, `.agents/skills/skill-design/SKILL.md` — sistema de diseño real contra el que se valida la UI final, no el wireframe.
- `workflow/agents.md` — guardrails de arquitectura documental, no negociables en esta fase.
- `workflow/define/roadmap.md`

---

## 1) El agente tiene una capa de herramientas real, no solo sugerencias de metadata

- Con autorización explícita del usuario, el agente puede leer, escribir, mover, editar y eliminar documentos del workspace; ninguna de estas cinco capacidades queda fuera de alcance por diseño.
- Toda escritura, movimiento o eliminación requiere aprobación explícita **por acción individual**, nunca una autorización global de sesión ni un "confiar siempre". Ampliar la superficie de herramientas no relaja el patrón no-destructivo ya usado en Text Drift y anotaciones.
- Ninguna acción del agente escribe metadata en el frontmatter ni altera contenido de un `.md` sin que el usuario haya visto y aprobado explícitamente esa escritura — demostrado por comparación de hash del archivo antes y después de un rechazo.
- El agente corre exclusivamente en el entorno local (desktop/Tauri), sobre el filesystem real del workspace; esta fase no construye ni depende de una versión web/cloud del agente.

## 2) El contexto viene del sustrato que ya existe, nunca de una fuente paralela

- El agente lee anotaciones (`lib/margins/margins.ts`), vocabulary de tipo/estatus (`lib/vocabulary/catalog.ts`), collections (`lib/collections/collections.ts`) y palabras aprendidas (`lib/services/contracts/ai-service.ts`) tal como existen hoy; no se introduce un almacén paralelo de "contexto" que duplique alguno de estos.
- La metadata liviana (título, tipo, estatus, rutas) se lee de `DocumentCatalog`; el contenido real de un documento puntual se trae solo para los documentos que una acción concreta necesita comparar, nunca precargando el body de todo el workspace.
- Ninguna sugerencia de tipo o estatus ofrece un valor fuera del catálogo de vocabulary vigente del usuario — nunca un tipo o estatus inventado por el modelo.

## 3) `workflow.md` es una acción del agente, no una precondición manual

- El agente puede redactar o actualizar un borrador de `workflow.md` en la raíz del workspace, sintetizado a partir del contenido y la organización ya existentes (títulos, collections, anotaciones) — el usuario aprueba o edita antes de que se escriba a disco.
- Cuando `workflow.md` existe en la raíz de un workspace, cualquier otra acción del agente sobre ese workspace lo carga como contexto, sin excepción y sin campo nuevo en base de datos.
- No introduce ningún store durable nuevo: `workflow.md` es un documento más del workspace, sujeto a las mismas reglas de identidad y catálogo que cualquier otro `.md`.

## 4) Cada acción individual cumple su propio contrato de evidencia

- **Enlaces rotos** corre sin ninguna llamada a modelo; opera solo sobre el catálogo ya cargado y el filesystem.
- **Sugerir tipo y estatus** siempre cita contra qué documentos similares o qué señal del catálogo se basó la sugerencia.
- **Candidatos a archivar** siempre llega con razón explícita (fecha, similitud, o ambas) visible antes de que el usuario pueda aprobar.
- **Contradicciones y fusión** compara contenido real (no solo metadata) de al menos dos documentos, cita el fragmento de cada uno, y soporta más de un hallazgo en la misma corrida: resolver uno lo registra de inmediato y avanza al siguiente sin resolver; el estado de resueltos sobrevive a cerrar y reabrir la revisión.
- Ninguna acción ejecuta su escritura antes de que el usuario haya visto la evidencia citada.

## 5) El agente se expande en su propio panel — nunca un modal o sheet sobre el contenido

- Revisar un hallazgo ensancha el panel del agente en el lugar y reemplaza su propio contenido interno; no se introduce un overlay, backdrop ni modal centrado que cubra Desk, Studio o Workspace detrás.
- Cerrar una revisión devuelve el panel a su ancho anterior y restaura la vista de chat, sin perder el historial de esa sesión.
- El mismo componente se monta en dos hosts — como tab de `editor-right-panel-tabs.tsx` en Studio y como chrome nuevo en `workspace-detail.tsx` en Workspace — diferenciado solo por un prop de scope (documento vs. carpeta/workspace), nunca por dos implementaciones paralelas.
- Arrastrar un archivo de la lista de documentos o una carpeta del árbol de Workspace hacia cualquier parte del panel del agente lo acumula como contexto adjunto removible antes de enviar; el mensaje enviado conserva ese contexto visible como registro.

## 6) El wireframe es autoridad de interacción, nunca de visual final

- Cada estado de interacción del wireframe (acciones sutiles con ícono+texto, hallazgo con evidencia citada, tarjetas de candidato clicables con la sugerencia del agente marcada, cola de varios hallazgos, chips de contexto removibles) tiene un equivalente construido con los tokens, tipografía e iconografía reales de `skill-design`.
- Ningún color, fuente o ícono del wireframe (`Material Symbols`, paleta gris/neutra genérica) se copia literalmente al producto; se traduce a los tokens vigentes de Artifact Studio.
- Antes de dar por cerrada la UI de esta fase, hay una comparación explícita — por estado de interacción, no por pantalla completa — entre el wireframe y lo construido, con las divergencias de estilo registradas como intencionales, no como omisión.

## 7) Evidencia de aceptación

- Matriz trazable desde cada bloque de este DoD a un test automatizado, una prueba manual reproducible, o la aceptación explícita del dueño.
- Para cada acción (enlaces rotos, tipo/estatus, archivar, contradicciones): captura del hallazgo con su evidencia citada y captura de la aprobación explícita que dispara la escritura.
- Comparación de hash antes/después de un archivo cuando una sugerencia se descarta, probando que no se escribió nada.
- Typecheck, lint, tests, `validate-workflow-json` y `ops:delivery:gate` en verde en cada entrega.
- El dueño acepta el outcome de interacción completo (no solo el proof of work en verde) antes del cierre de fase.

## Gate de cierre de fase

Fase 11 se marca `Done` solo si los siete bloques anteriores están evidenciados, no quedan issues bloqueantes abiertos en el proyecto Linear de Fase 11, y el comportamiento construido — capa de herramientas, acciones, expansión en el propio panel, drag-and-drop de contexto — coincide con lo que el wireframe interactivo demuestra, aunque su piel visual no sea la misma.
