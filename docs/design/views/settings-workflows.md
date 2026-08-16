# View — Settings › Workflows  *(not built — decision recorded)*

**Status: descartado en el design pass.** El 2026-08-16, en ODE-426, el dueño del diseño cerró las tres preguntas abiertas decidiendo que la feature no se construye. Este documento ya no es un encargo pendiente: es el registro de por qué no existe, para que nadie la vuelva a proponer sin saber qué se decidió.

No hay nada que implementar desde aquí. ODE-437, el issue de implementación, quedó sin arrancar.

## Qué se había pedido

Un workflow era **un conjunto ordenado de estados** por los que pasa un artifact — "Exploring → Draft → In review → Done" — para que el Desk pudiera mostrar qué está atascado y el editor pudiera ofrecer el siguiente paso. Se pedía como una quinta sección de Settings, con su propia lista, su modal editor y el reordenamiento de pasos.

## Qué se decidió

**No hay proceso ordenado que definir.** El estado de un artifact es un dato individual de ese artifact, no una posición dentro de una secuencia. Cualquier documento puede estar en cualquier estado, y puede ir de `in_review` a `draft` y de vuelta a `done` sin que eso sea una excepción a nada.

La lista plana de estados no era una versión incompleta de un workflow: era la respuesta correcta. Ponerle un orden encima habría añadido una capa de configuración que el producto no necesita.

### Las tres preguntas abiertas, cerradas

| Pregunta | Decisión |
| --- | --- |
| ¿Un workflow por tipo de artifact, o por workspace? | **Ninguno de los dos.** El estado se le pone al **artifact**, no a la carpeta ni al workspace. No hay un workflow al que asignar nada. |
| ¿Las transiciones hacia atrás son libres, o exigen nota de motivo? | **Libres.** Ir hacia atrás no es una excepción que haya que justificar; es uso normal. |
| ¿El Desk gana una vista de tablero agrupada por paso, o group-by-status ya lo cubre? | **No hay tablero.** Sin pasos, no hay nada por lo que agrupar que `group-by-status` no cubra ya. |

## Qué implica para el código

Nada cambia. Esta decisión confirma lo que el repo ya hace:

- Los estados siguen siendo la lista plana de `lib/writings/status.ts`, y `docs/design/views/settings.md` §"Artifact types and Status" sigue siendo su única autoridad de diseño.
- **No se añade el campo `workflow:` al frontmatter.** El `status` del artifact sigue siendo el único campo de estado, y sigue viajando dentro del `.md` como manda `workflow/context/core/odessay-adr-identidad.md`.
- El dropdown de estado en editor y preview **no se reordena**: no hay "next step" que poner primero, así que sigue mostrando la lista plana. Este era el único cambio de comportamiento que la feature iba a introducir fuera de su vista, y no ocurre.
- La nav de Settings se queda en cuatro secciones: Account · Artifact types · Status · Archived artifacts.
- `docs/design/overlays.md` no cambia: no hacía falta ninguna variante nueva, y ahora tampoco la fila de inventario.

## Si algún día se retoma

La anatomía completa que se había derivado —lista, fila de añadir, modal de 520px con sus campos en orden, reordenamiento con handle de 24px, estado vacío, tabla de errores y criterio de paridad— quedó escrita como **propuesta** en el comentario de handoff de [ODE-426](https://linear.app/hugo-marin/issue/ODE-426/design-pass-for-settings-workflows-and-close-its-three-open-questions). Se derivó de la tarjeta y el modal editor de `docs/design/reference/Artifact Studio Settings.dc.html`, porque Workflows nunca tuvo prototipo propio.

Retomarlo exige volver a abrir la pregunta de fondo, no la de diseño: **si el orden entre estados aporta algo que la lista plana no da.** Esa es la pregunta que se respondió que no. La anatomía es lo fácil; ya está resuelta y esperando si la respuesta cambia.

Dos restricciones que seguirían en pie si se retomara, y que conviene no volver a discutir desde cero:

- Un workflow sólo puede serializar como **un campo de frontmatter** (`workflow: name`), con el paso actual siendo el `status` existente. Ningún store durable nuevo.
- Una nota de motivo por transición **no cabe** en ese modelo: es un historial, y un historial es un store.
