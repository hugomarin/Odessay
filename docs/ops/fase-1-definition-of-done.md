# ODESSAY — Fase 1 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 1 — Escribir**.
Si un punto no está cumplido, la fase no se considera terminada.

Referencias:
- `docs/ops/odessay-roadmap.md`
- `docs/features/odessay-editor.md`
- `docs/core/odessay-arquitectura.md`
- `skills/skill-design/vistas.md`

---

## 1) Editor core completo

- TipTap en producción con: `Document`, `Paragraph`, `Text`, `Heading (H1/H2/H3)`, `Bold`, `Italic`, `Strike`, `Highlight`, `Link`, `Blockquote`, `BulletList`, `OrderedList`, `ListItem`, `Code`, `CodeBlock`, `History`, `Placeholder`, `CharacterCount`.
- Toggle `Rich / Markdown` funcional y reversible sin pérdida para el subconjunto soportado por el parser markdown del proyecto.
- Paste de Markdown interpreta formato al pegar.
- Sin toolbar flotante de selección.

## 2) Modales y paneles obligatorios

- Modal de rename de writing (topbar).
- Modal de insert link.
- Modal de insert footnote.
- Panel derecho `Properties` operativo.
- Panel derecho `Notes` operativo (listar/editar/borrar/agregar footnotes con renumeración consistente).

## 3) Shortcuts de teclado

- Activos y testeados: bold, italic, strike, highlight, headings, listas, blockquote, link, code inline, code block, undo/redo, focus mode, salida con `Esc`.
- No hay colisiones críticas de shortcuts en Mac/Windows/Linux para las acciones principales.

## 4) Métricas de escritura (en vivo)

- Render en panel derecho de:
  - palabras
  - caracteres
  - oraciones
  - tiempo de lectura (estimado)
  - páginas (estimado)
- Actualización local en tiempo real sin bloquear escritura.

## 5) Sidebar global (zona autenticada)

- Sidebar izquierdo reusable con 3 estados:
  - colapsado (52-55px)
  - expandido (292-300px)
  - expandido + panel secundario contextual (Collections)
- Incluye navegación principal (`Desk`, `Collections`, `Correspondences`) y acceso a `Settings`.
- Persistencia del estado de sidebar por sesión.

## 6) Persistencia y sync (local-first)

- Guardado inmediato local (IndexedDB) en cada edición.
- Sync en background a Supabase con debounce + retries.
- Estado visual mínimo de guardado (`Saved` / `Saving...`) sin interrumpir escritura.
- Escrituras nuevas reciben UUID en cliente y se normalizan a `/write/[id]` sin recarga.

## 7) Estado y visibilidad mínima

- Estado del writing: `Draft` / `Done`.
- Visibilidad mínima funcional en Fase 1: `Private` por default.
- Controles de visibilidad avanzada pueden existir bajo feature flag, sin bloquear fase.

## 8) Sharing cerrado para evaluación UX

- Existe capacidad mínima de compartir un writing para pruebas controladas:
  - generación de link privado de evaluación
  - acceso de lectura para testers invitados
- No requiere el sistema completo de shared/public de Fase 2.

## 9) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `test` verde (hermético, sin dependencias externas en suite base).
- Evidencia manual de UX:
  - flujo escribir > guardar > cerrar > reabrir > contenido intacto
  - flujo compartir link de evaluación > abrir como tester > leer sin editar

## 10) Gate de cierre de fase

Fase 1 se marca `Done` solo si:
- Se cumplen los 9 bloques anteriores.
- Hay al menos una ronda de evaluación externa (testers reales) y feedback documentado en Linear.
- No hay regresiones críticas abiertas en editor, guardado o navegación base.
