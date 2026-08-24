# ADR-0002 — Hono como framework HTTP

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

v1 usaba Express 4.17.2 (de 2021), con diecinueve vulnerabilidades en el árbol de
dependencias y una API que fuerza `res.status("200")` con strings. Había que
cambiar. Los candidatos serios eran **Hono** y **Elysia**.

## Decisión

**Hono.**

## Por qué

**1. Elysia es Bun-first, y laqi se distribuye por npm.**

La razón de ser de Elysia es Bun. Tiene adaptador de Node, pero es ciudadano de
segunda. laqi se instala con `npx laqi` y su público son devs de frontend que
tienen Node y no necesariamente Bun. **Exigir Bun instalado es un muro de
adopción** que una herramienta de este tipo no puede permitirse.

**2. El framework y la URL pública son la misma decisión.**

Ésta es la razón que decide. El relay propio de
[ADR-0007](0007-url-publica.md) corre en Cloudflare Workers. Hono corre en
Node, Bun, Deno, Workers, Vercel y Lambda sobre Web Standards
(`Request`/`Response`), así que **el mismo `packages/server` corre en el CLI local
y en el relay del edge**. Con Elysia habría que mantener dos implementaciones.

**3. Ya está en el stack.**

`rakoi-monorepo` tiene `hono@4.12.3` en el catalog de Bun workspaces, y un
`packages/infra-cloudflare` con `@cloudflare/workers-types`. El terreno ya está
pisado.

**4. Cosas menores que suman.**

`RegExpRouter` es el router JS más rápido que hay. El paquete pesa ~14kB, que
importa en un CLI que se instala con `npx`. Y `hono/client` da RPC tipado, útil
si algún día laqi genera un cliente TypeScript a partir de los mocks.

## Alternativas consideradas

**Elysia.** Mejor en benchmarks puros y con un DX de tipos excelente. Descartada
por los puntos 1 y 2: el acoplamiento a Bun choca con la distribución por npm, y
no corre en Workers, que es donde vive el relay.

**Express 5.** Descartada: resolvía las vulnerabilidades pero no aporta nada
hacia las features nuevas, no corre en el edge, y la migración a v5 igual rompía
el código por los status codes como string (defecto I).

**Node HTTP puro.** Descartada: habría que escribir el router, el matching de
params y el manejo de CORS a mano. Es exactamente el trabajo que Hono ya hace
mejor.

## Consecuencias

**A favor:**
- Una sola implementación del servidor para local y edge.
- Base moderna sobre Web Standards; el árbol de dependencias se reduce drásticamente.
- Alineado con el stack existente.

**En contra:**
- Hay que reescribir el registro de endpoints y el middleware de CORS.
- El ecosistema de middleware de Express es más grande, aunque para lo que laqi
  necesita (CORS, body parsing, logging) Hono trae todo de fábrica.
