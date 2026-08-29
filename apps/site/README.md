# @laqi/site

laqi's public site — the landing page and user-facing docs at laqi.dev.
Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

Separate from `apps/documentation`, which holds this repository's
internal ADRs, plans, and design docs and is never deployed.

## Structure

- `src/pages/index.astro` — the landing page, assembled from
  `src/components/*.astro`. Not part of Starlight's own routing.
- `src/content/docs/docs/**` — user docs, served at `/docs/*`.
- `src/content/docs/es/docs/**` — the Spanish docs locale, served at
  `/es/docs/*`.

## Commands

From the monorepo root:

| Command                                          | Action                               |
| ------------------------------------------------ | ------------------------------------ |
| `bun run --filter=@laqi/site dev`                | Local server at `localhost:4321`     |
| `bun run build --filter=@laqi/site`              | Production build to `./dist/`        |
| `bun scripts/site/content-lint.ts apps/site/src` | Check for "Laqi"/"LAQI" outside code |

## Deploying

`.github/workflows/deploy-site.yml` deploys `apps/site/dist` to Cloudflare
Pages on every push to `main` that touches `apps/site/**` or
`packages/tokens/**`. Requires two repository secrets:
`CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (Cloudflare Pages:
Edit permission), and a Cloudflare Pages project named `laqi-dev`
created once by hand.
