# ODESSAY — Fase 4 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 4 — Shared Core Multi-Runtime**.
Si un punto no está cumplido, la fase no se considera terminada.

El objetivo central de esta fase no es lanzar una nueva superficie visible para el usuario final. El objetivo es cambiar la base del sistema para que Odessay deje de depender estructuralmente del runtime web actual y pueda evolucionar hacia desktop y web como dos runtimes del mismo producto.

En otras palabras: al cerrar esta fase, el usuario todavía puede sentir que “Odessay web sigue funcionando”, pero internamente ya no debería ser verdad que web es el centro implícito del sistema.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-migration-diagnostic.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-prosemirror-tiptap.md`
- `workflow/context/features/odessay-sync.md`
- `workflow/context/core/odessay-arquitectura.md`
- `.agents/skills/skill-architecture/SKILL.md`

---

## 1) Partición explícita entre core y plataforma

- Existe una separación explícita entre:
  - núcleo de producto compartido
  - responsabilidades específicas del runtime web
  - responsabilidades futuras del runtime desktop
- Las decisiones de arquitectura ya no viven “dispersas” entre componentes, route handlers y utilidades web.
- Cualquier issue nuevo que toque write-path, sync, documento, adapters o boundaries puede clasificarse sin ambigüedad por:
  - `Layer`
  - `Runtime scope`
  - `Owner`

## 2) Contrato documental explícito

- El contrato documental de Odessay queda definido de forma explícita y compartida.
- Existe una respuesta clara, documentada y verificable sobre la relación entre:
  - `.md`
  - representación rica derivada
  - serialización
  - import/export
  - caches o materializaciones derivadas
- Ya no quedan dos fuentes de verdad compitiendo silenciosamente por el documento.
- Si existen representaciones auxiliares, quedan tratadas como derivadas, no como contrato primario del producto.

## 3) Web deja de definir el sistema

- La experiencia web principal sigue operativa, pero sus detalles de runtime dejan de ser la definición implícita del producto.
- Las dependencias de Next, Supabase, HTTP interno, cookies SSR o transporte web quedan identificadas y acotadas como concerns de plataforma.
- La UI principal deja de depender estructuralmente de conocer detalles accidentales del transporte o del runtime web.

## 4) Write-path y sync con boundaries verificables

- El write-path del producto queda modelado de forma explícita y reusable.
- La persistencia, hydration y sync ya no se leen como comportamiento informal pegado a la UI.
- Existe una forma clara de razonar qué parte del flujo pertenece al core y qué parte pertenece al adapter web actual.
- El sistema puede evolucionar hacia desktop sin exigir reescribir primero toda la semántica del documento o del guardado.

## 5) Capacidades remotas desacopladas estructuralmente

- AI, auth, sharing y capacidades remotas equivalentes dejan de ser acoplamientos estructurales directos entre producto y runtime web.
- No se exige cerrar todavía toda la implementación cross-runtime de estas capacidades, pero sí dejar claro:
  - qué pertenece al producto
  - qué pertenece al runtime web
  - qué quedará pendiente para desktop

## 6) Promesa percibida por el usuario en esta fase

Aunque esta fase sea arquitectónica, el usuario debe recibir algo real:

- el autor puede seguir escribiendo en web sin regresiones críticas respecto a Fase 3
- el comportamiento del documento se siente más consistente y menos frágil
- el sistema deja preparada una base confiable para que desktop no nazca como una “web empaquetada”

Lo que **no** se le promete todavía al usuario al cerrar Fase 4:

- una app desktop usable
- sync remoto desde desktop
- paridad completa entre web y desktop
- nuevas líneas de producto apoyadas en una base todavía inmadura

## 7) Evidencia obligatoria de cierre

- Existe evidencia reproducible de los invariantes estructurales del sistema.
- La fase no se cierra solo con “el refactor se ve bien” o “el código está más limpio”.
- Debe haber validación objetiva de al menos:
  - contrato documental
  - consistencia del write-path
  - boundaries entre core y adapter web
  - ausencia de regresiones críticas en la experiencia web actual

## 8) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes.
- Existe cobertura o evidencia específica para los contratos nuevos o estabilizados, no solo para UI superficial.
- Toda extracción o boundary nuevo relevante queda respaldado por documentación alineada con la secuencia desktop.

## 9) Evidencia manual mínima

- Flujo escribir → guardar → cerrar → reabrir sigue funcionando en web sin pérdida de contenido.
- Rich mode y Source mode preservan el contrato esperado para el subconjunto soportado.
- El documento sigue siendo estable frente a import/export y round-trip en los casos cubiertos por el perfil Markdown del producto.
- No hay regresiones críticas abiertas en editor, auto-save, sync ni lectura respecto a Fase 3.

## 10) Gate de cierre de fase

Fase 4 se marca `Done` solo si:

- Se cumplen los 9 bloques anteriores.
- Desktop deja de ser un objetivo abstracto y pasa a estar habilitado estructuralmente por la arquitectura resultante.
- Web puede seguir evolucionando sin volver a absorber el rol de “fuente de verdad” del sistema.
- Existe confianza razonable de que Fase 5 ya puede trabajar sobre convergencia web al core y no sobre más ambigüedad arquitectónica.
