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

## Copies to keep in sync

- `apps/site/public/` — favicon.svg, icon.svg, icon-light.svg, logo.png, logo-light.png, apple-touch-icon.png, icon-192.png, icon-512.png, og-image.png
- `apps/site/src/assets/` — icon.svg, icon-light.svg (Starlight logo imports)
- `apps/documentation/public/` — favicon.svg
- `apps/documentation/src/assets/` — icon.svg, icon-light.svg
- `packages/editor/public/` — favicon.svg
