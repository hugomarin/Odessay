# Lente de Change Size

## Objetivo

Review Change Size determina si un cambio puede entenderse, verificarse y revertirse como una unidad coherente. Identifica decisiones independientes dentro del diff y propone la etapa coherente más pequeña cuando el trabajo necesita división.

Pregunta guía: **¿Qué decisión completa entrega este diff y qué archivos son necesarios para ella?**

## Ámbito y activación

Activar cuando el diff cruza dominios, combina comportamiento con una transformación mecánica extensa o supera el umbral de revisión que use el proyecto. Un cambio grande puede seguir siendo una sola unidad cuando todos sus archivos son necesarios para mover la misma responsabilidad o contrato.

## Entradas y fuentes de autoridad

Leer el objetivo del issue, el diff, sus commits, los contratos afectados y la política local de tamaño o stages. Los recuentos de líneas son señales de investigación; la relación entre decisiones y archivos determina la conclusión.

## Método y criterios

1. Separar el diff en decisiones de comportamiento, arquitectura, datos y transformaciones mecánicas.
2. Para cada decisión, comprobar si puede revisarse, validarse, entregarse y revertirse de forma independiente.
3. Trazar dependencias entre las unidades. Los archivos que actualizan consumidores de un mismo contrato pueden pertenecer a la misma etapa.
4. Señalar qué parte del diff concentra el riesgo real cuando una transformación masiva rodea una decisión pequeña.
5. Proponer un orden de etapas que mantenga cada una operativa y verificable.

Un rename amplio y coherente, o la extracción de un owner con todos sus consumidores, puede constituir una sola decisión. Examinar con más cuidado cuando el PR agrupa commits entregables por separado, necesita secciones «Parte 1 / Parte 2» para explicarse, o su reversión desharía dos features sin relación. Si la mayor parte del diff es mecánica, identificar los archivos que contienen la decisión real y concentrar allí la revisión. El proyecto fija sus umbrales orientativos y su política de findings.

## Resultado y evidencia

Entregar un finding solo cuando existan unidades separables, nombrando las decisiones y sus archivos:

```text
Change Size — recomendación de división
- Unidad 1: <decisión y archivos>
- Unidad 2: <decisión y archivos>
- Dependencia entre unidades: <hecho comprobado>
- Etapa coherente mínima: <orden propuesto>
- Riesgo de mantenerlas juntas: <qué queda sin revisión o validación clara>
```

Un finding de tamaño conserva la severidad que corresponda al riesgo demostrado; el volumen por sí solo no fija prioridad.

## Manejo de fallos e incertidumbre

Cuando el brief no explica por qué dos cambios viajan juntos, registrar la relación observada y la información que falta para decidir si son una unidad. Si la separación rompería un contrato o dejaría un estado no entregable, describir esa dependencia y evaluar el diff como una etapa única.

## Relaciones y ownership

Esta lente posee el juicio sobre coherencia y revisabilidad del cambio. Planning define stages antes de BUILD; el orquestador de review decide cuándo activar la lente y cómo consolidar sus findings. Las reglas de dispatch por costo de agentes son responsabilidad de la orquestación y pueden usar umbrales distintos.

## Recursos asociados

- **Contexto local:** consultar el umbral orientativo, formato de finding y política de stages del proyecto.
- **Mecanismos:** usar estadísticas del diff y agrupación por archivos como evidencia inicial; inspeccionar el contenido para decidir si las unidades son independientes.

No requiere scripts propios ni especialistas dedicados.
