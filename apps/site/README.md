# @laqi/site

laqi's public site — the landing page and user-facing docs at laqi.dev.
Built with [Astro](https://astro.build) + [Starlight](https://starlight.astro.build).

Separate from `apps/documentation`, which holds this repository's
internal ADRs, plans, and design docs and is never deployed.

## Structure

- `src/pages/index.astro` — the home page: nine sections walked top to
  bottom, assembled from `src/components/home/*.astro`. Not part of
  Starlight's own routing.
- `src/lib/chapters.ts` — the single source for the rail, the overview
  chips and the section ids. Add a section there, not in the page.
- `src/pages/the-name.astro` — the standalone page explaining the name.
- `src/content/docs/docs/**` — user docs, served at `/docs/*`.

There is no Spanish locale. `astro.config.mjs` declares a single root
locale on purpose, so Starlight renders no language selector — one that
offered a single entry would promise an i18n the product does not have.

## Commands

From the monorepo root:

| Command                                          | Action                               |
| ------------------------------------------------ | ------------------------------------ |
| `bun run --filter=@laqi/site dev`                | Local server at `localhost:4321`     |
| `bun run build --filter=@laqi/site`              | Production build to `./dist/`        |
| `bun scripts/site/content-lint.ts apps/site/src` | Check for "Laqi"/"LAQI" outside code |

## Deploying

`.github/workflows/deploy-site.yml` deploys `apps/site/dist` to Cloudflare
**Workers** static assets — not Pages, because only Workers can bind a
custom domain from config (`apps/site/wrangler.jsonc`).

It runs on a `site-v*` tag, which release-please cuts when a site release
PR is merged — never on an ordinary push to `main`. `workflow_dispatch` is
the manual escape hatch and deploys whatever `main` currently holds.

Consequence worth knowing: a release of the CLI does not redeploy the
site. Anything the site renders from the CLI's version at build time will
be stale until the next site release, which is why the nav no longer
carries a version badge.

## Looking at it

The site has no visual test, so changes to it are checked by rendering the
page and reading the result, not by grepping the HTML. Chrome renders a
full-page shot headlessly:

```sh
bun run --filter=@laqi/site build
bun run --filter=@laqi/site preview --port 4370 &

"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  --headless --disable-gpu --force-device-scale-factor=1 \
  --window-size=1600,6000 --virtual-time-budget=4000 \
  --screenshot=/tmp/laqi.png http://localhost:4370/

# a section, by vertical offset
sips -c 820 1600 --cropOffset 4850 0 /tmp/laqi.png --out /tmp/flip.png
```

Grepping the built CSS is not a substitute. Several components share class
names — `.panel`, `.head`, `.tile` — and Astro scopes each one, so a search
for a rule returns whichever component matched first. Search by the scope
id (`.panel:where(.astro-bjypieal)`) or rename the class.

## Unused, pending deletion

The home page was rebuilt on 2026-10-02 and the previous landing sections
were left in the tree rather than deleted in the same change. None of them
is reachable from `src/pages/`:

| File                                | Replaced by                               |
| ----------------------------------- | ----------------------------------------- |
| `components/Hero.astro`             | `components/home/Hero.astro`              |
| `components/SiteNav.astro`          | `components/home/TopNav.astro`            |
| `components/ForWhom.astro`          | `components/home/Moments.astro`           |
| `components/QuickStart.astro`       | the `contract` chapter                    |
| `components/ResolutionLayers.astro` | the `watch` chapter                       |
| `components/FeatureGrid.astro`      | the four chapters                         |
| `components/McpSection.astro`       | nothing yet — see below                   |
| `components/FinalCta.astro`         | `components/home/Start.astro`             |
| `components/InstallCommand.astro`   | the install button in the hero and CTA    |
| `components/Demo.astro`             | nothing yet — see below                   |
| `lib/demos.ts`                      | nothing yet — see below                   |
| `lib/version.ts`                    | nothing; `version.test.ts` still tests it |

`components/Hero.astro` and `components/FeatureGrid.astro` are already gone.
They were the only two that referenced the demo slots, and when the three
recordings became one they stopped compiling — keeping them would have meant
re-adding dead data so that dead code could still type-check. Git has them.

**Delete the rest on or after 2026-11-02** if still unreferenced. Check before
deleting rather than trusting this list:

```sh
python3 - <<'PY'
# prints every .astro/.ts under src/ that no page reaches
PY
```

Two of these are not simply dead, and deleting them loses something:

- `Demo.astro` has moved to `components/home/` and is wired into the hero.
  Dropping a file into `public/demos/` turns the slot on, and its CTA with it.
- `McpSection.astro` is the only place the site explained the MCP server on
  the landing. The new home links `/docs/ai-agents/` from nowhere.
