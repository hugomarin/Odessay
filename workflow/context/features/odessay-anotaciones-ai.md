# ODESSAY — Anotaciones expandidas: lectura, AI y síntesis

**Documento de referencia para agentes de desarrollo y diseño.**
Lee `odessay-margenes.md` antes de implementar — este documento extiende esa visión, no la reemplaza. Lee también `odessay-ai-editor.md` y `odessay-editor.md`.

---

## Visión

El trabajo con AI no es solo escribir — es leer críticamente lo que la AI produce, evaluarlo, cuestionarlo, y devolver instrucciones precisas. La escritura colaborativa con AI crea un ciclo continuo:

> **leer → anotar → la AI responde → leer de nuevo → anotar de nuevo**

Las anotaciones son el puente entre ambos modos. No son herramienta de escritura ni de revisión — son herramienta de **pensamiento activo** sobre cualquier texto, propio, ajeno o generado por AI.

Este documento define cómo expandir el sistema de márgenes existente para cubrir ese ciclo completo.

---

## Principio rector

Las anotaciones son el filtro del usuario sobre el texto — no el filtro de la AI.

Cuando el usuario anota, no está corrigiendo ni editando. Está dejando constancia de su perspectiva: lo que le resonó, lo que rechaza, lo que quiere profundizar, lo que quiere que la AI atienda. Ese filtro es lo más valioso del sistema porque es irreproducible por la AI.

---

## Tres tipos de anotación

El sistema de márgenes actual no distingue audiencia. La expansión introduce un campo `type` que define quién puede ver y usar cada anotación:

| Tipo | Propósito | Visibilidad |
|------|-----------|-------------|
| `personal` | Notas propias, dudas, reflexiones | Solo el autor. Nunca viaja a la AI ni a colaboradores. |
| `ai` | Instrucciones inline para la AI | El autor y la AI cuando se exporta contexto. |
| `collaborative` | Notas para otros lectores o revisores | El autor y las personas con acceso compartido. |

### Anotaciones `ai`

Son el tipo más nuevo y más relevante para este documento. El usuario selecciona un pasaje y escribe una instrucción directa:

> "Claude: esta frase no me convence, propón alternativas"
> "Claude: valida si esto es técnicamente correcto"
> "Claude: me gusta este tono, mantenerlo en el resto"

Estas anotaciones no modifican el texto — son instrucciones pendientes que viajan como contexto cuando el usuario decide consultarle a la AI.

### Anotaciones `personal`

Nunca salen del usuario. Son su cuaderno de lectura privado: dudas, conexiones con otros textos, ideas que surgieron al leer. La AI nunca las ve aunque el usuario exporte el writing.

### Anotaciones `collaborative`

Extienden la visión de márgenes compartidos de `odessay-margenes.md`. El revisor anota con intención de que el autor lea su lectura.

---

## Flujo de exportación a AI

El flujo correcto para enviar contexto a la AI es:

1. El usuario lee y anota con `type: ai` los pasajes que quiere atender
2. Usa **"Copiar con anotaciones AI"** — un botón que arma el markdown con las anotaciones embebidas en el texto
3. Pega ese markdown en Claude, ChatGPT, o cualquier cliente externo
4. El prompt del sistema ya sabe interpretar el formato de anotaciones

El markdown resultante embebe las anotaciones como comentarios inline:

```md
Cuando quitas gluten de una torta no solo cambias el sabor:
cambias la física de la masa y del horneado.
<!-- [NOTA AI]: esta explicación es demasiado técnica para el lector objetivo, simplificar -->
Las versiones "sin gluten y sin azúcar" quedan apretadas, gomosas, secas.
```

Este formato es:
- legible fuera de Odessay
- parseable por cualquier AI sin instrucciones especiales
- no invasivo para el texto principal

### Etiquetas rápidas

En el panel de anotaciones o en el input del chat, el usuario puede insertar etiquetas preset que no requieren escribir:

- `me gusta esto`
- `valida esto`
- `corrige esto`
- `mantén este tono`
- `demasiado técnico`
- `expandir esta idea`

Son shortcuts de anotación, no reemplazo del texto libre.

---

## Síntesis multi-texto

Este es el caso de uso más ambicioso y el que define el potencial a largo plazo del sistema.

### Flujo

1. El usuario crea un **proyecto de lectura** — agrupa varios writings o textos importados
2. Lee cada texto y anota los pasajes relevantes (tipo `personal` o `ai`)
3. Al terminar, la AI toma **todas las anotaciones del proyecto** — no los textos completos — y genera un texto unificado con los conceptos clave del usuario
4. Ese texto unificado es un writing nuevo en Odessay, propiedad del usuario

### Por qué las anotaciones y no los textos

El resumen que genera la AI está filtrado por **la perspectiva del usuario**, no por lo que la AI cree que es importante. Las anotaciones son el filtro.

Un resumen sin anotaciones es genérico. Un resumen construido sobre anotaciones del usuario es una síntesis del pensamiento de esa persona sobre ese conjunto de textos.

### Casos de uso

- Investigación: leer 10 artículos sobre un tema, anotar los conceptos clave para mi argumento, generar un texto unificado
- Aprendizaje: leer material generado por AI, anotar lo que no entendí o quiero profundizar, generar un resumen desde mi perspectiva
- Trabajo editorial: leer versiones o borradores, anotar lo que funciona y lo que no, generar una síntesis de criterios

---

## Lectura de texto generado por AI

Un caso especial que merece atención explícita: cuando el texto a leer fue generado por AI dentro de Odessay.

El usuario no necesariamente entiende, comparte o aprueba todo lo que la AI produce. Necesita herramientas para:

- marcar lo que sí funciona (`me gusta esto`)
- marcar lo que no convence sin saber aún por qué
- dejar instrucciones precisas para la siguiente iteración
- registrar su criterio editorial aunque no lo pueda articular todavía

Las anotaciones son exactamente eso. El ciclo de escritura colaborativa con AI no termina cuando la AI produce el texto — termina cuando el usuario ha leído, anotado y dado su veredicto.

---

## Interfaz

### Indicador de tipo en el margen

Cada anotación en el margen derecho muestra un indicador visual de su tipo:

- `personal` — icono de candado, tono neutro
- `ai` — icono de chispa o comando, tono destacado
- `collaborative` — icono de persona, tono cálido

El usuario cambia el tipo desde la propia anotación antes de guardar.

### Panel de anotaciones filtrado

El panel de márgenes puede filtrarse por tipo. En modo de preparación para AI, muestra solo las anotaciones `ai` activas — las que viajarán en el próximo export.

### Botón "Copiar con anotaciones AI"

Aparece en la topbar cuando hay anotaciones `ai` activas en el writing. Arma el markdown y lo copia al clipboard en un solo gesto.

---

## Alcance v1

### Sí entra

- campo `type` en la tabla `margins` con valores `personal | ai | collaborative`
- UI para seleccionar tipo al crear la anotación
- indicador visual por tipo en el margen derecho
- botón "Copiar con anotaciones AI" que genera markdown con anotaciones `ai` embebidas
- etiquetas rápidas preset en el panel de anotaciones

### No entra

- síntesis multi-texto automatizada
- proyectos de lectura como entidad propia
- envío directo a la API de Claude desde el panel (el flujo es copiar/pegar)
- MCP server para acceso externo

---

## Schema

Extensión de la tabla `margins` existente:

```sql
ALTER TABLE margins
  ADD COLUMN type text NOT NULL DEFAULT 'personal'
    CHECK (type IN ('personal', 'ai', 'collaborative'));
```

RLS: las anotaciones `personal` solo las ve el `reader_id` incluso si el writing es compartido. Las `ai` siguen la misma regla. Las `collaborative` las ve también el autor del writing si `shared = true`.

---

## Decisiones explícitas

1. Las anotaciones `personal` **nunca** viajan a la AI ni a colaboradores bajo ninguna circunstancia.
2. El flujo de exportación es **copiar/pegar** en v1 — no integración directa con la API de Claude.
3. El formato de embedding en markdown usa **comentarios HTML** (`<!-- -->`) para ser compatible con cualquier renderer y cualquier AI.
4. La síntesis multi-texto no entra en v1 — el valor en v1 es el filtro de perspectiva por anotación, no la automatización del resumen.
5. Las etiquetas rápidas son shortcuts de texto, no tipos especiales — insertan texto libre en el campo de anotación.

---

## Criterio de éxito

La implementación es correcta si el usuario puede:

1. seleccionar un pasaje de cualquier texto,
2. dejarlo como nota personal, instrucción para AI, o nota colaborativa,
3. al terminar la lectura, copiar el writing con las anotaciones AI embebidas en un solo gesto,
4. pegar ese markdown en Claude o ChatGPT y obtener una respuesta que atiende exactamente los pasajes anotados,
5. sin que sus notas personales hayan salido del sistema.
