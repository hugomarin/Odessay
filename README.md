# Odessay

Una plataforma de escritura epistolar donde el texto recupera su dignidad, el lector es destinatario y no consumidor, y la inteligencia artificial cuida lo que escribís en lugar de escribir por vos.

---

## El producto

Odessay existe porque ningún espacio digital actual es un santuario para escribir. Notes es utilitario. Google Docs es laboral. Las redes convierten todo en contenido que necesita likes. Hay herramientas para producir y escenarios para ser visto — pero ningún lugar para escribir con amor, con tiempo, con la intención de que cada palabra merezca ser leída.

Odessay es ese lugar. Un espacio epistolar digital para personas que piensan escribiendo: escritores, filósofos, humanistas, artistas. Personas que ya lo hacen de forma improvisada — emails largos a un amigo, Google Docs compartidos, mensajes de WhatsApp de 47 párrafos — pero sin una herramienta que esté a la altura de su intención.

El producto tiene tres modos:

**Escribir** — el editor es el centro. TipTap sobre ProseMirror, tipografía epistolar (Lora), AI que observa y nunca interrumpe. El texto es el protagonista; la interfaz es el escenario que lo sirve.

**Leer** — un writing puede ser privado, compartido con personas específicas, o público. Leer activa los márgenes: un sistema de highlights y anotaciones que son materia prima para la respuesta, no feedback. La respuesta es otra carta, con el mismo peso y dignidad que el envío.

**Organizar** — el escritorio (Desk) y las colecciones (Collections) son el sistema de gestión. El AI editor ayuda a sugerir agrupaciones. La correspondencia (Correspondences) es el hilo epistolar que emerge cuando dos personas se responden.

---

## Stack tecnológico

| Capa | Tecnología | Decisión |
|------|-----------|----------|
| Framework | Next.js 15 (App Router) | Server Components por default. SSR para rutas públicas. |
| UI | React 19 + TypeScript strict | Sin `any`. |
| Styling | Tailwind CSS + ShadCN/UI | ShadCN se adapta por tokens, no por reescritura. |
| Editor | TipTap (ProseMirror) | Headless, siempre aislado del árbol de React. |
| Base de datos | Supabase (PostgreSQL + Auth + Realtime) | Capa remota, no operativa. |
| Local-first | IndexedDB (web) / SQLite (desktop) | El usuario nunca espera a Supabase. |
| AI | Claude API (Anthropic) | El AI editor observa — nunca genera texto por el autor. |
| Email transaccional | Resend | Invitaciones epistolares. |
| Tipografía | Lora + Geist Sans | Lora para lo epistolar. Geist Sans para lo funcional. Nunca mezclar en el mismo elemento. |

La arquitectura es local-first: cada acción escribe primero en la base local (IndexedDB/SQLite), y un sync queue sincroniza con Supabase en background. El usuario escribe sin latencia.

---

## Estructura de documentación

Este repositorio es la especificación completa del producto. El codebase de la aplicación no existe todavía — todo lo que está construido es la documentación que permite que agentes de código construyan Odessay de forma autónoma y consistente.

```
docs/
  core/       → Verdades estables del producto. Todo agente las lee siempre.
  features/   → Spec de cada feature. On-demand según el issue.
  ops/        → Estado vivo y operación de agentes. Pre-flight obligatorio.
framework/    → Framework MECE genérico, transferible a otros proyectos.
skills/       → Instrucciones de implementación por dominio.
reference/    → Prototipos HTML interactivos y screenshots. Referencia visual canónica.
config.json   → Registro completo de documentos y rutas de acceso para agentes.
```

### docs/core/ — siempre leer

| Documento | Propósito |
|-----------|-----------|
| `odessay-fundacional.md` | Visión, por qué existe, para quién, principios. |
| `odessay-arquitectura.md` | Arquitectura técnica y navegación. Referencia definitiva. |
| `odessay-stack.md` | Stack confirmado, convenciones, ambientes. |
| `odessay-modelo-datos.md` | Schema completo de Supabase. |
| `odessay-paginas.md` | Cada ruta/página: layout, comportamiento, notas. |
| `odessay-flujos.md` | Flujos de usuario detallados (secciones 1–11). |

### docs/features/ — on-demand

| Documento | Feature |
|-----------|---------|
| `odessay-editor.md` | Editor TipTap, extensions, shortcuts, auto-save, FootnoteExtension. |
| `odessay-ai-editor.md` | AI editor residente: spec completa de comportamiento. |
| `odessay-margenes.md` | Sistema de highlights y anotaciones en lectura. |

### skills/ — instrucciones de implementación

| Skill | Cuándo |
|-------|--------|
| `skill-design/SKILL.md` | Tokens, tipografía, ShadCN, reglas visuales. Siempre antes de construir UI. |
| `skill-design/vistas.md` | Valores exactos por vista + checklists. Companion de skill-design. |
| `skill-frontend/SKILL.md` | Arquitectura React, TipTap, estado, naming, performance. |
| `skill-backend/SKILL.md` | API routes, Supabase, sync, Claude API, observabilidad. |
| `skill-database/SKILL.md` | Migraciones, RLS policies, índices. |
| `skill-product-manager/SKILL.md` | Creación de issues, template, proof of work. |
| `skill-code-review/SKILL.md` | Checklist pre-PR. Siempre antes de abrir un PR. |
| `skill-ux-testing/SKILL.md` | Testing E2E con Playwright. |

---

## Metodología: desarrollo autónomo con agentes de código

Odessay se construye principalmente por agentes de código (Claude, Cursor, agentes con MCP) con mínima intervención humana en las decisiones de implementación. La documentación no es complementaria al desarrollo — es la condición de posibilidad del desarrollo autónomo.

### El problema que resuelve

Sin documentación estructurada, un agente de código improvisa en cada decisión ambigua. La improvisación produce inconsistencia: un agente elige un patrón de estado, el siguiente elige otro. Un agente inventa un nombre de tabla, el siguiente inventa uno diferente. La acumulación de improvisaciones produce una codebase que nadie — ni humano ni agente — puede mantener.

La solución no es supervisar más — es documentar mejor.

### Framework MECE para documentación de agentes

El proyecto usa un framework propio basado en el principio MECE (Mutuamente Excluyente, Colectivamente Exhaustivo), adaptado para documentación técnica autónoma.

El framework parte de una pregunta: ¿qué necesita saber un agente para tomar cualquier decisión sin improvisar? La respuesta son 10 preguntas que el proyecto debe responder completamente:

1. ¿Para qué existe esto y para quién?
2. ¿Qué ve y hace el usuario?
3. ¿Cómo se ve exactamente?
4. ¿Qué datos existen y cómo se modelan?
5. ¿Cómo está organizado el código?
6. ¿Cómo funciona cada feature crítico?
7. ¿Cómo se implementa el backend?
8. ¿Qué existe hoy en el codebase?
9. ¿Cómo opera el agente en este proyecto?
10. ¿Cómo sé que terminé?

Cada pregunta tiene exactamente un lugar donde vive su respuesta. Si dos documentos responden lo mismo, hay contradicción latente. Si alguna pregunta no tiene respuesta, el agente improvisa.

El framework está documentado en `framework/framework-mece.md` como un sistema transferible — se puede aplicar a cualquier proyecto de software, no solo a Odessay.

### config.json como cartografía de agentes

`config.json` no es solo configuración — es el mapa de navegación del proyecto para agentes. Tiene dos responsabilidades distintas:

**Registry** — inventario completo de todo documento que existe, con su descripción, tipo y scope. Un documento que no está en el registry es un nodo huérfano: existe en disco pero ningún agente tiene ruta para llegar a él. El pre-flight script detecta huérfanos en ambas direcciones (registry → disco y disco → registry).

**Questions** — índice temático orientado a tareas. Mapea cada una de las 10 preguntas MECE al documento que la responde, con el scope de lectura (always, conditional, reference) y el trigger que la activa.

### Protocolo de lectura por scope

Los documentos tienen tres scopes que determinan cuándo los lee un agente:

**always** — se lee antes de cualquier tarea, sin excepción. Son 7 documentos: fundacional, arquitectura, stack, STATUS, SETUP, skill-product-manager, skill-code-review.

**conditional** — se lee cuando el issue activa su trigger. El issue declara `areas_affected` y config.json mapea cada área a sus documentos. Un agente que trabaja en backend no carga los flujos de usuario; uno que trabaja en frontend no carga el skill de base de datos.

**reference** — se consulta al llegar a esa parte del trabajo. No se lee al inicio. `odessay-margenes.md` es reference: solo importa si el issue toca la reading view.

### Hermetic testing

Los tests corren con `npm test` sin dependencias externas. Supabase se mockea, fetch se intercepta con MSW, los datos de prueba viven en fixtures del repo. Un agente que rompe tests en CI tiene un problema — no el ambiente.

### Proof of work en PRs

Antes de mover un issue a "In Review", el agente pega el output de `npm run typecheck && npm run lint && npm test` en la descripción del PR. Sin ese output, el PR no se revisa. Esto elimina la categoría de bugs "funciona en mi máquina".

### WORKFLOW.md por issue

Para issues con contexto o restricciones específicas que van más allá de los docs estándar, se crea un `WORKFLOW.md` en la raíz de la rama. Sobreescribe `agent.md` para esa rama únicamente. Se borra al mergear. El historial vive en el PR, no en el repo.

---

## Decisiones no negociables

**Local-first.** El usuario nunca espera a Supabase. La base local es la fuente de verdad operativa. Supabase es la copia remota sincronizada.

**Editor aislado.** Un keystroke en el editor no re-renderiza el sidebar, paneles de AI, ni ningún componente externo.

**AI no genera texto.** El AI editor observa, señala, pregunta. Nunca escribe por el autor. Si la respuesta del modelo es SILENCIO, no se envía nada al cliente.

**Simplicidad radical.** Si el issue no lo pidió, no se agrega UI. Cada píxel existe por una razón.

**Tipografía y bordes.** Bordes siempre `0.5px`. Iconos siempre `strokeWidth={1.5}`. Lora para lo epistolar, Geist Sans para lo funcional.

---

## Estado actual

**Fase 0 — Cimientos completada.** La documentación fundacional está completa. El codebase de la aplicación no existe todavía. La Fase 1 (Escribir: editor, auto-save, Desk) es el próximo bloque de trabajo.

Ver `docs/ops/STATUS.md` para el estado detallado y `docs/ops/odessay-roadmap.md` para el plan completo de fases.

---

## Para agentes de código

Leer en este orden antes de tocar cualquier archivo:

1. `config.json` — pre-flight: verificar integridad del registry
2. `docs/ops/SETUP.md` — entorno, herramientas, permisos, Git
3. `docs/ops/STATUS.md` — qué existe hoy
4. `docs/core/odessay-fundacional.md` — qué es el producto
5. `docs/core/odessay-arquitectura.md` — cómo está organizado
6. `docs/core/odessay-stack.md` — con qué está construido
7. Docs condicionales según `config.json → triggers` del issue
8. `skills/skill-product-manager/SKILL.md` y `skills/skill-code-review/SKILL.md` antes del PR
