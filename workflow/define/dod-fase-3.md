# ODESSAY — Fase 3 Definition of Done (DoD)

Este documento define el gate de cierre de **Fase 3 — Organizar y publicar**.
Si un punto no está cumplido, la fase no se considera terminada.

El objetivo central de esta fase es que Odessay pueda reemplazar cualquier otra herramienta de escritura en el flujo de trabajo diario del autor. Al terminar Fase 3, no debería ser necesario abrir iA Writer, Notion ni ningún editor externo para escribir, editar, organizar ni preparar textos para publicación.

Referencias:
- `workflow/define/roadmap.md`
- `workflow/context/features/odessay-editor.md`
- `workflow/context/features/odessay-collections.md`
- `workflow/context/features/odessay-margenes.md`
- `workflow/context/core/odessay-arquitectura.md`
- `.agents/skills/skill-design/vistas.md`

---

## 1) Workspace multi-documento

- El editor soporta múltiples writings abiertos en paralelo como pestañas persistentes.
- Cambiar de pestaña no requiere salir del editor, volver al desk ni recargar.
- Cada pestaña muestra: título del writing, indicador de estado de guardado (`Saved` / `Saving...` / `Error`), punto rojo si hay cambios no guardados.
- Cerrar una pestaña no cierra las demás ni pierde el estado de las otras.
- Al reabrir la app, las pestañas abiertas se restauran con su contenido y posición de cursor.
- Límite razonable de pestañas simultáneas: mínimo 5 sin degradación de rendimiento.

## 2) Documentos recientes en sidebar

- El sidebar expandido incluye bloque "Recientes" con los últimos 8 writings abiertos, ordenados por `updated_at` descendente.
- Hacer clic en un reciente abre el writing en una nueva pestaña dentro del editor — sin redirigir al desk.
- El bloque de recientes se actualiza en tiempo real al abrir o guardar un writing.
- Si el writing ya está abierto en una pestaña, el clic lleva foco a esa pestaña en lugar de abrir una duplicada.

## 3) Find & Replace en el editor

- `Cmd+F` (Mac) / `Ctrl+F` (Windows/Linux) abre el panel de búsqueda dentro del writing activo.
- El panel aparece integrado en el editor (no modal), sin interrumpir el texto visible.
- Búsqueda en tiempo real: resalta todas las coincidencias mientras se escribe.
- Navegación entre coincidencias: `Enter` / `Shift+Enter` o botones siguiente/anterior.
- `Cmd+H` / `Ctrl+H` expande el panel para mostrar el campo de reemplazo.
- Reemplazar una coincidencia: sustituye la selección activa y avanza a la siguiente.
- Reemplazar todas: aplica el reemplazo a todas las coincidencias con confirmación del número de cambios.
- Opción de búsqueda con distinción de mayúsculas/minúsculas.
- `Escape` cierra el panel y devuelve el foco al editor.

## 4) Métricas de selección en tiempo real

- Cuando el autor selecciona texto en el editor, la statusbar muestra las métricas de la selección activa: palabras seleccionadas y caracteres seleccionados.
- Cuando no hay selección, la statusbar muestra las métricas del documento completo (palabras, caracteres, oraciones, tiempo de lectura, páginas).
- La transición entre ambos modos es inmediata y sin parpadeo.
- Las métricas de selección no bloquean ni interrumpen la escritura.

## 5) Optimización para publicación con AI

- El editor expone un modo "Listo para publicar" activable desde topbar o panel Properties.
- En este modo, la AI analiza el texto y produce:
  - Correcciones ortográficas y gramaticales con diff claro (texto original vs. sugerido).
  - Sugerencias de mejora de redacción (claridad, fluidez, tono) presentadas bloque a bloque.
  - Checklist de publicación con observaciones accionables.
- El autor puede aceptar o rechazar cada sugerencia de forma individual.
- "Aplicar todo" acepta todas las sugerencias pendientes con una sola acción.
- El texto original se preserva hasta que el autor confirma un cambio — nunca se modifica sin acción explícita.
- El modo es desactivable en cualquier momento sin perder el texto.

## 6) Preview compartida con márgenes visibles

- El autor puede marcar anotaciones de margen como "compartidas" desde el panel de márgenes.
- Cuando se genera un link de preview, el destinatario ve los highlights y anotaciones marcadas como compartidas en su reading view.
- Las anotaciones privadas del autor nunca son visibles en la preview compartida.
- El autor tiene control explícito por anotación: un toggle o acción clara de "compartir esta nota".
- El estado de visibilidad de cada anotación es persistente y editable después de compartir.

## 7) Collections

- El autor puede crear, editar, renombrar y eliminar collections.
- Puede asignar un writing a una o más collections desde el panel Properties del editor y desde la vista /collections.
- Collections públicas aparecen en el espacio público `/{username}`.
- Banner "Sin clasificar" siempre visible cuando hay writings sin asignar a ninguna collection.
- Las collections son expandibles en la vista sin navegar a otra página.

## 8) Consistencia tipográfica cross-mode

- El texto de un writing se ve idéntico en `/write`, en la preview compartida y en `/{username}/{slug}`.
- Sin desajustes de spacing, line-height, overflow de tablas ni cortes visuales entre vistas.
- La clase `odessay-rich-content` (o equivalente) es la única fuente de verdad tipográfica para todo contenido de writing.

## 9) Flujos de cuenta

- **Recuperación de contraseña:** flujo completo funcional — solicitud → email → ruta `/auth/reset-password` → redirect a /desk. Token, expiración y sesión manejados por Supabase Auth; email enviado por Supabase Auth vía custom SMTP.
- **Ajustes de perfil:** el autor puede cambiar email (con reconfirmación), contraseña, username y display name desde Settings. Validación con Zod. Feedback de éxito/error inmediato.
- Ambos flujos son accesibles sin bugs en staging y producción.

## 10) Email transaccional

- Supabase Auth custom SMTP configurado en producción (no solo staging) con Resend como proveedor SMTP.
- Dominio de auth verificado: `auth.odessay.com`.
- Templates funcionales en Supabase Auth para: confirmación de cuenta post-signup, recuperación de contraseña, cambio de email y reautenticación si aplica.
- Los emails de auth tienen tono coherente con Odessay: sobrios, claros, un CTA, sin marketing.
- En staging, los emails van a direcciones de prueba configuradas — nunca a destinatarios reales.
- Los emails no-auth (invitaciones, writing recibido) se tratan separado de Supabase Auth.

## 11) Páginas públicas

- `/` (landing), `/manifesto`, `/about`, `/terms`, `/privacy` funcionan sin autenticación.
- La landing tiene el diseño especificado en `workflow/define/roadmap.md` (Fase 3): columna única, sin hero genérico, párrafo fundacional en Lora 22px, un solo CTA terracota.
- Las páginas de términos y privacidad tienen contenido real, no placeholder.
- El acceso a `/login` y `/signup` es visible desde todas las páginas públicas.

## 12) Calidad de entrega (gate técnico)

- `typecheck` verde.
- `lint` verde.
- `tests` verdes (suite hermética sin dependencias externas en base).
- Evidencia manual de los flujos críticos de reemplazo de herramienta externa:
  - Abrir 3 writings en paralelo → cambiar entre pestañas → cerrar una → las demás permanecen intactas.
  - Abrir un reciente desde el sidebar sin pasar por /desk.
  - Find & Replace: buscar una palabra → navegar coincidencias → reemplazar una → reemplazar todas.
  - Seleccionar 50 palabras → verificar que statusbar muestra count de selección → deseleccionar → vuelve a métricas de documento.
  - Activar modo publicación → aceptar una sugerencia → rechazar otra → aplicar todo al resto.
  - Crear anotación en margen → marcarla como compartida → abrir la preview → verificar que aparece.
  - Crear una collection → asignar dos writings → verificar en /collections y en espacio público.

## 13) Gate de cierre de fase

Fase 3 se marca `Done` solo si:
- Se cumplen los 12 bloques anteriores.
- El autor puede completar una sesión de trabajo real en Odessay sin necesidad de abrir ninguna herramienta de escritura externa (iA Writer, Notion, Google Docs, etc.).
- Al menos una ronda de uso real documentada con feedback registrado en Linear.
- Sin regresiones críticas en editor, auto-save, sync ni desk de Fases 1 y 2.
