# Lente de Architecture

## Objetivo

Review Architecture comprueba que el código final materializa el contrato arquitectónico del cambio. Identifica nuevos owners paralelos, dependencias que cruzan boundaries y divergencias entre el comportamiento implementado y las fuentes normativas.

Pregunta guía: **¿El diff extiende al owner esperado y mantiene una sola autoridad para cada responsabilidad?**

## Ámbito y activación

Activar cuando el diff modifica ownership, contratos de servicio, fuentes de verdad, adapters, rutas de persistencia, sync, parser/serializer o límites entre capas y runtimes. Aplicar también cuando el brief contiene una clasificación o contrato arquitectónico explícito.

## Entradas y fuentes de autoridad

Leer el diff, el contrato del issue, los callers y consumers, las instrucciones scoped y las decisiones aceptadas que gobiernan esa responsabilidad. Architecture fija el owner esperado; Recon y el código muestran el owner observado. Seguir la precedencia documental del proyecto cuando difieren.

## Método y criterios

1. Comparar `Layer`, `Runtime scope`, `Owner`, contratos e invariantes declarados con los archivos y dependencias modificados.
2. Localizar el owner canónico y cualquier implementación competidora introducida o ampliada por el diff.
3. Comprobar que los consumers usan el contrato del owner y que los adapters traducen infraestructura sin redefinir reglas de dominio.
4. Revisar fuentes de verdad y write paths: una responsabilidad debe conservar la autoridad que fijan las decisiones del proyecto.
5. Revisar hotspots de composición: el cableado puede crecer para integrar un owner, mientras la responsabilidad conserva su módulo propio.
6. Seleccionar checks tecnológicos y documentales según el runtime y los contratos realmente tocados; verificar el artefacto distribuido cuando el entorno de producción difiere del desarrollo.

Si el diff altera schema o políticas de acceso, consultar la lente de migraciones que use el review local. Si altera carga al crecer, incorporar la evidencia de Performance.

## Resultado y evidencia

Emitir findings con el formato local. Un finding de owner duplicado nombra el owner canónico, la implementación competidora, el consumer afectado y el camino por el que divergen. Cuando falta una decisión normativa, registrar un `Architecture Gap` con la fuente ausente y la decisión requerida.

## Manejo de fallos e incertidumbre

Cuando docs y código discrepan, aplicar la precedencia y clasificación locales antes de proponer un fix. Un riesgo del bundle o de otra infraestructura requiere evidencia del artefacto o un gate pertinente; el éxito en desarrollo no confirma su comportamiento en producción. La prioridad del finding refleja su impacto demostrado.

## Relaciones y ownership

Architecture define el contrato esperado; Architecture Recon localiza implementaciones y consumers; esta lente comprueba el diff final. El orquestador de review decide activación, consolidación y scoring. Las lentes de migración, seguridad, performance y testing aportan evidencia de sus dominios sin repetir la decisión de ownership.

## Recursos asociados

- **Conocimiento local:** cargar precedencia, hotspots, reglas de navegación y checklist del runtime que el proyecto vincule al diff.
- **Guías tecnológicas:** revisar diferencias entre entorno de desarrollo y bundle cuando una capacidad nativa o empaquetada cambie.
- **Mecanismos:** tests de contrato, dependency checks, migraciones y pruebas del bundle según el riesgo concreto.

Esta lente funciona directamente; un especialista puede aplicar el mismo criterio con otro formato de ejecución.
