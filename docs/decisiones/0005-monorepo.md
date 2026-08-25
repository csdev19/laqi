# ADR-0005 — Monorepo alineado con rakoi

**Estado:** Aceptada
**Fecha:** 2026-08-24

## Contexto

v1 era un paquete npm plano de cuatro archivos. v2 tiene al menos cuatro
artefactos distintos con ciclos de vida distintos: el CLI que se publica a npm,
la UI del editor web, un servidor MCP, un Worker de Cloudflare para el relay, y
un sitio de documentación.

## Decisión

**Monorepo**, con las mismas herramientas que `rakoi-monorepo`: Bun workspaces
con catalog, Turborepo, oxlint + oxfmt, Vitest, tsdown para publicar, Zod 4,
Astro + Starlight para la documentación.

```
laqi/
├── apps/
│   ├── cli/            @laqi/cli — el binario `laqi`. Esto es lo que va a npm.
│   ├── documentation/  Astro + Starlight, igual que rakoi
│   └── relay/          Cloudflare Worker — la URL pública propia (fase 2)
└── packages/
    ├── core/           parser, validación, tabla de rutas, resolución de estado
    ├── server/         la app Hono — corre igual en Node, Bun y Workers
    ├── editor/         la UI web, embebida en el CLI y servida en /__laqi
    ├── mcp/            servidor MCP
    └── schema/         Zod + JSON Schema generado
```

## Por qué

**1. `core` y `server` separados es lo que hace posible el relay.**

Es la razón estructural principal. `server` es una app Hono sobre Web Standards
que no sabe si corre en Node o en un Worker. Eso permite que **el mismo servidor
corra en tu máquina y en el edge** sin duplicar código
([ADR-0007](0007-url-publica.md)).

**2. El editor web se embebe, no se despliega.**

`packages/editor` es una app React + Vite que se compila a assets estáticos y se
sirve desde el propio CLI en `http://localhost:8000/__laqi`. Sin app aparte, sin
cuenta, sin login: `laqi` levanta el mock y su panel de control en el mismo
proceso. El editor, el MCP y una API de control HTTP hablan los tres contra el
mismo *control plane* dentro de `core`.

**3. `schema` aislado porque lo consumen cuatro cosas.**

Las definiciones Zod las usan el CLI (validar al cargar), el editor (validar
formularios), el MCP (describir sus herramientas al modelo) y el JSON Schema
publicado (autocompletado en VSCode). Una sola fuente de verdad.

**4. Alinearse con rakoi baja el costo de contexto.**

Mismo gestor de paquetes, mismo linter, mismo runner de tests, misma forma de
publicar. Moverse entre repos no cuesta recontextualizarse.

## Lo que NO se copia de rakoi

**DDD + arquitectura hexagonal.** rakoi es una app de negocio con reglas de
dominio que justifican las capas `domain ← application ← infra`. laqi es una
herramienta de cuatro piezas sin dominio de negocio: aplicar esas capas acá sería
ceremonia sin beneficio.

**Sí se adopta la política de TDD** del `CLAUDE.md` de rakoi: ningún código de
producción sin un test que falle primero.

**Y sí se adopta el enfoque MVP-first:** hacer que funcione punta a punta antes
de refactorizar a la estructura final.

## Alternativas consideradas

**Seguir con un paquete plano.** Descartada: el Worker del relay y el sitio de
documentación no pueden vivir en el mismo paquete npm que el CLI, y meter la UI
del editor en el mismo `package.json` que el servidor mezcla dependencias de
frontend con las del binario que se instala vía `npx`.

**Repos separados.** Descartada: `core` y `schema` cambian a la vez que sus
consumidores. Repos separados obligarían a publicar y versionar en cada
iteración, sobre un proyecto de una sola persona.

## Consecuencias

**A favor:**
- El servidor se escribe una vez y corre local y en el edge.
- El CLI publicado a npm no arrastra dependencias del editor ni de la documentación.
- Turborepo cachea builds y tests por paquete.

**En contra:**
- Más ceremonia inicial que un solo `package.json`.
- Hay que cuidar que `apps/cli` empaquete los assets del editor ya compilados —
  si no, `npx laqi` se rompe.
- Bun como gestor de paquetes para desarrollar, aunque el artefacto publicado
  debe correr en Node sin Bun. Hay que testear ambos.
