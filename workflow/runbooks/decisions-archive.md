# ODESSAY — Decisions Archive

Histórico de decisiones por fase que **no necesitan** vivir en `workflow/status.json` como decisiones globales vigentes.

Uso:
- `status.json -> decisions_global`: decisiones activas, transversales y no negociables.
- `status.json -> decisions_phase_active`: decisiones específicas de la fase actual.
- Este archivo: decisiones históricas por fase (contexto y trazabilidad).

---

## Fase 0 — Cimientos

| Decisión | Issue | Fecha | Estado | Referencia |
|---|---|---|---|---|
| Login/Signup con plantilla `login-02` de ShadCN | ODE-15 | 2026-03-18 | Histórica (implementada) | `workflow/context/core/odessay-paginas.md` |

Notas:
- Si una decisión histórica se vuelve transversal, se promueve a `decisions_global` en `status.json`.
- Si una decisión histórica se reabre o se reemplaza, registrar el issue nuevo aquí y actualizar el estado.
