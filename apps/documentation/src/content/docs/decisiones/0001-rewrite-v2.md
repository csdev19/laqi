---
title: ADR-0001 — Rewrite completo en vez de arreglar v1
---

# ADR-0001 — Rewrite completo en vez de arreglar v1

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

laqi v1 (1.2.1) son ~200 líneas de JavaScript CommonJS sobre Express 4. El
[análisis](/analisis-v1/) encontró doce defectos —cinco verificados
ejecutando el servidor— y seis problemas de seguridad, incluyendo diecinueve
vulnerabilidades en dependencias (una crítica).

La pregunta era si arreglar sobre esa base o empezar de cero.

## Decisión

**Rewrite completo**, en TypeScript, sobre un monorepo nuevo. Se conserva la
idea central (selector declarativo de respuestas) y el nombre. No se conserva
código.

Los proyectos existentes migran con `laqi migrate`, que convierte los JSON del
formato v1 al de v2.

## Por qué

**1. Los defectos no son bugs sueltos, son consecuencias del diseño.**

Los tres peores salen del mismo modelo de datos:

- El handler escribe sobre la configuración que sirve (`body.query = req.query`)
  → fuga de estado entre requests.
- Los archivos se fusionan con spread en un objeto plano → colisiones silenciosas
  entre archivos.
- La clave del endpoint codifica también el método → nació el hack `(get)files/:id`,
  que además no resuelve la colisión entre archivos.

Arreglar los tres exige cambiar el modelo de datos. Cambiado el modelo de datos,
no queda mucho de las 200 líneas.

**2. Las limitaciones estructurales no se parchan.**

Sin validación, sin tests, sin CLI (`yargs` declarado y nunca importado), estado
global único, CommonJS, `res.status("200")` con strings que bloquea Express 5.
Todo eso es trabajo nuevo, no arreglo.

**3. El formato tiene que cambiar de todos modos.**

Las tres features que justifican v2 —editor web, MCP, URL pública compartida—
requieren separar definición de estado y quitar el método de la clave. Eso rompe
compatibilidad. Si el formato se rompe, el argumento principal para conservar el
código desaparece.

**4. Doscientas líneas.**

El costo de reescribir es bajo, y nunca va a ser más bajo que ahora.

**5. No hay usuarios en producción que bloqueen.**

Confirmado con el autor. Las apps existentes pueden correr `laqi migrate` sin
problema.

## Alternativas consideradas

**Arreglo incremental manteniendo compatibilidad.** Descartada: obliga a soportar
para siempre el formato con el método en la clave y el estado global, que son
justo las dos cosas que impiden las features nuevas. Se pagaría deuda permanente
para conservar 200 líneas defectuosas.

**Arreglar sólo los bugs de seguridad y dejar v1 en mantenimiento.** Descartada
como objetivo, pero el análisis de seguridad se conserva como documentación por
si algún proyecto se queda en v1: lo urgente ahí es mover `nodemon` a
`devDependencies` (arrastra la vulnerabilidad crítica) y no exponer el servidor
fuera de `127.0.0.1`.

## Consecuencias

**A favor:**

- Modelo de datos correcto desde el principio, con validación Zod al cargar.
- TypeScript, tests desde la primera línea (TDD, siguiendo la política de rakoi).
- Sin deuda de compatibilidad.

**En contra:**

- Los usuarios de v1 tienen que migrar. Mitigado con `laqi migrate`.
- Hay que reescribir el README y la documentación entera.
- El período hasta que v2 alcance la paridad funcional de v1 es tiempo sin
  release utilizable.
