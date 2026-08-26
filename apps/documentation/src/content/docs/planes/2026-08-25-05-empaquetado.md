---
title: "laqi v2 — Plan 5: Documentación y empaquetado"
---

# laqi v2 — Plan 5: Documentación y empaquetado

**Estado:** ejecutado. Registro de lo construido.

## Qué entrega

`npx laqi` funcionando sobre Node limpio, con el panel adentro del paquete.

El sitio de documentación (`apps/documentation`, Astro + Starlight) ya existía
desde antes; este plan lo deja construyéndose junto al resto y suma las
páginas de los planes 2b a 5.

## El bundle

`tsdown` mete `apps/cli` y todos los paquetes `@laqi/*` en **un solo paquete
publicable**. Se publica uno, no seis.

El panel viaja adentro como `dist/panel`: `packages/editor` no se publica por
separado, así que sin eso `npx laqi` serviría la página de "no está construido"
para siempre. **El build se niega a terminar si el panel falta**, en vez de
producir un paquete roto en silencio.

`editorDistDir()` busca primero `dist/panel` al lado del bundle y si no
resuelve `@laqi/editor` por el resolver de módulos — el mismo código sirve
empaquetado y desde el fuente.

## Dos bugs de empaquetado que no se ven hasta que alguien instala

1. **`catalog:` llegaba a las dependencias publicadas.** Es un protocolo de
   bun/pnpm; npm falla el install entero con `EUNSUPPORTEDPROTOCOL`. Las
   versiones ahora están fijas, y `package.test.ts` falla si alguna dependencia
   usa un protocolo que npm no puede instalar, o si una versión fijada se
   desincroniza del catálogo de la raíz.
2. **Los paquetes del workspace eran dependencias runtime.** Como se bundlean,
   npm habría buscado `@laqi/core` en el registro, donde no existe. Ahora son
   devDependencies, y hay un test que lo exige.

También: `packages/editor` pasó a `private` sin entry point de código — su
`exports` apuntaba a un `src/dist-path.ts` que nunca existió.

## Verificación end-to-end sobre el artefacto real

No sobre el monorepo: sobre un tarball hecho con `npm pack`, instalado con
`npm install` en un directorio vacío y corrido **con bun fuera del PATH**.

- `laqi --help`
- sirve mocks con el `X-Laqi-Resolved` correcto
- el panel y sus assets, desde adentro del paquete
- el control plane, y CRUD completo
- hot-reload sobre un archivo editado a mano
- las capas de estado y escenario
- el servidor MCP sobre stdio, con las nueve herramientas

## La fuga de SSE que quedaba diferida

El Plan 2a dejó anotado que el CLI, corrido con `bun apps/cli/src/index.ts`,
perdía listeners de SSE cuando el cliente se desconectaba — una limitación del
engine de Bun, no del código.

Medido sobre el binario empaquetado bajo Node: **40 clientes SSE abiertos y
cortados más 300 requests movieron el servidor de 62 MB a 64 MB.** El artefacto
que se publica no tiene la fuga. El punto queda cerrado.

## Fuera del alcance

- **Publicar a npm.** El paquete está listo; apretar el botón es una decisión
  del dueño del repo, no de este plan.
- **Templating `{{uuid}}`** (defecto E del análisis de v1) sigue sin plan
  asignado.
- **Binarios standalone** (`bun build --compile`): el paquete de npm cubre el
  caso de uso, y un binario por plataforma es un pipeline de release entero.
