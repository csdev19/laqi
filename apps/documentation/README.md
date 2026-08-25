# @laqi/documentation

Sitio de documentación de laqi, construido con [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build). Contiene el registro de decisiones,
conceptos, diseño y planes que antes vivían en `docs/` y `documentacion/` en la
raíz del monorepo.

## Estructura

```
.
├── public/
├── src/
│   ├── assets/
│   ├── content/
│   │   └── docs/
│   └── content.config.ts
├── astro.config.mjs
├── package.json
└── tsconfig.json
```

Starlight busca archivos `.md`/`.mdx` en `src/content/docs/`. Cada archivo se
expone como una ruta según su nombre y carpeta.

## Comandos

Desde la raíz del monorepo (con Bun + Turborepo):

| Comando                                      | Acción                                        |
| -------------------------------------------- | --------------------------------------------- |
| `bun install`                                | Instala dependencias                          |
| `bun run dev --filter=@laqi/documentation`   | Levanta el servidor local en `localhost:4321` |
| `bun run build --filter=@laqi/documentation` | Compila el sitio a `./dist/`                  |

También se puede correr directamente desde `apps/documentation`:

| Comando         | Acción                                       |
| --------------- | -------------------------------------------- |
| `bun dev`       | Servidor local en `localhost:4321`           |
| `bun build`     | Build de producción en `./dist/`             |
| `bun preview`   | Preview del build local                      |
| `bun astro ...` | CLI de Astro (`astro add`, `astro check`, …) |
