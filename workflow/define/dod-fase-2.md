# ODESSAY — Fase 2 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 2 — Compartir y leer**.
Si un punto no está cumplido, la fase no se considera terminada.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/context/features/odessay-espacio-publico.md`
- `workflow/context/features/odessay-margenes.md`
- `workflow/context/core/odessay-arquitectura.md`
- `workflow/context/core/odessay-modelo-datos.md`
- `.agents/skills/skill-design/vistas.md`

---

## 1) Gestión completa en /desk

- El usuario puede **eliminar** un writing desde el desk con confirmación explícita antes de borrar.
- La eliminación es **soft delete**: escribe `deleted_at` en la tabla `writings`. El writing no se muestra en el desk ni en ninguna otra vista para el autor.
- Si el writing tiene un link de preview activo o shares en `writing_shares`, se revocan al eliminar.
- El writing desaparece de la lista en el mismo acto sin recargar la página.

## 2) Visibilidad shared y public

- El usuario puede cambiar la visibilidad de un writing entre `private`, `shared` y `public` desde el panel Properties del editor.
- La transición es bidireccional en cualquier dirección y en cualquier momento.
- RLS refleja correctamente cada estado: `private` solo visible por el autor, `shared` visible por usuarios en `writing_shares`, `public` accesible sin autenticación.

## 3) Compartir con usuarios específicos

- El usuario puede buscar otro usuario por username o email y compartir un writing con él.
- Puede revocar el acceso en cualquier momento desde el panel Properties.
- El destinatario puede ver el writing recibido en `/shared`.
- El campo `can_respond` controla si el destinatario puede responder (base para Fase 3).

## 4) Vista de lectura dedicada

- Vista de pantalla completa sin sidebar, sin toolbar, sin posibilidad de editar.
- Tipografía: autor + título en Lora 30px, cuerpo Geist Sans 17px / line-height 1.85.
- Topbar 46px con back link, navegación Previous/Next y botón "Write a response" en terracota.
- Navegación entre writings con flechas de teclado. ESC para volver.

## 5) Márgenes — highlights y anotaciones

- El lector puede seleccionar texto en la reading view → popup mínimo (Mark / Annotate).
- Highlights en ámbar. Anotaciones con burbuja de anotación visible.
- Panel de márgenes 296px accesible desde topbar en reading view.
- Márgenes privados por default. Compartibles con el autor.
- Anclados a offsets de `body_text`.

## 6) Espacio público del autor

- Ruta `/{username}` muestra writings y collections públicas del autor sin métricas visibles.
- Ruta `/{username}/{slug}` muestra un writing público en la reading view.
- El slug se genera automáticamente desde el título (trigger ya definido en schema).
- El autor tiene toggle "cómo me ven" / "todo mi contenido" en su vista propia.

## 7) Exportación de documentos

- Desde el editor, el usuario puede exportar el writing activo a:
  - `.md` — Markdown plano compatible con el parser del proyecto.
  - `.pdf` — PDF legible con tipografía Odessay (Lora + Geist Sans), título y cuerpo.
  - `.docx` — Documento Word con estructura título + cuerpo.
- El archivo exportado usa el título del writing como nombre de archivo.
- La acción de exportar es accesible desde el editor (topbar o panel Properties).

## 8) Lectura en mobile

- Las rutas `/{username}/{slug}` y `/shared` funcionan en mobile sin errores.
- `/write` muestra mensaje amable indicando que la escritura es en desktop.
- Tipografía adaptada a pantallas pequeñas según tabla responsive del proyecto.

## 9) Calidad de entrega (gate técnico)

- `typecheck` verde, `lint` verde, `tests` verdes.
- Evidencia manual de flujos clave:
  - Escribir → cambiar visibilidad a `shared` → buscar usuario → compartir → el destinatario lee en `/shared`.
  - Exportar a `.md`, `.pdf` y `.docx` desde el editor con writing con contenido real.
  - Eliminar un writing desde el desk → confirmación → desaparece de la lista.
  - Visitar `/{username}/{slug}` como visitante no autenticado → reading view sin errores.
  - Crear highlight y anotación en la reading view → visible en panel de márgenes.

## 10) Gate de cierre de fase

Fase 2 se marca `Done` solo si:
- Se cumplen los 9 bloques anteriores.
- Al menos una ronda de evaluación con un usuario real del flujo compartir → leer.
- Sin regresiones en editor, desk ni sync de Fase 1.
