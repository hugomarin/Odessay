# ODESSAY — Fase 6 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 6 — Desktop Local-First Runtime**.
Si un punto no está cumplido, la fase no se considera terminada.

El objetivo central de esta fase es entregar la primera versión desktop realmente usable de Odessay. No es una demo técnica ni una web empaquetada: es una app de escritura local real, file-based first, con `.md` como fuente de verdad del documento.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/define/dod-fase-5.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-prosemirror-tiptap.md`
- `workflow/context/core/odessay-stack.md`
- `.agents/skills/skill-architecture/SKILL.md`

---

## 1) App desktop usable

- Existe una aplicación desktop arrancable y utilizable como producto, no solo como experimento técnico.
- La app puede abrirse y operar sin login obligatorio.
- La experiencia base permite sostener una sesión real de escritura local.

## 2) Filesystem como base operativa del writing

- El usuario puede abrir, crear, editar, renombrar y guardar documentos locales desde desktop.
- El documento vive primero en el disco del usuario.
- La existencia del writing no depende de red, auth ni servicios remotos.

## 3) `.md` como fuente de verdad en desktop

- El documento canónico en desktop es `.md`.
- No existen fuentes de verdad paralelas que compitan silenciosamente con el archivo.
- Cualquier índice, cache o materialización rica queda subordinada al documento canónico.

## 4) Rich mode y Source mode sobre el mismo documento

- Desktop soporta dos superficies legítimas del mismo writing:
  - edición rica
  - edición fuente
- Ambas operan sobre el mismo documento canónico.
- El cambio entre modos no rompe el contrato documental ni degrada el contenido soportado por el perfil del producto.

## 5) Infraestructura local derivada correctamente acotada

- Índice local, settings, credenciales locales y manejo de assets existen como soporte del producto desktop.
- Ninguna de estas capas reemplaza al documento como fuente de verdad.
- Los assets locales funcionan con una estrategia portable y coherente con el modelo file-based.

## 6) Promesa percibida por el usuario en esta fase

Al cerrar Fase 6, el usuario ya debe recibir una promesa visible y real:

- puede usar Odessay en desktop para escribir localmente
- puede trabajar sin red
- su documento le pertenece como archivo y no depende de una sesión activa

Lo que **no** se le promete todavía al usuario al cerrar Fase 6:

- sync remoto completo
- paridad completa de AI, sharing, publishing o auth entre web y desktop
- convivencia totalmente cerrada entre ambas superficies

## 7) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes.
- Existe evidencia específica para:
  - save/load local
  - round-trip documental en desktop
  - funcionamiento offline
  - consistencia entre Rich mode y Source mode

## 8) Evidencia manual mínima

- Crear documento nuevo en desktop → escribir → guardar → cerrar app → reabrir → contenido intacto.
- Abrir archivo `.md` existente desde filesystem → editar → guardar → verificar persistencia en disco.
- Cambiar entre Rich mode y Source mode sin perder contenido soportado por el perfil Markdown.
- Usar la app sin red y confirmar que la sesión de escritura base sigue funcionando.
- Abrir un documento con assets locales soportados y verificar que resuelven correctamente.

## 9) Gate de cierre de fase

Fase 6 se marca `Done` solo si:

- Se cumplen los 8 bloques anteriores.
- Existe una versión desktop usable para escritura local real.
- Desktop ya puede sostener la promesa principal del producto sin depender del runtime web.
- Fase 7 puede enfocarse en capacidades remotas y paridad, no en terminar de hacer que desktop “por fin funcione”.
