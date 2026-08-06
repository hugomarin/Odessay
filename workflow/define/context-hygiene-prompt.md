# Prompt — Context Hygiene

Objetivo: reducir context rot entre `.agents/skills`, Linear y `workflow/` en dos dominios críticos: funcionalidades AI del editor y arquitectura documental desktop.

Instrucciones para el agente:

1. Revisa consistencia entre:
   - `workflow/docs.json`
   - `workflow/agents.md`
   - `workflow/decisions.json`
   - `workflow/status.json`
   - `workflow/context/features/odessay-ai-writing-assist.md`
   - `workflow/context/features/odessay-prosemirror-tiptap.md`
   - skills: `skill-product-manager`, `skill-backend`, `skill-frontend`, `skill-code-review`, `skill-ux-testing`
   - corpus desktop: `workflow/context/core/odessay-adr-identidad.md`, `workflow/context/features/odessay-desktop-document-catalog.md`, `workflow/agents.md` y `.agents/skills/skill-architecture/SKILL.md`
2. Detecta y corrige referencias legacy o ambiguas:
   - nombres viejos del flujo (`publication review`) cuando el scope actual sea corrección mecánica,
   - mención de proveedor/modelo AI como constante de producto,
   - rutas rotas o rutas antiguas en `workflow/`.
3. Mantén dos contratos explícitos:
   - AI residente (`observe/discuss`): observación y discusión, no reescritura.
   - AI writing assist (`corrections/title`): correcciones mecánicas + sugerencia de título, con contrato estructurado.
4. Verifica que ProseMirror/Decorations/Markdown backbone estén alineados con el flujo de correcciones en streaming:
   - trigger automático,
   - chunks incrementales,
   - descarte de stale requests,
   - memoria de accept/reject/manual fix.
5. Actualiza documentos para que PM/Backend/Frontend/Review usen las mismas referencias y mismos términos.
6. Consulta en Linear los issues cerrados desde la última pasada de higiene cuyo brief contenga `Architecture Contract`. Compara su campo `Invariants` con el corpus normativo aplicable y clasifica cada invariante como:
   - ya documentado;
   - decisión local del issue, no promovible;
   - normativo y ausente, que debe promoverse a la autoridad correcta sin duplicarlo en documentos subordinados.
7. Para arquitectura documental desktop, respeta la precedencia ADR de identidad → spec del catálogo → target architecture/plan. Si ADR y spec se contradicen, reporta `Context Gap — Desktop Document Architecture` y detén esa corrección; no resuelvas el conflicto por inferencia.
8. No cambies historial de decisiones pasadas salvo textos de contexto general claramente desactualizados.
9. Entrega:
   - lista de archivos corregidos,
   - resumen de inconsistencias resueltas,
   - lista completa de invariantes revisados con su clasificación y issue de origen,
   - riesgos abiertos (si quedan).

Checklist mínimo de salida:
- Sin rutas legacy (`workflow/core/*`, `workflow/features/*`, `workflow/odessay-roadmap.md`).
- Sin acoplar el producto a un modelo AI hardcodeado en documentación de contrato.
- Sin invariantes normativos ratificados en issues cerrados que permanezcan solo en Linear.
- Corpus desktop alineado con su precedencia documental y sin reglas operacionales duplicadas en el ADR.
- `workflow/docs.json` actualizado si se creó/movió/eliminó algún documento.
