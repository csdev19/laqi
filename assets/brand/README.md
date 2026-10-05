# Brand assets

Canonical home for every laqi brand asset. Apps keep their own copies
(Astro `public/` dirs cannot reach outside their app), but this folder
is the source of truth — update here first, then re-copy.

## Naming convention

- No suffix = **dark mode** variant, the default (`icon.svg`, `logo.png`).
- `-light` suffix = **light mode** variant (`icon-light.svg`, `logo-light.png`).

## Files

| File                            | What it is                                                                                         | Used at                                          |
| ------------------------------- | -------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `favicon.svg`                   | App-tile mark: bolt on violet rounded square. Works on any background, so it has no light variant. | Browser tabs — site, docs, and the control panel |
| `icon.svg`                      | Bare bolt, plum shadow — for dark surfaces                                                         | Site nav, Starlight logo (dark)                  |
| `icon-light.svg`                | Bare bolt, pink shadow — for light surfaces                                                        | Starlight logo (light)                           |
| `logo.png`                      | Full lockup (bolt + wordmark), transparent, light text — for dark surfaces                         | README (dark), site footer                       |
| `logo-light.png`                | Full lockup, transparent, dark text — for light surfaces                                           | README (light)                                   |
| `apple-touch-icon.png`          | 180×180 raster of the favicon (generated from `favicon.svg` with sharp)                            | iOS home screen                                  |
| `icon-192.png` / `icon-512.png` | Webmanifest rasters (generated)                                                                    | Android / PWA install                            |
| `og-image.png`                  | 1200×630 social card: lockup + tagline on brand dark (generated)                                   | Link previews — Twitter, Slack, Discord          |

## The bolt on a tile

Neither SVG above is the right file for a mark sitting on a coloured tile,
and using one anyway is how the nav and the hero ended up looking like two
different logos.

`icon.svg` is the **bare** bolt for a dark surface: violet, with a plum
shadow offset behind it. On a violet tile the bolt loses its contrast and the
shadow becomes what the eye reads — and because the offset is a fixed share
of the viewBox, it collapses into the bolt at nav size and separates from it
at display size. Same file, two apparent shapes.

`favicon.svg` carries the correct white bolt, but welded to a flat violet
square, and the site's tile is a 145° gradient.

So a mark on a tile inlines the shape and takes `currentColor`:
`apps/site/src/components/home/BoltMark.astro`, path copied from `icon.svg`,
viewBox `0 0 210 309` — the bolt is taller than it is wide and must not be
given a square box. White on a tile, `--vio` when bare.

If the bolt's outline ever changes, that path changes with these files.

## Copies to keep in sync

- `apps/site/public/` — favicon.svg, icon.svg, icon-light.svg, logo.png, logo-light.png, apple-touch-icon.png, icon-192.png, icon-512.png, og-image.png
- `apps/site/src/assets/` — icon.svg, icon-light.svg (Starlight logo imports)
- `apps/documentation/public/` — favicon.svg
- `apps/documentation/src/assets/` — icon.svg, icon-light.svg
- `packages/editor/public/` — favicon.svg
