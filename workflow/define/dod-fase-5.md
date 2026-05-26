# ODESSAY — Fase 5 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 5 — Convergencia Web sobre el Core Compartido**.
Si un punto no está cumplido, la fase no se considera terminada.

El objetivo central de esta fase es demostrar que la nueva base multi-runtime no es solo una arquitectura “correcta” en abstracto, sino una base que ya sostiene la experiencia web real de Odessay. Al cerrar Fase 5, web debe funcionar como una implementación del sistema y no como la definición implícita del sistema.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/define/dod-fase-4.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-sync.md`
- `workflow/context/features/odessay-editor.md`
- `workflow/context/core/odessay-arquitectura.md`
- `.agents/skills/skill-architecture/SKILL.md`

---

## 1) Web ya corre sobre contratos estabilizados

- Los flujos principales de escritura y lectura en web operan sobre contratos ya definidos en la fase anterior.
- La experiencia web deja de depender de acoplamientos implícitos entre componentes, transporte y runtime.
- La UI ya no necesita “saber demasiado” sobre infraestructura para ejecutar los casos de uso principales.

## 2) Adapters web explícitos

- Las responsabilidades específicas de web quedan identificadas como adapters de plataforma.
- Lo que depende de Next, Supabase, cookies, HTTP interno o APIs browser queda claramente separado de lo que pertenece al producto.
- La semántica del producto no queda definida por route handlers, middleware ni detalles del cliente web.

## 3) Persistencia local-first web alineada al contrato documental

- La persistencia local-first del runtime web respeta el mismo contrato documental que habilitará desktop.
- El documento no cambia de significado al pasar por guardado local, rehidratación, sync o reapertura.
- El write-path web ya no introduce una semántica paralela que luego desktop tendría que corregir o reinterpretar.

## 4) Harnesses de validación compartida

- Existe evidencia reproducible de que el core y el adapter web preservan los invariantes del sistema.
- La validación ya no depende de observación manual aislada ni de “parece que no se rompió”.
- Debe haber capacidad verificable para razonar y probar:
  - round-trip documental
  - guardado y reapertura
  - hydration
  - boundaries entre core y web adapter

## 5) Promesa percibida por el usuario en esta fase

El usuario debe recibir algo real, aunque la fase siga siendo estructural:

- Odessay web sigue funcionando como herramienta principal de escritura
- el comportamiento del documento se siente más estable y consistente
- el producto se vuelve menos frágil frente a cambios internos

Lo que **no** se le promete todavía al usuario al cerrar Fase 5:

- una experiencia desktop usable
- capacidades remotas nuevas en desktop
- expansión funcional relevante sobre desktop

## 6) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes.
- La cobertura y/o evidencia incluye explícitamente contratos del core y boundaries del adapter web, no solo regresión superficial de UI.
- Toda decisión relevante de convergencia queda reflejada en documentación alineada con la secuencia desktop.

## 7) Evidencia manual mínima

- Flujo escribir → guardar → cerrar → reabrir sigue funcionando en web sin pérdida de contenido.
- Flujo lectura → reapertura de writing → continuidad de estado no presenta regresiones críticas.
- Rich mode y Source mode preservan el comportamiento esperado del documento en web.
- No hay regresiones críticas abiertas en editor, auto-save, sync, lectura ni navegación respecto a Fase 4.

## 8) Gate de cierre de fase

Fase 5 se marca `Done` solo si:

- Se cumplen los 7 bloques anteriores.
- Existe confianza razonable de que la versión web ya opera como una implementación del core y no como su excepción estructural.
- La base técnica permite iniciar Fase 6 sin tener que volver a reabrir ambigüedades sobre documento, write-path o ownership.
