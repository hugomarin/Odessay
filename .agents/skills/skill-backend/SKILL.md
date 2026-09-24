---
name: skill-backend
description: Diseña e implementa operaciones de servidor y adapters externos con contratos de entrada, autoridad, errores y evidencia; activa recetas del stack local según el servicio afectado.
---

# Backend

## 1. Objetivo

Backend convierte una operación de producto en un contrato de servidor que valida entradas, protege autoridad y comunica resultados y errores a sus consumidores. Ubica reglas compartidas en su owner y conecta proveedores externos mediante adapters explícitos.

Pregunta guía: **¿Qué contrato ofrece esta operación y qué debe garantizar en cada resultado posible?**

## 2. Ámbito y activación

Aplicar al modificar rutas o acciones de servidor, autenticación, consultas, proveedores externos, colas, sincronización o persistencia remota. Cargar Architecture cuando el cambio altera un contrato compartido, una fuente de verdad o el límite entre servidor y otro runtime.

## 3. Entradas y fuentes de autoridad

Reunir el brief, contrato del servicio, consumidores, permisos, esquema de datos, comportamiento actual y pruebas. Consultar la documentación vigente del proveedor para las capacidades y formatos concretos que se usen. El proyecto aporta endpoints, stack, credenciales, políticas de acceso y fuentes normativas.

Distinguir la autoridad del dato de la copia, proyección o caché que usa el servidor. Seguir la precedencia del repo cuando el código vigente y el contrato esperado difieren.

## 4. Método y criterios

1. Definir la operación semántica, el owner, sus consumidores y el runtime que la ejecuta.
2. Especificar entradas, validación, identidad del solicitante, autorización y límites de tamaño o paginación. Separar listados ligeros de lecturas de detalle cuando el costo lo requiera.
3. Definir outputs y errores tipados que permitan al caller distinguir retry, falta de permiso, ausencia y fallo externo.
4. Elegir el boundary del proveedor: inicialización por entorno, secretos, timeout, retry e idempotencia. Verificar el contrato real de la API antes de implementar.
5. Mantener transacciones, side effects y sincronización en el owner apropiado; hacer explícita la secuencia de confirmación y recuperación.
6. Instrumentar fallos y costo sin exponer datos sensibles. Evaluar fan-out y trabajo por elemento con Performance cuando el cambio crece con datos o usuarios.
7. Comprobar consumidores y pruebas de contrato, incluidos caminos de error y condiciones de carrera relevantes.

## 5. Resultado y evidencia

Entregar el contrato de operación, la implementación en su owner o adapter, consumers actualizados y validación proporcional. Indicar las fuentes consultadas para decisiones de proveedor y los resultados comprobados en el entorno pertinente.

El proyecto puede exigir checks, variables, status codes y formatos de respuesta específicos; aplicarlos desde la especialidad local.

## 6. Manejo de fallos e incertidumbre

Una discrepancia entre documentación del proveedor, contrato local y respuesta observada se resuelve antes de prometer un comportamiento nuevo. Una operación externa que puede completarse parcialmente declara cómo detecta duplicados, reintenta o compensa. Los errores recuperables llegan al caller con semántica suficiente para decidir la siguiente acción.

Si la autoridad de un dato o el boundary del servicio no está decidido, registrar la brecha con sus consumidores antes de fijarlo desde una route por conveniencia.

## 7. Relaciones y ownership

Architecture decide owners, runtimes y fuentes de verdad. Database posee schema, migraciones, RLS y planes de consulta. Performance evalúa carga y crecimiento. Frontend consume el contrato sin conocer la infraestructura interna; UX Testing comprueba el flujo que observa la persona usuaria.

## 8. Recursos asociados

- **API y persistencia:** cargar [api-and-persistence.md](specialties/api-and-persistence.md) cuando la operación toque rutas, Supabase, autenticación, save/sync, errores o configuración. Leer `API Routes` para el contrato de entrada y respuesta; leer las secciones de Supabase, autenticación o sync según el servicio afectado, y cerrar con el checklist de entrega.
- **Integraciones externas:** cargar [external-integrations.md](specialties/external-integrations.md) si el cambio conecta AI, email u observabilidad; usar sus reglas para elegir el adapter y verificar sus fallos.
- **Guías de proveedor:** consultar documentación oficial de la versión usada cuando una integración cambie.
- **Mecanismos:** ejecutar pruebas de contrato, migraciones o checks existentes conforme al riesgo del cambio.
