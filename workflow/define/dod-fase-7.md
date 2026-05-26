# ODESSAY — Fase 7 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 7 — Capacidades Remotas y Paridad Web/Desktop**.
Si un punto no está cumplido, la fase no se considera terminada.

El objetivo central de esta fase es cerrar la convergencia del producto. Al terminar, desktop y web ya no deben sentirse como productos separados ni como implementaciones con reglas incompatibles. La red vuelve a entrar, pero como capacidad del sistema local-first, no como condición de existencia del documento.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/define/dod-fase-6.md`
- `workflow/context/features/odessay-desktop-app.md`
- `workflow/context/features/odessay-desktop-target-architecture.md`
- `workflow/context/features/odessay-desktop-migration-plan.md`
- `workflow/context/features/odessay-prosemirror-tiptap.md`
- `workflow/context/core/odessay-stack.md`
- `.agents/skills/skill-architecture/SKILL.md`
- `.agents/skills/skill-product-manager/SKILL.md`

---

## 1) Capacidades remotas integradas sin romper local-first

- Desktop puede conectarse a capacidades remotas relevantes del producto sin perder su naturaleza local-first.
- El documento sigue existiendo y operando localmente aunque fallen auth, sync, publishing o AI.
- La red extiende el sistema; no reemplaza su base documental.

## 2) Paridad contractual entre web y desktop

- Web y desktop preservan el mismo contrato documental.
- Los invariantes centrales del producto son consistentes entre runtimes.
- Las diferencias entre superficies se explican por runtime y UX, no por semánticas incompatibles del documento.

## 3) Capacidades compatibles entre runtimes

- Sync, auth, AI, publishing y sharing se entienden como capacidades compatibles con ambos runtimes.
- No se exige identidad visual absoluta ni idéntica implementación interna, pero sí compatibilidad funcional y contractual.
- No hay zonas grises donde una superficie produzca documentos o estados que la otra no pueda interpretar razonablemente.

## 4) Política operativa de coexistencia

- Existe una política clara sobre:
  - releases
  - convivencia web/desktop
  - migración desde el runtime web actual
  - qué funciona offline
  - qué depende de login
  - qué se sincroniza y cómo
- El producto ya puede explicarse como una sola plataforma con más de una superficie.

## 5) Promesa percibida por el usuario en esta fase

Al cerrar Fase 7, el usuario debe poder entender algo simple:

- puede escribir localmente en desktop
- puede seguir usando web cuando le convenga
- sus documentos mantienen coherencia entre superficies
- las capacidades remotas agregan valor sin quitarle propiedad ni control sobre el documento

## 6) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes.
- Existe evidencia reproducible de paridad cross-runtime para los flujos relevantes.
- La documentación operativa y de arquitectura queda alineada con el estado final de convergencia.

## 7) Evidencia manual mínima

- Crear o editar documento en desktop → sincronizar o abrir su equivalente en web → verificar coherencia documental.
- Publicar o compartir desde la superficie soportada → validar que el resultado respeta el mismo contrato del writing.
- Usar capacidades remotas desde desktop sin que la app deje de funcionar localmente cuando la red falla.
- Confirmar que auth y capacidades remotas no vuelven a convertir desktop en un cliente subordinado al runtime web.

## 8) Gate de cierre de fase

Fase 7 se marca `Done` solo si:

- Se cumplen los 7 bloques anteriores.
- Desktop y web pueden describirse honestamente como dos runtimes del mismo producto.
- No quedan contradicciones estructurales visibles entre documento, save-path, sync o capacidades remotas.
- El producto queda listo para retomar líneas diferidas de valor, como Writing Harness, correspondencias o distribución, sin reabrir la base de plataforma.
