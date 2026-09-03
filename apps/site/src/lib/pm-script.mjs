/**
 * The blocking `<head>` script that picks the visible install command.
 *
 * A string rather than a component, because it has two consumers that cannot
 * share one: the hand-built landing page (`src/pages/index.astro`, its own
 * `<head>`) and every Starlight docs page (`astro.config.mjs`'s `head`
 * array, which takes tag descriptors, not components). One definition, two
 * injection points.
 *
 * `.mjs` and not `.ts` so `astro.config.mjs` can import it directly.
 *
 * It must run BEFORE the body paints. CSS keys off `data-pm` on the root
 * element, so a script that ran on DOMContentLoaded would render npm and
 * then visibly swap.
 */
export const PM_STORAGE_KEY = 'laqi:pm'

export const PM_INLINE_SCRIPT = `
;(() => {
  var ids = ['npm', 'pnpm', 'yarn', 'bun']
  var KEY = '${PM_STORAGE_KEY}'
  var fallback = 'npm'

  function read() {
    try {
      var stored = localStorage.getItem(KEY)
      return ids.indexOf(stored) !== -1 ? stored : fallback
    } catch (error) {
      // Safari in private mode throws on access. An exception here would
      // leave data-pm unset and every command on the page hidden.
      return fallback
    }
  }

  function apply(id) {
    document.documentElement.setAttribute('data-pm', id)
    try {
      localStorage.setItem(KEY, id)
    } catch (error) {
      // The choice still applies to this page; it just will not persist.
    }
  }

  apply(read())

  // The toggle buttons call this. On window rather than wired up here
  // because this script runs before any of those buttons exist.
  window.__laqiSetPm = function (id) {
    if (ids.indexOf(id) !== -1) apply(id)
  }
})()
`.trim()
