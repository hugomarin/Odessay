# Prompt — Context Hygiene (acotado)

Objetivo: reducir context rot entre `.agents/skills` y `workflow/` para funcionalidades AI del editor.

Instrucciones para el agente:

1. Revisa consistencia entre:
   - `workflow/docs.json`
   - `workflow/agents.md`
   - `workflow/decisions.json`
   - `workflow/status.json`
   - `workflow/context/features/odessay-ai-writing-assist.md`
   - `workflow/context/features/odessay-prosemirror-tiptap.md`
   - skills: `skill-product-manager`, `skill-backend`, `skill-frontend`, `skill-code-review`, `skill-ux-testing`
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
6. No cambies historial de decisiones pasadas salvo textos de contexto general claramente desactualizados.
7. Entrega:
   - lista de archivos corregidos,
   - resumen de inconsistencias resueltas,
   - riesgos abiertos (si quedan).

Checklist mínimo de salida:
- Sin rutas legacy (`workflow/core/*`, `workflow/features/*`, `workflow/odessay-roadmap.md`).
- Sin acoplar el producto a un modelo AI hardcodeado en documentación de contrato.
- `workflow/docs.json` actualizado si se creó/movió/eliminó algún documento.
