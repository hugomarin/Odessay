# ODESSAY — Márgenes

**Documento de referencia para agentes de desarrollo.**
Lee `odessay-fundacional.md` para la visión, `odessay-flujos.md` para los flujos de escritura y lectura, y `odessay-ai-editor.md` para el agente AI.

---

## Qué son los márgenes

Los márgenes son el espacio de escritura que emerge mientras se lee. No son comentarios, no son feedback, no son anotaciones de revisión. Son escritura en gestación — fragmentos de pensamiento, conexiones, preguntas que el lector construye al margen del texto ajeno.

La metáfora es el libro físico anotado: el lector que subraya un pasaje y escribe en el margen "esto conecta con Davidson" o "¿pero no es esto lo que Weil llama atención?" no está evaluando el libro — está construyendo su propio pensamiento a partir de él.

En Odessay, los márgenes son writings en borrador. Cuando el lector termina de leer y anotar, tiene material para su respuesta. No escribe desde cero — escribe desde lo que fue construyendo al margen.

---

## Dos modos

### Márgenes privados

Por defecto, los márgenes son completamente privados. El autor del writing original nunca los ve. Son el espacio personal del lector — su diálogo con el texto.

Los márgenes privados se acumulan en el archivo del lector. Puede revisarlos, editarlos, convertirlos en writings propios. Son la memoria de su vida lectora en Odessay.

### Márgenes compartidos

El lector puede elegir compartir sus márgenes con el autor del writing. Esto no es "enviar comentarios" — es un gesto de intimidad intelectual: *"Te comparto lo que fui construyendo mientras te leía."*

El autor recibe los márgenes compartidos como un documento separado — no inline sobre su texto, sino como un writing paralelo. Los lee en su propio espacio de lectura, con la misma dignidad que cualquier writing recibido.

**Caso académico:** el autor puede pedir explícitamente a alguien que lea su writing con márgenes activos — "lee esto y dime lo que te construye." El revisor lee, anota, y comparte sus márgenes. El autor recibe una lectura anotada que no interrumpe ni corrige su texto, sino que construye a su lado.

La diferencia con Google Docs es filosófica: los comentarios de Docs viven **dentro** del texto, compitiendo con él. Los márgenes de Odessay son un **texto paralelo** — la lectura del lector, con su propia dignidad.

---

## Interfaz

### En la vista de lectura

Al seleccionar texto en la vista de lectura aparece un popup mínimo con dos acciones:

- **Marcar** — el pasaje queda resaltado en ámbar sutil. Sin texto adicional.
- **Anotar** — abre un campo de texto inline al margen del pasaje. El lector escribe lo que ese fragmento le construye.

Las anotaciones no interrumpen el texto. Viven en el margen derecho — en pantallas anchas aparecen al lado del párrafo relevante, en pantallas estrechas se acceden desde un panel lateral.

### Panel de márgenes

El panel de márgenes se abre desde el icono de líneas en la topbar de lectura. Muestra:

- Todos los pasajes marcados del writing actual
- El texto marcado en itálica como referencia
- La anotación del lector debajo
- La posibilidad de expandir y editar cada anotación

El panel no es de solo lectura — es un espacio de escritura. El lector puede seguir construyendo sus pensamientos mientras el texto original está visible.

### Colección de citas

Los márgenes de todos los writings leídos se acumulan en una sección especial del archivo del lector — separada de sus propios writings. Es su **colección de citas y pasajes**: fragmentos de otros que decidió guardar, con sus propias anotaciones.

Esta colección no es pública. Es privada como un cuaderno de lectura.

---

## Márgenes como puente a la respuesta

Cuando el lector decide responder a un writing, sus márgenes están disponibles como contexto en el editor. El editor puede mostrar los márgenes en un panel lateral mientras el autor escribe su respuesta — no como citas automáticas, sino como material disponible.

El autor decide qué incorporar a su respuesta, cómo, y en qué forma. Los márgenes son materia prima, no estructura.

Este flujo — leer → anotar al margen → escribir desde los márgenes — es el ciclo epistolar completo de Odessay. La respuesta no sale de la nada: sale de una lectura atenta.

---

## Implementación técnica

### Schema

```sql
-- Márgenes
CREATE TABLE margins (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reader_id       uuid REFERENCES profiles NOT NULL,
  writing_id      uuid REFERENCES writings NOT NULL,
  -- Posición en el documento
  anchor_start    int NOT NULL,  -- offset de caracteres en body_text
  anchor_end      int NOT NULL,
  anchor_text     text NOT NULL, -- el pasaje marcado (snapshot)
  -- Contenido
  type            text NOT NULL DEFAULT 'personal', -- personal | ai | collaborative | highlight
  text            text NOT NULL DEFAULT '',         -- contenido canónico de la anotación
  note            text,                             -- alias legacy mantenido por compatibilidad
  -- Estado
  shared          boolean NOT NULL DEFAULT false,
  shared_at       timestamptz,
  archived        boolean NOT NULL DEFAULT false,
  resolved        boolean NOT NULL DEFAULT false,
  -- Timestamps
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
```

### RLS

- `SELECT`: solo el `reader_id`. Si `shared = true`, también el autor del writing.
- `INSERT`: solo autenticados, solo sobre writings que pueden leer.
- `UPDATE`: solo el `reader_id`.
- `DELETE`: solo el `reader_id`.

### Notas de implementación

El `anchor_text` guarda un snapshot del pasaje marcado en el momento de la anotación. Esto protege contra cambios en el writing original — la referencia siempre apunta al texto correcto aunque el autor edite su writing después.

`text` es el campo canónico del contrato actual del adapter web. `note` se mantiene como alias legacy durante la transición para no romper readers o escrituras contra esquemas que todavía no hayan absorbido la expansión completa de `margins`.

La posición (`anchor_start`, `anchor_end`) se calcula sobre `body_text` (texto plano). Para renderizar el highlight en la vista de lectura se mapea la posición del texto plano a los nodos del JSON de TipTap.

Los márgenes compartidos no se convierten en un writing independiente en v1 — se comparten como colección de objetos `margin`. En v2 se puede explorar la posibilidad de que el lector "compile" sus márgenes en un writing propio antes de compartir.

---

## Relación con el AI editor

El AI editor tiene acceso a los márgenes del autor en el contexto de escritura de una respuesta. Puede observar: *"Marcaste tres pasajes sobre la idea de distancia. Tu respuesta aún no los ha integrado."*

El AI nunca cita los márgenes directamente ni los incorpora al texto. Solo los usa como contexto para sus observaciones — coherente con su rol de guardián del proceso, no generador de contenido.
