# ODESSAY — Testing strategy: cost tiers y Critical Capabilities

Este documento es el **canonical owner** de dos cosas que antes vivían implícitas o repetidas en distintos lugares:

1. la taxonomía de niveles de test y el principio que decide cuál usar;
2. hasta 2026-09-19, la lista de Critical Capabilities de Odessay sin integration tests dedicados — movida desde entonces a `workflow/quality/capability-integration-map.md` (ver "Critical Capabilities — canonical owner movido" abajo).

`.agents/skills/skill-planning/SKILL.md` (sección `Validation requirements`) y `.agents/skills/review-testing/SKILL.md` referencian este documento en vez de repetir la regla. `workflow/testing/playwright-catalog.md` sigue siendo el catálogo operativo de Playwright — cuándo Playwright es la herramienta correcta se decide aquí; qué asset de Playwright reutilizar se decide ahí.

---

## Principio rector

> **Test at the lowest-cost boundary that can falsify the failure mode we care about.**

No se sube de nivel porque "así se hace normalmente" o por reflejo ("hagamos E2E"). Se sube de nivel solo cuando el nivel más barato no puede demostrar la propiedad real que importa — y esa decisión se justifica explícitamente, no se asume.

Corolario práctico: si un contract test o un integration test con servicios reales puede falsificar el mismo failure mode que un test E2E, se usa ese, no Playwright. El costo no es solo tiempo de CI — es determinismo: un test E2E que depende de browser, red y timing introduce más formas de fallar por razones ajenas al comportamiento que se quiere verificar.

## Taxonomía

| Nivel | Definición | Cuándo demuestra la propiedad real |
| --- | --- | --- |
| **Unit** | Una pieza aislada (función, hook, reducer) con sus dependencias mockeadas. | Lógica pura, transformaciones, validación, edge cases de una sola función. |
| **Contract** | Verifica una interfaz o invariante entre boundaries — un servicio real contra su contrato declarado (`lib/services/contracts/**`), sin UI ni browser. | Adapters, serialización, forma de payload, invariantes de identidad/schema. |
| **Integration** | Varias piezas reales colaborando (servicios reales, storage temporal, sin browser) — ver `tests/desk-workspace-catalog-integration.test.tsx` como precedente ya existente en el repo. | Colaboración entre componentes/servicios reales: catálogo + binding, persistencia + retry, servicio + storage. |
| **E2E** | Sistema completo desde la interfaz (Playwright). | Choreography de UI que un test bajo el componente no puede modelar razonablemente — ver siguiente sección. |
| **Performance** | Instrumento especializado con un Performance Contract explícito (ver `.agents/skills/skill-performance/SKILL.md`). | Hot paths con presupuesto de tiempo/bytes/listeners declarado — no "por si acaso".|

## Cuándo Playwright sí es la primera opción

- choreography de modal/interacción (abrir, encadenar, cerrar);
- focus/keyboard behavior que depende del DOM real;
- drag & drop;
- navegación visual entre rutas reales;
- estados de UI que son difíciles de demostrar por debajo del componente (overlap visual, scroll, timing de animación).

## Cuándo Playwright NO debe ser la primera opción

- guardar un documento (persistence, no UI);
- filesystem / catálogo (`DocumentCatalog`, binding, canonical path);
- UUID → path / identidad documental;
- export (Markdown/DOCX/PDF);
- sync (queue, mutación cloud, retry);
- runtime host (desktop nunca debe apuntar a localhost en producción);
- forma de payload de una API;
- persistencia en general.

Un test E2E que hace click en "Export" y verifica la descarga no demuestra que el adapter maneja Unicode correctamente — solo demuestra que el flujo funciona para un caso feliz. Esa distinción ya está documentada en `workflow/testing/playwright-catalog.md` §"Regla de mapeo servicio-contrato"; este documento la generaliza a cualquier nivel de test, no solo Playwright.

## Performance: misma lógica, mismo principio

Performance capture (`scripts/capture-editor-trace.mjs`, `/perf/editor-harness`, `scripts/check-performance-gate.mjs`) sigue existiendo y disponible para uso explícito. No corre universalmente en cada PR — corre cuando:

- el brief declaró un `Performance Architecture Contract` activo (`.agents/skills/skill-performance/SKILL.md`), o
- el cambio está scoped a un hot path performance-sensitive ya conocido, o
- es una validación manual/release/periódica (ver `/wf-audit-runtime`).

No existe todavía un scheduler automático que decida esto por PR — se selecciona explícitamente en el brief (`Validation requirements`, ver `skill-planning`).

---

## Critical Capabilities — canonical owner movido

La lista de capabilities priorizadas para integration tests ya no vive aquí como una lista comprimida A–G: se reemplazó por el inventario completo y auditado en **`workflow/quality/capability-integration-map.md`** — 106 escenarios con `coverage_status` real (leído del código de cada test, no inferido del nombre del archivo), prioridad, evidencia y gaps concretos.

Ese documento es ahora el canonical owner de "qué capability priorizar después". Este documento sigue siendo el canonical owner de la taxonomía de niveles de test y el principio de menor costo (secciones arriba) — el capability map los referencia en vez de repetirlos.

---

## Cómo usar este documento

- Al escribir un brief (`Validation requirements`, ver `skill-planning`): elegir el nivel mínimo de esta taxonomía que falsifica el failure mode declarado, y justificar por escrito si se escala a E2E o Performance.
- En review (`review-testing`): un integration/contract test que demuestra el contrato directamente es evidencia válida — no exigir Playwright por defecto.
- Al priorizar trabajo nuevo de testing: `workflow/quality/capability-integration-map.md`'s V1 Implementation Plan es la lista candidata, en el orden en que está declarado salvo que un incidente real reordene la prioridad.
