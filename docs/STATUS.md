# ODESSAY — Estado del proyecto

**Fuente de orientación para agentes.** Este documento responde: ¿qué existe hoy en el codebase y qué no? No duplica GitHub — apunta a él. Para el detalle de cada cambio, ir al PR referenciado.

**Regla de mantenimiento:** Cada PR que cierra trabajo significativo actualiza este archivo. Una línea por entregable, con referencia al PR. Sin este hábito, el documento pierde valor en días.

---

## Fase actual

**Fase 0 — Cimientos (documentación y setup)**

La documentación fundacional está completa. El codebase de la aplicación no existe todavía — ningún componente, ruta, ni endpoint ha sido implementado. Todo lo que existe es este repositorio de documentación.

---

## Qué está construido

| Entregable | PR | Notas |
|---|---|---|
| Repositorio de documentación inicializado | — | Estructura de carpetas: `docs/`, `skills/`, `reference/` |

---

## Qué no existe todavía

Todo el codebase de la aplicación. La Fase 1 (Escribir) es el próximo bloque de trabajo. En orden de implementación según `odessay-roadmap.md`:

**Infraestructura base (bloqueante para todo lo demás):**
- Proyecto Next.js inicializado con App Router, TypeScript strict, Tailwind, ShadCN
- Proyecto Supabase creado con schema inicial
- Variables de entorno configuradas en Vercel (staging y prod)
- Autenticación con Supabase Auth (email + contraseña)

**Fase 1 — Escribir:**
- Tabla `profiles` con RLS
- Tabla `writings` con RLS
- Sidebar y Topbar (componentes globales)
- Editor TipTap base con auto-save local
- API routes: `/api/writings` (CRUD)
- Sync local → Supabase
- Vista `/desk`
- Vista `/write` y `/write/[id]`
- FootnoteExtension (custom TipTap)

**Fases posteriores:** ver `docs/odessay-roadmap.md`

---

## Decisiones tomadas fuera del código

Decisiones arquitectónicas resueltas durante la fase de documentación, con su justificación. No buscarlas en commits — viven en los docs.

| Decisión | Donde está documentada |
|---|---|
| Local-first con IndexedDB (no localStorage) | `docs/odessay-arquitectura.md` |
| body_json como fuente de verdad (no body_markdown) | `docs/odessay-modelo-datos.md` |
| Last-write-wins silencioso para conflictos de sync | `skills/skill-backend/SKILL.md` §Conflictos |
| ShadCN tres capas de adaptación | `skills/skill-design/SKILL.md` §ShadCN |
| TanStack Query + Zustand (2 slices únicamente) | `skills/skill-frontend/SKILL.md` §Estado |
| Validación con react-hook-form + Zod, onBlur | `skills/skill-frontend/SKILL.md` §Validación |
| Login/Signup con login-02 de ShadCN | `docs/odessay-paginas.md` §/login |
| FootnoteExtension custom (no existe en ecosistema) | `docs/odessay-editor.md` §FootnoteExtension |

---

## Cómo actualizar este documento

Al completar un PR significativo, agregar una fila a la tabla "Qué está construido" y mover el entregable fuera de "Qué no existe todavía". Un PR significativo es cualquiera que implemente funcionalidad visible o infraestructura que otros issues necesitan.

Formato de fila: `| Descripción del entregable | PR #N | Notas breves si aplica |`
