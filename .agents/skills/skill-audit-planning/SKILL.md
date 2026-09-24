---
name: skill-audit-planning
description: Audita una fase o un conjunto de Issue Briefs para comprobar cobertura, secuencia, owners, contratos y evidencia antes de BUILD.
---

# Audit Planning

## 1. Objetivo

Audit Planning comprueba si un conjunto de issues puede producir el resultado prometido por una fase. Relaciona criterios de salida con entregables, detecta dependencias y responsabilidades ambiguas, y propone correcciones concretas al plan.

Pregunta guía: **¿Qué falta, se solapa o está mal secuenciado para que este plan sea ejecutable?**

## 2. Ámbito y activación

Aplicar antes de BUILD, después de definir una fase o cuando cambian varios briefs conectados. Auditar el conjunto permite encontrar huecos que un issue individual no revela.

## 3. Entradas y fuentes de autoridad

Reunir roadmap, criterios de salida, briefs completos, contratos citados, estado de las dependencias y decisiones aceptadas. Consultar los skills de dominio que cada issue activa. El proyecto define sus artefactos, tracker y formato de auditoría.

## 4. Método y criterios

1. Trazar cada resultado de la fase hasta uno o varios issues y su evidencia de cierre.
2. Verificar que cada issue tenga owner, precondiciones, consumidores, criterios de aceptación y validación suficientes.
3. Buscar dos issues que cambian la misma responsabilidad o dependen de decisiones incompatibles.
4. Ordenar dependencias por contratos, datos y capabilities necesarias; identificar ciclos y trabajo que comienza antes de su fundamento.
5. Revisar tamaño y unidad de entrega: cada issue debe producir un resultado coherente y revisable.
6. Confrontar los briefs con arquitectura, costo al crecer y dominios activados. Distinguir falta de definición de implementación aún pendiente.
7. Proponer la corrección mínima del plan y volver a comprobar cobertura y secuencia.

## 5. Resultado y evidencia

Entregar un veredicto por fase o conjunto, una matriz de cobertura de resultados, hallazgos con fuentes y propuestas de cambio en issues o dependencias. Cada hallazgo nombra el efecto sobre BUILD y la decisión necesaria. Aplicar el formato local si el workflow lo exige.

## 6. Manejo de fallos e incertidumbre

Si una fuente normativa o la intención del producto falta, registrar la pregunta y su efecto sobre el plan. Una contradicción que cambia owner, scope o contrato impide declarar listo el conjunto. Una observación sin impacto claro se deja como seguimiento, no como bloqueo.

## 7. Relaciones y ownership

Planning produce briefs ejecutables; Audit Planning comprueba la coherencia del conjunto. Architecture y los skills de dominio aportan sus contratos. El workflow posee estados, aprobación y persistencia del veredicto.

## 8. Recursos asociados

- **Especialidad local:** en Odessay, [specialties/phase-audit-contract.md](specialties/phase-audit-contract.md) contiene fuentes de roadmap y DoD, preguntas de auditoría, criterios de rechazo, severidad y formato de salida. Cargarla al auditar una fase del proyecto.
- **Mecanismos:** reutilizar la información del tracker y checks existentes; este skill no requiere scripts propios.
