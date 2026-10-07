/**
 * The one piece of panel state that lives in the URL: which endpoint the
 * detail pane shows. `/__laqi?endpoint=POST%20/auth/login` opens that
 * endpoint; no param is the list.
 *
 * A query param rather than a hash because the server serves `/__laqi` for
 * any query string and a shared `--share` link reads as one URL, not an
 * anchor. Only the endpoint id goes in: the response that is live is server
 * state (overrides, scenario), and a link that flipped it on open would be a
 * GET with side effects.
 */

export const ENDPOINT_PARAM = 'endpoint'

/** The endpoint id a `location.search` names, or null for the list. */
export function endpointFromSearch(search: string): string | null {
  const id = new URLSearchParams(search).get(ENDPOINT_PARAM)
  return id === null || id === '' ? null : id
}

/**
 * The `location.search` that shows `id` (or the list, with null), keeping
 * any other params as they were. The id is encoded by hand instead of via
 * URLSearchParams so the slashes in the path stay readable in the address
 * bar: `POST%20/auth/login`, not `POST+%2Fauth%2Flogin`.
 */
export function searchForEndpoint(search: string, id: string | null): string {
  const params = new URLSearchParams(search)
  params.delete(ENDPOINT_PARAM)
  const rest = params.toString()
  if (id === null) return rest === '' ? '' : `?${rest}`
  const own = `${ENDPOINT_PARAM}=${encodeURIComponent(id).replace(/%2F/g, '/')}`
  return rest === '' ? `?${own}` : `?${rest}&${own}`
}
