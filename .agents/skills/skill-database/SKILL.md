---
name: skill-database
description: Diseña y verifica cambios de schema, migraciones, políticas de acceso, triggers e índices con evidencia del estado real de la base de datos y sus consumidores.
---

# Database

## 1. Objetivo

Database transforma un contrato de datos en schema, migraciones, políticas y consultas que preservan integridad, acceso y compatibilidad con sus consumidores.

Pregunta guía: **¿Qué datos y operaciones cambian, quién puede usarlos y cómo se valida la transición?**

## 2. Ámbito y activación

Aplicar al modificar tablas, columnas, constraints, índices, RLS, triggers, seed data o la forma de una consulta. Cargar Architecture cuando cambia la autoridad de un dato o el boundary entre runtimes. Cargar Performance cuando cambian fan-out, paginación o costo al crecer.

## 3. Entradas y fuentes de autoridad

Reunir el contrato de datos, schema versionado, estado vivo del entorno pertinente, migraciones previas, consumers y pruebas. Distinguir decisiones normativas del schema observado. El proyecto determina proveedor, entidades, políticas de acceso y precedencia documental.

## 4. Método y criterios

1. Formular la invariante de datos y los consumidores que dependen de ella.
2. Comparar schema declarado y schema real antes de diseñar la migración.
3. Diseñar la transición compatible con lecturas y escrituras existentes, incluidos datos previos y rollback cuando el riesgo lo exija.
4. Definir constraints, índices y políticas de acceso donde se puede hacer cumplir la regla. Comprobar roles y caminos de lectura/escritura reales.
5. Revisar triggers y side effects por idempotencia, recursión y alcance de transacción.
6. Evaluar planes de consulta, cardinalidad, paginación y número de viajes cuando el volumen pueda crecer.
7. Verificar migración, políticas y consumidores en el entorno adecuado antes de entregar.

## 5. Resultado y evidencia

Entregar migración versionada, contrato actualizado, consultas y consumidores compatibles, y evidencia de schema y políticas. La validación debe demostrar el comportamiento y los roles afectados, no solo que el SQL compila.

## 6. Manejo de fallos e incertidumbre

Cuando schema vivo, migraciones y contrato documental divergen, registrar la diferencia y resolver la autoridad antes de aplicar otro cambio. Una migración parcial o una política que depende de contexto no disponible requiere una estrategia explícita de recuperación.

## 7. Relaciones y ownership

Architecture fija autoridad y límites del dato. Backend consume el schema mediante contratos de servicio; Database posee migraciones, RLS, triggers, índices y verificación de consultas. Performance evalúa costo y forma de carga.

## 8. Recursos asociados

- **Especialidad local:** en Odessay, [specialties/schema-and-access.md](specialties/schema-and-access.md) conserva el schema de referencia, la semántica documental, reglas Supabase, comandos y checklist. Cargarla antes de una operación de datos del proyecto.
- **Mecanismos:** usar introspección, tests de políticas, schema diff y validación de migraciones disponibles en el repo.
