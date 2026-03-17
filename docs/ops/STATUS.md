# ODESSAY — Estado del proyecto

**Fuente de orientación para agentes.** Este documento responde dos preguntas: ¿en qué fase estamos? y ¿qué existe en el codebase? No rastrea qué sigue — eso vive en Linear. No reemplaza a GitHub — lo referencia.

**Regla de mantenimiento:** Al mover un issue a Done, el agente agrega una fila a "Qué está construido". Una fila, un commit, un issue. Nada más.

---

## Fase activa

**Fase 0 — Cimientos** | In Progress

Para saber qué issue ejecutar: consultar el proyecto [Fase 0 — Cimientos](https://linear.app/z9ne/project/fase-0-cimientos-58af8acb9bb0) en Linear — primer issue en estado `Ready`.

---

## Qué está construido

| Entregable | Issue | Commit | Fecha | Notas |
|---|---|---|---|---|
| Repositorio de documentación | — | — | 2026-03-17 | Estructura: `docs/`, `skills/`, `framework/`, `reference/` |
| Repo GitHub + `.gitignore` base | ODE-9 | `1b53bbe` | 2026-03-17 | Branch protection no disponible en plan actual — fallback documentado en ODE-9 |

---

## Decisiones arquitectónicas

Decisiones tomadas durante la fase de documentación. No buscarlas en commits — viven en los docs referenciados.

| Decisión | Documentada en |
|---|---|
| Local-first con IndexedDB (no localStorage) | `docs/core/odessay-arquitectura.md` |
| `body_json` como fuente de verdad (no `body_markdown`) | `docs/core/odessay-modelo-datos.md` |
| Last-write-wins silencioso para conflictos de sync | `docs/features/odessay-sync.md` §Conflictos |
| ShadCN tres capas de adaptación | `skills/skill-design/SKILL.md` §ShadCN |
| TanStack Query + Zustand (2 slices únicamente) | `skills/skill-frontend/SKILL.md` §Estado |
| Validación con react-hook-form + Zod, onBlur | `skills/skill-frontend/SKILL.md` §Validación |
| Login/Signup con login-02 de ShadCN | `docs/core/odessay-paginas.md` §/login |
| FootnoteExtension custom (no existe en ecosistema) | `docs/features/odessay-editor.md` §FootnoteExtension |
| Branch protection no disponible — fallback por PR obligatorio | `docs/ops/SETUP.md` §Estrategia de Git |

---

## Cobertura de features en docs/features/

| Feature | Doc | Trigger |
|---|---|---|
| Editor TipTap | `docs/features/odessay-editor.md` | `editor` |
| AI editor residente | `docs/features/odessay-ai-editor.md` | `ai-editor` |
| Highlights y márgenes | `docs/features/odessay-margenes.md` | `reading-view` |
| Correspondencias | `docs/features/odessay-correspondencias.md` | `correspondencias` |
| Collections | `docs/features/odessay-collections.md` | `collections` |
| Sync local-first | `docs/features/odessay-sync.md` | `sync` |
| Invitaciones | `docs/features/odessay-invitaciones.md` | `invitaciones` |
| Espacio público | `docs/features/odessay-espacio-publico.md` | `espacio-publico` |
