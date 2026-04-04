---
name: skill-design/tipografia
description: Contrato tipográfico canónico de Odessay para superficies de escritura y lectura. Fuente de verdad para .odessay-editor-content y .prose-odessay.
---

# Skill: Design — Tipografía (Odessay)

Este documento preserva el contrato tipográfico canónico para evitar drift entre `write`, `preview`, `shared` y `public`.

Regla operativa: cuando un issue toque presentación textual, este archivo es obligatorio junto con `SKILL.md` y `vistas.md`.

```css
/* ============================================
   ODESSAY — CONTRATO TIPOGRÁFICO CANÓNICO
   Shared by .odessay-editor-content + .prose-odessay
   Última revisión: abril 2026
   ============================================ */

/* --------------------------------------------
   BASE
   -------------------------------------------- */

.odessay-editor-content,
.prose-odessay {
  color: hsl(var(--ink-2));
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 18px;
  font-weight: 400;
  line-height: 1.85;
}

/* --------------------------------------------
   HEADINGS — familia, peso, color compartidos
   -------------------------------------------- */

.odessay-editor-content h1,
.odessay-editor-content h2,
.odessay-editor-content h3,
.prose-odessay h1,
.prose-odessay h2,
.prose-odessay h3 {
  color: hsl(var(--ink));
  font-family: var(--font-lora), Georgia, serif;
  font-weight: 500;
}

.odessay-editor-content h1,
.prose-odessay h1 {
  font-size: 2.441em;
  line-height: 1.15;
  letter-spacing: -0.02em;
}

.odessay-editor-content h2,
.prose-odessay h2 {
  font-size: 1.953em;
  line-height: 1.25;
  letter-spacing: -0.015em;
}

.odessay-editor-content h3,
.prose-odessay h3 {
  font-size: 1.563em;
  line-height: 1.3;
  letter-spacing: -0.01em;
}

/* --------------------------------------------
   RITMO VERTICAL — antes de heading
   -------------------------------------------- */

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

/* --------------------------------------------
   RITMO VERTICAL — después de heading
   -------------------------------------------- */

.odessay-editor-content h1 + p, .prose-odessay h1 + p { margin-top: 0.75em; }
.odessay-editor-content h2 + p, .prose-odessay h2 + p { margin-top: 0.65em; }
.odessay-editor-content h3 + p, .prose-odessay h3 + p { margin-top: 0.55em; }

/* --------------------------------------------
   PÁRRAFOS
   -------------------------------------------- */

.odessay-editor-content p,
.prose-odessay p {
  margin-bottom: 1.4em;
  max-width: 68ch;
}

/* Lead / intro */
.odessay-editor-content .lead,
.prose-odessay .lead {
  font-size: 1.25em;
  font-weight: 300;
  line-height: 1.6;
  color: hsl(var(--ink-2));
  max-width: 60ch;
  margin-bottom: 1.6em;
}

/* --------------------------------------------
   LISTAS
   -------------------------------------------- */

.odessay-editor-content ul,
.odessay-editor-content ol,
.prose-odessay ul,
.prose-odessay ol {
  padding-left: 1.4em;
  margin-bottom: 1.2em;
  max-width: 68ch;
}

/* Unordered — tres niveles */
.odessay-editor-content ul, .prose-odessay ul { list-style-type: disc; }
.odessay-editor-content ul ul, .prose-odessay ul ul { list-style-type: circle; }
.odessay-editor-content ul ul ul, .prose-odessay ul ul ul { list-style-type: square; }

/* Ordered — tres niveles */
.odessay-editor-content ol, .prose-odessay ol { list-style-type: decimal; }
.odessay-editor-content ol ol, .prose-odessay ol ol { list-style-type: lower-alpha; }
.odessay-editor-content ol ol ol, .prose-odessay ol ol ol { list-style-type: lower-roman; }

.odessay-editor-content li,
.prose-odessay li {
  margin-bottom: 0.5em;
  padding-left: 0.2em;
  line-height: 1.7;
}

.odessay-editor-content li:last-child,
.prose-odessay li:last-child { margin-bottom: 0; }

.odessay-editor-content li ul,
.odessay-editor-content li ol,
.prose-odessay li ul,
.prose-odessay li ol {
  margin-top: 0.4em;
  margin-bottom: 0;
  padding-left: 1.2em;
}

/* --------------------------------------------
   BLOCKQUOTE
   -------------------------------------------- */

.odessay-editor-content blockquote,
.prose-odessay blockquote {
  border-left: 1.5px solid hsl(var(--cursor));
  color: hsl(var(--ink-3));
  font-family: var(--font-lora), Georgia, serif;
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
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 0.65em;
  font-style: normal;
  font-weight: 400;
  letter-spacing: 0.04em;
  color: hsl(var(--ink-4));
}

/* --------------------------------------------
   INLINE — strong, em, mark, s, a
   -------------------------------------------- */

.odessay-editor-content strong,
.odessay-editor-content b,
.prose-odessay strong,
.prose-odessay b {
  font-weight: 500;
  color: hsl(var(--ink));
}

.odessay-editor-content em,
.prose-odessay em { font-style: italic; }

.odessay-editor-content mark,
.prose-odessay mark {
  background: hsl(45 90% 84%);
  border-radius: 2px;
  padding: 0 0.08em;
  color: inherit;
}

.odessay-editor-content s,
.prose-odessay s {
  text-decoration: line-through;
  color: hsl(var(--ink-3));
  text-decoration-color: hsl(var(--ink-4));
}

.odessay-editor-content a,
.prose-odessay a {
  color: hsl(var(--cursor));
  text-decoration: underline;
  text-underline-offset: 2px;
}

/* --------------------------------------------
   CODE
   -------------------------------------------- */

.odessay-editor-content code,
.prose-odessay code {
  font-size: 0.875em;
  background: hsl(var(--ink) / 0.07);
  border: 0.5px solid hsl(var(--border));
  border-radius: 4px;
  padding: 0.08em 0.35em;
}

.odessay-editor-content pre,
.prose-odessay pre {
  background: hsl(var(--ink) / 0.05);
  border: 0.5px solid hsl(var(--ink) / 0.1);
  border-radius: 8px;
  padding: 0.9em 1.1em;
  margin-block: 1.4em;
  overflow-x: auto;
}

.odessay-editor-content pre code,
.prose-odessay pre code {
  background: transparent;
  border: none;
  padding: 0;
  font-size: 0.85em;
}

/* KBD */
.odessay-editor-content kbd,
.prose-odessay kbd {
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 0.8em;
  font-weight: 500;
  line-height: 1;
  color: hsl(var(--ink-2));
  background: hsl(var(--ink) / 0.05);
  border: 1px solid hsl(var(--ink) / 0.2);
  border-bottom-width: 2px;
  border-radius: 4px;
  padding: 0.15em 0.45em;
  white-space: nowrap;
}

/* --------------------------------------------
   TABLAS
   -------------------------------------------- */

.odessay-editor-content th,
.odessay-editor-content td,
.prose-odessay th,
.prose-odessay td {
  padding: 0.8em 0;
  vertical-align: top;
}

/* TH — small caps, metadata */
.odessay-editor-content th,
.prose-odessay th {
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 0.72em;
  font-weight: 500;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: hsl(var(--ink-3));
  border-bottom: 1px solid hsl(var(--ink) / 0.2);
  padding-bottom: 0.75em;
  text-align: left;
}

/* TD — ligeramente más pequeño que body */
.odessay-editor-content td,
.prose-odessay td {
  font-size: 0.9em;
  color: hsl(var(--ink-2));
  line-height: 1.55;
  border-bottom: 0.5px solid hsl(var(--ink) / 0.12);
}

/* P dentro de td — sin margen, hereda tamaño de td */
.odessay-editor-content td p,
.prose-odessay td p {
  margin: 0;
  font-size: 1em;
}

.odessay-editor-content th + th,
.odessay-editor-content td + td,
.prose-odessay th + th,
.prose-odessay td + td { padding-left: 1.05em; }

/* --------------------------------------------
   CAPTION / FIGCAPTION
   -------------------------------------------- */

.odessay-editor-content figcaption,
.odessay-editor-content .caption,
.prose-odessay figcaption,
.prose-odessay .caption {
  font-family: var(--font-geist-sans), system-ui, sans-serif;
  font-size: 0.8em;
  font-weight: 400;
  line-height: 1.4;
  color: hsl(var(--ink-4));
  margin-top: 0.5em;
  display: block;
  max-width: 68ch;
}

.odessay-editor-content figure,
.prose-odessay figure {
  margin-block: 2em;
  max-width: 68ch;
}

.odessay-editor-content figure img,
.prose-odessay figure img {
  width: 100%;
  height: auto;
  border-radius: 4px;
  display: block;
}

.odessay-editor-content figure figcaption,
.prose-odessay figure figcaption {
  margin-top: 0.6em;
}

/* --------------------------------------------
   ELEMENTOS TIPOGRÁFICOS ADICIONALES
   -------------------------------------------- */

/* HR — separador de sección */
.odessay-editor-content hr,
.prose-odessay hr {
  border: none;
  border-top: 1px solid hsl(var(--ink) / 0.15);
  margin-block: 2.5em;
  max-width: 68ch;
}

/* SUP / SUB — sin romper line-height */
.odessay-editor-content sup,
.odessay-editor-content sub,
.prose-odessay sup,
.prose-odessay sub {
  font-size: 0.72em;
  line-height: 0;
  position: relative;
  vertical-align: baseline;
}

.odessay-editor-content sup, .prose-odessay sup { top: -0.5em; }
.odessay-editor-content sub, .prose-odessay sub { bottom: -0.3em; }

/* ABBR */
.odessay-editor-content abbr[title],
.prose-odessay abbr[title] {
  text-decoration: underline dotted hsl(var(--ink-4));
  text-underline-offset: 2px;
  cursor: help;
}

/* ============================================
   ESPECÍFICO DE CONTEXTO — no compartido
   ============================================ */

/* Solo editor */
.odessay-editor-content {
  min-height: 55vh;
  caret-color: hsl(190 88% 46%);
  outline: none;
}

/* Solo prose */
.prose-odessay ::selection {
  background: hsl(var(--ink) / 0.12);
  color: hsl(var(--ink));
}

/* Highlights de anotación — solo en lectura */
.prose-odessay .hl {
  background: hsl(45 90% 84%);
  border-radius: 2px;
  cursor: pointer;
  padding: 0 0.08em;
  box-decoration-break: clone;
  -webkit-box-decoration-break: clone;
  transition: background 0.15s ease;
}

.prose-odessay .hl:hover { background: hsl(45 90% 76%); }
.prose-odessay .hl.active { background: hsl(45 90% 74%); }
.prose-odessay .hl.annotated { border-bottom: 1.5px solid hsl(35 80% 55%); }

/* Mobile — solo prose */
@media (max-width: 699px) {
  .prose-odessay {
    font-size: 16px;
    line-height: 1.75;
  }

  .prose-odessay h1 { font-size: 1.5em; }
  .prose-odessay h2 { font-size: 1.22em; }
  .prose-odessay h3 { font-size: 1.05em; }

  .prose-odessay blockquote {
    font-size: 1.05em;
    padding-left: 1em;
  }
}
```

## Principios Operativos

1. Un solo contrato tipográfico  
`.odessay-editor-content` y `.prose-odessay` comparten todas las reglas tipográficas. Solo se permiten excepciones reales de contexto: `caret-color`, `min-height`, `::selection`, `.hl` y breakpoints mobile de prose.

2. Rem para layout, em para escala interna  
El tamaño base se declara una vez en contenedor (`18px`). Los hijos tipográficos escalan en `em`. Reservar `rem` para espaciado de layout.

3. Escala Major Third (1.25)  
La escala tipográfica deriva del ratio 1.25 (`h1/h2/h3`, lead, blockquote, caption/cite, body) sin tamaños ad-hoc.

4. Weights por rol tipográfico  
Lora 500 para headings, Lora 400 italic para blockquote, Geist 400 para body, Geist 300 para lead, Geist 500 para `strong` y `th`.

5. Jerarquía por color  
Usar `--ink`/`--ink-2`/`--ink-3`/`--ink-4`/`--cursor` como eje de jerarquía. Evitar resolver énfasis subiendo weight de forma arbitraria.

6. Line-height proporcional  
Siempre unitless. Regla: a mayor tamaño de fuente, menor line-height.

7. Ritmo vertical de headings  
Más aire antes del heading que después. El heading pertenece al contenido que introduce.

8. Columna de lectura  
`68ch` para prosa, `54ch` para blockquote. Mantener rango legible sin forzar ancho fijo en px.

9. Tablas como metadata estructurada  
`th` en small caps (`uppercase`, `letter-spacing: 0.08em`, `0.72em`) con Geist.

10. Blockquote distinguible sin ornamento extra  
Borde izquierdo delgado en `--cursor`, tono `--ink-3`, escala propia y `cite` como metadata discreta.

## Checklist Cross-Mode

- `/write/[id]`, `/preview/[token]`, `/shared/[id]` y `/{username}/{slug}` usan el mismo contrato tipográfico para texto semántico.
- Headings (`h1/h2/h3`) mantienen misma escala, peso y ritmo vertical en todas las superficies.
- `p`, `ul/ol/li`, `blockquote`, `code/pre`, tablas, `caption`, `mark`, `a`, `strong`, `em` conservan paridad visual.
- URLs largas, `pre/code` y tablas anchas preservan semántica de contención/scroll interno sin overflow horizontal global.
- Excepciones de contexto quedan acotadas a reglas explícitas (editor/prose), sin duplicar contrato base.
- Mobile solo ajusta `prose` según breakpoint acordado (`max-width: 699px`).

## Política

No introducir reglas tipográficas ad-hoc fuera de este contrato. Cualquier cambio de presentación textual debe actualizar este documento y aplicarse de forma coordinada en las superficies del contrato.
