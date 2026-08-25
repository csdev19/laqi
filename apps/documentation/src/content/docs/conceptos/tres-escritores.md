---
title: Los tres escritores
---

# Los tres escritores

**Fecha:** 2026-08-24

Éste es el principio que gobierna varias decisiones de v2 a la vez: el formato
([ADR-0003](/decisiones/0003-json-declarativo/)), dónde vive el estado
([ADR-0004](/decisiones/0004-estado-fuera-de-git/)) y por qué la validación
es obligatoria al cargar. Vale la pena entenderlo antes que los ADRs, porque
todos apuntan acá.

## El cambio respecto de v1

En laqi v1 los archivos de mock tenían **un solo escritor**: el humano, con su
editor de texto. Eso permite cualquier formato — YAML con comentarios,
TypeScript, lo que sea — porque un humano lee el contexto, respeta el estilo
existente y no rompe nada al editar.

En v2 hay **tres escritores** sobre los mismos datos:

| Escritor          | Cómo escribe            | Qué necesita del formato                                                        |
| ----------------- | ----------------------- | ------------------------------------------------------------------------------- |
| **El humano**     | Editor de texto, a mano | Legible, diffeable, con autocompletado                                          |
| **El editor web** | Clicks en una UI        | Round-trip seguro: leer → modificar un campo → reescribir sin destruir el resto |
| **La IA (MCP)**   | Generación programática | Estructura predecible y validable; que un error se detecte, no se ejecute       |

## Qué implica

### 1. El formato tiene que ser round-trippeable por una máquina

Ésta es la restricción dura. El editor web tiene que poder abrir el archivo,
cambiar un campo y volver a escribirlo **sin perder nada** — ni comentarios, ni
orden, ni formato de los campos que no tocó.

Eso descarta cualquier formato que requiera interpretar código para entenderlo:

- **TypeScript / JavaScript** — reescribir un `.ts` desde una UI exige un codemod
  de AST, y aun así el resultado se degrada con cada pasada. Además cargar
  archivos `.ts` significa **ejecutar código arbitrario**, y mete un transpilador
  dentro del CLI.
- **YAML con comentarios** — preservar comentarios en un round-trip es posible
  pero frágil, y los tres escritores lo tratarían distinto.

**JSON gana**, no por conservadurismo, sino por ser el único formato que los tres
escritores comparten sin fricción. Ver
[ADR-0003](/decisiones/0003-json-declarativo/).

### 2. La validación deja de ser un lujo

Con un solo escritor humano, un typo se detecta cuando algo se ve raro y lo
arreglas. Con tres escritores — dos de ellos automáticos, uno de ellos un modelo
de lenguaje que a veces alucina un campo — **los datos inválidos son inevitables**.

Por eso v2 valida con Zod **al cargar**, no en runtime. Los defectos B, C y G del
[análisis de v1](/analisis-v1/) son exactamente esto: entradas inválidas que
no se detectaron y produjeron un 404 silencioso, una request colgada, o una
llamada a una propiedad arbitraria.

Un selector que no existe tiene que ser un error con el nombre del archivo y la
línea. Nunca una request que cuelga.

**Ruidoso, pero no fatal.** La validación falla **por archivo**, no para todo el
servidor: un archivo inválido muestra su error, retira sólo sus endpoints, y el
resto del mock se sigue sirviendo (el contador del panel lee `26 (+1 file
failed)`, así que el número nunca miente). Reiniciar el mock entero porque un
archivo tiene una coma de más es hostil, y el desarrollador casi siempre está a
mitad de otra cosa cuando pasa.

Esto vale igual para errores de parseo (`JSON.parse`) y para errores semánticos
(un `default` que apunta a una respuesta inexistente, un método inválido, una
ruta duplicada entre archivos): la misma superficie, el mismo formato de error.

### 3. El estado no puede vivir donde escriben los tres

Si el editor web y el MCP escriben el estado activo en el mismo archivo que
commiteas, cada click y cada instrucción a la IA te ensucia el working tree.

El humano commitea. El editor y la IA no deberían tener que decidir si lo que
escriben va a git. La separación resuelve eso: **la definición es del humano y se
commitea; el estado es de la sesión y no se trackea.** Ver
[ADR-0004](/decisiones/0004-estado-fuera-de-git/).

## La regla, en una línea

> Si un cambio lo puede originar una máquina, el formato debe ser validable y
> reescribible por una máquina — y lo que la máquina escribe no va a git.
