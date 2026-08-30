---
name: odessay-typography
description: >
  Contrato tipográfico canónico de Odessay. Usar cuando el usuario pida ajustar, revisar,
  extender o escribir CSS tipográfico para Odessay. También triggear cuando mencione
  .odessay-editor-content, .prose-odessay, escala tipográfica, ritmo vertical, headings,
  blockquote, listas, tablas, caption, o cualquier elemento tipográfico del editor o la
  vista de lectura.
---

# Odessay — Contrato Tipográfico

Sistema tipográfico canónico compartido por editor y lectura. Un solo contrato para `.odessay-editor-content` + `.prose-odessay`.

## Delta 3 — el cuerpo del editor es 17px / 1.9

Resuelto en ODE-425. El paquete Artifact Studio y `globals.css` daban dos respuestas: 17/1.9 (prototipo) y 18/1.85 (repo). **Gana 17/1.9.** Razones, en orden de peso:

1. **Es el valor del prototipo, que es la autoridad visual de la fase.** `docs/design/reference/Artifact Studio Studio.dc.html` declara el cuerpo de la hoja como `font: 400 17px/1.9 'DM Sans'`, afinado contra una hoja de 720px.
2. **Unifica editor y lectura.** La tabla de este skill ya pedía 17px en el cuerpo de lectura. Mantener 18px en el editor obligaba a sostener dos tamaños de cuerpo para el mismo contenido según la superficie que lo renderiza.
3. **La medida no depende del ancho de la hoja.** La columna está expresada en `ch` (68ch para prosa, 54ch para blockquote), así que sigue siendo de 68 caracteres tanto en la hoja de 860px vigente como en la de 720px que llega con el rediseño del shell. El cambio no queda a la espera de ese rediseño.
4. **El ritmo vertical apenas se mueve.** La caja de línea pasa de 33.3px (18 × 1.85) a 32.3px (17 × 1.9): −3%. El interlineado relativo sube, así que la mancha de texto queda algo más aireada, no más apretada.

**Se aplica en un solo lugar:** la regla agrupada `.odessay-editor-content, .prose-odessay` de `app/globals.css`. Esa regla es la que gobierna las cuatro superficies del contrato de presentación — `/write/[id]`, `/preview/[token]`, `/shared/[id]` y `/{username}/{slug}` — porque las cuatro llegan a ella por una de esas dos clases. Ninguna superficie declara su propio `font-size` de cuerpo; si alguna lo hiciera, rompería el contrato.

**Excepción acoplada:** `.odessay-markdown-source` y `.odessay-markdown-semantic` (el par apilado del modo markdown) también pasan a 17/1.9. No son una segunda decisión: son un overlay transparente sobre su capa semántica y deben mantener métricas idénticas entre sí, y seguir al cuerpo para que alternar de modo no cambie el tamaño del texto.

**Fuera de este cambio:** el override móvil (`max-width: 699px` → 16px/1.75) se mantiene como está.

## Principios del sistema

1. Un solo contrato tipográfico compartido; excepciones solo de contexto (`caret-color`, `min-height`, `::selection`, `.hl`, mobile prose).
2. Base en `17px` solo en contenedor; hijos tipográficos escalan en `em`.
3. Escala Major Third (1.25) sin valores ad hoc.
4. Jerarquía por tokens de color (`--ink*`) antes que sobrecargar `font-weight`.
5. `line-height` siempre unitless.
6. Heading con más aire antes que después.
7. Columna de prosa `68ch`, blockquote `54ch`.
8. Tablas con `th` small-caps y metadata en `--od-font-meta`.
9. Preservar overflow interno de tablas grandes (`tableWrapper` + `width: max-content`).

## Preferencia global de estilo

El tamaño, ritmo vertical y pesos permanecen canónicos. Solo cambia la familia tipográfica del contenido mediante una preferencia local por dispositivo:

| Valor | Nombre | Cuerpo | Headings / título / blockquote |
|---|---|---|---|
| `quine` | Quine · Contemporary | `--od-font-ui` | `--od-font-ui` |
| `kant` | Kant · Balanced | `--od-font-ui` | `--od-font-prose` |
| `descartes` | Descartes · Classic | `--od-font-prose` | `--od-font-prose` |

`kant` es el fallback. La selección vive en settings locales, no en metadata documental. Las cuatro superficies del contrato leen los tokens `--od-writing-body-font`, `--od-writing-heading-font` y `--od-writing-quote-font`; ninguna vista decide la familia por separado. Código, tablas funcionales, captions y metadata conservan sus fuentes semánticas.

### Tabla de escala tipográfica (canónica)

| step | Elemento | Tamaño | px aprox |
|---|---|---|---|
| step-5 | h1 | 1.75em | ~30px |
| step-4 | h2 | 1.5em | ~25.5px |
| step-3 | h3 | 1.25em | ~21px |

### Tabla de line-height (canónica)

| Elemento | line-height |
|---|---|
| h1 | 1.2 |
| h2 | 1.25 |
| h3 | 1.3 |

### Tabla de ritmo vertical (canónica)

| Elemento | margin-top | margin-bottom |
|---|---|---|
| h1 | 1.8em | 0.3em |
| h2 | 1.5em | 0.3em |
| h3 | 1.2em | 0.25em |

### Tabla de weights y colores (canónica)

| Elemento | Regla |
|---|---|
| body / p | color `--ink-2` |
| strong / b | `font-weight: 500`, color `--ink` |

## CSS canónico (alineado al estado real de `app/globals.css`)

```css
.odessay-editor-content,
.prose-odessay {
  color: hsl(var(--ink-2));
  font-family: var(--od-writing-body-font);
  font-size: 17px;
  font-weight: 400;
  line-height: 1.9;
}

.odessay-editor-content h1,
.odessay-editor-content h2,
.odessay-editor-content h3,
.prose-odessay h1,
.prose-odessay h2,
.prose-odessay h3 {
  color: hsl(var(--ink));
  font-family: var(--od-writing-heading-font);
  font-weight: 500;
}

.odessay-editor-content h1,
.prose-odessay h1 {
  font-size: 1.75em;
  line-height: 1.2;
  letter-spacing: -0.02em;
  margin-top: 1.8em;
  margin-bottom: 0.3em;
}

.odessay-editor-content h2,
.prose-odessay h2 {
  font-size: 1.5em;
  line-height: 1.25;
  letter-spacing: -0.015em;
  margin-top: 1.5em;
  margin-bottom: 0.3em;
}

.odessay-editor-content h3,
.prose-odessay h3 {
  font-size: 1.25em;
  line-height: 1.3;
  letter-spacing: -0.01em;
  margin-top: 1.2em;
  margin-bottom: 0.25em;
}

.odessay-editor-content p + h1,
.odessay-editor-content ul + h1,
.odessay-editor-content ol + h1,
.odessay-editor-content blockquote + h1,
.prose-odessay p + h1,
.prose-odessay ul + h1,
.prose-odessay ol + h1,
.prose-odessay blockquote + h1 { margin-top: 2.3em; }

.odessay-editor-content p + h2,
.odessay-editor-content ul + h2,
.odessay-editor-content ol + h2,
.odessay-editor-content blockquote + h2,
.prose-odessay p + h2,
.prose-odessay ul + h2,
.prose-odessay ol + h2,
.prose-odessay blockquote + h2 { margin-top: 2.1em; }

.odessay-editor-content p + h3,
.odessay-editor-content ul + h3,
.odessay-editor-content ol + h3,
.odessay-editor-content blockquote + h3,
.prose-odessay p + h3,
.prose-odessay ul + h3,
.prose-odessay ol + h3,
.prose-odessay blockquote + h3 { margin-top: 1.9em; }

.odessay-editor-content h1 + p, .prose-odessay h1 + p { margin-top: 0.75em; }
.odessay-editor-content h2 + p, .prose-odessay h2 + p { margin-top: 0.65em; }
.odessay-editor-content h3 + p, .prose-odessay h3 + p { margin-top: 0.55em; }

.odessay-editor-content p,
.prose-odessay p {
  margin-bottom: 1.4em;
  max-width: 68ch;
}

.odessay-editor-content .lead,
.prose-odessay .lead {
  font-size: 1.25em;
  font-weight: 300;
  line-height: 1.6;
  color: hsl(var(--ink-2));
  max-width: 60ch;
  margin-bottom: 1.6em;
}

.odessay-editor-content ul,
.odessay-editor-content ol,
.prose-odessay ul,
.prose-odessay ol {
  padding-left: 1.4em;
  margin-bottom: 1.2em;
  max-width: 68ch;
}

.odessay-editor-content li,
.prose-odessay li {
  margin-bottom: 0.5em;
  padding-left: 0.2em;
  line-height: 1.7;
}

.odessay-editor-content li:last-child,
.prose-odessay li:last-child { margin-bottom: 0; }

.odessay-editor-content li p,
.prose-odessay li p {
  margin-top: 0;
  margin-bottom: 0.25em;
}

.odessay-editor-content li p:last-child,
.prose-odessay li p:last-child { margin-bottom: 0; }

.odessay-editor-content blockquote,
.prose-odessay blockquote {
  border-left: 1.5px solid hsl(var(--cursor));
  color: hsl(var(--ink-3));
  font-family: var(--od-writing-quote-font);
  font-size: 1.35em;
  font-style: italic;
  font-weight: 400;
  line-height: 1.55;
  margin-block: 1.8em;
  margin-inline: 0;
  padding-left: 1.1em;
  max-width: 54ch;
}

.odessay-editor-content blockquote cite,
.prose-odessay blockquote cite {
  display: block;
  margin-top: 0.6em;
  font-family: var(--od-font-meta);
  font-size: 0.65em;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: hsl(var(--ink-4));
}

.odessay-editor-content strong,
.odessay-editor-content b,
.prose-odessay strong,
.prose-odessay b {
  font-weight: 500;
  color: hsl(var(--ink));
}

.odessay-editor-content mark,
.prose-odessay mark {
  background: hsl(45 90% 84%);
  border-radius: 2px;
  padding: 0;
  color: inherit;
}

.odessay-editor-content kbd,
.prose-odessay kbd { font-family: var(--od-font-meta); }

.odessay-editor-content th,
.prose-odessay th { font-family: var(--od-font-meta); }

.odessay-editor-content figcaption,
.odessay-editor-content .caption,
.prose-odessay figcaption,
.prose-odessay .caption { font-family: var(--od-font-meta); }

.prose-odessay .hl {
  background: hsl(45 90% 84%);
  border-radius: 2px;
  cursor: pointer;
  padding: 0;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
}

@media (max-width: 699px) {
  .prose-odessay {
    font-size: 16px;
    line-height: 1.75;
  }

  .prose-odessay h1 { font-size: 1.5em; }
  .prose-odessay h2 { font-size: 1.22em; }
  .prose-odessay h3 { font-size: 1.05em; }
  .prose-odessay blockquote { font-size: 1.05em; padding-left: 1em; }
}

.odessay-editor-content table,
.prose-odessay table {
  display: block;
  max-width: 100%;
  min-width: 100%;
  overflow-x: auto;
  -webkit-overflow-scrolling: touch;
  width: max-content;
}

.odessay-table-wrap,
.prose-odessay-table-wrap,
.odessay-rich-content .tableWrapper {
  margin: 1.6em 0;
  max-width: 100%;
  width: 100%;
  overflow-x: auto;
  overflow-y: hidden;
  -webkit-overflow-scrolling: touch;
}

.odessay-table-wrap > table,
.prose-odessay-table-wrap > table,
.odessay-rich-content .tableWrapper > table {
  min-width: 100%;
  width: max-content;
}

.odessay-editor-content .tableWrapper > table,
.prose-odessay .tableWrapper > table {
  display: table;
  margin: 0;
  max-width: none;
  overflow: visible;
}
```

## Checklist rápido

- [ ] Selectores agrupados para editor + prose cuando aplica
- [ ] Tipografía con `--od-font-prose` / `--od-font-ui` / `--od-font-meta`
- [ ] Heading con `margin-top` base + reglas `p + h*` intactas
- [ ] `li > p` sin margen excesivo
- [ ] `mark` y `.hl` sin padding extra
- [ ] Overflow horizontal de tablas preservado

## Qué NO hacer

- `font-size: 2.441em` en `h1` — la escala es editorial, no display.
- `font-weight: 600` en `strong/b` — el peso canónico es 500 para mantener la jerarquía dentro de la escala DM Sans.
