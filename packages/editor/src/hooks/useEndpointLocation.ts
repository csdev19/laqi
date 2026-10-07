import { useCallback, useEffect, useState } from 'react'
import { endpointFromSearch, searchForEndpoint } from '../location'

/**
 * The detail pane's endpoint id, kept in the URL (see `location.ts`) so a
 * reload stays on it, back/forward move between it and the list, and the
 * address bar is a link worth sharing.
 *
 * Every in-panel change is a `pushState`, opening and closing alike: the
 * browser's Back always undoes the last thing the panel did, which is what
 * a router would do too. Nothing is ever replaced, so an id the project does
 * not have stays in the URL: the list shows meanwhile, and the detail comes
 * back by itself when the endpoint does — a file being fixed, a link to an
 * endpoint about to be created.
 *
 * Returns the same tuple `useState` would: callers set the id and the URL
 * follows. Setting the id the URL already has is a no-op, so a jump from the
 * log to the endpoint already open adds no entry.
 */
export function useEndpointLocation(): [string | null, (id: string | null) => void] {
  const [detailId, setLocalId] = useState<string | null>(() =>
    endpointFromSearch(window.location.search),
  )

  useEffect(() => {
    const onPopState = () => setLocalId(endpointFromSearch(window.location.search))
    window.addEventListener('popstate', onPopState)
    return () => window.removeEventListener('popstate', onPopState)
  }, [])

  const setDetailId = useCallback((id: string | null) => {
    setLocalId(id)
    const { pathname, search, hash } = window.location
    if (endpointFromSearch(search) === id) return
    window.history.pushState(null, '', `${pathname}${searchForEndpoint(search, id)}${hash}`)
  }, [])

  return [detailId, setDetailId]
}
