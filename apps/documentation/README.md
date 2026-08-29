# @laqi/documentation

laqi's documentation site, built with [Astro](https://astro.build) +
[Starlight](https://starlight.astro.build). Contains the decision log,
concepts, design and plans that used to live in `docs/` and `documentacion/`
at the root of the monorepo.

## Structure

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

Starlight looks for `.md`/`.mdx` files in `src/content/docs/`. Each file is
exposed as a route based on its name and folder.

## Commands

From the monorepo root (with Bun + Turborepo):

| Command                                      | Action                                      |
| -------------------------------------------- | ------------------------------------------- |
| `bun install`                                | Installs dependencies                       |
| `bun run dev --filter=@laqi/documentation`   | Starts the local server at `localhost:4321` |
| `bun run build --filter=@laqi/documentation` | Builds the site to `./dist/`                |

It can also be run directly from `apps/documentation`:

| Command         | Action                                    |
| --------------- | ----------------------------------------- |
| `bun dev`       | Local server at `localhost:4321`          |
| `bun build`     | Production build in `./dist/`             |
| `bun preview`   | Preview of the local build                |
| `bun astro ...` | Astro CLI (`astro add`, `astro check`, …) |
